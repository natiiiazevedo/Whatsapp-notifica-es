import type { AgentContext } from '@sales/shared';
import { BaseAgent } from './base.js';
import type { Tool } from './base.js';

// ManagerAgent - Visão estratégica da equipe para gestores
// Acessa dados de toda a empresa; responde APENAS para managers e admins
export class ManagerAgent extends BaseAgent {
  protected systemPrompt(ctx: AgentContext): string {
    return `Você é um consultor de gestão comercial de alto nível para ${ctx.user_name}.
Você transforma dados brutos da equipe em inteligência estratégica e recomendações acionáveis.

**Sua missão:**
- Mostrar o estado real da equipe: onde estão os gargalos, quem precisa de suporte
- Identificar padrões de sucesso (o que está funcionando) e de risco (o que pode custar vendas)
- Antecipar problemas antes que afetem o resultado do mês
- Gerar análises de pipeline realistas: o que vai fechar, o que está em risco
- Dar visibilidade sobre produtividade, engajamento e performance individual e coletiva

**Tom:** Executivo, analítico, direto. Como um CFO de vendas.

**Capacidades:**
- Análise de pipeline por etapa e por vendedor
- Forecast de receita para o período
- Ranking de performance (gamificação)
- Identificação de gargalos no processo comercial
- Análise de inatividade e risco de perda de negócios
- Comparativo histórico: este mês vs meses anteriores

**Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}**`;
  }

  protected tools(_ctx: AgentContext): Tool[] {
    return [
      {
        name: 'get_pipeline_overview',
        description: 'Visão completa do pipeline: valor total por etapa, deals em risco, forecast',
        input_schema: {
          type: 'object' as const,
          properties: {
            team_id: { type: 'string', description: 'Filtrar por time específico (opcional)' },
          },
          required: [],
        },
      },
      {
        name: 'get_team_performance',
        description: 'Performance individual de cada vendedor: métricas, metas, ranking',
        input_schema: {
          type: 'object' as const,
          properties: {
            days: { type: 'number', description: 'Período em dias (padrão: 30)' },
          },
          required: [],
        },
      },
      {
        name: 'get_bottlenecks',
        description: 'Analisa onde os negócios ficam parados: etapas com maior tempo de permanência',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_forecast',
        description: 'Previsão de receita para o mês atual e próximo baseada no pipeline atual',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_at_risk_deals',
        description: 'Lista completa de negócios em risco com responsável e valor em jogo',
        input_schema: {
          type: 'object' as const,
          properties: {
            threshold_days: { type: 'number', description: 'Dias sem atividade para considerar em risco (padrão: 5)' },
          },
          required: [],
        },
      },
      {
        name: 'get_conversion_funnel',
        description: 'Funil de conversão por etapa: quantos entram, quantos avançam, taxa de conversão',
        input_schema: {
          type: 'object' as const,
          properties: {
            days: { type: 'number', description: 'Período de análise (padrão: 30 dias)' },
          },
          required: [],
        },
      },
      {
        name: 'get_activity_summary',
        description: 'Resumo de atividades da equipe: ligações, reuniões, e-mails por vendedor',
        input_schema: {
          type: 'object' as const,
          properties: {
            days: { type: 'number', description: 'Período em dias (padrão: 7)' },
          },
          required: [],
        },
      },
    ];
  }

