import type { AgentContext, Task, DailyKPIs, TaskType, TaskPriority } from '@sales/shared';
import { BaseAgent } from './base.js';
import type { Tool } from './base.js';

const TYPE_LABELS: Record<TaskType, string> = {
  call: 'Ligação',
  meeting: 'Reunião',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  proposal: 'Proposta',
  follow_up: 'Follow-up',
  demo: 'Demonstração',
  contract: 'Contrato',
  other: 'Outro',
};

const TYPE_EMOJI: Record<TaskType, string> = {
  call: '📞',
  meeting: '🤝',
  email: '✉️',
  whatsapp: '💬',
  proposal: '📄',
  follow_up: '🔄',
  demo: '🖥️',
  contract: '✍️',
  other: '📋',
};

// AgendaAgent — Gestão de agenda e KPIs diários
// "O que fazer hoje", "o que já fiz", KPIs: reuniões, ligações, vendas, negócios, empresas
export class AgendaAgent extends BaseAgent {
  protected systemPrompt(ctx: AgentContext): string {
    const isManager = ctx.user_role !== 'salesperson';
    const today = new Date().toLocaleDateString('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    return `Você é o agente de agenda e produtividade comercial${isManager ? ' para gestão' : ` de ${ctx.user_name}`}.
Hoje é ${today}.

**Sua função:**
- Gerar a lista de tarefas do dia baseada nos negócios reais (priorizando por urgência + valor)
- Mostrar o que foi feito e o que ainda falta
- Apresentar KPIs diários: ligações, reuniões, vendas, negócios trabalhados, empresas atingidas
- Comparar com metas quando disponíveis
- Sugerir reagendamentos e prioridades dinâmicas

${isManager
  ? `**Modo Gestor:** Você vê a agenda e KPIs de toda a equipe. Identifica quem está atrasado nas atividades, quem precisa de suporte e quem está performando bem.`
  : `**Modo Vendedor:** Foco total em ${ctx.user_name}. Seja o copiloto do dia: mostre o que está pendente, celebre o que foi feito e ajuste prioridades quando necessário.`
}

**Regras de prioridade automática:**
- 🔴 Urgente: negócio sem contato há 7+ dias OU prazo vencido OU alto valor em negociação
- 🟠 Alta: 3–6 dias sem contato OU fecha nos próximos 7 dias
- 🟡 Média: negócio ativo normal, manter cadência
- 🟢 Baixa: contato recente, estável

**Ao gerar a agenda do dia:**
1. Liste as tarefas em ordem de prioridade
2. Para cada uma: cliente, tipo de contato, motivo e valor do negócio
3. Ao final: resumo dos KPIs do dia até agora vs meta

**Tom:** Direto, focado, energético. Como um técnico passando o jogo antes de entrar em campo.`;
  }

  protected tools(ctx: AgentContext): Tool[] {
    const isManager = ctx.user_role !== 'salesperson';
    return [
      {
        name: 'get_today_agenda',
        description: 'Gera a lista de tarefas prioritárias do dia baseada nos negócios ativos',
        input_schema: {
          type: 'object' as const,
          properties: {
            user_id: isManager
              ? { type: 'string', description: 'Vendedor específico (opcional, padrão = todos)' }
              : undefined,
          },
          required: [],
        },
      },
      {
        name: 'get_today_kpis',
        description: 'KPIs do dia atual: quantas ligações, reuniões, vendas, negócios tratados e empresas atingidas',
        input_schema: {
          type: 'object' as const,
          properties: {
            user_id: isManager
              ? { type: 'string', description: 'Vendedor específico (opcional)' }
              : undefined,
          },
          required: [],
        },
      },
      {
        name: 'get_pending_tasks',
        description: 'Lista todas as tarefas pendentes (criadas pelo usuário ou pela IA)',
        input_schema: {
          type: 'object' as const,
          properties: {
            priority: {
              type: 'string',
              enum: ['urgent', 'high', 'medium', 'low'],
              description: 'Filtrar por prioridade (opcional)',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_done_tasks',
        description: 'Lista tarefas concluídas hoje com notas do que foi realizado',
        input_schema: { type: 'object' as const, properties: {}, required: [] },
      },
      {
        name: 'create_task',
        description: 'Cria uma nova tarefa na agenda do vendedor',
        input_schema: {
          type: 'object' as const,
          properties: {
            title: { type: 'string', description: 'Título da tarefa (ex: Ligar para João - Empresa ABC)' },
            type: { type: 'string', enum: ['call', 'meeting', 'email', 'whatsapp', 'proposal', 'follow_up', 'demo', 'contract', 'other'] },
            priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
            deal_id: { type: 'string', description: 'ID do negócio relacionado (opcional)' },
            contact_name: { type: 'string', description: 'Nome do contato' },
            company_name: { type: 'string', description: 'Nome da empresa' },
            due_date: { type: 'string', description: 'Data de vencimento YYYY-MM-DD (padrão: hoje)' },
            due_time: { type: 'string', description: 'Hora HH:MM (opcional)' },
            description: { type: 'string', description: 'Detalhes ou objetivo da tarefa' },
          },
          required: ['title', 'type'],
        },
      },
      {
        name: 'complete_task',
        description: 'Marca uma tarefa como concluída com nota do que foi feito',
        input_schema: {
          type: 'object' as const,
          properties: {
            task_id: { type: 'string', description: 'ID da tarefa' },
            note: { type: 'string', description: 'O que foi feito, resultado da conversa' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'get_kpi_history',
        description: 'Histórico de KPIs dos últimos dias para análise de tendência',
        input_schema: {
          type: 'object' as const,
          properties: {
            days: { type: 'number', description: 'Número de dias (padrão: 7)' },
            user_id: isManager ? { type: 'string', description: 'Vendedor específico' } : undefined,
          },
          required: [],
        },
      },
      ...(isManager ? [{
        name: 'get_team_agenda_overview',
        description: 'Visão geral da agenda e KPIs de toda a equipe hoje',
        input_schema: { type: 'object' as const, properties: {}, required: [] },
      }] : []),
    ];
  }

  protected async executeTool(
    name: string,
    input: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<string> {
    const isManager = ctx.user_role !== 'salesperson';
    const targetUserId = (isManager && input.user_id) ? (input.user_id as string) : ctx.user_id;

    switch (name) {

      case 'get_today_agenda': {
        // Usa função DB para gerar sugestões + busca tarefas já criadas
        const [suggested, existing] = await Promise.all([
          this.deps.db.query(
            `SELECT * FROM generate_daily_tasks($1)`,
            [targetUserId]
          ),
          this.deps.db.query<Task>(
            `SELECT t.*, d.title as deal_title, d.value as deal_value
             FROM tasks t
             LEFT JOIN deals d ON d.id = t.deal_id
             WHERE t.user_id = $1 AND t.status IN ('pending', 'in_progress')
               AND (t.due_date IS NULL OR t.due_date <= CURRENT_DATE)
             ORDER BY
               CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
               t.due_date ASC NULLS LAST`,
            [targetUserId]
          ),
        ]);

        const result = {
          tarefas_agendadas: existing.rows.map((t: Task & { deal_title?: string }) => ({
            id: t.id,
            titulo: t.title,
            tipo: TYPE_EMOJI[t.type] + ' ' + TYPE_LABELS[t.type],
            prioridade: t.priority,
            contato: t.contact_name,
            empresa: t.company_name,
            negocio: t.deal_title,
            valor: t.source_deal_value
              ? `R$ ${Number(t.source_deal_value).toLocaleString('pt-BR')}`
              : undefined,
            hora: t.due_time,
            descricao: t.description,
            status: t.status,
          })),
          sugestoes_ia: suggested.rows.map((s: Record<string, unknown>) => ({
            negocio: s.deal_title,
            contato: s.contact_name,
            telefone: s.contact_phone,
            valor: s.deal_value ? `R$ ${Number(s.deal_value).toLocaleString('pt-BR')}` : undefined,
            acao_sugerida: TYPE_EMOJI[s.task_type as TaskType] + ' ' + TYPE_LABELS[s.task_type as TaskType],
            prioridade: s.priority,
            motivo: s.reason,
          })),
        };

        if (!result.tarefas_agendadas.length && !result.sugestoes_ia.length) {
          return 'Nenhuma tarefa pendente e sem negócios que precisam de atenção hoje. Continue assim!';
        }

        return JSON.stringify(result, null, 2);
      }

      case 'get_today_kpis': {
        const kpiRes = await this.deps.db.query(
          `SELECT k.*, g.goal_calls_per_day, g.goal_meetings_per_day, g.goal_companies_per_day
           FROM v_today_kpis k
           LEFT JOIN sales_goals g ON g.user_id = k.user_id
             AND g.period_start <= CURRENT_DATE AND g.period_end >= CURRENT_DATE
           WHERE k.user_id = $1`,
          [targetUserId]
        );

        const taskKpis = await this.deps.db.query(
          `SELECT
            COUNT(*) FILTER (WHERE status = 'done' AND completed_at::date = CURRENT_DATE) AS done_today,
            COUNT(*) FILTER (WHERE status IN ('pending','in_progress') AND due_date <= CURRENT_DATE) AS overdue,
            COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS created_today
           FROM tasks WHERE user_id = $1`,
          [targetUserId]
        );

        const k = kpiRes.rows[0] ?? {};
        const t = taskKpis.rows[0] ?? {};

        return JSON.stringify({
          data: new Date().toLocaleDateString('pt-BR'),
          atividades: {
            ligacoes: { feitas: k.calls_done ?? 0, meta: k.goal_calls_per_day, percent: k.goal_calls_per_day ? Math.round((k.calls_done / k.goal_calls_per_day) * 100) : null },
            reunioes: { feitas: k.meetings_done ?? 0, meta: k.goal_meetings_per_day, percent: k.goal_meetings_per_day ? Math.round((k.meetings_done / k.goal_meetings_per_day) * 100) : null },
            emails: k.emails_sent ?? 0,
            whatsapp: k.whatsapp_sent ?? 0,
          },
          vendas: {
            negocios_fechados: k.deals_won ?? 0,
            receita_hoje: k.revenue_won ? `R$ ${Number(k.revenue_won).toLocaleString('pt-BR')}` : 'R$ 0',
          },
          alcance: {
            negocios_tratados: k.deals_worked ?? 0,
            empresas_atingidas: { atingidas: k.companies_reached ?? 0, meta: k.goal_companies_per_day, percent: k.goal_companies_per_day ? Math.round((k.companies_reached / k.goal_companies_per_day) * 100) : null },
          },
          tarefas: {
            concluidas_hoje: t.done_today ?? 0,
            criadas_hoje: t.created_today ?? 0,
            atrasadas: t.overdue ?? 0,
          },
          pipeline: {
            negocios_ativos: k.active_deals ?? 0,
            valor_total: k.pipeline_value ? `R$ ${Number(k.pipeline_value).toLocaleString('pt-BR')}` : 'R$ 0',
          },
        }, null, 2);
      }

      case 'get_pending_tasks': {
        const priorityFilter = input.priority ? `AND t.priority = '${input.priority as string}'` : '';
        const res = await this.deps.db.query<Task>(
          `SELECT t.*, d.title as deal_title, d.stage as deal_stage
           FROM tasks t
           LEFT JOIN deals d ON d.id = t.deal_id
           WHERE t.user_id = $1 AND t.status IN ('pending', 'in_progress')
             ${priorityFilter}
           ORDER BY
             CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
             t.due_date ASC NULLS LAST, t.created_at ASC`,
          [targetUserId]
        );
        if (!res.rows.length) return 'Nenhuma tarefa pendente. 🎉';
        return JSON.stringify(res.rows.map((t: Task & { deal_title?: string }) => ({
          id: t.id,
          titulo: t.title,
          tipo: TYPE_EMOJI[t.type] + ' ' + TYPE_LABELS[t.type],
          prioridade: t.priority,
          empresa: t.company_name,
          contato: t.contact_name,
          negocio: t.deal_title,
          prazo: t.due_date ?? 'sem prazo',
          hora: t.due_time ?? '',
          descricao: t.description,
        })), null, 2);
      }

      case 'get_done_tasks': {
        const res = await this.deps.db.query<Task>(
          `SELECT t.*, d.title as deal_title
           FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id
           WHERE t.user_id = $1 AND t.status = 'done'
             AND t.completed_at::date = CURRENT_DATE
           ORDER BY t.completed_at DESC`,
          [targetUserId]
        );
        if (!res.rows.length) return 'Nenhuma tarefa concluída hoje ainda.';
        return JSON.stringify(res.rows.map((t: Task & { deal_title?: string }) => ({
          titulo: t.title,
          tipo: TYPE_EMOJI[t.type] + ' ' + TYPE_LABELS[t.type],
          empresa: t.company_name,
          contato: t.contact_name,
          negocio: t.deal_title,
          concluida_as: t.completed_at,
          nota: t.completed_note ?? '(sem nota)',
        })), null, 2);
      }

      case 'create_task': {
        const res = await this.deps.db.query<Task>(
          `INSERT INTO tasks
             (user_id, company_id, deal_id, title, type, priority, contact_name, company_name,
              due_date, due_time, description, created_by, source_deal_value)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'agent',$12)
           RETURNING id, title, type, priority, due_date`,
          [
            targetUserId,
            ctx.company_id,
            (input.deal_id as string) ?? null,
            input.title as string,
            (input.type as string) ?? 'other',
            (input.priority as string) ?? 'medium',
            (input.contact_name as string) ?? null,
            (input.company_name as string) ?? null,
            (input.due_date as string) ?? new Date().toISOString().split('T')[0],
            (input.due_time as string) ?? null,
            (input.description as string) ?? null,
            null,
          ]
        );
        const t = res.rows[0];
        return JSON.stringify({
          success: true,
          tarefa_criada: {
            id: t.id,
            titulo: t.title,
            tipo: TYPE_LABELS[t.type as TaskType],
            prioridade: t.priority,
            prazo: t.due_date,
          },
        });
      }

      case 'complete_task': {
        const res = await this.deps.db.query<Task>(
          `UPDATE tasks
           SET status = 'done', completed_at = NOW(), completed_note = $1, updated_at = NOW()
           WHERE id = $2 AND user_id = $3
           RETURNING id, title, type`,
          [(input.note as string) ?? null, input.task_id as string, targetUserId]
        );
        if (!res.rows.length) return 'Tarefa não encontrada ou sem permissão.';
        return JSON.stringify({
          success: true,
          mensagem: `✅ "${res.rows[0].title}" marcada como concluída!`,
        });
      }

      case 'get_kpi_history': {
        const days = (input.days as number) ?? 7;
        const res = await this.deps.db.query(
          `SELECT date, calls_done, meetings_done, deals_won, revenue_won,
                  deals_worked, companies_reached, tasks_done, pipeline_value
           FROM daily_kpis
           WHERE user_id = $1 AND date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
           ORDER BY date ASC`,
          [targetUserId, days]
        );
        if (!res.rows.length) return 'Sem histórico de KPIs ainda. Os dados acumulam a partir de hoje.';
        return JSON.stringify({ historico: res.rows, periodo_dias: days }, null, 2);
      }

      case 'get_team_agenda_overview': {
        const res = await this.deps.db.query(
          `SELECT
            u.name as vendedor,
            k.calls_done, k.meetings_done, k.deals_won,
            k.revenue_won, k.deals_worked, k.companies_reached,
            k.active_deals, k.pipeline_value,
            COUNT(t.id) FILTER (WHERE t.status IN ('pending','in_progress') AND t.due_date <= CURRENT_DATE) as tarefas_atrasadas,
            COUNT(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at::date = CURRENT_DATE) as tarefas_hoje
           FROM users u
           LEFT JOIN v_today_kpis k ON k.user_id = u.id
           LEFT JOIN tasks t ON t.user_id = u.id
           WHERE u.company_id = $1 AND u.active = true AND u.role = 'salesperson'
           GROUP BY u.id, u.name, k.calls_done, k.meetings_done, k.deals_won,
                    k.revenue_won, k.deals_worked, k.companies_reached, k.active_deals, k.pipeline_value
           ORDER BY k.deals_won DESC, k.calls_done DESC`,
          [ctx.company_id]
        );
        return JSON.stringify({ equipe_hoje: res.rows }, null, 2);
      }

      default:
        return `Ferramenta "${name}" não reconhecida.`;
    }
  }

  // Consolida KPIs do dia e salva no histórico (chamado pelo scheduler às 23h)
  async persistDailyKPIs(companyId: string): Promise<void> {
    await this.deps.db.query(`
      INSERT INTO daily_kpis
        (user_id, company_id, date, calls_done, meetings_done, emails_sent, whatsapp_sent,
         deals_won, revenue_won, deals_worked, companies_reached, pipeline_value, active_deals)
      SELECT
        k.user_id, k.company_id, CURRENT_DATE,
        k.calls_done, k.meetings_done, k.emails_sent, k.whatsapp_sent,
        k.deals_won, k.revenue_won, k.deals_worked, k.companies_reached,
        k.pipeline_value, k.active_deals
      FROM v_today_kpis k
      JOIN users u ON u.id = k.user_id AND u.company_id = $1
      ON CONFLICT (user_id, date) DO UPDATE SET
        calls_done = EXCLUDED.calls_done,
        meetings_done = EXCLUDED.meetings_done,
        deals_won = EXCLUDED.deals_won,
        revenue_won = EXCLUDED.revenue_won,
        deals_worked = EXCLUDED.deals_worked,
        companies_reached = EXCLUDED.companies_reached,
        pipeline_value = EXCLUDED.pipeline_value,
        active_deals = EXCLUDED.active_deals
    `, [companyId]);
  }
}
