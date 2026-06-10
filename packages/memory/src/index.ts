import { Pool } from 'pg';
import Redis from 'ioredis';
import OpenAI from 'openai';
import type { Memory, MemorySearchResult, AgentType } from '@sales/shared';

export interface MemoryServiceConfig {
  databaseUrl: string;
  redisUrl: string;
  openaiApiKey: string;
}

export class MemoryService {
  private pool: Pool;
  private redis: Redis;
  private openai: OpenAI;

  constructor(config: MemoryServiceConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
    this.redis = new Redis(config.redisUrl);
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
  }

  // ─── Embeddings ─────────────────────────────────────────────

  private async embed(text: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return res.data[0].embedding;
  }

  // ─── Armazenar memória ───────────────────────────────────────

  async store(memory: Omit<Memory, 'id' | 'created_at'>): Promise<string> {
    const embedding = await this.embed(memory.content);
    const embeddingStr = `[${embedding.join(',')}]`;

    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO agent_memories (user_id, company_id, agent_type, memory_type, content, summary, embedding, importance, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9)
       RETURNING id`,
      [
        memory.user_id ?? null,
        memory.company_id,
        memory.agent_type,
        memory.memory_type,
        memory.content,
        memory.summary ?? null,
        embeddingStr,
        memory.importance,
        JSON.stringify(memory.metadata),
      ]
    );

    // Invalida cache de memórias desse usuário
    if (memory.user_id) {
      await this.redis.del(`memories:${memory.user_id}:${memory.agent_type}`);
    }

    return res.rows[0].id;
  }

  // ─── Busca semântica ─────────────────────────────────────────

  async search(query: string, options: {
    user_id?: string;
    company_id: string;
    agent_type?: AgentType;
    limit?: number;
    min_similarity?: number;
  }): Promise<MemorySearchResult[]> {
    const embedding = await this.embed(query);
    const embeddingStr = `[${embedding.join(',')}]`;

    const res = await this.pool.query<MemorySearchResult>(
      `SELECT * FROM search_memories($1::vector, $2, $3, $4, $5, $6)`,
      [
        embeddingStr,
        options.user_id ?? null,
        options.company_id,
        options.agent_type ?? null,
        options.limit ?? 10,
        options.min_similarity ?? 0.65,
      ]
    );

    // Atualiza accessed_at em background
    res.rows.forEach(row => {
      this.pool.query('SELECT touch_memory($1)', [row.id]).catch(() => {});
    });

    return res.rows;
  }

  // ─── Memórias recentes (sem embedding) ──────────────────────

  async getRecent(options: {
    user_id?: string;
    company_id: string;
    agent_type?: AgentType;
    limit?: number;
  }): Promise<Memory[]> {
    const res = await this.pool.query<Memory>(
      `SELECT id, user_id, company_id, agent_type, memory_type, content, summary, importance, metadata, created_at
       FROM agent_memories
       WHERE company_id = $1
         AND ($2::uuid IS NULL OR user_id = $2 OR user_id IS NULL)
         AND ($3::text IS NULL OR agent_type = $3)
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY importance DESC, created_at DESC
       LIMIT $4`,
      [options.company_id, options.user_id ?? null, options.agent_type ?? null, options.limit ?? 20]
    );
    return res.rows;
  }

  // ─── Sessão de conversa (Redis) ──────────────────────────────

  async getConversationHistory(
    userId: string,
    agentType: AgentType,
    maxMessages = 20
  ): Promise<Array<{ role: string; content: string }>> {
    const key = `conv:${userId}:${agentType}`;
    const raw = await this.redis.lrange(key, -maxMessages, -1);
    return raw.map(r => JSON.parse(r) as { role: string; content: string });
  }

  async appendConversation(
    userId: string,
    agentType: AgentType,
    message: { role: string; content: string }
  ): Promise<void> {
    const key = `conv:${userId}:${agentType}`;
    await this.redis.rpush(key, JSON.stringify(message));
    await this.redis.expire(key, 60 * 60 * 24 * 7); // 7 dias
    // Mantém apenas os últimos 100 mensagens
    await this.redis.ltrim(key, -100, -1);
  }

  async clearConversation(userId: string, agentType: AgentType): Promise<void> {
    await this.redis.del(`conv:${userId}:${agentType}`);
  }

  // ─── Cache de contexto ───────────────────────────────────────

  async cacheSet(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    await this.redis.set(`cache:${key}`, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async cacheGet<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(`cache:${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async cacheInvalidate(pattern: string): Promise<void> {
    const keys = await this.redis.keys(`cache:${pattern}`);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  // ─── Limpeza ─────────────────────────────────────────────────

  async pruneOldMemories(olderThanDays = 90, minImportance = 0.3): Promise<number> {
    const res = await this.pool.query(
      `DELETE FROM agent_memories
       WHERE expires_at < NOW()
          OR (created_at < NOW() - ($1 || ' days')::INTERVAL AND importance < $2)
       RETURNING id`,
      [olderThanDays, minImportance]
    );
    return res.rowCount ?? 0;
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.pool.end(), this.redis.quit()]);
  }
}
