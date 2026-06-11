import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Task, DailyKPIs } from '@sales/shared';

const createTaskSchema = z.object({
  title:        z.string().min(1).max(200),
  type:         z.enum(['call','meeting','email','whatsapp','proposal','follow_up','demo','contract','other']).default('other'),
  priority:     z.enum(['urgent','high','medium','low']).default('medium'),
  deal_id:      z.string().optional(),
  contact_name: z.string().optional(),
  company_name: z.string().optional(),
  due_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_time:     z.string().regex(/^\d{2}:\d{2}$/).optional(),
  description:  z.string().optional(),
});

const completeTaskSchema = z.object({
  note: z.string().optional(),
});

const setGoalSchema = z.object({
  user_id:                 z.string().uuid(),
  period_start:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal_calls_per_day:      z.number().int().min(0).optional(),
  goal_meetings_per_day:   z.number().int().min(0).optional(),
  goal_deals_per_month:    z.number().int().min(0).optional(),
  goal_revenue_per_month:  z.number().min(0).optional(),
  goal_companies_per_day:  z.number().int().min(0).optional(),
});

export async function taskRoutes(fastify: FastifyInstance) {

  // ─── Tarefas ─────────────────────────────────────────────────

  // GET /api/tasks — lista tarefas do usuário
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { status, date } = req.query as { status?: string; date?: string };
    const { user } = req;
    const isManager = user.role !== 'salesperson';

    let whereClause = 'WHERE t.company_id = $1';
    const params: unknown[] = [user.company_id];

    if (!isManager) {
      params.push(user.id);
      whereClause += ` AND t.user_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      whereClause += ` AND t.status = $${params.length}`;
    }
    if (date) {
      params.push(date);
      whereClause += ` AND (t.due_date = $${params.length} OR (t.due_date IS NULL AND t.created_at::date = $${params.length}))`;
    } else {
      // Default: tarefas pendentes com prazo até hoje
      whereClause += ` AND t.status IN ('pending','in_progress') AND (t.due_date IS NULL OR t.due_date <= CURRENT_DATE)`;
    }

    const res = await fastify.db.query<Task & { deal_title?: string; vendedor?: string }>(
      `SELECT t.*, d.title as deal_title, u.name as vendedor
       FROM tasks t
       LEFT JOIN deals d ON d.id = t.deal_id
       LEFT JOIN users u ON u.id = t.user_id
       ${whereClause}
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         t.due_date ASC NULLS LAST, t.due_time ASC NULLS LAST`,
      params
    );

    return reply.send(res.rows);
  });

  // POST /api/tasks — cria tarefa
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body = createTaskSchema.parse(req.body);
    const { user } = req;

    // Busca valor do negócio para contexto
    let dealValue: number | null = null;
    let contactName = body.contact_name ?? null;
    let companyName = body.company_name ?? null;
    if (body.deal_id) {
      const dealRes = await fastify.db.query(
        `SELECT value, contact_name, company_name FROM deals WHERE id = $1`,
        [body.deal_id]
      );
      if (dealRes.rows[0]) {
        dealValue = dealRes.rows[0].value;
        contactName = contactName ?? dealRes.rows[0].contact_name;
        companyName = companyName ?? dealRes.rows[0].company_name;
      }
    }

    const res = await fastify.db.query<Task>(
      `INSERT INTO tasks
         (user_id, company_id, deal_id, title, type, priority,
          contact_name, company_name, due_date, due_time,
          description, created_by, source_deal_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'user',$12)
       RETURNING *`,
      [
        user.id, user.company_id,
        body.deal_id ?? null, body.title, body.type, body.priority,
        contactName, companyName,
        body.due_date ?? new Date().toISOString().split('T')[0],
        body.due_time ?? null,
        body.description ?? null,
        dealValue,
      ]
    );

    return reply.code(201).send(res.rows[0]);
  });

  // PATCH /api/tasks/:id/complete — conclui tarefa
  fastify.patch('/:id/complete', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { note } = completeTaskSchema.parse(req.body);

    const res = await fastify.db.query<Task>(
      `UPDATE tasks
       SET status = 'done', completed_at = NOW(), completed_note = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [note ?? null, id, req.user.id]
    );

    if (!res.rows.length) return reply.code(404).send({ error: 'Tarefa não encontrada' });
    return reply.send(res.rows[0]);
  });

  // PATCH /api/tasks/:id — atualiza tarefa
  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<Task>;

    const allowed = ['title','description','priority','status','type','due_date','due_time','contact_name','company_name'];
    const updates = Object.entries(body).filter(([k]) => allowed.includes(k));
    if (!updates.length) return reply.code(400).send({ error: 'Nenhum campo válido para atualizar' });

    const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`).join(', ');
    const values = updates.map(([, v]) => v);

    const res = await fastify.db.query<Task>(
      `UPDATE tasks SET ${setClauses}, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, req.user.id, ...values]
    );

    if (!res.rows.length) return reply.code(404).send({ error: 'Tarefa não encontrada' });
    return reply.send(res.rows[0]);
  });

  // DELETE /api/tasks/:id
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await fastify.db.query(`DELETE FROM tasks WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
    return reply.send({ success: true });
  });

  // GET /api/tasks/suggestions — sugestões de tarefas geradas pela IA (função DB)
  fastify.get('/suggestions', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await fastify.db.query(
      `SELECT * FROM generate_daily_tasks($1)`,
      [req.user.id]
    );
    return reply.send(res.rows);
  });

  // ─── KPIs ────────────────────────────────────────────────────

  // GET /api/tasks/kpis/today — KPIs do dia atual (tempo real)
  fastify.get('/kpis/today', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { user } = req;
    const isManager = user.role !== 'salesperson';

    if (isManager) {
      // Gestores veem todos os vendedores
      const res = await fastify.db.query(
        `SELECT u.id, u.name, u.avatar_url, k.*,
                g.goal_calls_per_day, g.goal_meetings_per_day, g.goal_companies_per_day
         FROM users u
         LEFT JOIN v_today_kpis k ON k.user_id = u.id
         LEFT JOIN sales_goals g ON g.user_id = u.id
           AND g.period_start <= CURRENT_DATE AND g.period_end >= CURRENT_DATE
         WHERE u.company_id = $1 AND u.active = true AND u.role = 'salesperson'
         ORDER BY u.name`,
        [user.company_id]
      );
      return reply.send(res.rows);
    }

    const res = await fastify.db.query<DailyKPIs>(
      `SELECT k.*, g.goal_calls_per_day, g.goal_meetings_per_day, g.goal_companies_per_day, g.goal_revenue_per_month
       FROM v_today_kpis k
       LEFT JOIN sales_goals g ON g.user_id = k.user_id
         AND g.period_start <= CURRENT_DATE AND g.period_end >= CURRENT_DATE
       WHERE k.user_id = $1`,
      [user.id]
    );

    return reply.send(res.rows[0] ?? {});
  });

  // GET /api/tasks/kpis/history?days=30 — histórico de KPIs
  fastify.get('/kpis/history', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { user } = req;
    const { days = '30', user_id } = req.query as { days?: string; user_id?: string };
    const isManager = user.role !== 'salesperson';
    const targetId = isManager && user_id ? user_id : user.id;

    const res = await fastify.db.query(
      `SELECT date, calls_done, meetings_done, emails_sent, deals_won,
              revenue_won, deals_worked, companies_reached, tasks_done, pipeline_value,
              goal_calls, goal_meetings, goal_companies
       FROM daily_kpis
       WHERE user_id = $1 AND date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
       ORDER BY date ASC`,
      [targetId, parseInt(days)]
    );

    return reply.send(res.rows);
  });

  // GET /api/tasks/kpis/team — resumo de KPIs da equipe hoje (manager)
  fastify.get('/kpis/team', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (req.user.role === 'salesperson') {
      return reply.code(403).send({ error: 'Acesso restrito a gestores' });
    }

    const res = await fastify.db.query(
      `SELECT
        u.id, u.name, u.avatar_url,
        COALESCE(k.calls_done, 0)       AS ligacoes,
        COALESCE(k.meetings_done, 0)    AS reunioes,
        COALESCE(k.deals_won, 0)        AS vendas_fechadas,
        COALESCE(k.deals_worked, 0)     AS negocios_tratados,
        COALESCE(k.companies_reached,0) AS empresas_atingidas,
        COALESCE(k.revenue_won, 0)      AS receita,
        COALESCE(k.active_deals, 0)     AS deals_ativos,
        g.goal_calls_per_day AS meta_ligacoes,
        g.goal_meetings_per_day AS meta_reunioes,
        -- % de cumprimento
        CASE WHEN g.goal_calls_per_day > 0
             THEN ROUND(k.calls_done::numeric / g.goal_calls_per_day * 100)
             ELSE NULL END AS pct_ligacoes,
        CASE WHEN g.goal_meetings_per_day > 0
             THEN ROUND(k.meetings_done::numeric / g.goal_meetings_per_day * 100)
             ELSE NULL END AS pct_reunioes
       FROM users u
       LEFT JOIN v_today_kpis k ON k.user_id = u.id
       LEFT JOIN sales_goals g ON g.user_id = u.id
         AND g.period_start <= CURRENT_DATE AND g.period_end >= CURRENT_DATE
       WHERE u.company_id = $1 AND u.active = true AND u.role = 'salesperson'
       ORDER BY receita DESC, ligacoes DESC`,
      [req.user.company_id]
    );

    return reply.send(res.rows);
  });

  // ─── Metas ───────────────────────────────────────────────────

  // POST /api/tasks/goals — define metas para um vendedor (manager only)
  fastify.post('/goals', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (req.user.role === 'salesperson') {
      return reply.code(403).send({ error: 'Apenas gestores podem definir metas' });
    }
    const body = setGoalSchema.parse(req.body);

    const res = await fastify.db.query(
      `INSERT INTO sales_goals
         (user_id, company_id, period_start, period_end,
          goal_calls_per_day, goal_meetings_per_day, goal_deals_per_month,
          goal_revenue_per_month, goal_companies_per_day, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id, period_start) DO UPDATE SET
         period_end            = EXCLUDED.period_end,
         goal_calls_per_day    = EXCLUDED.goal_calls_per_day,
         goal_meetings_per_day = EXCLUDED.goal_meetings_per_day,
         goal_deals_per_month  = EXCLUDED.goal_deals_per_month,
         goal_revenue_per_month = EXCLUDED.goal_revenue_per_month,
         goal_companies_per_day = EXCLUDED.goal_companies_per_day
       RETURNING *`,
      [
        body.user_id, req.user.company_id,
        body.period_start, body.period_end,
        body.goal_calls_per_day ?? 10,
        body.goal_meetings_per_day ?? 3,
        body.goal_deals_per_month ?? 5,
        body.goal_revenue_per_month ?? null,
        body.goal_companies_per_day ?? 5,
        req.user.id,
      ]
    );

    return reply.code(201).send(res.rows[0]);
  });

  // GET /api/tasks/goals — metas do usuário atual
  fastify.get('/goals', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const res = await fastify.db.query(
      `SELECT g.*, u.name as vendedor_nome
       FROM sales_goals g
       JOIN users u ON u.id = g.user_id
       WHERE g.company_id = $1
         AND ($2 OR g.user_id = $3)
         AND g.period_end >= CURRENT_DATE
       ORDER BY g.period_start DESC`,
      [req.user.company_id, req.user.role !== 'salesperson', req.user.id]
    );
    return reply.send(res.rows);
  });
}
