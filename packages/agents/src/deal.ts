import type { AgentContext, Deal } from '@sales/shared';
import { BaseAgent } from './base.js';
import type { Tool } from './base.js';

// DealAgent - Analisa negócios individuais: risco, próximo passo, o que falta para fechar
export class DealAgent extends BaseAgent {
  protected systemPrompt(ctx: AgentContext): string {
    const isManager = ctx.user_role !== 'salesperson';
    return `Você é um especialista em análise de negócios (deal intelligence) para ${ctx.user_name}.
Sua função é fazer diagnóstico cirúrgico de oportunidades individuais e de toda a carteira ativa.

**O que você faz:**
- Calcular score de saúde de cada negócio (0-100) com base em inatividade, etapa, valor, probabilidade e histórico
- Identificar sinais de risco: decisor não alcançado, proposta sem resposta, stuck in stage, concorrência
- Recomendar o próximo passo mais impactante para avançar ou fechar
- Comparar com negócios ganhos no passado para detectar padrões de sucesso
- Responder "o que falta para fechar este negócio?" com precisão cirúrgica
- Priorizar portfólio: qual negócio merece atenção AGORA?

**Cálculo de saúde do negócio:**
- 100 = negócio saudável, atividade recente, probabilidade alta, prazo ok
- 80-99 = bom, mas alguma coisa a melhorar
- 60-79 = atenção, risco moderado
- 40-59 = risco alto, ação imediata necessária
- <40 = crítico, risco de perda iminente

**Fatores que reduzem o score:**
- Cada dia sem atividade: -3 pontos (a partir do dia 2)
- Prazo vencido: -20 pontos
- Stuck na etapa (mais de 2x o tempo médio): -15 pontos
- Probabilidade < 30%: -10 pontos
- Sem contato com decisor: -10 pontos

**Diretrizes:**
- Seja específico: cite o nome do negócio, valor, empresa, contato
- Sugira ações com prazo: "ligue hoje", "envie proposta até sexta"
- Quando o negócio tiver alto valor, aumente a urgência das recomendações
- Identifique o deal que tem maior chance de fechar esta semana
${isManager ? '\n- Você pode analisar qualquer negócio da equipe' : '\n- Você analisa apenas os negócios de ' + ctx.user_name}

**Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}**`;
  }

