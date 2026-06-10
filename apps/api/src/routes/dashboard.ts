import type { FastifyInstance } from 'fastify';

export async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/dashboard/overview - Dados do dashboard do usuário atual
  fastify.get('/overview', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { user } = request;
    const isManager = user.role !== 'salesperson';

    const [metrics, deals, insights, gamification] = await Promise.all([
      // Métricas do usuário ou da empresa
      fastify.db.query(
        isManager
          ? `SELECT
              COUNT(DISTINCT d.assigned_user_id) as membros_ativos,
              COUNT(d.id) FILTER (WHERE d.stage NOT IN ('won', 'lost')) as deals_ativos,
              COALESCE(SUM(d.value) FILTER (WHERE d.stage NOT IN ('won', 'lost')), 0) as pipeline_total,
              COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'won' AND d.updated_at >= DATE_TRUNC('month', NOW())), 0) as receita_mes,
              COUNT(d.id) FILTER (WHERE d.days_without_activity >= 3 AND d.stage NOT IN ('won', 'lost')) as deals_em_risco,
              COUNT(d.id) FILTER (WHERE d.stage = 'won' AND d.updated_at >= DATE_TRUNC('month', NOW())) as fechamentos_mes
             FROM deals d WHERE d.company_id = $1`
          : `SELECT * FROM get_user_metrics($1, 30)`,
        isManager ? [user.company_id] : [user.id]
      ),

      // Negócios recentes
      fastify.db.query(
        `SELECT d.id, d.title, d.stage, d.value, d.days_without_activity,
                d.expected_close_date, d.contact_name, u.name as vendedor
         FROM deals d
         LEFT JOIN users u ON d.assigned_user_id = u.id
         WHERE d.company_id = $1
           AND ($2 OR d.assigned_user_id = $3)
           AND d.stage NOT IN ('won', 'lost')
         ORDER BY d.days_without_activity DESC, d.value DESC NULLS LAST
         LIMIT 10`,
        [user.company_id, isManager, user.id]
      ),

      // Insights não lidos
      fastify.db.query(
        `SELECT id, title, content, priority, insight_type, created_at
         FROM insights
         WHERE company_id = $1
           AND ($2 OR user_id = $3)
           AND read = false
         ORDER BY
           CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
           created_at DESC
         LIMIT 5`,
        [user.company_id, isManager, user.id]
      ),

      // Gamificação
      fastify.db.query(
        `SELECT gp.*, u.name,
                RANK() OVER (ORDER BY gp.points DESC) as posicao_ranking
         FROM gamification_profiles gp
         JOIN users u ON gp.user_id = u.id
         WHERE u.company_id = $1
           AND ($2 OR gp.user_id = $3)
         ORDER BY gp.points DESC
         LIMIT ${isManager ? 10 : 1}`,
        [user.company_id, isManager, user.id]
      ),
    ]);

    return reply.send({
      metrics: metrics.rows[0],
      deals_prioritarios: deals.rows,
      insights_nao_lidos: insights.rows,
      gamificacao: isManager ? gamification.rows : gamification.rows[0],
    });
  });

  // GET /api/dashboard/metrics/history - Histórico de métricas (gráficos)
  fastify.get('/metrics/history', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { user } = request;
    const { days = '30' } = request.query as { days?: string };

    const res = await fastify.db.query(
      `SELECT date, deals_won, revenue_won, activities_done, pipeline_value
       FROM daily_metrics
       WHERE company_id = $1
         AND ($2 OR user_id = $3)
         AND date >= CURRENT_DATE - ($4 || ' days')::INTERVAL
       ORDER BY date ASC`,
      [user.company_id, user.role !== 'salesperson', user.id, parseInt(days)]
    );

    return reply.send(res.rows);
  });

  // GET /api/dashboard/ranking - Ranking da equipe
  fastify.get('/ranking', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { user } = request;
    const res = await fastify.db.query(
      `SELECT
        u.id, u.name, u.avatar_url,
        gp.points, gp.level, gp.level_name, gp.streak_days,
        COALESCE(SUM(ge.points) FILTER (WHERE ge.created_at >= DATE_TRUNC('month', NOW())), 0) as pontos_mes,
        RANK() OVER (ORDER BY gp.points DESC) as posicao
       FROM users u
       LEFT JOIN gamification_profiles gp ON gp.user_id = u.id
       LEFT JOIN gamification_events ge ON ge.user_id = u.id
       WHERE u.company_id = $1 AND u.active = true AND u.role = 'salesperson'
       GROUP BY u.id, u.name, u.avatar_url, gp.points, gp.level, gp.level_name, gp.streak_days
       ORDER BY gp.points DESC NULLS LAST`,
      [user.company_id]
    );
    return reply.send(res.rows);
  });
}
