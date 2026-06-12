-- ──────────────────────────────────────────────────────────────
-- Plataforma Multiagentes Comercial
-- Schema inicial com RLS, pgvector e estrutura completa
-- ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── Empresas e Times ────────────────────────────────────────

CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  bitrix24_domain TEXT,
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Usuários ────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('salesperson', 'manager', 'admin');

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id),
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'salesperson',
  whatsapp        TEXT,
  bitrix_user_id  TEXT,
  avatar_url      TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at    TIMESTAMPTZ,
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_users_team_id ON users(team_id);
CREATE INDEX idx_users_bitrix_user_id ON users(bitrix_user_id);

-- ─── Auth tokens ─────────────────────────────────────────────

CREATE TABLE auth_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Deals (sincronizados do Bitrix24) ───────────────────────

CREATE TYPE deal_stage AS ENUM (
  'new', 'qualification', 'proposal', 'negotiation',
  'won', 'lost', 'paused'
);

CREATE TABLE deals (
  id                  TEXT PRIMARY KEY, -- ID do Bitrix24
  company_id          UUID NOT NULL REFERENCES companies(id),
  assigned_user_id    UUID REFERENCES users(id),
  bitrix_assigned_id  TEXT,
  title               TEXT NOT NULL,
  stage               deal_stage NOT NULL DEFAULT 'new',
  stage_id            TEXT, -- stage ID original do Bitrix24
  value               DECIMAL(15,2),
  currency            TEXT DEFAULT 'BRL',
  probability         INTEGER DEFAULT 0,
  contact_name        TEXT,
  contact_phone       TEXT,
  contact_email       TEXT,
  company_name        TEXT,
  source              TEXT,
  expected_close_date DATE,
  closed_date         DATE,
  last_activity_at    TIMESTAMPTZ,
  days_without_activity INTEGER DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}',
  bitrix_data         JSONB NOT NULL DEFAULT '{}',
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deals_company_id ON deals(company_id);
CREATE INDEX idx_deals_assigned_user_id ON deals(assigned_user_id);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_last_activity ON deals(last_activity_at);

-- ─── Atividades ──────────────────────────────────────────────

CREATE TYPE activity_type AS ENUM (
  'call', 'meeting', 'email', 'whatsapp', 'task', 'note', 'other'
);

