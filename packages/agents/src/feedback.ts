import type { AgentContext, Deal, UserMetrics } from '@sales/shared';
import { BaseAgent } from './base.js';
import type { Tool } from './base.js';

// FeedbackAgent - Coach 1:1 consultivo para cada vendedor
// Acessa APENAS dados do próprio usuário (RLS aplicado)
export class FeedbackAgent extends BaseAgent {
  protected systemPrompt(ctx: AgentContext): string {
    return `Você é um coach comercial especializado e consultor estratégico de vendas para ${ctx.user_name}.
Seu papel é ser um parceiro de alta performance: analítico, direto e inspirador.

**Seu propósito:**
- Dar insights consultivos personalizados baseados nos dados reais de ${ctx.user_name}
- Identificar padrões de comportamento que impactam resultados (positivos e negativos)
- Sugerir ações concretas e priorizadas para aumentar vendas e produtividade
- Celebrar conquistas e manter a motivação alta
- Antecipar gargalos antes que virem problemas

**Diretrizes:**
- Sempre baseie análises em dados concretos (negócios, atividades, histórico)
- Seja específico: cite nomes de negócios, valores, datas
- Priorize ações de alto impacto / baixo esforço
- Tom: direto, respeitoso, motivador — como um mentor que acredita no potencial
- Nunca seja genérico ou dê conselhos que valem para qualquer pessoa
- Quando identificar um padrão recorrente (positivo ou negativo), mencione-o

**Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}**

Você tem acesso às ferramentas para buscar dados em tempo real de ${ctx.user_name}.`;
  }

  protected tools(_ctx: AgentContext): Tool[] {
    return [
      {
        name: 'get_my_pipeline',
        description: 'Busca todos os negócios ativos do vendedor com detalhes de cada etapa',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_my_metrics',
        description: 'Busca métricas consolidadas do vendedor (conversão, receita, atividades, etc.)',
        input_schema: {
          type: 'object' as const,
          properties: {
            days: { type: 'number', description: 'Período em dias para análise (padrão: 30)' },
          },
          required: [],
        },
      },
      {
        name: 'get_deals_at_risk',
        description: 'Lista negócios em risco: sem atividade há mais de X dias ou com prazo vencido',
        input_schema: {
          type: 'object' as const,
          properties: {
            inactivity_days: { type: 'number', description: 'Dias sem atividade (padrão: 3)' },
          },
          required: [],
        },
      },
      {
        name: 'get_recent_activities',
        description: 'Busca atividades recentes do vendedor (ligações, reuniões, e-mails)',
        input_schema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', description: 'Quantidade de atividades (padrão: 15)' },
          },
          required: [],
        },
      },
      {
        name: 'get_team_benchmarks',
        description: 'Busca médias da equipe para comparação (sem expor dados individuais de outros)',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_won_deals_patterns',
        description: 'Analisa padrões dos negócios ganhos: tempo médio, estágio mais longo, atividades que geraram fechamento',
        input_schema: {
          type: 'object' as const,
          properties: {},
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
      case 'get_my_pipeline': {
        const deals = await this.getUserDeals(ctx.user_id);
        if (deals.length === 0) return 'Nenhum negócio ativo no momento.';
        return JSON.stringify(deals.map(d => ({
          id: d.id,
          titulo: d.title,
          etapa: d.stage,
          valor: d.value ? `R$ ${d.value.toLocaleString('pt-BR')}` : 'sem valor',
          probabilidade: `${d.probability}%`,
          dias_sem_atividade: d.days_without_activity,
          fechamento_previsto: d.expected_close_date,
          empresa: d.company_name,
          contato: d.contact_name,
        })), null, 2);
      }

      case 'get_my_metrics': {
        const days = (input.days as number) ?? 30;
        const metrics = await this.getUserMetrics(ctx.user_id, days);
        return JSON.stringify({
          periodo: `últimos ${days} dias`,
          ...metrics,
        }, null, 2);
      }

      case 'get_deals_at_risk': {
        const threshold = (input.inactivity_days as number) ?? 3;
        const res = await this.deps.db.query<Deal>(
          `SELECT * FROM deals
           WHERE assigned_user_id = $1
             AND stage NOT IN ('won', 'lost')
             AND (days_without_activity >= $2 OR (expected_close_date < CURRENT_DATE AND expected_close_date IS NOT NULL))
           ORDER BY days_without_activity DESC`,
          [ctx.user_id, threshold]
        );
        if (res.rows.length === 0) return 'Nenhum negócio em risco no momento. Ótimo trabalho!';
        return JSON.stringify(res.rows.map(d => ({
          titulo: d.title,
          etapa: d.stage,
          valor: d.value,
          dias_sem_atividade: d.days_without_activity,
          fechamento_previsto: d.expected_close_date,
          status: d.expected_close_date && new Date(d.expected_close_date) < new Date() ? 'PRAZO_VENCIDO' : 'INATIVO',
        })), null, 2);
      }

      case 'get_recent_activities': {
        const limit = (input.limit as number) ?? 15;
        const activities = await this.getUserActivities(ctx.user_id, limit);
        return JSON.stringify(activities.map(a => ({
          tipo: a.type,
          assunto: a.subject,
          concluido: a.completed,
          data: a.completed_at ?? a.created_at,
          duracao_minutos: a.duration_minutes,
        })), null, 2);
      }

      case 'get_team_benchmarks': {
        const res = await this.deps.db.query(
          `SELECT
            ROUND(AVG(m.deals_active)) as media_deals_ativos,
            ROUND(AVG(m.deals_won)) as media_fechamentos,
            ROUND(AVG(m.revenue_won)) as media_receita,
            ROUND(AVG(m.conversion_rate) * 100, 1) as taxa_conversao_media
           FROM daily_metrics m
           WHERE m.company_id = $1 AND m.user_id IS NOT NULL
             AND m.date >= CURRENT_DATE - 30`,
          [ctx.company_id]
        );
        return JSON.stringify({ benchmarks_equipe: res.rows[0] }, null, 2);
      }

      case 'get_won_deals_patterns': {
        const res = await this.deps.db.query(
          `SELECT
            COUNT(*) as total_ganhos,
            ROUND(AVG(EXTRACT(DAY FROM (closed_date::date - created_at::date)))) as ciclo_medio_dias,
            ROUND(AVG(value)) as ticket_medio,
            stage_id as ultima_etapa_mais_comum
           FROM deals
           WHERE assigned_user_id = $1 AND stage = 'won' AND closed_date IS NOT NULL
           GROUP BY stage_id
           ORDER BY total_ganhos DESC LIMIT 5`,
          [ctx.user_id]
        );
        if (res.rows.length === 0) return 'Ainda sem histórico de negócios ganhos para analisar padrões.';
        return JSON.stringify(res.rows, null, 2);
      }

      default:
        return `Ferramenta "${name}" não reconhecida.`;
    }
  }
}
