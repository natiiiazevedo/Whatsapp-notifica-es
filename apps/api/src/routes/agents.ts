import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentContext, AgentType } from '@sales/shared';
import type { OrchestratorAgent } from '@sales/agents';

export async function agentRoutes(
  fastify: FastifyInstance,
  { orchestrator }: { orchestrator: OrchestratorAgent }
) {
  const messageSchema = z.object({
    message: z.string().min(1).max(4000),
    agent_type: z.enum(['orchestrator', 'feedback', 'carteira', 'manager', 'gamification']).optional(),
    channel: z.enum(['web', 'whatsapp', 'email']).default('web'),
    conversation_id: z.string().uuid().optional(),
  });

  // POST /api/agents/chat - Enviar mensagem para um agente
  fastify.post('/chat', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const body = messageSchema.parse(request.body);
    const { user } = request;

    const ctx: AgentContext = {
      user_id: user.id,
      company_id: user.company_id,
      user_role: user.role,
      user_name: user.name,
      channel: body.channel,
    };

    try {
      let response;
      if (body.agent_type && body.agent_type !== 'orchestrator') {
        const agent = orchestrator.getAgent(body.agent_type as AgentType);
        if (!agent) return reply.code(400).send({ error: 'Agente não encontrado' });
        response = await agent.run(body.message, ctx);
      } else {
        response = await orchestrator.route(body.message, ctx);
      }

      // Salva no DB para histórico
      await saveConversationMessage(fastify, {
        user_id: user.id,
        agent_type: response.agent_type,
        channel: body.channel,
        user_message: body.message,
        agent_response: response.message,
        conversation_id: body.conversation_id,
      });

      return reply.send(response);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Erro ao processar mensagem' });
    }
  });

  // GET /api/agents/conversations - Histórico de conversas do usuário
  fastify.get('/conversations', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const res = await fastify.db.query(
      `SELECT id, agent_type, channel, updated_at,
              (messages->-1->>'content') as last_message
       FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 20`,
      [request.user.id]
    );
    return reply.send(res.rows);
  });

  // GET /api/agents/conversations/:id - Conversa completa
  fastify.get('/conversations/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const res = await fastify.db.query(
      `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, request.user.id]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Conversa não encontrada' });
    return reply.send(res.rows[0]);
  });

  // GET /api/agents/insights - Insights gerados para o usuário
  fastify.get('/insights', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { user } = request;
    const isManager = user.role !== 'salesperson';

    const res = await fastify.db.query(
      `SELECT * FROM insights
       WHERE company_id = $1
         AND ($2 OR user_id = $3)
       ORDER BY created_at DESC
       LIMIT 50`,
      [user.company_id, isManager, user.id]
    );
    return reply.send(res.rows);
  });

  // PATCH /api/agents/insights/:id/read - Marcar insight como lido
  fastify.patch('/insights/:id/read', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await fastify.db.query(
      `UPDATE insights SET read = true WHERE id = $1 AND (user_id = $2 OR $3)`,
      [id, request.user.id, request.user.role !== 'salesperson']
    );
    return reply.send({ success: true });
  });
}

async function saveConversationMessage(
  fastify: FastifyInstance,
  data: {
    user_id: string;
    agent_type: AgentType;
    channel: string;
    user_message: string;
    agent_response: string;
    conversation_id?: string;
  }
) {
  if (data.conversation_id) {
    await fastify.db.query(
      `UPDATE conversations
       SET messages = messages || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3`,
      [
        JSON.stringify([
          { role: 'user', content: data.user_message, timestamp: new Date().toISOString() },
          { role: 'assistant', content: data.agent_response, timestamp: new Date().toISOString() },
        ]),
        data.conversation_id,
        data.user_id,
      ]
    );
  } else {
    await fastify.db.query(
      `INSERT INTO conversations (user_id, agent_type, channel, messages)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        data.user_id,
        data.agent_type,
        data.channel,
        JSON.stringify([
          { role: 'user', content: data.user_message, timestamp: new Date().toISOString() },
          { role: 'assistant', content: data.agent_response, timestamp: new Date().toISOString() },
        ]),
      ]
    );
  }
}
