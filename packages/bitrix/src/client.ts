import type { Bitrix24Deal, Bitrix24Activity } from '@sales/shared';

export interface Bitrix24Config {
  domain: string;      // https://empresa.bitrix24.com.br
  userId: string;      // ID do usuário para webhook
  webhookToken: string; // token do webhook
}

interface ListParams {
  filter?: Record<string, unknown>;
  select?: string[];
  order?: Record<string, 'ASC' | 'DESC'>;
  start?: number;
}

interface ListResult<T> {
  result: T[];
  total: number;
  next?: number;
}

export class Bitrix24Client {
  private baseUrl: string;

  constructor(private config: Bitrix24Config) {
    this.baseUrl = `${config.domain}/rest/${config.userId}/${config.webhookToken}`;
  }

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.baseUrl}/${method}.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      throw new Error(`Bitrix24 API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as { result: T; error?: string };
    if (data.error) {
      throw new Error(`Bitrix24 error: ${data.error}`);
    }

    return data.result;
  }

  // Busca lista completa com paginação automática
  private async listAll<T>(method: string, params: ListParams = {}): Promise<T[]> {
    const all: T[] = [];
    let start = 0;

    while (true) {
      const res = await this.call<ListResult<T>>(method, { ...params, start });
      all.push(...res.result);

      if (!res.next || all.length >= res.total) break;
      start = res.next;

      // Rate limiting: 2 req/s permitido pelo Bitrix24
      await new Promise(r => setTimeout(r, 500));
    }

    return all;
  }

  // ─── Deals ────────────────────────────────────────────────

  async getDeals(filter: Record<string, unknown> = {}): Promise<Bitrix24Deal[]> {
    return this.listAll<Bitrix24Deal>('crm.deal.list', {
      filter,
      select: [
        'ID', 'TITLE', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID',
        'PROBABILITY', 'ASSIGNED_BY_ID', 'CONTACT_ID', 'COMPANY_ID',
        'CLOSEDATE', 'DATE_CREATE', 'DATE_MODIFY',
        'UF_CRM_LAST_ACTIVITY_TIME', 'SOURCE_ID', 'STATUS_ID',
      ],
      order: { DATE_MODIFY: 'DESC' },
    });
  }

  async getDeal(id: string): Promise<Bitrix24Deal> {
    return this.call<Bitrix24Deal>('crm.deal.get', { id });
  }

  async getDealsModifiedAfter(date: Date): Promise<Bitrix24Deal[]> {
    return this.getDeals({
      '>=DATE_MODIFY': date.toISOString(),
    });
  }

  // ─── Activities ───────────────────────────────────────────

  async getActivities(filter: Record<string, unknown> = {}): Promise<Bitrix24Activity[]> {
    return this.listAll<Bitrix24Activity>('crm.activity.list', {
      filter,
      select: [
        'ID', 'OWNER_ID', 'OWNER_TYPE_ID', 'TYPE_ID', 'SUBJECT',
        'DESCRIPTION', 'RESPONSIBLE_ID', 'DEADLINE', 'COMPLETED',
        'END_TIME', 'DURATION', 'DATE_CREATE',
      ],
      order: { DATE_CREATE: 'DESC' },
    });
  }

  async getActivitiesForDeal(dealId: string): Promise<Bitrix24Activity[]> {
    return this.getActivities({
      OWNER_TYPE_ID: 2, // 2 = Deal no Bitrix24
      OWNER_ID: dealId,
    });
  }

  async getActivitiesModifiedAfter(date: Date): Promise<Bitrix24Activity[]> {
    return this.getActivities({
      '>=DATE_CREATE': date.toISOString(),
    });
  }

  // ─── Contacts ─────────────────────────────────────────────

  async getContact(id: string): Promise<Record<string, unknown>> {
    return this.call('crm.contact.get', { id });
  }

  // ─── Users ────────────────────────────────────────────────

  async getUsers(): Promise<Array<{ ID: string; NAME: string; LAST_NAME: string; EMAIL: string; PERSONAL_MOBILE: string }>> {
    return this.listAll('user.get', { filter: { ACTIVE: true } });
  }

  // ─── Pipeline stages ──────────────────────────────────────

  async getDealStages(): Promise<Array<{ STATUS_ID: string; NAME: string; SORT: string }>> {
    return this.call('crm.dealcategory.stage.list', { id: 0 });
  }

  // ─── Webhook registration ─────────────────────────────────

  async registerWebhook(eventName: string, handlerUrl: string): Promise<unknown> {
    return this.call('event.bind', {
      event: eventName,
      handler: handlerUrl,
    });
  }
}
