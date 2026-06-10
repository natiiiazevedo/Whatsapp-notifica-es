// ─── Domínio ──────────────────────────────────────────────────

export type UserRole = 'salesperson' | 'manager' | 'admin';

export interface User {
  id: string;
  company_id: string;
  team_id?: string;
  email: string;
  name: string;
  role: UserRole;
  whatsapp?: string;
  bitrix_user_id?: string;
  avatar_url?: string;
  active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
}

export type DealStage = 'new' | 'qualification' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'paused';

export interface Deal {
  id: string;
  company_id: string;
  assigned_user_id?: string;
  title: string;
  stage: DealStage;
  stage_id?: string;
  value?: number;
  currency: string;
  probability: number;
  contact_name?: string;
  contact_phone?: string;
  company_name?: string;
  expected_close_date?: string;
  last_activity_at?: string;
  days_without_activity?: number;
  metadata: Record<string, unknown>;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  deal_id?: string;
  assigned_user_id?: string;
  company_id: string;
  type: 'call' | 'meeting' | 'email' | 'whatsapp' | 'task' | 'note' | 'other';
  subject?: string;
  description?: string;
  completed: boolean;
  deadline?: string;
  completed_at?: string;
  duration_minutes?: number;
  created_at: string;
}

export interface Contact {
  id: string;
  company_id: string;
  assigned_user_id?: string;
  name: string;
  phone?: string;
  email?: string;
  company_name?: string;
  last_contacted_at?: string;
}

// ─── Agentes ──────────────────────────────────────────────────

export type AgentType =
  | 'orchestrator'
  | 'carteira'
  | 'deal'
  | 'feedback'
  | 'manager'
  | 'gamification'
  | 'inactivity';

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface AgentContext {
  user_id: string;
  company_id: string;
  team_id?: string;
  user_role: UserRole;
  user_name: string;
  channel: 'web' | 'whatsapp' | 'email';
}

export interface AgentResponse {
  message: string;
  agent_type: AgentType;
  insights?: Insight[];
  actions?: AgentAction[];
  metadata?: Record<string, unknown>;
}

export interface AgentAction {
  type: 'send_whatsapp' | 'send_email' | 'create_alert' | 'update_memory' | 'update_gamification';
  target_user_id?: string;
  payload: Record<string, unknown>;
}

// ─── Insights ─────────────────────────────────────────────────

export type InsightPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Insight {
  id?: string;
  user_id?: string;
  company_id: string;
  agent_type: AgentType;
  insight_type: string;
  title: string;
  content: string;
  priority: InsightPriority;
  action_items: string[];
  related_deals: string[];
  metadata: Record<string, unknown>;
  created_at?: string;
}

// ─── Memória ──────────────────────────────────────────────────

export interface Memory {
  id: string;
  user_id?: string;
  company_id: string;
  agent_type: AgentType;
  memory_type: 'insight' | 'pattern' | 'feedback' | 'context' | 'achievement' | 'goal';
  content: string;
  summary?: string;
  importance: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  summary?: string;
  similarity: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Métricas ─────────────────────────────────────────────────

export interface UserMetrics {
  deals_active: number;
  deals_won: number;
  deals_lost: number;
  pipeline_value: number;
  revenue_won: number;
  avg_deal_value: number;
  overdue_deals: number;
  inactive_deals: number;
  conversion_rate?: number;
  activities_done?: number;
}

export interface TeamMetrics {
  total_members: number;
  active_members: number;
  total_pipeline: number;
  total_revenue: number;
  deals_at_risk: number;
  members: Array<{
    user: Pick<User, 'id' | 'name' | 'email' | 'avatar_url'>;
    metrics: UserMetrics;
    gamification?: GamificationProfile;
  }>;
}

// ─── Gamificação ──────────────────────────────────────────────

export interface GamificationProfile {
  user_id: string;
  points: number;
  level: number;
  level_name: string;
  xp_current: number;
  xp_next_level: number;
  streak_days: number;
  achievements: Achievement[];
  badges: Badge[];
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned_at: string;
  points: number;
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  earned_at: string;
}

// ─── Bitrix24 ─────────────────────────────────────────────────

export interface Bitrix24Deal {
  ID: string;
  TITLE: string;
  STAGE_ID: string;
  OPPORTUNITY: string;
  CURRENCY_ID: string;
  PROBABILITY: string;
  ASSIGNED_BY_ID: string;
  CONTACT_ID: string;
  COMPANY_ID: string;
  CLOSEDATE: string;
  DATE_CREATE: string;
  DATE_MODIFY: string;
  UF_CRM_LAST_ACTIVITY_TIME?: string;
  [key: string]: unknown;
}

export interface Bitrix24Activity {
  ID: string;
  OWNER_ID: string;
  OWNER_TYPE_ID: string;
  TYPE_ID: string;
  SUBJECT: string;
  DESCRIPTION: string;
  RESPONSIBLE_ID: string;
  DEADLINE: string;
  COMPLETED: string;
  END_TIME: string;
  DURATION: string;
  [key: string]: unknown;
}

// ─── WhatsApp ─────────────────────────────────────────────────

export interface WhatsAppMessage {
  instance: string;
  data: {
    key: {
      remoteJid: string;
      id: string;
    };
    message: {
      conversation?: string;
      extendedTextMessage?: { text: string };
    };
    pushName: string;
  };
}