CREATE TABLE activities (
  id              TEXT PRIMARY KEY,
  deal_id         TEXT REFERENCES deals(id) ON DELETE CASCADE,
  assigned_user_id UUID REFERENCES users(id),
  company_id      UUID NOT NULL REFERENCES companies(id),
  type            activity_type NOT NULL DEFAULT 'other',
  subject         TEXT,
  description     TEXT,
  completed       BOOLEAN DEFAULT FALSE,
  deadline        TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_minutes INTEGER,
  metadata        JSONB NOT NULL DEFAULT '{}',
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activities_deal_id ON activities(deal_id);
CREATE INDEX idx_activities_user_id ON activities(assigned_user_id);
CREATE INDEX idx_activities_created_at ON activities(created_at);

-- ─── Contatos ────────────────────────────────────────────────

CREATE TABLE contacts (
  id              TEXT PRIMARY KEY,
  company_id      UUID NOT NULL REFERENCES companies(id),
  assigned_user_id UUID REFERENCES users(id),
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  company_name    TEXT,
  last_contacted_at TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contacts_company_id ON contacts(company_id);
CREATE INDEX idx_contacts_user_id ON contacts(assigned_user_id);

-- ─── Memória dos Agentes (pgvector) ──────────────────────────

CREATE TYPE memory_type AS ENUM (
  'insight', 'pattern', 'feedback', 'context', 'achievement', 'goal'
);

CREATE TABLE agent_memories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = memória da equipe
  company_id  UUID NOT NULL REFERENCES companies(id),
  agent_type  TEXT NOT NULL,
  memory_type memory_type NOT NULL DEFAULT 'context',
  content     TEXT NOT NULL,
  summary     TEXT,
  embedding   vector(1536),
  importance  FLOAT NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  metadata    JSONB NOT NULL DEFAULT '{}',
  expires_at  TIMESTAMPTZ, -- NULL = permanente
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memories_user_id ON agent_memories(user_id);
CREATE INDEX idx_memories_company_id ON agent_memories(company_id);
CREATE INDEX idx_memories_agent_type ON agent_memories(agent_type);
CREATE INDEX idx_memories_embedding ON agent_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── Conversas com Agentes ───────────────────────────────────

CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_type  TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'web', -- 'web', 'whatsapp', 'email'
  messages    JSONB NOT NULL DEFAULT '[]',
  context     JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

-- ─── Insights gerados pelos agentes ─────────────────────────

CREATE TYPE insight_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TABLE insights (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = insight de gestão
  company_id    UUID NOT NULL REFERENCES companies(id),
  agent_type    TEXT NOT NULL,
  insight_type  TEXT NOT NULL, -- 'inactivity', 'deal_risk', 'coaching', 'team_bottleneck', etc.
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  priority      insight_priority NOT NULL DEFAULT 'medium',
  action_items  JSONB NOT NULL DEFAULT '[]',
  related_deals JSONB NOT NULL DEFAULT '[]',
  metadata      JSONB NOT NULL DEFAULT '{}',
  read          BOOLEAN NOT NULL DEFAULT FALSE,
  sent_via      JSONB NOT NULL DEFAULT '[]', -- ['whatsapp', 'email', 'web']
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insights_user_id ON insights(user_id);
CREATE INDEX idx_insights_company_id ON insights(company_id);
CREATE INDEX idx_insights_priority ON insights(priority);
CREATE INDEX idx_insights_created_at ON insights(created_at DESC);

-- ─── Gamificação ─────────────────────────────────────────────

CREATE TABLE gamification_profiles (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  points      INTEGER NOT NULL DEFAULT 0,
  level       INTEGER NOT NULL DEFAULT 1,
  level_name  TEXT NOT NULL DEFAULT 'Iniciante',
  xp_current  INTEGER NOT NULL DEFAULT 0,
  xp_next_level INTEGER NOT NULL DEFAULT 100,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_activity_date DATE,
  achievements JSONB NOT NULL DEFAULT '[]',
  badges      JSONB NOT NULL DEFAULT '[]',
  stats       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE gamification_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL, -- 'deal_won', 'activity_completed', 'streak', etc.
  points      INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gam_events_user_id ON gamification_events(user_id);
CREATE INDEX idx_gam_events_created_at ON gamification_events(created_at DESC);

-- ─── Métricas diárias (pré-calculadas) ───────────────────────

CREATE TABLE daily_metrics (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id),   -- NULL = métrica da equipe
  company_id      UUID NOT NULL REFERENCES companies(id),
  team_id         UUID REFERENCES teams(id),
  date            DATE NOT NULL,
  deals_active    INTEGER DEFAULT 0,
  deals_won       INTEGER DEFAULT 0,
  deals_lost      INTEGER DEFAULT 0,
  revenue_won     DECIMAL(15,2) DEFAULT 0,
  activities_done INTEGER DEFAULT 0,
  pipeline_value  DECIMAL(15,2) DEFAULT 0,
  conversion_rate FLOAT DEFAULT 0,
  avg_deal_cycle  INTEGER DEFAULT 0, -- dias
  metadata        JSONB NOT NULL DEFAULT '{}',
  UNIQUE(user_id, company_id, date)
);

CREATE INDEX idx_daily_metrics_company_date ON daily_metrics(company_id, date DESC);
CREATE INDEX idx_daily_metrics_user_date ON daily_metrics(user_id, date DESC);

-- ─── Alertas e Gatilhos ──────────────────────────────────────

CREATE TABLE alerts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  target_user_id UUID REFERENCES users(id), -- destinatário (gestor ou vendedor)
  triggered_by  TEXT NOT NULL, -- nome do agente
  alert_type    TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}',
  delivered     BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at  TIMESTAMPTZ,
  channels      JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_user_id ON alerts(target_user_id);
CREATE INDEX idx_alerts_delivered ON alerts(delivered, created_at DESC);

-- ─── Row Level Security ──────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Função auxiliar: pegar user_id do JWT
CREATE OR REPLACE FUNCTION auth_user_id() RETURNS UUID AS $$
  SELECT COALESCE(
    current_setting('app.current_user_id', TRUE)::UUID,
    NULL
  );
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION auth_user_role() RETURNS user_role AS $$
  SELECT COALESCE(
    current_setting('app.current_user_role', TRUE)::user_role,
    'salesperson'
  );
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION auth_company_id() RETURNS UUID AS $$
  SELECT current_setting('app.current_company_id', TRUE)::UUID;
$$ LANGUAGE SQL STABLE;

-- Deals: vendedor vê só os próprios; gestor/admin vê da empresa
CREATE POLICY "deals_select" ON deals FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR
    assigned_user_id = auth_user_id()
  )
);

