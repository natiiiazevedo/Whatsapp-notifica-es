import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import type {
  AgentType, AgentContext, AgentResponse, AgentAction,
  Deal, Activity, UserMetrics, Insight
} from '@sales/shared';
import type { MemoryService } from '@sales/memory';

export type Tool = Anthropic.Messages.Tool;
export type ToolResultBlockParam = Anthropic.Messages.ToolResultBlockParam;
export type MessageParam = Anthropic.Messages.MessageParam;

export interface AgentDeps {
  anthropic: Anthropic;
  db: Pool;
  memory: MemoryService;
}

export abstract class BaseAgent {
  protected model = 'claude-sonnet-4-6';
  protected maxTokens = 4096;

  constructor(
    readonly agentType: AgentType,
    protected deps: AgentDeps,
  ) {}

  protected abstract systemPrompt(ctx: AgentContext): string;
  protected abstract tools(ctx: AgentContext): Tool[];

  // Executa uma tool call e retorna o resultado como string
  protected abstract executeTool(
    name: string,
    input: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<string>;

  async run(userMessage: string, ctx: AgentContext): Promise<AgentResponse> {
    // 1. Recupera histórico de conversa
    const history = await this.deps.memory.getConversationHistory(ctx.user_id, this.agentType);

    // 2. Busca memórias relevantes
    const memories = await this.deps.memory.search(userMessage, {
      user_id: ctx.user_role === 'salesperson' ? ctx.user_id : undefined,
      company_id: ctx.company_id,
      agent_type: this.agentType,
      limit: 5,
      min_similarity: 0.65,
    });

    const memoryContext = memories.length > 0
      ? `\n\n**Memórias relevantes do histórico:**\n${memories.map(m => `- ${m.summary ?? m.content}`).join('\n')}`
      : '';

    // 3. Monta mensagens
    const messages: MessageParam[] = [
      ...history as MessageParam[],
      { role: 'user', content: userMessage + memoryContext },
    ];

    // 4. Agentic loop com tool use
    const actions: AgentAction[] = [];
    const insights: Insight[] = [];
    let finalMessage = '';

    let response = await this.deps.anthropic.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.systemPrompt(ctx),
      tools: this.tools(ctx),
      messages,
    });

    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
      );

      const toolResults: ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async toolUse => {
          try {
            const result = await this.executeTool(
              toolUse.name,
              toolUse.input as Record<string, unknown>,
              ctx,
            );
            return {
              type: 'tool_result' as const,
              tool_use_id: toolUse.id,
              content: result,
            };
          } catch (err) {
            return {
              type: 'tool_result' as const,
              tool_use_id: toolUse.id,
              content: `Erro ao executar ${toolUse.name}: ${(err as Error).message}`,
              is_error: true,
            };
          }
        })
      );

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await this.deps.anthropic.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.systemPrompt(ctx),
        tools: this.tools(ctx),
        messages,
      });
    }

    // 5. Extrai resposta de texto
    finalMessage = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // 6. Salva conversa no histórico
    await this.deps.memory.appendConversation(ctx.user_id, this.agentType, {
      role: 'user',
      content: userMessage,
    });
    await this.deps.memory.appendConversation(ctx.user_id, this.agentType, {
      role: 'assistant',
      content: finalMessage,
    });

    // 7. Armazena insight na memória longa
    if (finalMessage.length > 100) {
      await this.deps.memory.store({
        user_id: ctx.user_role === 'salesperson' ? ctx.user_id : undefined,
        company_id: ctx.company_id,
        agent_type: this.agentType,
        memory_type: 'insight',
        content: `${userMessage}\n\nResposta: ${finalMessage}`,
        summary: finalMessage.slice(0, 200),
        importance: 0.6,
        metadata: { channel: ctx.channel, timestamp: new Date().toISOString() },
      }).catch(() => {}); // não bloqueia a resposta
    }

    return {
      message: finalMessage,
      agent_type: this.agentType,
      insights,
      actions,
    };
  }

  // ─── Helpers de DB ─────────────────────────────────────────

  protected async getUserDeals(userId: string): Promise<Deal[]> {
    const res = await this.deps.db.query<Deal>(
      `SELECT * FROM deals WHERE assigned_user_id = $1 AND stage NOT IN ('won', 'lost')
       ORDER BY last_activity_at ASC`,
      [userId]
    );
    return res.rows;
  }

  protected async getCompanyDeals(companyId: string): Promise<Deal[]> {
    const res = await this.deps.db.query<Deal>(
      `SELECT * FROM deals WHERE company_id = $1 AND stage NOT IN ('won', 'lost')
       ORDER BY assigned_user_id, last_activity_at ASC`,
      [companyId]
    );
    return res.rows;
  }

  protected async getUserMetrics(userId: string, days = 30): Promise<UserMetrics> {
    const res = await this.deps.db.query<{ get_user_metrics: UserMetrics }>(
      `SELECT get_user_metrics($1, $2) AS get_user_metrics`,
      [userId, days]
    );
    return res.rows[0].get_user_metrics;
  }

  protected async getUserActivities(userId: string, limit = 20): Promise<Activity[]> {
    const res = await this.deps.db.query<Activity>(
      `SELECT * FROM activities WHERE assigned_user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  }

  protected async getTeamUsers(companyId: string, teamId?: string): Promise<Array<{
    id: string; name: string; email: string; whatsapp?: string; bitrix_user_id?: string;
  }>> {
    const res = await this.deps.db.query(
      `SELECT id, name, email, whatsapp, bitrix_user_id FROM users
       WHERE company_id = $1 AND active = true
         AND ($2::uuid IS NULL OR team_id = $2)
         AND role = 'salesperson'`,
      [companyId, teamId ?? null]
    );
    return res.rows;
  }
}
