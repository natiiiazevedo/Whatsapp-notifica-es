import type { AgentContext, Deal } from '@sales/shared';
import { BaseAgent } from './base.js';
import type { Tool } from './base.js';

// CarteirAgent - Revisão de carteira: clientes sem atendimento, fora dos prazos
// Para gestores: vê toda a equipe; para vendedores: vê a própria carteira
export class CarteiraAgent extends BaseAgent {
  protected systemPrompt(ctx: AgentContext): string {
    const isManager = ctx.user_role !== 'salesperson';
    return `Você é um especialista em gestão de carteira comercial.
Seu foco é garantir que nenhum cliente fique sem atendimento e que os prazos sejam respeitados.

${isManager
  ? `Você está falando com ${ctx.user_name} (gestor/admin).
     Você tem visão COMPLETA da equipe: analise carteiras de todos os vendedores, identifique quem está sobrecarregado, quem está negligenciando clientes e gere listas de ação.`
  : `Você está falando com ${ctx.user_name} (vendedor).
     Analise a carteira pessoal: priorize contatos urgentes, organize por impacto, sugira o roteiro do dia/semana.`
}

**Princípios:**
- Priorize por: valor do negócio × probabilidade × urgência (prazo vencido ou quase vencendo)
- Negócios sem atividade há 3+ dias = alerta amarelo; 7+ dias = alerta vermelho
- Sempre gere uma lista de ação ordenada e acionável
- Cite valores em R$ para deixar o impacto financeiro claro

**Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}**`;
  }

  protected tools(ctx: AgentContext): Tool[] {
    const isManager = ctx.user_role !== 'salesperson';
    const tools: Tool[] = [
      {
        name: 'get_overdue_deals',
        description: isManager
          ? 'Lista todos os negócios da equipe com prazo vencido ou próximo do vencimento'
          : 'Lista meus negócios com prazo vencido ou próximo do vencimento',
        input_schema: {
          type: 'object' as const,
          properties: {
            days_threshold: { type: 'number', description: 'Dias antes do vencimento para alertar (padrão: 7)' },
            user_id: isManager ? { type: 'string', description: 'Filtrar por vendedor específico (opcional)' } : undefined,
          },
          required: [],
        },
      },
      {
        name: 'get_inactive_portfolio',
        description: 'Lista negócios sem atividade recente, ordenados por inatividade',
        input_schema: {
          type: 'object' as const,
          properties: {
            min_days: { type: 'number', description: 'Mínimo de dias sem atividade (padrão: 3)' },
            user_id: isManager ? { type: 'string', description: 'Filtrar por vendedor (opcional)' } : undefined,
          },
          required: [],
        },
      },
      {
        name: 'generate_priority_list',
        description: 'Gera lista priorizada de contatos para o dia, ordenada por impacto e urgência',
        input_schema: {
          type: 'object' as const,
          properties: {
            user_id: isManager ? { type: 'string', description: 'Gerar lista para vendedor específico (opcional)' } : undefined,
            limit: { type: 'number', description: 'Máximo de itens na lista (padrão: 10)' },
          },
          required: [],
        },
      },
    ];

    if (isManager) {
      tools.push({
        name: 'get_team_portfolio_overview',
        description: 'Visão consolidada da carteira de toda a equipe: quem tem mais negócios em risco',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      });
    }

    return tools;
  }