-- Activities
CREATE POLICY "activities_select" ON activities FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR
    assigned_user_id = auth_user_id()
  )
);

-- Memória: vendedor só vê a própria; gestor/admin vê tudo da empresa
CREATE POLICY "memories_select" ON agent_memories FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR
    user_id = auth_user_id() OR
    user_id IS NULL
  )
);

-- Conversas: cada usuário vê só as suas
CREATE POLICY "conversations_select" ON conversations FOR SELECT USING (
  user_id = auth_user_id()
);
CREATE POLICY "conversations_insert" ON conversations FOR INSERT WITH CHECK (
  user_id = auth_user_id()
);
CREATE POLICY "conversations_update" ON conversations FOR UPDATE USING (
  user_id = auth_user_id()
);

-- Insights
CREATE POLICY "insights_select" ON insights FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR
    user_id = auth_user_id()
  )
);

-- Gamificação: vendedor vê o próprio; gestor vê equipe
CREATE POLICY "gam_profiles_select" ON gamification_profiles FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM users u WHERE u.id = gamification_profiles.user_id
    AND u.company_id = auth_company_id()
  ) AND (
    auth_user_role() IN ('manager', 'admin') OR
    user_id = auth_user_id()
  )
);

-- Métricas diárias
CREATE POLICY "metrics_select" ON daily_metrics FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR
    user_id = auth_user_id() OR
    user_id IS NULL
  )
);

-- Alertas
CREATE POLICY "alerts_select" ON alerts FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR
    target_user_id = auth_user_id()
  )
);

-- ─── Funções utilitárias ─────────────────────────────────────

-- Busca semântica na memória
CREATE OR REPLACE FUNCTION search_memories(
  p_query_embedding vector(1536),
  p_user_id UUID DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_agent_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10,
  p_min_similarity FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  summary TEXT,
  similarity FLOAT,
  metadata JSONB,
  created_at TIMESTAMPTZ
) AS $$
  SELECT
    m.id,
    m.content,
    m.summary,
    1 - (m.embedding <=> p_query_embedding) AS similarity,
    m.metadata,
    m.created_at
  FROM agent_memories m
  WHERE
    (p_company_id IS NULL OR m.company_id = p_company_id)
    AND (p_user_id IS NULL OR m.user_id = p_user_id OR m.user_id IS NULL)
    AND (p_agent_type IS NULL OR m.agent_type = p_agent_type)
    AND (m.expires_at IS NULL OR m.expires_at > NOW())
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_limit;
$$ LANGUAGE SQL STABLE;

-- Atualizar accessed_at após busca
CREATE OR REPLACE FUNCTION touch_memory(p_memory_id UUID) RETURNS VOID AS $$
  UPDATE agent_memories SET accessed_at = NOW() WHERE id = p_memory_id;
$$ LANGUAGE SQL;

-- Calcular métricas de um vendedor
CREATE OR REPLACE FUNCTION get_user_metrics(p_user_id UUID, p_days INTEGER DEFAULT 30)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'deals_active', COUNT(*) FILTER (WHERE stage NOT IN ('won', 'lost')),
    'deals_won', COUNT(*) FILTER (WHERE stage = 'won' AND updated_at >= NOW() - (p_days || ' days')::INTERVAL),
    'deals_lost', COUNT(*) FILTER (WHERE stage = 'lost' AND updated_at >= NOW() - (p_days || ' days')::INTERVAL),
    'pipeline_value', COALESCE(SUM(value) FILTER (WHERE stage NOT IN ('won', 'lost')), 0),
    'revenue_won', COALESCE(SUM(value) FILTER (WHERE stage = 'won' AND updated_at >= NOW() - (p_days || ' days')::INTERVAL), 0),
    'avg_deal_value', COALESCE(AVG(value) FILTER (WHERE stage = 'won'), 0),
    'overdue_deals', COUNT(*) FILTER (WHERE stage NOT IN ('won', 'lost') AND expected_close_date < CURRENT_DATE),
    'inactive_deals', COUNT(*) FILTER (WHERE stage NOT IN ('won', 'lost') AND days_without_activity >= 3)
  )
  INTO result
  FROM deals
  WHERE assigned_user_id = p_user_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;