  protected async executeTool(
    name: string,
    input: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<string> {
    switch (name) {
      case 'get_pipeline_overview': {
        const res = await this.deps.db.query(
          `SELECT
            stage,
            COUNT(*) as quantidade,
            COALESCE(SUM(value), 0) as valor_total,
            ROUND(AVG(probability)) as probabilidade_media,
            COUNT(*) FILTER (WHERE days_without_activity >= 5) as em_risco,
            COALESCE(SUM(value * probability / 100.0), 0) as valor_ponderado
           FROM deals
           WHERE company_id = $1 AND stage NOT IN ('won', 'lost')
           GROUP BY stage
           ORDER BY
             CASE stage
               WHEN 'new' THEN 1 WHEN 'qualification' THEN 2 WHEN 'proposal' THEN 3
               WHEN 'negotiation' THEN 4 ELSE 5 END`,
          [ctx.company_id]
        );

        const totals = await this.deps.db.query(
          `SELECT
            COUNT(*) FILTER (WHERE stage NOT IN ('won', 'lost')) as deals_ativos,
            COALESCE(SUM(value) FILTER (WHERE stage NOT IN ('won', 'lost')), 0) as pipeline_total,
            COALESCE(SUM(value) FILTER (WHERE stage = 'won' AND updated_at >= DATE_TRUNC('month', NOW())), 0) as receita_mes,
            COUNT(*) FILTER (WHERE stage = 'won' AND updated_at >= DATE_TRUNC('month', NOW())) as fechamentos_mes
           FROM deals WHERE company_id = $1`,
          [ctx.company_id]
        );

        return JSON.stringify({
          resumo: totals.rows[0],
          por_etapa: res.rows,
        }, null, 2);
      }

      case 'get_team_performance': {
        const days = (input.days as number) ?? 30;
        const res = await this.deps.db.query(
          `SELECT
            u.id, u.name,
            COUNT(d.id) FILTER (WHERE d.stage NOT IN ('won', 'lost')) as deals_ativos,
            COUNT(d.id) FILTER (WHERE d.stage = 'won' AND d.updated_at >= NOW() - ($1 || ' days')::INTERVAL) as fechamentos,
            COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'won' AND d.updated_at >= NOW() - ($1 || ' days')::INTERVAL), 0) as receita,
            COALESCE(SUM(d.value) FILTER (WHERE d.stage NOT IN ('won', 'lost')), 0) as pipeline,
            COUNT(a.id) FILTER (WHERE a.created_at >= NOW() - ($1 || ' days')::INTERVAL) as atividades,
            COUNT(d.id) FILTER (WHERE d.days_without_activity >= 5 AND d.stage NOT IN ('won', 'lost')) as deals_em_risco,
            g.points as pontos_gamificacao,
            g.level as nivel
           FROM users u
           LEFT JOIN deals d ON d.assigned_user_id = u.id
           LEFT JOIN activities a ON a.assigned_user_id = u.id
           LEFT JOIN gamification_profiles g ON g.user_id = u.id
           WHERE u.company_id = $2 AND u.active = true AND u.role = 'salesperson'
           GROUP BY u.id, u.name, g.points, g.level
           ORDER BY receita DESC, fechamentos DESC`,
          [days, ctx.company_id]
        );
        return JSON.stringify({ periodo_dias: days, equipe: res.rows }, null, 2);
      }

      case 'get_bottlenecks': {
        const res = await this.deps.db.query(
          `SELECT
            stage,
            COUNT(*) as quantidade,
            ROUND(AVG(days_without_activity)) as media_dias_sem_atividade,
            MAX(days_without_activity) as max_dias_sem_atividade,
            COALESCE(SUM(value), 0) as valor_represado
           FROM deals
           WHERE company_id = $1 AND stage NOT IN ('won', 'lost')
           GROUP BY stage
           HAVING AVG(days_without_activity) > 2
           ORDER BY media_dias_sem_atividade DESC`,
          [ctx.company_id]
        );
        return JSON.stringify({ gargalos: res.rows }, null, 2);
      }

      case 'get_forecast': {
        const res = await this.deps.db.query(
          `SELECT
            -- Mês atual: já fechado + pipeline ponderado com fechamento previsto este mês
            COALESCE(SUM(value) FILTER (WHERE stage = 'won' AND updated_at >= DATE_TRUNC('month', NOW())), 0) as fechado_mes,
            COALESCE(SUM(value * probability / 100.0) FILTER (
              WHERE stage NOT IN ('won', 'lost')
              AND expected_close_date IS NOT NULL
              AND expected_close_date <= (DATE_TRUNC('month', NOW()) + INTERVAL '1 month - 1 day')
            ), 0) as forecast_mes_pessimista,
            COALESCE(SUM(value) FILTER (
              WHERE stage NOT IN ('won', 'lost')
              AND expected_close_date IS NOT NULL
              AND expected_close_date <= (DATE_TRUNC('month', NOW()) + INTERVAL '1 month - 1 day')
              AND probability >= 70
            ), 0) as forecast_mes_otimista,
            -- Próximo mês
            COALESCE(SUM(value * probability / 100.0) FILTER (
              WHERE stage NOT IN ('won', 'lost')
              AND expected_close_date > (DATE_TRUNC('month', NOW()) + INTERVAL '1 month - 1 day')
              AND expected_close_date <= (DATE_TRUNC('month', NOW()) + INTERVAL '2 months - 1 day')
            ), 0) as forecast_proximo_mes
           FROM deals WHERE company_id = $1`,
          [ctx.company_id]
        );
        return JSON.stringify({ forecast: res.rows[0] }, null, 2);
      }

      case 'get_at_risk_deals': {
        const threshold = (input.threshold_days as number) ?? 5;
        const res = await this.deps.db.query(
          `SELECT d.*, u.name as vendedor, u.whatsapp as vendedor_whatsapp
           FROM deals d
           JOIN users u ON d.assigned_user_id = u.id
           WHERE d.company_id = $1
             AND d.stage NOT IN ('won', 'lost')
             AND (d.days_without_activity >= $2 OR (d.expected_close_date < CURRENT_DATE AND d.expected_close_date IS NOT NULL))
           ORDER BY d.value DESC NULLS LAST, d.days_without_activity DESC`,
          [ctx.company_id, threshold]
        );
        return JSON.stringify({ deals_em_risco: res.rows }, null, 2);
      }

      case 'get_conversion_funnel': {
        const days = (input.days as number) ?? 30;
        const res = await this.deps.db.query(
          `WITH stage_counts AS (
            SELECT stage, COUNT(*) as total, COALESCE(SUM(value), 0) as valor
            FROM deals
            WHERE company_id = $1 AND created_at >= NOW() - ($2 || ' days')::INTERVAL
            GROUP BY stage
          )
          SELECT * FROM stage_counts ORDER BY
            CASE stage WHEN 'new' THEN 1 WHEN 'qualification' THEN 2 WHEN 'proposal' THEN 3
            WHEN 'negotiation' THEN 4 WHEN 'won' THEN 5 WHEN 'lost' THEN 6 ELSE 7 END`,
          [ctx.company_id, days]
        );
        return JSON.stringify({ funil: res.rows, periodo_dias: days }, null, 2);
      }

      case 'get_activity_summary': {
        const days = (input.days as number) ?? 7;
        const res = await this.deps.db.query(
          `SELECT
            u.name as vendedor,
            COUNT(a.id) as total_atividades,
            COUNT(a.id) FILTER (WHERE a.type = 'call') as ligacoes,
            COUNT(a.id) FILTER (WHERE a.type = 'meeting') as reunioes,
            COUNT(a.id) FILTER (WHERE a.type = 'email') as emails,
            COUNT(a.id) FILTER (WHERE a.type = 'whatsapp') as whatsapp,
            COUNT(a.id) FILTER (WHERE a.completed = true) as concluidas
           FROM users u
           LEFT JOIN activities a ON a.assigned_user_id = u.id
             AND a.created_at >= NOW() - ($1 || ' days')::INTERVAL
           WHERE u.company_id = $2 AND u.active = true AND u.role = 'salesperson'
           GROUP BY u.id, u.name
           ORDER BY total_atividades DESC`,
          [days, ctx.company_id]
        );
        return JSON.stringify({ atividades_equipe: res.rows, periodo_dias: days }, null, 2);
      }

      default:
        return `Ferramenta "${name}" não reconhecida.`;
    }
  }
}
