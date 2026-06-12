import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentContext, AgentType } from '@sales/shared';
import type { OrchestratorAgent } from '@sales/agents';

export async function agentRoutes(
  fastify: FastifyInstance,
  { orchestrator }: { orchestrator: OrchestratorAgent }
) {
  const AGENT_TYPES = ['orchestrator', 'feedback', 'carteira', 'deal', 'postsales', 'manager', 'gamification', 'inactivity', 'agenda'] as const;

  const messageSchema = z.object({
    message: z.string().min(1).max(4000),
    agent_type: z.enum(AGENT_TYPES).optional(),
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

  // POST /api/agents/chat/stream - Chat com streaming SSE (para Agent Lab)
  fastify.post('/chat/stream', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const body = messageSchema.parse(request.body);
    const { user } = request;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    const send = (data: Record<string, unknown>) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
    };

    const ctx: AgentContext = {
      user_id: user.id,
      company_id: user.company_id,
      user_role: user.role,
      user_name: user.name,
      channel: body.channel,
    };

    let finalMessage = '';
    let finalAgentType = body.agent_type ?? 'orchestrator';

    try {
      const onEvent = (event: Record<string, unknown>) => {
        send(event);
        if (event.type === 'done') {
          finalMessage = event.message as string;
          finalAgentType = (event.agent_type as string) ?? finalAgentType;
        }
      };

      if (body.agent_type && body.agent_type !== 'orchestrator') {
        const agent = orchestrator.getAgent(body.agent_type as import('@sales/shared').AgentType);
        if (!agent) { send({ type: 'error', message: 'Agente não encontrado' }); reply.raw.end(); return reply; }
        await agent.runWithEvents(body.message, ctx, onEvent as Parameters<typeof agent.runWithEvents>[2]);
      } else {
        await orchestrator.routeWithEvents(body.message, ctx, onEvent as Parameters<typeof orchestrator.routeWithEvents>[2]);
      }

      if (finalMessage) {
        await saveConversationMessage(fastify, {
          user_id: user.id,
          agent_type: finalAgentType as import('@sales/shared').AgentType,
          channel: body.channel,
          user_message: body.message,
          agent_response: finalMessage,
          conversation_id: body.conversation_id,
        });
      }
    } catch (err) {
      fastify.log.error(err);
      send({ type: 'error', message: String(err) });
    }

    reply.raw.end();
    return reply;
  });

  // GET /api/agents/status - Status e métricas dos agentes (para Agent Lab)
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { user } = request;
    const isManager = user.role !== 'salesperson';

    const [convCount, insightCount] = await Promise.all([
      fastify.db.query(
        `SELECT COUNT(*) as total, agent_type FROM conversations
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY agent_type`,
        [user.id]
      ),
      fastify.db.query(
        `SELECT COUNT(*) as total FROM insights
         WHERE company_id = $1 AND ($2 OR user_id = $3) AND read = false`,
        [user.company_id, isManager, user.id]
      ),
    ]);

    return reply.send({
      conversations_today: convCount.rows,
      unread_insights: Number(insightCount.rows[0]?.total ?? 0),
      agents_available: ['orchestrator', 'feedback', 'carteira', 'deal', 'postsales', 'manager', 'gamification', 'inactivity', 'agenda'],
    });
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

  // GET /api/agents/configs - Listar configs de todos os agentes da empresa
  fastify.get('/configs', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const res = await fastify.db.query(
      `SELECT agent_type, active, personalidade, instrucoes, restricoes, empresa, updated_at,
              u.name as updated_by_name
       FROM agent_configs ac
       LEFT JOIN users u ON u.id = ac.updated_by
       WHERE ac.company_id = $1
       ORDER BY agent_type`,
      [request.user.company_id]
    );

    // Se não houver configs ainda, retorna defaults
    if (res.rows.length === 0) {
      return reply.send(DEFAULT_AGENT_CONFIGS);
    }
    return reply.send(res.rows);
  });

  // GET /api/agents/configs/:type - Config de um agente específico
  fastify.get('/configs/:type', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { type } = request.params as { type: string };
    const res = await fastify.db.query(
      `SELECT agent_type, active, personalidade, instrucoes, restricoes, empresa, updated_at
       FROM agent_configs WHERE company_id = $1 AND agent_type = $2`,
      [request.user.company_id, type]
    );
    if (res.rows.length === 0) {
      const def = DEFAULT_AGENT_CONFIGS.find(c => c.agent_type === type);
      if (!def) return reply.code(404).send({ error: 'Agente não encontrado' });
      return reply.send(def);
    }
    return reply.send(res.rows[0]);
  });

  // PUT /api/agents/configs/:type - Atualizar config (apenas gestores)
  fastify.put('/configs/:type', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role === 'salesperson') {
      return reply.code(403).send({ error: 'Apenas gestores podem editar configurações de agentes' });
    }

    const { type } = request.params as { type: string };
    const configSchema = z.object({
      active: z.boolean().optional(),
      personalidade: z.string().max(5000).optional(),
      instrucoes: z.string().max(5000).optional(),
      restricoes: z.string().max(2000).optional(),
      empresa: z.string().max(2000).optional(),
    });

    const body = configSchema.parse(request.body);

    await fastify.db.query(
      `INSERT INTO agent_configs (company_id, agent_type, active, personalidade, instrucoes, restricoes, empresa, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (company_id, agent_type) DO UPDATE SET
         active        = COALESCE(EXCLUDED.active, agent_configs.active),
         personalidade = COALESCE(EXCLUDED.personalidade, agent_configs.personalidade),
         instrucoes    = COALESCE(EXCLUDED.instrucoes, agent_configs.instrucoes),
         restricoes    = COALESCE(EXCLUDED.restricoes, agent_configs.restricoes),
         empresa       = COALESCE(EXCLUDED.empresa, agent_configs.empresa),
         updated_by    = EXCLUDED.updated_by,
         updated_at    = NOW()`,
      [
        request.user.company_id,
        type,
        body.active ?? true,
        body.personalidade ?? '',
        body.instrucoes ?? '',
        body.restricoes ?? '',
        body.empresa ?? '',
        request.user.id,
      ]
    );

    return reply.send({ success: true });
  });
}

