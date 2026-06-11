import cron from 'node-cron';
import type { Pool } from 'pg';
import type { OrchestratorAgent } from '@sales/agents';
import type { WhatsAppService } from './whatsapp.js';
import type { BitrixSyncService } from '@sales/bitrix';

export function startScheduler(deps: {
  db: Pool;
  orchestrator: OrchestratorAgent;
  whatsapp: WhatsAppService;
  bitrixSync: BitrixSyncService;
}) {
  const { db, orchestrator, whatsapp, bitrixSync } = deps;

  // ─── Sync Bitrix24 a cada 15 minutos ───────────────────────
  cron.schedule('*/15 * * * *', async () => {
    console.log('[scheduler] Syncing Bitrix24...');
    try {
      const since = new Date(Date.now() - 16 * 60 * 1000); // último sync + margem
      const deals = await bitrixSync.syncDeals(since);
      const activities = await bitrixSync.syncActivities(since);

      // Upsert deals
      for (const deal of deals) {
        await db.query(
          `INSERT INTO deals (id, company_id, assigned_user_id, title, stage, stage_id, value,
                              currency, probability, expected_close_date, last_activity_at, metadata, bitrix_data, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
           ON CONFLICT (id) DO UPDATE SET
             stage=$5, stage_id=$6, value=$7, probability=$9,
             expected_close_date=$10, last_activity_at=$11,
             bitrix_data=$13, synced_at=NOW(), updated_at=NOW()`,
          [deal.id, deal.company_id, deal.assigned_user_id, deal.title,
           deal.stage, deal.stage_id, deal.value, deal.currency, deal.probability,
           deal.expected_close_date, deal.last_activity_at,
           JSON.stringify(deal.metadata), JSON.stringify(deal.bitrix_data)]
        );
      }

      // Upsert activities
      for (const activity of activities) {
        await db.query(
          `INSERT INTO activities (id, deal_id, assigned_user_id, company_id, type, subject, completed, completed_at, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT (id) DO UPDATE SET completed=$7, completed_at=$8, synced_at=NOW()`,
          [activity.id, activity.deal_id, activity.assigned_user_id, activity.company_id,
           activity.type, activity.subject, activity.completed, activity.completed_at]
        );
      }

      console.log(`[scheduler] Synced ${deals.length} deals, ${activities.length} activities`);
    } catch (err) {
      console.error('[scheduler] Bitrix sync error:', err);
    }
  });

  // ─── Varredura de inatividade - diária às 8h ────────────────
  cron.schedule('0 8 * * 1-5', async () => {
    console.log('[scheduler] Running inactivity scan...');
    try {
      const companies = await db.query(
        `SELECT DISTINCT c.id as company_id, u.id as manager_id, u.whatsapp
         FROM companies c
         JOIN users u ON u.company_id = c.id AND u.role IN ('manager', 'admin')
         WHERE u.active = true`
      );

      const inactivityAgent = orchestrator.getAgent('inactivity') as import('@sales/agents').InactivityAgent;
      if (!inactivityAgent) return;

      for (const row of companies.rows) {
        const result = await (inactivityAgent as import('@sales/agents').InactivityAgent).runAutomated(
          row.company_id, row.manager_id
        );

        if (result.summary && row.whatsapp) {
          const criticalCount = (result.summary.match(/CRÍTICO|URGENTE/g) ?? []).length;
          if (criticalCount > 0) {
            await whatsapp.sendText(row.whatsapp,
              `🚨 *Alerta de Inatividade - ${new Date().toLocaleDateString('pt-BR')}*\n\n${result.summary.slice(0, 1000)}`
            );
          }
        }
      }
    } catch (err) {
      console.error('[scheduler] Inactivity scan error:', err);
    }
  });

  // ─── Briefing matinal para vendedores - 8h30 dias úteis ─────
  cron.schedule('30 8 * * 1-5', async () => {
    console.log('[scheduler] Sending morning briefings...');
    try {
      const sellers = await db.query(
        `SELECT u.id, u.name, u.whatsapp, u.company_id,
                COUNT(d.id) FILTER (WHERE d.days_without_activity >= 3 AND d.stage NOT IN ('won','lost')) as deals_em_risco,
                (SELECT title FROM deals WHERE assigned_user_id = u.id
                 AND stage NOT IN ('won','lost')
                 ORDER BY (COALESCE(value,0) * COALESCE(probability,50) / 100.0 + COALESCE(days_without_activity,0) * 1000) DESC
                 LIMIT 1) as top_priority
         FROM users u
         LEFT JOIN deals d ON d.assigned_user_id = u.id
         WHERE u.active = true AND u.role = 'salesperson' AND u.whatsapp IS NOT NULL
         GROUP BY u.id, u.name, u.whatsapp, u.company_id`
      );

      for (const seller of sellers.rows) {
        if (seller.whatsapp) {
          await whatsapp.sendDailyBriefing(seller.whatsapp, {
            userName: seller.name.split(' ')[0],
            dealsAtRisk: parseInt(seller.deals_em_risco ?? '0'),
            topPriority: seller.top_priority,
            todayGoal: 'Faça 5 contatos hoje!',
          });
        }
      }
    } catch (err) {
      console.error('[scheduler] Morning briefing error:', err);
    }
  });

  // ─── Consolida KPIs diários - 23h ────────────────────────────
  cron.schedule('0 23 * * *', async () => {
    console.log('[scheduler] Persisting daily KPIs...');
    try {
      // Persiste KPIs do dia via AgendaAgent
      const agendaAgent = orchestrator.getAgent('agenda') as import('@sales/agents').AgendaAgent;
      const companiesRes = await db.query(`SELECT DISTINCT company_id FROM users WHERE active = true`);
      for (const row of companiesRes.rows) {
        await agendaAgent?.persistDailyKPIs(row.company_id).catch(console.error);
      }

      // Também persiste métricas legadas
      await db.query(`
        INSERT INTO daily_metrics (user_id, company_id, date, deals_active, deals_won, revenue_won, pipeline_value)
        SELECT
          d.assigned_user_id, d.company_id, CURRENT_DATE,
          COUNT(*) FILTER (WHERE d.stage NOT IN ('won','lost')),
          COUNT(*) FILTER (WHERE d.stage = 'won' AND d.updated_at::date = CURRENT_DATE),
          COALESCE(SUM(d.value) FILTER (WHERE d.stage = 'won' AND d.updated_at::date = CURRENT_DATE), 0),
          COALESCE(SUM(d.value) FILTER (WHERE d.stage NOT IN ('won','lost')), 0)
        FROM deals d
        GROUP BY d.assigned_user_id, d.company_id
        ON CONFLICT (user_id, company_id, date) DO UPDATE SET
          deals_active = EXCLUDED.deals_active,
          deals_won = EXCLUDED.deals_won,
          revenue_won = EXCLUDED.revenue_won,
          pipeline_value = EXCLUDED.pipeline_value
      `);
    } catch (err) {
      console.error('[scheduler] Daily KPIs error:', err);
    }
  });

  // ─── Marcar tarefas vencidas - 9h ─────────────────────────────
  cron.schedule('0 9 * * 1-5', async () => {
    try {
      const overdue = await db.query(
        `SELECT t.*, u.whatsapp, u.name
         FROM tasks t JOIN users u ON u.id = t.user_id
         WHERE t.status = 'pending'
           AND t.due_date < CURRENT_DATE
           AND u.whatsapp IS NOT NULL`
      );
      for (const task of overdue.rows) {
        await whatsapp.sendText(task.whatsapp,
          `⏰ *Tarefa atrasada:* ${task.title}\nPrazo era ${new Date(task.due_date).toLocaleDateString('pt-BR')}.\nResponda "feito" para concluir ou acesse a plataforma.`
        ).catch(() => {});
      }
    } catch (err) {
      console.error('[scheduler] Overdue tasks error:', err);
    }
  });

  console.log('[scheduler] All cron jobs started');
}
