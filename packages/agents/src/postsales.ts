import type { AgentContext } from '@sales/shared';
import { BaseAgent } from './base.js';
import type { Tool } from './base.js';

// PostSalesAgent - Pós-vendas: NPS, risco de churn, upsell, reativação de clientes
export class PostSalesAgent extends BaseAgent {
  protected systemPrompt(ctx: AgentContext): string {
    const isManager = ctx.user_role !== 'salesperson';
    return `Você é o especialista em pós-vendas e sucesso do cliente para ${isManager ? 'a equipe' : ctx.user_name}.
Sua missão é proteger a receita existente e encontrar oportunidades de crescimento na base de clientes.

**Suas responsabilidades:**
1. **Retenção**: Identificar clientes em risco de churn antes que aconteça
2. **Satisfação**: Acompanhar NPS e sentimento dos clientes após o fechamento
3. **Expansão**: Identificar oportunidades de upsell e cross-sell
4. **Reativação**: Reengajar clientes que pararam de interagir
5. **Relacionamento**: Garantir cadência de contato pós-venda para fidelização

**Sinais de churn (risco de perda):**
- Sem contato há mais de 30 dias após o fechamento
- NPS baixo (< 7) ou sem resposta ao NPS
- Reclamações não resolvidas
- Redução de engajamento

**Sinais de upsell:**
- NPS alto (9-10) — cliente satisfeito e defensor
- Crescimento da empresa cliente (novas contratações, expansão)
- Cliente engajado com múltiplas interações
- Negócio inicial bem abaixo do ticket médio

**Sinais de reativação:**
- Cliente que fechou negócio há mais de 90 dias sem nenhuma interação posterior
- Clientes que responderam NPS neutro (7-8)

${isManager
  ? '- Você tem visão de toda a base de clientes da empresa'
  : `- Você analisa apenas os clientes de ${ctx.user_name}`}

**Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}**

Sempre sugira ações concretas com prazo. Priorize clientes de maior valor ou maior risco.`;
  }

