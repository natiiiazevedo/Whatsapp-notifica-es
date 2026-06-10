import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

import dbPlugin from './plugins/db.js';
import authPlugin from './plugins/auth.js';
import { agentRoutes } from './routes/agents.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { webhookRoutes } from './routes/webhooks.js';

import { OrchestratorAgent } from '@sales/agents';
import { MemoryService } from '@sales/memory';
import { Bitrix24Client, BitrixSyncService } from '@sales/bitrix';
import { WhatsAppService } from './services/whatsapp.js';
import { startScheduler } from './services/scheduler.js';

async function bootstrap() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty' }
        : undefined,
    },
  });

  // ─── Plugins ────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req as { user?: { id: string } }).user?.id ?? req.ip,
  });

  await fastify.register(dbPlugin);
  await fastify.register(authPlugin);

  // ─── Serviços ────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const memory = new MemoryService({
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL!,
    openaiApiKey: process.env.OPENAI_API_KEY!,
  });

  const deps = { anthropic, db: fastify.db, memory };
  const orchestrator = new OrchestratorAgent(deps);
  const whatsapp = new WhatsAppService();

  // Bitrix24
  const bitrixClient = new Bitrix24Client({
    domain: process.env.BITRIX24_DOMAIN!,
    userId: process.env.BITRIX24_USER_ID!,
    webhookToken: process.env.BITRIX24_WEBHOOK_TOKEN!,
  });

  // Carrega mapeamento bitrix_user_id → nosso UUID
  const userMapRes = await fastify.db.query(
    `SELECT id, bitrix_user_id FROM users WHERE bitrix_user_id IS NOT NULL`
  );
  const userBitrixMap = new Map<string, string>(
    userMapRes.rows.map((r: { id: string; bitrix_user_id: string }) => [r.bitrix_user_id, r.id])
  );

  const bitrixSync = new BitrixSyncService(
    bitrixClient,
    process.env.COMPANY_ID ?? '',
    userBitrixMap,
  );

  // ─── Rotas ──────────────────────────────────────────────────
  fastify.register(authRoutes, { prefix: '/api/auth' });
  fastify.register(agentRoutes, { prefix: '/api/agents', orchestrator });
  fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
  fastify.register(webhookRoutes, { prefix: '/api/webhooks', orchestrator, whatsapp, bitrixSync });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // ─── Scheduler ──────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'test') {
    startScheduler({ db: fastify.db, orchestrator, whatsapp, bitrixSync });
  }

  // ─── Start ──────────────────────────────────────────────────
  try {
    const port = parseInt(process.env.API_PORT ?? '3001');
    const host = process.env.API_HOST ?? '0.0.0.0';
    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on ${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

bootstrap();