  protected tools(ctx: AgentContext): Tool[] {
    const isManager = ctx.user_role !== 'salesperson';
    const tools: Tool[] = [
      {
        name: 'get_deal_detail',
        description: 'Busca todos os detalhes de um negócio específico: histórico de atividades, contatos, valor, probabilidade, tempo na etapa atual',
        input_schema: {
          type: 'object' as const,
          properties: {
            deal_id: { type: 'string', description: 'ID do negócio' },
          },
          required: ['deal_id'],
        },
      },
      {
        name: 'get_active_deals_with_health',
        description: 'Lista todos os negócios ativos com score de saúde calculado, sinais de risco e próximo passo sugerido',
        input_schema: {
          type: 'object' as const,
          properties: {
            min_value: { type: 'number', description: 'Filtrar negócios com valor mínimo (opcional)' },
            stage: { type: 'string', description: 'Filtrar por etapa: new, qualification, proposal, negotiation (opcional)' },
            risk_only: { type: 'boolean', description: 'Se true, retorna apenas negócios em risco (score < 60)' },
          },
          required: [],
        },
      },
      {
        name: 'get_stage_benchmarks',
        description: 'Tempo médio que negócios ganhos ficaram em cada etapa do funil — serve para identificar se um negócio está "preso" mais tempo que o normal',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'compare_to_won_deals',
        description: 'Compara um negócio atual com negócios ganhos similares (por valor, etapa, empresa) para identificar o que está diferente e o que fez os outros fecharem',
        input_schema: {
          type: 'object' as const,
          properties: {
            deal_id: { type: 'string', description: 'ID do negócio a comparar' },
          },
          required: ['deal_id'],
        },
      },
      {
        name: 'get_deal_activities',
        description: 'Histórico completo de atividades de um negócio: ligações, reuniões, e-mails, notas',
        input_schema: {
          type: 'object' as const,
          properties: {
            deal_id: { type: 'string', description: 'ID do negócio' },
          },
          required: ['deal_id'],
        },
      },
      {
        name: 'get_highest_priority_deal',
        description: 'Identifica o negócio que mais merece atenção hoje: maior valor ponderado por probabilidade e urgência',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
    ];

    if (isManager) {
      tools.push({
        name: 'get_team_deal_overview',
        description: 'Visão geral de todos os negócios da equipe com health scores, agrupados por vendedor',
        input_schema: {
          type: 'object' as const,
          properties: {
            risk_only: { type: 'boolean', description: 'Se true, mostra apenas negócios em risco' },
          },
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
    switch (name) {
      case 'get_deal_detail': {
        const res = await this.deps.db.query<Deal>(
          `SELECT d.*,
                  u.name as assigned_to,
                  EXTRACT(DAY FROM NOW() - d.created_at) as age_days,
                  EXTRACT(DAY FROM NOW() - MAX(a.created_at)) as days_since_last_activity_real
           FROM deals d
           LEFT JOIN users u ON u.id = d.assigned_user_id
           LEFT JOIN activities a ON a.deal_id = d.id
           WHERE d.id = $1
             AND ($2 = 'manager' OR $2 = 'admin' OR d.assigned_user_id = $3)
           GROUP BY d.id, u.name`,
          [input.deal_id, ctx.user_role, ctx.user_id]
        );
        if (res.rows.length === 0) return 'Negócio não encontrado ou sem permissão de acesso.';
        const deal = res.rows[0] as Deal & { assigned_to?: string; age_days?: number };
        return JSON.stringify({
          id: deal.id,
          titulo: deal.title,
          empresa: deal.company_name,
          contato: deal.contact_name,
          telefone: deal.contact_phone,
          vendedor: deal.assigned_to,
          etapa: deal.stage,
          valor: deal.value ? `R$ ${Number(deal.value).toLocaleString('pt-BR')}` : 'não definido',
          probabilidade: `${deal.probability}%`,
          dias_sem_atividade: deal.days_without_activity,
          idade_negocio_dias: deal.age_days,
          fechamento_previsto: deal.expected_close_date,
          ultima_atividade: deal.last_activity_at,
          health_score: this.calcHealthScore(deal),
          sinais_risco: this.getRiskSignals(deal),
        }, null, 2);
      }

      case 'get_active_deals_with_health': {
        const { min_value, stage, risk_only } = input as {
          min_value?: number; stage?: string; risk_only?: boolean;
        };
        const isManager = ctx.user_role !== 'salesperson';
        const res = await this.deps.db.query<Deal>(
          `SELECT d.*, u.name as assigned_to
           FROM deals d
           LEFT JOIN users u ON u.id = d.assigned_user_id
           WHERE d.company_id = $1
             AND ($2 OR d.assigned_user_id = $3)
             AND d.stage NOT IN ('won', 'lost')
             AND ($4::numeric IS NULL OR d.value >= $4)
             AND ($5::text IS NULL OR d.stage = $5)
           ORDER BY (COALESCE(d.value,0) * COALESCE(d.probability,50) / 100.0) DESC`,
          [ctx.company_id, isManager, ctx.user_id, min_value ?? null, stage ?? null]
        );
        if (res.rows.length === 0) return 'Nenhum negócio ativo encontrado com esses filtros.';

        const withHealth = res.rows
          .map(d => ({
            id: d.id,
            titulo: d.title,
            empresa: d.company_name,
            vendedor: (d as Deal & { assigned_to?: string }).assigned_to,
            etapa: d.stage,
            valor: d.value ? Number(d.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            probabilidade: `${d.probability}%`,
            dias_sem_atividade: d.days_without_activity ?? 0,
            fechamento_previsto: d.expected_close_date,
            health_score: this.calcHealthScore(d),
            sinais_risco: this.getRiskSignals(d),
            proximo_passo: this.suggestNextStep(d),
          }))
          .filter(d => !risk_only || d.health_score < 60)
          .sort((a, b) => a.health_score - b.health_score);

        return JSON.stringify(withHealth, null, 2);
      }

      case 'get_stage_benchmarks': {
        const res = await this.deps.db.query(
          `SELECT
            stage,
            ROUND(AVG(EXTRACT(DAY FROM (updated_at - created_at)))) as dias_medio_na_etapa,
            COUNT(*) as total_ganhos,
            ROUND(AVG(value)) as ticket_medio
           FROM deals
           WHERE company_id = $1 AND stage = 'won'
           GROUP BY stage
           UNION ALL
           SELECT
            'all_active' as stage,
            ROUND(AVG(EXTRACT(DAY FROM (NOW() - created_at)))) as dias_medio_na_etapa,
            COUNT(*) as total,
            ROUND(AVG(value)) as ticket_medio
           FROM deals
           WHERE company_id = $1 AND stage NOT IN ('won', 'lost')`,
          [ctx.company_id]
        );

        const stageRes = await this.deps.db.query(
          `SELECT
            stage,
            ROUND(AVG(days_without_activity)) as media_inatividade,
            COUNT(*) as total,
            ROUND(AVG(value)) as ticket_medio,
            ROUND(AVG(probability)) as probabilidade_media
           FROM deals
           WHERE company_id = $1 AND stage NOT IN ('won', 'lost')
           GROUP BY stage`,
          [ctx.company_id]
        );

        return JSON.stringify({
          historico_ganhos: res.rows,
          etapas_ativas: stageRes.rows,
          nota: 'dias_medio_na_etapa mostra quanto tempo negócios ganhos ficaram em cada etapa — use como referência para identificar negócios presos',
        }, null, 2);
      }

      case 'compare_to_won_deals': {
        const dealRes = await this.deps.db.query<Deal>(
          `SELECT * FROM deals WHERE id = $1 AND ($2 = 'manager' OR $2 = 'admin' OR assigned_user_id = $3)`,
          [input.deal_id, ctx.user_role, ctx.user_id]
        );
        if (dealRes.rows.length === 0) return 'Negócio não encontrado.';
        const deal = dealRes.rows[0];

        const wonRes = await this.deps.db.query(
          `SELECT
            title, value, probability,
            EXTRACT(DAY FROM (updated_at - created_at)) as ciclo_dias,
            stage_id as etapa_final,
            metadata
           FROM deals
           WHERE company_id = $1 AND stage = 'won'
             AND ABS(COALESCE(value,0) - COALESCE($2,0)) < COALESCE($2,0) * 0.5
           ORDER BY updated_at DESC LIMIT 5`,
          [ctx.company_id, deal.value]
        );

        return JSON.stringify({
          negocio_atual: {
            titulo: deal.title,
            etapa: deal.stage,
            valor: deal.value,
            probabilidade: deal.probability,
            dias_sem_atividade: deal.days_without_activity,
            health_score: this.calcHealthScore(deal),
          },
          negócios_ganhos_similares: wonRes.rows,
          analise: wonRes.rows.length === 0
            ? 'Sem histórico de negócios similares ganhos ainda.'
            : `Negócios similares fecharam em média ${Math.round(wonRes.rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.ciclo_dias ?? 0), 0) / wonRes.rows.length)} dias. Compare o ciclo atual.`,
        }, null, 2);
      }

      case 'get_deal_activities': {
        const res = await this.deps.db.query(
          `SELECT a.type, a.subject, a.description, a.completed, a.completed_at, a.created_at, a.duration_minutes
           FROM activities a
           JOIN deals d ON d.id = a.deal_id
           WHERE a.deal_id = $1
             AND ($2 = 'manager' OR $2 = 'admin' OR d.assigned_user_id = $3)
           ORDER BY a.created_at DESC LIMIT 30`,
          [input.deal_id, ctx.user_role, ctx.user_id]
        );
        if (res.rows.length === 0) return 'Nenhuma atividade registrada neste negócio.';
        return JSON.stringify(res.rows, null, 2);
      }

      case 'get_highest_priority_deal': {
        const isManager = ctx.user_role !== 'salesperson';
        const res = await this.deps.db.query<Deal>(
          `SELECT d.*, u.name as assigned_to,
                  (COALESCE(d.value,0) * COALESCE(d.probability,50) / 100.0
                   + COALESCE(d.days_without_activity, 0) * 500) as priority_score
           FROM deals d
           LEFT JOIN users u ON u.id = d.assigned_user_id
           WHERE d.company_id = $1
             AND ($2 OR d.assigned_user_id = $3)
             AND d.stage NOT IN ('won', 'lost')
             AND d.value IS NOT NULL
           ORDER BY priority_score DESC LIMIT 3`,
          [ctx.company_id, isManager, ctx.user_id]
        );
        if (res.rows.length === 0) return 'Sem negócios ativos com valor definido.';

        return JSON.stringify(
          res.rows.map(d => ({
            titulo: d.title,
            empresa: d.company_name,
            vendedor: (d as Deal & { assigned_to?: string }).assigned_to,
            etapa: d.stage,
            valor: d.value ? Number(d.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            probabilidade: `${d.probability}%`,
            dias_sem_atividade: d.days_without_activity,
            health_score: this.calcHealthScore(d),
            proximo_passo: this.suggestNextStep(d),
            por_que_prioridade: this.explainPriority(d),
          })),
          null, 2
        );
      }

      case 'get_team_deal_overview': {
        const { risk_only } = input as { risk_only?: boolean };
        const res = await this.deps.db.query<Deal & { assigned_to: string }>(
          `SELECT d.*, u.name as assigned_to
           FROM deals d
           JOIN users u ON u.id = d.assigned_user_id
           WHERE d.company_id = $1 AND d.stage NOT IN ('won', 'lost')
           ORDER BY u.name, d.value DESC NULLS LAST`,
          [ctx.company_id]
        );

        const byUser: Record<string, {
          vendedor: string;
          total_deals: number;
          pipeline_value: number;
          deals: Array<{ titulo: string; etapa: string; valor: string; health_score: number; proximo_passo: string }>;
        }> = {};

        for (const deal of res.rows) {
          const assigned = deal.assigned_to ?? 'Sem responsável';
          if (!byUser[assigned]) {
            byUser[assigned] = { vendedor: assigned, total_deals: 0, pipeline_value: 0, deals: [] };
          }
          const health = this.calcHealthScore(deal);
          if (risk_only && health >= 60) continue;
          byUser[assigned].total_deals++;
          byUser[assigned].pipeline_value += Number(deal.value ?? 0);
          byUser[assigned].deals.push({
            titulo: deal.title,
            etapa: deal.stage,
            valor: deal.value ? Number(deal.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            health_score: health,
            proximo_passo: this.suggestNextStep(deal),
          });
        }

        return JSON.stringify(Object.values(byUser), null, 2);
      }

      default:
        return `Ferramenta "${name}" não reconhecida.`;
    }
  }

  private calcHealthScore(deal: Deal): number {
    let score = 100;
    const daysInactive = deal.days_without_activity ?? 0;
    if (daysInactive > 1) score -= Math.min(50, (daysInactive - 1) * 3);
    if (deal.expected_close_date && new Date(deal.expected_close_date) < new Date()) score -= 20;
    if ((deal.probability ?? 50) < 30) score -= 10;
    return Math.max(0, score);
  }

  private getRiskSignals(deal: Deal): string[] {
    const signals: string[] = [];
    const daysInactive = deal.days_without_activity ?? 0;
    if (daysInactive >= 7) signals.push(`⚠️ ${daysInactive} dias sem contato`);
    else if (daysInactive >= 3) signals.push(`🟡 ${daysInactive} dias sem atividade`);
    if (deal.expected_close_date && new Date(deal.expected_close_date) < new Date()) {
      signals.push('🔴 Prazo de fechamento vencido');
    }
    if ((deal.probability ?? 50) < 30) signals.push('📉 Probabilidade baixa');
    if (!deal.contact_name) signals.push('👤 Sem contato registrado');
    if (!deal.value) signals.push('💰 Sem valor definido');
    return signals;
  }

  private suggestNextStep(deal: Deal): string {
    const days = deal.days_without_activity ?? 0;
    const stage = deal.stage;

    if (days >= 5) return 'URGENTE: Ligue hoje para reativar o contato';
    if (stage === 'proposal' && days >= 2) return 'Follow-up da proposta enviada';
    if (stage === 'negotiation') return 'Alinhar condições finais e data de assinatura';
    if (stage === 'qualification' && days >= 3) return 'Agendar reunião de apresentação';
    if (stage === 'new') return 'Fazer contato inicial e qualificar necessidade';
    if (deal.expected_close_date && new Date(deal.expected_close_date) < new Date(Date.now() + 7 * 86400000)) {
      return 'Prazo se aproxima — confirmar decisão do cliente';
    }
    return 'Manter cadência de contato semanal';
  }

  private explainPriority(deal: Deal): string {
    const reasons: string[] = [];
    if ((deal.value ?? 0) > 50000) reasons.push('alto valor');
    if ((deal.days_without_activity ?? 0) >= 5) reasons.push('risco de esfriamento');
    if (deal.stage === 'negotiation') reasons.push('em fase de fechamento');
    if (deal.expected_close_date) {
      const daysToClose = Math.ceil((new Date(deal.expected_close_date).getTime() - Date.now()) / 86400000);
      if (daysToClose <= 7 && daysToClose >= 0) reasons.push(`fecha em ${daysToClose} dias`);
    }
    return reasons.length > 0 ? reasons.join(', ') : 'pipeline prioritário';
  }
}