  protected async executeTool(
    name: string,
    input: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<string> {
    const isManager = ctx.user_role !== 'salesperson';
    const targetUserId = isManager && input.user_id ? (input.user_id as string) : ctx.user_id;

    switch (name) {
      case 'get_overdue_deals': {
        const days = (input.days_threshold as number) ?? 7;
        const userFilter = isManager && !input.user_id
          ? 'AND d.company_id = $2'
          : 'AND d.assigned_user_id = $2';
        const filterParam = isManager && !input.user_id ? ctx.company_id : targetUserId;

        const res = await this.deps.db.query(
          `SELECT d.*, u.name as vendedor_nome
           FROM deals d
           LEFT JOIN users u ON d.assigned_user_id = u.id
           WHERE d.stage NOT IN ('won', 'lost')
             AND d.expected_close_date IS NOT NULL
             AND d.expected_close_date <= CURRENT_DATE + ($1 || ' days')::INTERVAL
             ${userFilter}
           ORDER BY d.expected_close_date ASC, d.value DESC NULLS LAST`,
          [days, filterParam]
        );

        if (res.rows.length === 0) return `Nenhum negócio com prazo nos próximos ${days} dias.`;
        return JSON.stringify(res.rows.map((d: Deal & { vendedor_nome: string }) => ({
          titulo: d.title,
          vendedor: d.vendedor_nome ?? 'N/A',
          valor: d.value ? `R$ ${Number(d.value).toLocaleString('pt-BR')}` : 'sem valor',
          etapa: d.stage,
          fechamento_previsto: d.expected_close_date,
          dias_restantes: Math.ceil((new Date(d.expected_close_date!).getTime() - Date.now()) / 86400000),
          status: new Date(d.expected_close_date!) < new Date() ? '🔴 VENCIDO' : '🟡 PRÓXIMO',
        })), null, 2);
      }

      case 'get_inactive_portfolio': {
        const minDays = (input.min_days as number) ?? 3;
        const userFilter = isManager && !input.user_id
          ? 'AND d.company_id = $2'
          : 'AND d.assigned_user_id = $2';
        const filterParam = isManager && !input.user_id ? ctx.company_id : targetUserId;

        const res = await this.deps.db.query(
          `SELECT d.*, u.name as vendedor_nome
           FROM deals d
           LEFT JOIN users u ON d.assigned_user_id = u.id
           WHERE d.stage NOT IN ('won', 'lost')
             AND d.days_without_activity >= $1
             ${userFilter}
           ORDER BY d.days_without_activity DESC, d.value DESC NULLS LAST`,
          [minDays, filterParam]
        );

        if (res.rows.length === 0) return `Nenhum negócio inativo há ${minDays}+ dias.`;
        return JSON.stringify(res.rows.map((d: Deal & { vendedor_nome: string }) => ({
          titulo: d.title,
          vendedor: d.vendedor_nome ?? 'N/A',
          valor: d.value ? `R$ ${Number(d.value).toLocaleString('pt-BR')}` : 'sem valor',
          etapa: d.stage,
          dias_sem_atividade: d.days_without_activity,
          ultimo_contato: d.last_activity_at,
          contato: d.contact_name,
          telefone: d.contact_phone,
          alerta: (d.days_without_activity ?? 0) >= 7 ? '🔴 CRÍTICO' : '🟡 ATENÇÃO',
        })), null, 2);
      }

      case 'generate_priority_list': {
        const limit = (input.limit as number) ?? 10;
        const userFilter = isManager && !input.user_id
          ? 'AND d.company_id = $2'
          : 'AND d.assigned_user_id = $2';
        const filterParam = isManager && !input.user_id ? ctx.company_id : targetUserId;

        // Score = valor × probabilidade × urgência (inatividade + prazo)
        const res = await this.deps.db.query(
          `SELECT d.*, u.name as vendedor_nome,
            (
              COALESCE(d.value, 0) * COALESCE(d.probability, 50) / 100.0
              + COALESCE(d.days_without_activity, 0) * 1000
              + CASE WHEN d.expected_close_date <= CURRENT_DATE + INTERVAL '7 days'
                     THEN 5000 ELSE 0 END
            ) AS priority_score
           FROM deals d
           LEFT JOIN users u ON d.assigned_user_id = u.id
           WHERE d.stage NOT IN ('won', 'lost')
             ${userFilter}
           ORDER BY priority_score DESC
           LIMIT $3`,
          [filterParam, filterParam, limit]
        );

        return JSON.stringify(res.rows.map((d: Deal & { vendedor_nome: string; priority_score: number }, i: number) => ({
          posicao: i + 1,
          titulo: d.title,
          vendedor: d.vendedor_nome ?? 'N/A',
          contato: d.contact_name,
          telefone: d.contact_phone,
          valor: d.value ? `R$ ${Number(d.value).toLocaleString('pt-BR')}` : 'sem valor',
          etapa: d.stage,
          probabilidade: `${d.probability}%`,
          dias_sem_atividade: d.days_without_activity,
          fechamento_previsto: d.expected_close_date,
          acao_sugerida: this.suggestAction(d),
        })), null, 2);
      }

      case 'get_team_portfolio_overview': {
        const res = await this.deps.db.query(
          `SELECT
            u.id, u.name,
            COUNT(d.id) FILTER (WHERE d.stage NOT IN ('won', 'lost')) as deals_ativos,
            COUNT(d.id) FILTER (WHERE d.days_without_activity >= 3 AND d.stage NOT IN ('won', 'lost')) as deals_inativos,
            COUNT(d.id) FILTER (WHERE d.expected_close_date < CURRENT_DATE AND d.stage NOT IN ('won', 'lost')) as prazos_vencidos,
            COALESCE(SUM(d.value) FILTER (WHERE d.stage NOT IN ('won', 'lost')), 0) as pipeline_total
           FROM users u
           LEFT JOIN deals d ON d.assigned_user_id = u.id
           WHERE u.company_id = $1 AND u.active = true AND u.role = 'salesperson'
           GROUP BY u.id, u.name
           ORDER BY deals_inativos DESC`,
          [ctx.company_id]
        );
        return JSON.stringify(res.rows, null, 2);
      }

      default:
        return `Ferramenta "${name}" não reconhecida.`;
    }
  }

  private suggestAction(deal: Deal): string {
    if ((deal.days_without_activity ?? 0) >= 7) return 'URGENTE: ligar agora';
    if (deal.expected_close_date && new Date(deal.expected_close_date) < new Date()) return 'Prazo vencido: verificar status';
    if (deal.stage === 'proposal') return 'Acompanhar proposta enviada';
    if (deal.stage === 'negotiation') return 'Fechar negociação';
    if ((deal.days_without_activity ?? 0) >= 3) return 'Retomar contato';
    return 'Avançar para próxima etapa';
  }
}
