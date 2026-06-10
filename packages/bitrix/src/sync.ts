import type { Deal, Activity, DealStage } from '@sales/shared';
import { Bitrix24Client } from './client.js';

// Mapeia STAGE_ID do Bitrix24 para nosso enum
const STAGE_MAP: Record<string, DealStage> = {
  'NEW': 'new',
  'PREPARATION': 'qualification',
  'EXECUTING': 'qualification',
  'FINAL_INVOICE': 'proposal',
  'SENT': 'proposal',
  'CONDUCTING': 'negotiation',
  'WON': 'won',
  'LOSE': 'lost',
  'APOLOGY': 'lost',
};

function mapStage(stageId: string): DealStage {
  const upper = stageId.toUpperCase();
  if (upper.includes('WON') || upper.includes('FINAL')) return 'won';
  if (upper.includes('LOSE') || upper.includes('APOLOGY') || upper.includes('FAIL')) return 'lost';
  return STAGE_MAP[upper] ?? 'new';
}

const ACTIVITY_TYPE_MAP: Record<string, Activity['type']> = {
  '1': 'meeting',
  '2': 'call',
  '3': 'task',
  '4': 'email',
  '6': 'meeting',
};

export class BitrixSyncService {
  constructor(
    private client: Bitrix24Client,
    private companyId: string,
    private userBitrixMap: Map<string, string>, // bitrix_user_id → our user UUID
  ) {}

  async syncDeals(since?: Date): Promise<Deal[]> {
    const rawDeals = since
      ? await this.client.getDealsModifiedAfter(since)
      : await this.client.getDeals();

    return rawDeals.map(raw => {
      const userId = this.userBitrixMap.get(raw.ASSIGNED_BY_ID);
      const lastActivity = raw['UF_CRM_LAST_ACTIVITY_TIME'] as string | undefined;

      return {
        id: raw.ID,
        company_id: this.companyId,
        assigned_user_id: userId,
        bitrix_assigned_id: raw.ASSIGNED_BY_ID,
        title: raw.TITLE,
        stage: mapStage(raw.STAGE_ID),
        stage_id: raw.STAGE_ID,
        value: raw.OPPORTUNITY ? parseFloat(raw.OPPORTUNITY) : undefined,
        currency: raw.CURRENCY_ID || 'BRL',
        probability: raw.PROBABILITY ? parseInt(raw.PROBABILITY) : 0,
        contact_name: undefined,
        contact_phone: undefined,
        company_name: undefined,
        expected_close_date: raw.CLOSEDATE || undefined,
        last_activity_at: lastActivity || raw.DATE_MODIFY,
        days_without_activity: 0, // calculado pelo DB
        metadata: {},
        bitrix_data: raw as unknown as Record<string, unknown>,
        synced_at: new Date().toISOString(),
        created_at: raw.DATE_CREATE,
        updated_at: raw.DATE_MODIFY,
      } satisfies Deal;
    });
  }

  async syncActivities(since?: Date): Promise<Activity[]> {
    const rawActivities = since
      ? await this.client.getActivitiesModifiedAfter(since)
      : await this.client.getActivities();

    return rawActivities.map(raw => {
      const userId = this.userBitrixMap.get(raw.RESPONSIBLE_ID);

      return {
        id: raw.ID,
        deal_id: raw.OWNER_TYPE_ID === '2' ? raw.OWNER_ID : undefined,
        assigned_user_id: userId,
        company_id: this.companyId,
        type: ACTIVITY_TYPE_MAP[raw.TYPE_ID] ?? 'other',
        subject: raw.SUBJECT,
        description: raw.DESCRIPTION,
        completed: raw.COMPLETED === 'Y',
        deadline: raw.DEADLINE || undefined,
        completed_at: raw.END_TIME || undefined,
        duration_minutes: raw.DURATION ? Math.floor(parseInt(raw.DURATION) / 60) : undefined,
        metadata: {},
        synced_at: new Date().toISOString(),
        created_at: raw.DATE_CREATE,
      } satisfies Activity;
    });
  }
}
