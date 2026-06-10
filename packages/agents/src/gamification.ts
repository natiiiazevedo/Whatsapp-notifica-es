import type { AgentContext, GamificationProfile } from '@sales/shared';
import { BaseAgent } from './base.js';
import type { Tool } from './base.js';

const LEVELS = [
  { level: 1, name: 'Iniciante', xp_required: 0 },
  { level: 2, name: 'Prospectador', xp_required: 100 },
  { level: 3, name: 'Negociador', xp_required: 300 },
  { level: 4, name: 'Closer', xp_required: 700 },
  { level: 5, name: 'Expert', xp_required: 1500 },
  { level: 6, name: 'Mestre', xp_required: 3000 },
  { level: 7, name: 'Lenda', xp_required: 6000 },
];

const POINT_RULES = {
  deal_won: 100,           // Por real ganho ÷ 100 + bônus fixo
  deal_won_bonus: 200,     // Bônus fixo por fechamento
  activity_call: 10,
  activity_meeting: 20,
  activity_email: 5,
  deal_advanced: 30,       // Avançou etapa no funil
  daily_streak: 50,        // Bônus de streak diário
  overdue_recovered: 40,   // Reativou negócio inativo
};

export class GamificationAgent extends BaseAgent {
  protected systemPrompt(ctx: AgentContext): string {
    const isManager = ctx.user_role !== 'salesperson';
    return `Você é o agente de gamificação e motivação da equipe comercial.
Você transforma dados de performance em engajamento, reconhecimento e competição saudável.

${isManager
  ? `**Modo Gestor:** Você mostra o ranking completo, celebra conquistas e sugere ações motivacionais.`
  : `**Modo Vendedor:** Você mostra o progresso de ${ctx.user_name}, próximas conquistas e posição no ranking.`
}

**Regras de pontuação:**
- Negócio fechado: ${POINT_RULES.deal_won_bonus} pts + 1 pt por R$100 ganhos
- Ligação realizada: ${POINT_RULES.activity_call} pts
- Reunião realizada: ${POINT_RULES.activity_meeting} pts
- E-mail enviado: ${POINT_RULES.activity_email} pts
- Avançou etapa no funil: ${POINT_RULES.deal_advanced} pts
- Streak diário (atividade todo dia): ${POINT_RULES.daily_streak} pts bônus
- Reativou negócio inativo: ${POINT_RULES.overdue_recovered} pts

**Níveis:** ${LEVELS.map(l => `${l.name} (Nv.${l.level})`).join(' → ')}

Tom: energético, celebratório, competitivo de forma saudável. Use dados para motivar, não para pressionar.`;
  }

