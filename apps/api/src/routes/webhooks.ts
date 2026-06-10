import type { FastifyInstance } from 'fastify';
import type { OrchestratorAgent } from '@sales/agents';
import type { AgentContext, WhatsAppMessage } from '@sales/shared';
import { WhatsAppService } from '../services/whatsapp.js';
import type { BitrixSyncService } from '@sales/bitrix';

export async function webhookRoutes(
  fastify: FastifyInstance,
  deps: {
    orchestrator: OrchestratorAgent;
    whatsapp: WhatsAppService;
    bitrixSync: BitrixSyncService;
  }
) {
  // POST /api/webhooks/whatsapp - Recebe mensagens do WhatsApp (Evolution API)
  fastify.post('/whatsapp', async (request, reply) => {
    const webhookData = request.body as WhatsAppMessage;

    // Ignora mensagens enviadas pelo próprio bot
    if (webhookData.data?.key?.remoteJid?.includes('@g.us')) {
      return reply.send({ status: 'ignored_group' });
    }

    const phone = WhatsAppService.extractSender(webhookData);
    const text = WhatsAppService.extractMessageText(webhookData);

    if (!text || !phone) return reply.send({ status: 'no_content' });

    // Busca o usuário pelo WhatsApp
    const userRes = await fastify.db.query(
      `SELECT id, name, role, company_id, team_id FROM users
       WHERE whatsapp LIKE $1 AND active = true LIMIT 1`,
      [`%${phone}%`]
    );

    if (userRes.rows.length === 0) {
      await deps.whatsapp.sendText(phone,
        '❌ Seu número não está cadastrado na plataforma. Fale com seu gestor.'
      );
      return reply.send({ status: 'user_not_found' });
    }

    const user = userRes.rows[0];
    const ctx: AgentContext = {
      user_id: user.id,
      company_id: user.company_id,
      team_id: user.team_id,
      user_role: user.role,
      user_name: user.name,
      channel: 'whatsapp',
    };

    // Processa a mensagem em background e responde
    try {
      await deps.whatsapp.sendText(phone, '⏳ Analisando...');

      const response = await deps.orchestrator.route(text, ctx);

      // Quebra mensagens longas em partes de 4000 chars (limite WhatsApp)
      const chunks = splitMessage(response.message, 4000);
      for (const chunk of chunks) {
        await deps.whatsapp.sendText(phone, chunk);
      }
    } catch (err) {
      fastify.log.error(err);
      await deps.whatsapp.sendText(phone,
        '❌ Ocorreu um erro ao processar sua mensagem. Tente novamente.'
      );
    }

    return reply.send({ status: 'processed' });
  });

  // POST /api/webhooks/bitrix - Recebe eventos do Bitrix24
  fastify.post('/bitrix', async (request, reply) => {
    const event = request.body as {
      event: string;
      data: { FIELDS: Record<string, string> };
      auth: { domain: string };
    };

    fastify.log.info({ event: event.event }, 'Bitrix24 webhook received');

    // Processa em background
    setImmediate(async () => {
      try {
        if (event.event === 'ONCRMDEALWON') {
          await handleDealWon(fastify, deps, event.data.FIELDS);
        } else if (event.event.startsWith('ONCRMDEAL')) {
          await syncDeal(fastify, deps, event.data.FIELDS.ID);
        }
      } catch (err) {
        fastify.log.error(err, 'Error processing Bitrix24 webhook');
      }
    });

    return reply.send({ status: 'received' });
  });
}

async function handleDealWon(
  fastify: FastifyInstance,
  deps: { orchestrator: OrchestratorAgent },
  fields: Record<string, string>
) {
  const dealId = fields.ID;
  const res = await fastify.db.query(
    `SELECT d.*, u.id as user_id, u.company_id, u.whatsapp
     FROM deals d JOIN users u ON d.assigned_user_id = u.id
     WHERE d.id = $1`,
    [dealId]
  );
  if (!res.rows[0]) return;

  const deal = res.rows[0];
  const gamAgent = deps.orchestrator.getAgent('gamification') as import('@sales/agents').GamificationAgent;
  if (gamAgent) {
    await (gamAgent as import('@sales/agents').GamificationAgent).processDealWon(
      deal.user_id, deal.value ?? 0, deal.company_id
    );
  }
}

async function syncDeal(
  fastify: FastifyInstance,
  _deps: object,
  dealId: string
) {
  fastify.log.info({ dealId }, 'Syncing deal from Bitrix24');
  // A sincronização completa é feita pelo scheduler
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of text.split('\n')) {
    if ((current + '\n' + paragraph).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = paragraph;
    } else {
      current += (current ? '\n' : '') + paragraph;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}
