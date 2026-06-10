// Evolution API client para WhatsApp
export class WhatsAppService {
  private baseUrl: string;
  private apiKey: string;
  private instance: string;

  constructor() {
    this.baseUrl = process.env.EVOLUTION_API_URL!;
    this.apiKey = process.env.EVOLUTION_API_KEY!;
    this.instance = process.env.EVOLUTION_INSTANCE_NAME ?? 'comercial';
  }

  private async request(path: string, body: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Evolution API error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async sendText(phone: string, message: string): Promise<void> {
    const number = phone.replace(/\D/g, '');
    await this.request(`/message/sendText/${this.instance}`, {
      number: `55${number}@s.whatsapp.net`,
      text: message,
    });
  }

  async sendInsight(phone: string, insight: {
    title: string;
    content: string;
    priority: string;
  }): Promise<void> {
    const priorityEmoji = {
      urgent: '🚨',
      high: '🔴',
      medium: '🟡',
      low: '🟢',
    }[insight.priority] ?? '📋';

    const message = `${priorityEmoji} *${insight.title}*\n\n${insight.content}`;
    await this.sendText(phone, message);
  }

  async sendDailyBriefing(phone: string, briefing: {
    userName: string;
    dealsAtRisk: number;
    topPriority?: string;
    todayGoal: string;
  }): Promise<void> {
    const message = `☀️ Bom dia, *${briefing.userName}*!\n\n` +
      `📊 *Sua carteira hoje:*\n` +
      (briefing.dealsAtRisk > 0 ? `⚠️ ${briefing.dealsAtRisk} negócio(s) precisam de atenção\n` : '') +
      (briefing.topPriority ? `🎯 Prioridade: ${briefing.topPriority}\n` : '') +
      `\n💬 Quer que eu analise sua carteira agora? Responda com *"carteira"*`;

    await this.sendText(phone, message);
  }

  // Extrai o texto da mensagem recebida
  static extractMessageText(webhookData: { data: { message: { conversation?: string; extendedTextMessage?: { text: string } } } }): string {
    return webhookData.data.message.conversation
      ?? webhookData.data.message.extendedTextMessage?.text
      ?? '';
  }

  // Extrai o número do remetente
  static extractSender(webhookData: { data: { key: { remoteJid: string } } }): string {
    return webhookData.data.key.remoteJid.replace('@s.whatsapp.net', '').replace('55', '');
  }
}