  protected tools(ctx: AgentContext): Tool[] {
    const isManager = ctx.user_role !== 'salesperson';
    return [
      {
        name: 'get_ranking',
        description: 'Busca o ranking atual da equipe por pontos',
        input_schema: {
          type: 'object' as const,
          properties: {
            period: { type: 'string', enum: ['weekly', 'monthly', 'all_time'], description: 'Período do ranking' },
          },
          required: [],
        },
      },
      {
        name: 'get_my_profile',
        description: 'Busca o perfil de gamificação do usuário atual',
        input_schema: { type: 'object' as const, properties: {}, required: [] },
      },
      ...(isManager ? [{
        name: 'get_team_achievements',
        description: 'Lista todas as conquistas recentes da equipe',
        input_schema: { type: 'object' as const, properties: {}, required: [] },
      }] : []),
      {
        name: 'award_points',
        description: 'Concede pontos para um usuário por uma ação realizada',
        input_schema: {
          type: 'object' as const,
          properties: {
            user_id: { type: 'string', description: 'ID do usuário' },
            event_type: { type: 'string', description: 'Tipo de evento que gerou os pontos' },
            points: { type: 'number', description: 'Quantidade de pontos' },
            description: { type: 'string', description: 'Descrição do motivo' },
          },
          required: ['user_id', 'event_type', 'points'],
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
      case 'get_ranking': {
        const period = (input.period as string) ?? 'monthly';
        let dateFilter = '';
        if (period === 'weekly') dateFilter = `AND ge.created_at >= NOW() - INTERVAL '7 days'`;
        if (period === 'monthly') dateFilter = `AND ge.created_at >= DATE_TRUNC('month', NOW())`;

        const res = await this.deps.db.query(
          `SELECT
            u.id, u.name, u.avatar_url,
            COALESCE(SUM(ge.points), 0) as pontos_periodo,
            gp.points as pontos_total, gp.level, gp.level_name, gp.streak_days,
            RANK() OVER (ORDER BY COALESCE(SUM(ge.points), 0) DESC) as posicao
           FROM users u
           LEFT JOIN gamification_events ge ON ge.user_id = u.id ${dateFilter}
           LEFT JOIN gamification_profiles gp ON gp.user_id = u.id
           WHERE u.company_id = $1 AND u.active = true AND u.role = 'salesperson'
           GROUP BY u.id, u.name, u.avatar_url, gp.points, gp.level, gp.level_name, gp.streak_days
           ORDER BY pontos_periodo DESC`,
          [ctx.company_id]
        );
        return JSON.stringify({ periodo: period, ranking: res.rows }, null, 2);
      }

      case 'get_my_profile': {
        const res = await this.deps.db.query<GamificationProfile>(
          `SELECT gp.*, u.name,
            (SELECT COALESCE(SUM(points), 0) FROM gamification_events WHERE user_id = $1 AND created_at >= DATE_TRUNC('month', NOW())) as pontos_mes
           FROM gamification_profiles gp
           JOIN users u ON u.id = gp.user_id
           WHERE gp.user_id = $1`,
          [ctx.user_id]
        );
        if (res.rows.length === 0) return 'Perfil de gamificação ainda não inicializado.';

        const profile = res.rows[0];
        const currentLevel = LEVELS.find(l => l.level === profile.level)!;
        const nextLevel = LEVELS.find(l => l.level === profile.level + 1);

        return JSON.stringify({
          ...profile,
          nivel_atual: currentLevel.name,
          proximo_nivel: nextLevel ? `${nextLevel.name} (faltam ${nextLevel.xp_required - profile.xp_current} XP)` : 'Nível máximo atingido!',
        }, null, 2);
      }

      case 'get_team_achievements': {
        const res = await this.deps.db.query(
          `SELECT ge.*, u.name as vendedor
           FROM gamification_events ge
           JOIN users u ON ge.user_id = u.id
           WHERE u.company_id = $1 AND ge.created_at >= NOW() - INTERVAL '7 days'
           ORDER BY ge.created_at DESC LIMIT 50`,
          [ctx.company_id]
        );
        return JSON.stringify({ conquistas_recentes: res.rows }, null, 2);
      }

      case 'award_points': {
        const { user_id, event_type, points, description } = input as {
          user_id: string; event_type: string; points: number; description?: string;
        };

        // Registra o evento
        await this.deps.db.query(
          `INSERT INTO gamification_events (user_id, event_type, points, description)
           VALUES ($1, $2, $3, $4)`,
          [user_id, event_type, points, description ?? event_type]
        );

        // Atualiza perfil (upsert)
        await this.deps.db.query(
          `INSERT INTO gamification_profiles (user_id, points, xp_current)
           VALUES ($1, $2, $2)
           ON CONFLICT (user_id) DO UPDATE SET
             points = gamification_profiles.points + $2,
             xp_current = gamification_profiles.xp_current + $2,
             updated_at = NOW()`,
          [user_id, points]
        );

        // Verifica level up
        await this.checkLevelUp(user_id);

        return JSON.stringify({ success: true, user_id, points_awarded: points });
      }

      default:
        return `Ferramenta "${name}" não reconhecida.`;
    }
  }

  private async checkLevelUp(userId: string): Promise<void> {
    const res = await this.deps.db.query<GamificationProfile>(
      `SELECT level, xp_current FROM gamification_profiles WHERE user_id = $1`,
      [userId]
    );
    if (!res.rows[0]) return;

    const { level, xp_current } = res.rows[0];
    const nextLevel = LEVELS.find(l => l.level === level + 1);

    if (nextLevel && xp_current >= nextLevel.xp_required) {
      await this.deps.db.query(
        `UPDATE gamification_profiles
         SET level = $1, level_name = $2,
             xp_next_level = $3, updated_at = NOW()
         WHERE user_id = $4`,
        [nextLevel.level, nextLevel.name,
         LEVELS[nextLevel.level]?.xp_required ?? 999999, userId]
      );
    }
  }

  // Processa evento de negócio fechado e concede pontos automaticamente
  async processDealWon(userId: string, dealValue: number, companyId: string): Promise<void> {
    const points = POINT_RULES.deal_won_bonus + Math.floor(dealValue / 100);
    const ctx: AgentContext = {
      user_id: userId, company_id: companyId,
      user_role: 'manager', user_name: 'Sistema', channel: 'web',
    };
    await this.executeTool('award_points', {
      user_id: userId,
      event_type: 'deal_won',
      points,
      description: `Negócio fechado! R$ ${dealValue.toLocaleString('pt-BR')} → +${points} pts`,
    }, ctx);
  }
}