  protected tools(ctx: AgentContext): Tool[] {
    const isManager = ctx.user_role !== 'salesperson';
    const tools: Tool[] = [
      {
        name: 'get_won_customers',
        description: 'Lista todos os clientes com negócios ganhos: data do fechamento, valor, último contato pós-venda, status de saúde do relacionamento',
        input_schema: {
          type: 'object' as const,
          properties: {
            days_since_close: { type: 'number', description: 'Filtrar clientes que fecharam nos últimos N dias (padrão: todos)' },
            min_value: { type: 'number', description: 'Valor mínimo do negócio fechado' },
          },
          required: [],
        },
      },
      {
        name: 'get_churn_risks',
        description: 'Clientes em risco de churn: sem contato há mais de X dias após o fechamento, NPS baixo ou ausente',
        input_schema: {
          type: 'object' as const,
          properties: {
            days_without_contact: { type: 'number', description: 'Dias sem contato pós-venda (padrão: 30)' },
          },
          required: [],
        },
      },
      {
        name: 'get_upsell_opportunities',
        description: 'Clientes com alta satisfação (NPS ≥ 9) ou alto engajamento que podem estar prontos para expandir o relacionamento',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_inactive_customers',
        description: 'Clientes que fecharam negócio há mais de 90 dias sem nenhuma interação posterior — candidatos à reativação',
        input_schema: {
          type: 'object' as const,
          properties: {
            days_inactive: { type: 'number', description: 'Dias sem interação (padrão: 90)' },
          },
          required: [],
        },
      },
      {
        name: 'get_nps_summary',
        description: 'Resumo de NPS da base de clientes: distribuição por faixa (promotores/neutros/detratores), média e tendência',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_customer_timeline',
        description: 'Linha do tempo de um cliente específico: todas as interações pré e pós-venda, NPS, notas, atividades',
        input_schema: {
          type: 'object' as const,
          properties: {
            company_name: { type: 'string', description: 'Nome da empresa cliente' },
          },
          required: ['company_name'],
        },
      },
      {
        name: 'create_reactivation_task',
        description: 'Cria tarefa de reativação para um cliente inativo — aparece na agenda do vendedor responsável',
        input_schema: {
          type: 'object' as const,
          properties: {
            company_name: { type: 'string', description: 'Nome da empresa cliente' },
            reason: { type: 'string', description: 'Motivo da reativação / contexto para o vendedor' },
            priority: {
              type: 'string',
              enum: ['urgent', 'high', 'medium', 'low'],
              description: 'Prioridade da tarefa',
            },
          },
          required: ['company_name', 'reason'],
        },
      },
    ];

    if (isManager) {
      tools.push({
        name: 'get_postsales_team_overview',
        description: 'Visão consolidada do pós-vendas de toda a equipe: clientes em risco, oportunidades de upsell, NPS médio por vendedor',
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

    switch (name) {
      case 'get_won_customers': {
        const { days_since_close, min_value } = input as { days_since_close?: number; min_value?: number };
        const res = await this.deps.db.query(
          `SELECT
            d.id, d.title, d.company_name, d.contact_name, d.contact_phone,
            d.value, d.updated_at as closed_at, d.assigned_user_id,
            u.name as vendedor,
            MAX(a.created_at) as ultimo_contato_posicional,
            EXTRACT(DAY FROM NOW() - MAX(a.created_at)) as dias_sem_contato_posicional,
            COUNT(a.id) as total_interacoes_posicional
           FROM deals d
           LEFT JOIN users u ON u.id = d.assigned_user_id
           LEFT JOIN activities a ON a.deal_id = d.id AND a.created_at > d.updated_at
           WHERE d.company_id = $1
             AND d.stage = 'won'
             AND ($2 OR d.assigned_user_id = $3)
             AND ($4::int IS NULL OR d.updated_at >= NOW() - ($4 || ' days')::interval)
             AND ($5::numeric IS NULL OR d.value >= $5)
           GROUP BY d.id, u.name
           ORDER BY d.value DESC NULLS LAST, d.updated_at DESC`,
          [ctx.company_id, isManager, ctx.user_id, days_since_close ?? null, min_value ?? null]
        );
        if (res.rows.length === 0) return 'Nenhum cliente encontrado com esses filtros.';
        return JSON.stringify(
          res.rows.map(r => ({
            empresa: r.company_name,
            contato: r.contact_name,
            telefone: r.contact_phone,
            vendedor: r.vendedor,
            valor_negocio: r.value ? Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            fechamento: r.closed_at ? new Date(r.closed_at).toLocaleDateString('pt-BR') : '—',
            dias_sem_contato: Math.round(Number(r.dias_sem_contato_posicional ?? 0)),
            total_interacoes_posicional: Number(r.total_interacoes_posicional),
            status: this.getRelationshipStatus(Number(r.dias_sem_contato_posicional ?? 0)),
          })),
          null, 2
        );
      }

      case 'get_churn_risks': {
        const threshold = (input.days_without_contact as number) ?? 30;
        const res = await this.deps.db.query(
          `SELECT
            d.id, d.title, d.company_name, d.contact_name, d.contact_phone,
            d.value, d.updated_at as closed_at,
            u.name as vendedor,
            COALESCE(MAX(a.created_at), d.updated_at) as ultimo_contato,
            EXTRACT(DAY FROM NOW() - COALESCE(MAX(a.created_at), d.updated_at)) as dias_sem_contato
           FROM deals d
           LEFT JOIN users u ON u.id = d.assigned_user_id
           LEFT JOIN activities a ON a.deal_id = d.id AND a.created_at > d.updated_at
           WHERE d.company_id = $1
             AND d.stage = 'won'
             AND ($2 OR d.assigned_user_id = $3)
           GROUP BY d.id, u.name
           HAVING EXTRACT(DAY FROM NOW() - COALESCE(MAX(a.created_at), d.updated_at)) >= $4
           ORDER BY dias_sem_contato DESC, d.value DESC NULLS LAST`,
          [ctx.company_id, isManager, ctx.user_id, threshold]
        );
        if (res.rows.length === 0) return `Nenhum cliente em risco de churn (todos com contato nos últimos ${threshold} dias). Ótimo trabalho!`;
        return JSON.stringify(
          res.rows.map(r => ({
            empresa: r.company_name,
            contato: r.contact_name,
            telefone: r.contact_phone,
            vendedor: r.vendedor,
            valor_negocio: r.value ? Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            ultimo_contato: r.ultimo_contato ? new Date(r.ultimo_contato).toLocaleDateString('pt-BR') : '—',
            dias_sem_contato: Math.round(Number(r.dias_sem_contato)),
            risco: Number(r.dias_sem_contato) >= 60 ? '🔴 CRÍTICO' : '🟡 ATENÇÃO',
            acao_sugerida: Number(r.dias_sem_contato) >= 60
              ? 'Ligação urgente de relacionamento'
              : 'Enviar mensagem de check-in',
          })),
          null, 2
        );
      }

      case 'get_upsell_opportunities': {
        const res = await this.deps.db.query(
          `SELECT
            d.id, d.title, d.company_name, d.contact_name, d.contact_phone,
            d.value, d.updated_at as closed_at,
            u.name as vendedor,
            COUNT(a.id) as total_atividades_posicional,
            MAX(a.created_at) as ultimo_contato
           FROM deals d
           LEFT JOIN users u ON u.id = d.assigned_user_id
           LEFT JOIN activities a ON a.deal_id = d.id AND a.created_at > d.updated_at
           WHERE d.company_id = $1
             AND d.stage = 'won'
             AND ($2 OR d.assigned_user_id = $3)
             AND d.updated_at >= NOW() - INTERVAL '180 days'
           GROUP BY d.id, u.name
           HAVING COUNT(a.id) >= 2
              AND EXTRACT(DAY FROM NOW() - MAX(a.created_at)) <= 30
           ORDER BY d.value DESC NULLS LAST`,
          [ctx.company_id, isManager, ctx.user_id]
        );
        if (res.rows.length === 0) {
          return 'Nenhuma oportunidade de upsell identificada no momento. Trabalhe na cadência de pós-venda para criar essas oportunidades.';
        }
        return JSON.stringify(
          res.rows.map(r => ({
            empresa: r.company_name,
            contato: r.contact_name,
            vendedor: r.vendedor,
            valor_negocio_atual: r.value ? Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            fechamento: r.closed_at ? new Date(r.closed_at).toLocaleDateString('pt-BR') : '—',
            interacoes_posicional: Number(r.total_atividades_posicional),
            ultimo_contato: r.ultimo_contato ? new Date(r.ultimo_contato).toLocaleDateString('pt-BR') : '—',
            indicador: '📈 Engajamento ativo — potencial de expansão',
            sugestao: 'Apresente nova proposta de expansão ou produto complementar',
          })),
          null, 2
        );
      }

      case 'get_inactive_customers': {
        const threshold = (input.days_inactive as number) ?? 90;
        const res = await this.deps.db.query(
          `SELECT
            d.id, d.title, d.company_name, d.contact_name, d.contact_phone,
            d.value, d.updated_at as closed_at,
            u.name as vendedor,
            COALESCE(MAX(a.created_at), d.updated_at) as ultimo_contato,
            EXTRACT(DAY FROM NOW() - COALESCE(MAX(a.created_at), d.updated_at)) as dias_inativos
           FROM deals d
           LEFT JOIN users u ON u.id = d.assigned_user_id
           LEFT JOIN activities a ON a.deal_id = d.id
           WHERE d.company_id = $1
             AND d.stage = 'won'
             AND ($2 OR d.assigned_user_id = $3)
           GROUP BY d.id, u.name
           HAVING EXTRACT(DAY FROM NOW() - COALESCE(MAX(a.created_at), d.updated_at)) >= $4
           ORDER BY d.value DESC NULLS LAST`,
          [ctx.company_id, isManager, ctx.user_id, threshold]
        );
        if (res.rows.length === 0) return `Nenhum cliente inativo há mais de ${threshold} dias.`;
        return JSON.stringify(
          res.rows.map(r => ({
            empresa: r.company_name,
            contato: r.contact_name,
            telefone: r.contact_phone,
            vendedor: r.vendedor,
            valor: r.value ? Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            fechamento: r.closed_at ? new Date(r.closed_at).toLocaleDateString('pt-BR') : '—',
            dias_inativos: Math.round(Number(r.dias_inativos)),
            potencial_reativacao: Number(r.value ?? 0) > 20000 ? '⭐ Alto' : '📋 Médio',
          })),
          null, 2
        );
      }

      case 'get_nps_summary': {
        // Usa atividades do tipo 'note' com subject contendo 'NPS' como proxy até ter tabela dedicada
        const res = await this.deps.db.query(
          `SELECT
            COUNT(*) FILTER (WHERE d.value >= 50000) as clientes_alto_valor,
            COUNT(*) FILTER (WHERE d.stage = 'won') as total_clientes,
            ROUND(AVG(
              EXTRACT(DAY FROM NOW() - COALESCE(MAX(a.created_at), d.updated_at))
            )) as media_dias_sem_contato,
            COUNT(*) FILTER (
              WHERE EXTRACT(DAY FROM NOW() - COALESCE(MAX(a.created_at), d.updated_at)) > 30
            ) as clientes_sem_contato_30d,
            COUNT(*) FILTER (
              WHERE EXTRACT(DAY FROM NOW() - COALESCE(MAX(a.created_at), d.updated_at)) > 60
            ) as clientes_sem_contato_60d
           FROM deals d
           LEFT JOIN activities a ON a.deal_id = d.id
           WHERE d.company_id = $1
             AND d.stage = 'won'
             AND ($2 OR d.assigned_user_id = $3)
           GROUP BY d.company_id`,
          [ctx.company_id, isManager, ctx.user_id]
        );
        if (res.rows.length === 0) return 'Ainda sem clientes na base de pós-vendas.';
        const stats = res.rows[0];
        return JSON.stringify({
          resumo_base_clientes: {
            total_clientes: Number(stats.total_clientes),
            clientes_alto_valor: Number(stats.clientes_alto_valor),
            media_dias_sem_contato: Math.round(Number(stats.media_dias_sem_contato ?? 0)),
            sem_contato_30_dias: Number(stats.clientes_sem_contato_30d),
            sem_contato_60_dias: Number(stats.clientes_sem_contato_60d),
          },
          nota: 'NPS formal ainda não integrado — dados baseados em cadência de relacionamento',
          recomendacao: Number(stats.clientes_sem_contato_30d) > 0
            ? `⚠️ ${stats.clientes_sem_contato_30d} clientes sem contato há mais de 30 dias — risco de churn`
            : '✅ Base de clientes com boa cadência de contato',
        }, null, 2);
      }

      case 'get_customer_timeline': {
        const companyName = input.company_name as string;
        const res = await this.deps.db.query(
          `SELECT
            d.title as negocio, d.stage, d.value,
            d.created_at as negocio_criado, d.updated_at as negocio_atualizado,
            a.type as tipo_atividade, a.subject, a.description,
            a.completed, a.completed_at, a.created_at as data_atividade
           FROM deals d
           LEFT JOIN activities a ON a.deal_id = d.id
           WHERE d.company_id = $1
             AND ($2 OR d.assigned_user_id = $3)
             AND LOWER(d.company_name) LIKE LOWER($4)
           ORDER BY COALESCE(a.created_at, d.created_at) DESC
           LIMIT 50`,
          [ctx.company_id, isManager, ctx.user_id, `%${companyName}%`]
        );
        if (res.rows.length === 0) return `Nenhum histórico encontrado para "${companyName}".`;
        return JSON.stringify(res.rows, null, 2);
      }

      case 'create_reactivation_task': {
        const { company_name, reason, priority = 'medium' } = input as {
          company_name: string; reason: string; priority?: string;
        };
        // Encontra o negócio mais recente da empresa para associar a tarefa
        const dealRes = await this.deps.db.query(
          `SELECT d.id, d.assigned_user_id, d.contact_name
           FROM deals d
           WHERE d.company_id = $1
             AND ($2 OR d.assigned_user_id = $3)
             AND LOWER(d.company_name) LIKE LOWER($4)
             AND d.stage = 'won'
           ORDER BY d.updated_at DESC LIMIT 1`,
          [ctx.company_id, isManager, ctx.user_id, `%${company_name}%`]
        );
        if (dealRes.rows.length === 0) return `Empresa "${company_name}" não encontrada na base de clientes.`;

        const deal = dealRes.rows[0];
        const due = new Date();
        due.setDate(due.getDate() + 1);

        await this.deps.db.query(
          `INSERT INTO tasks (user_id, company_id, deal_id, title, description, priority, status, type, due_date, created_by, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'call', $7, 'agent', '{}')`,
          [
            deal.assigned_user_id ?? ctx.user_id,
            ctx.company_id,
            deal.id,
            `Reativar cliente: ${company_name}`,
            reason,
            priority,
            due.toISOString().split('T')[0],
          ]
        );

        return JSON.stringify({
          sucesso: true,
          mensagem: `Tarefa de reativação criada para "${company_name}"`,
          prazo: due.toLocaleDateString('pt-BR'),
          prioridade: priority,
          motivo: reason,
        }, null, 2);
      }

      case 'get_postsales_team_overview': {
        const res = await this.deps.db.query(
          `SELECT
            u.name as vendedor,
            COUNT(d.id) as total_clientes,
            COUNT(d.id) FILTER (
              WHERE EXTRACT(DAY FROM NOW() - COALESCE(last_act.ultimo_contato, d.updated_at)) > 30
            ) as em_risco_churn,
            COUNT(d.id) FILTER (
              WHERE EXTRACT(DAY FROM NOW() - COALESCE(last_act.ultimo_contato, d.updated_at)) > 90
            ) as inativos_90d,
            ROUND(AVG(d.value)) as ticket_medio,
            SUM(d.value) as receita_total
           FROM deals d
           JOIN users u ON u.id = d.assigned_user_id
           LEFT JOIN LATERAL (
             SELECT MAX(a.created_at) as ultimo_contato
             FROM activities a WHERE a.deal_id = d.id
           ) last_act ON true
           WHERE d.company_id = $1 AND d.stage = 'won' AND u.role = 'salesperson'
           GROUP BY u.id, u.name
           ORDER BY em_risco_churn DESC, receita_total DESC`,
          [ctx.company_id]
        );
        if (res.rows.length === 0) return 'Nenhum dado de pós-vendas disponível.';
        return JSON.stringify(
          res.rows.map(r => ({
            vendedor: r.vendedor,
            total_clientes: Number(r.total_clientes),
            em_risco_churn: Number(r.em_risco_churn),
            inativos_90d: Number(r.inativos_90d),
            ticket_medio: r.ticket_medio ? Number(r.ticket_medio).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            receita_total_carteira: r.receita_total ? Number(r.receita_total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—',
            status: Number(r.em_risco_churn) > 3 ? '🔴 Atenção' : Number(r.em_risco_churn) > 0 ? '🟡 Monitorar' : '✅ Saudável',
          })),
          null, 2
        );
      }

      default:
        return `Ferramenta "${name}" não reconhecida.`;
    }
  }

  private getRelationshipStatus(daysSinceContact: number): string {
    if (daysSinceContact <= 14) return '✅ Saudável';
    if (daysSinceContact <= 30) return '🟡 Atenção';
    if (daysSinceContact <= 60) return '🟠 Risco';
    return '🔴 Crítico';
  }
}