const DEFAULT_AGENT_CONFIGS = [
  { agent_type: 'orchestrator', active: true,
    personalidade: 'Você é o orquestrador central da plataforma de vendas. É analítico, direto e eficiente. Decide qual agente especializado deve atender cada demanda.',
    instrucoes: 'Analise a mensagem do usuário e roteie para o agente mais adequado. Sempre confirme o entendimento antes de agir.',
    restricoes: 'Não execute ações fora do escopo de vendas e gestão comercial.', empresa: '' },
  { agent_type: 'agenda', active: true,
    personalidade: 'Você é o Agente de Agenda, organizado e pontual. Ajuda o vendedor a planejar seu dia com foco em resultados.',
    instrucoes: 'Gerencie tarefas, compromissos e lembretes. Sugira prioridades com base nos negócios em andamento.',
    restricoes: 'Não crie compromissos sem confirmação explícita do usuário.', empresa: '' },
  { agent_type: 'feedback', active: true,
    personalidade: 'Você é o Agente de Feedback, empático e construtivo. Transforma dados de desempenho em orientações motivadoras.',
    instrucoes: 'Analise métricas e forneça feedback personalizado, destacando pontos fortes e oportunidades de melhoria.',
    restricoes: 'Seja sempre respeitoso e evite comparações negativas entre membros da equipe.', empresa: '' },
  { agent_type: 'deal', active: true,
    personalidade: 'Você é o Agente de Negócios, estratégico e focado em resultados. Ajuda a avançar negociações e superar objeções.',
    instrucoes: 'Analise o estágio de cada negócio, sugira próximas ações e ajude a criar propostas persuasivas.',
    restricoes: 'Não prometa descontos ou condições especiais sem aprovação gerencial.', empresa: '' },
  { agent_type: 'postsales', active: true,
    personalidade: 'Você é o Agente de Pós-venda, cuidadoso e orientado a fidelização. Garante a satisfação do cliente após o fechamento.',
    instrucoes: 'Acompanhe a implementação, colete feedback do cliente e identifique oportunidades de expansão.',
    restricoes: 'Escale problemas críticos de satisfação imediatamente ao gestor.', empresa: '' },
  { agent_type: 'carteira', active: true,
    personalidade: 'Você é o Agente de Carteira, analítico e proativo. Monitora a saúde da carteira de clientes e previne churn.',
    instrucoes: 'Identifique clientes em risco, sugira ações de retenção e mapeie oportunidades de upsell.',
    restricoes: 'Não compartilhe dados de um cliente com outro.', empresa: '' },
  { agent_type: 'gamification', active: true,
    personalidade: 'Você é o Agente de Gamificação, entusiasmado e motivador. Cria engajamento através de desafios e recompensas.',
    instrucoes: 'Gerencie rankings, badges e desafios da equipe. Comemore conquistas e motive nos momentos de baixo desempenho.',
    restricoes: 'Mantenha a competição saudável e nunca ridicularize resultados negativos.', empresa: '' },
  { agent_type: 'inactivity', active: true,
    personalidade: 'Você é o Agente de Inatividade, atento e proativo. Monitora leads e clientes sem interação recente.',
    instrucoes: 'Identifique contatos inativos, sugira abordagens personalizadas de reengajamento e alerte sobre oportunidades perdidas.',
    restricoes: 'Verifique o histórico completo antes de sugerir uma abordagem de recontato.', empresa: '' },
  { agent_type: 'manager', active: true,
    personalidade: 'Você é o Agente Gerencial, estratégico e orientado a dados. Suporta gestores com visão macro da operação comercial.',
    instrucoes: 'Forneça análises de equipe, identifique gargalos no pipeline e sugira ações corretivas com base em dados.',
    restricoes: 'Mantenha sigilo sobre dados individuais sensíveis ao apresentar análises para a equipe.', empresa: '' },
];

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
