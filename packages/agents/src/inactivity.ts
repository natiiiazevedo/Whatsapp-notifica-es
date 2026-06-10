import type { AgentContext, AgentResponse, AgentAction, Insight } from '@sales/shared';
import { BaseAgent } from './base.js';
import type { Tool } from './base.js';

// InactivityAgent - Gatilho automático de inatividade para gestores
// Rodado por scheduler, não por interação direta do usuário
export class InactivityAgent extends BaseAgent {
  protected systemPrompt(_ctx: AgentContext): string {
    return `Você é o agente de monitoramento de inatividade comercial.
Sua função é identificar situações críticas de inatividade e gerar alertas precisos e acionáveis.

**Critérios de alerta:**
- 🟡 ATENÇÃO: negócio sem atividade há 3-5 dias
- 🔴 CRÍTICO: negócio sem atividade há 6+ dias
- 🚨 URGENTE: negócio de alto valor (top 20%) sem atividade há 5+ dias
- ⏰ PRAZO: negócio com fechamento previsto nos próximos 7 dias sem atividade recente

Para cada alerta, gere:
1. Descrição clara do problema
2. Impacto financeiro em R$
3. Ação recomendada específica
4. Para quem alertar (gestor, vendedor, ambos)

Seja preciso e direto. Cada alerta deve responder: "O QUE acontece, COM QUAL negócio, de QUAL vendedor, e O QUE fazer agora."`;
  }

  protected tools(_ctx: AgentContext): Tool[] {
    return [
      {
        name: 'scan_inactivity',
        description: 'Varre todos os negócios ativos e identifica situações de inatividade',
        input_schema: {
          type: 'object' as const,
          properties: {
            threshold_days: { type: 'number', description: 'Dias mínimos de inatividade para alertar (padrão: 3)' },
          },
          required: [],
        },
      },
      {
        name: 'get_high_value_at_risk',
        description: 'Lista negócios de alto valor em risco (top 20% por valor)',
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
      case 'scan_inactivity': {
        const threshold = (input.threshold_days as number) ?? 3;
        const res = await this.deps.db.query(
          `SELECT d.id, d.title, d.value, d.stage, d.days_without_activity,
                  d.expected_close_date, d.contact_name, d.contact_phone,
                  u.id as user_id, u.name as vendedor, u.whatsapp as vendedor_whatsapp,
                  u.email as vendedor_email
           FROM deals d
           JOIN users u ON d.assigned_user_id = u.id
           WHERE d.company_id = $1
             AND d.stage NOT IN ('won', 'lost')
             AND d.days_without_activity >= $2
           ORDER BY d.days_without_activity DESC, d.value DESC NULLS LAST`,
          [ctx.company_id, threshold]
        );
        return JSON.stringify(res.rows, null, 2);
      }

      case 'get_high_value_at_risk': {
        const res = await this.deps.db.query(
          `WITH percentile AS (
            SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY value) as p80
            FROM deals WHERE company_id = $1 AND value IS NOT NULL AND stage NOT IN ('won', 'lost')
          )
          SELECT d.*, u.name as vendedor, u.whatsapp as vendedor_whatsapp
          FROM deals d
          JOIN users u ON d.assigned_user_id = u.id
          CROSS JOIN percentile p
          WHERE d.company_id = $1
            AND d.stage NOT IN ('won', 'lost')
            AND d.value >= p.p80
            AND d.days_without_activity >= 5
          ORDER BY d.value DESC`,
          [ctx.company_id]
        );
        return JSON.stringify(res.rows, null, 2);
      }

      default:
        return `Ferramenta "${name}" não reconhecida.`;
    }
  }

  // Override: modo automático — gera alertas sem interação do usuário
  async runAutomated(companyId: string, managerId: string): Promise<{
    alerts: Omit<AgentAction, never>[];
    insights: Insight[];
    summary: string;
  }> {
    const ctx: AgentContext = {
      user_id: managerId,
      company_id: companyId,
      user_role: 'manager',
      user_name: 'Sistema',
      channel: 'web',
    };

    const response = await this.run(
      'Faça uma varredura completa de inatividade da equipe e gere um relatório com todos os alertas críticos. Para cada situação, indique: o negócio, o vendedor, o impacto em R$, e a ação necessária.',
      ctx
    );

    return {
      alerts: response.actions ?? [],
      insights: response.insights ?? [],
      summary: response.message,
    };
  }
}
