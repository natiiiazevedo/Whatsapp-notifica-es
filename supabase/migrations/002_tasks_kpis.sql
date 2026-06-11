-- ──────────────────────────────────────────────────────────────
-- Módulo de Gestão de Agenda, Tarefas e KPIs Diários
-- ──────────────────────────────────────────────────────────────

-- ─── Tarefas dos vendedores ──────────────────────────────────

CREATE TYPE task_priority AS ENUM ('urgent', 'high', 'medium', 'low');
CREATE TYPE task_status   AS ENUM ('pending', 'in_progress', 'done', 'cancelled');
CREATE TYPE task_type     AS ENUM (
  'call', 'meeting', 'email', 'whatsapp',
  'proposal', 'follow_up', 'demo', 'contract', 'other'
);

CREATE TABLE tasks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  deal_id      TEXT REFERENCES deals(id) ON DELETE SET NULL,
  contact_name TEXT,
  company_name TEXT,
  title        TEXT NOT NULL,
  description  TEXT,
  priority     task_priority NOT NULL DEFAULT 'medium',
  status       task_status   NOT NULL DEFAULT 'pending',
  type         task_type     NOT NULL DEFAULT 'other',
  due_date     DATE,
  due_time     TIME,
  completed_at TIMESTAMPTZ,
  completed_note TEXT,                         -- o que foi realizado
  created_by   TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'agent'
  source_deal_value DECIMAL(15,2),             -- valor do negócio para contexto
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_id     ON tasks(user_id);
CREATE INDEX idx_tasks_company_id  ON tasks(company_id);
CREATE INDEX idx_tasks_status      ON tasks(status);
CREATE INDEX idx_tasks_due_date    ON tasks(due_date);
CREATE INDEX idx_tasks_deal_id     ON tasks(deal_id);

-- RLS em tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select" ON tasks FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR
    user_id = auth_user_id()
  )
);
CREATE POLICY "tasks_insert" ON tasks FOR INSERT WITH CHECK (
  company_id = auth_company_id() AND user_id = auth_user_id()
);
CREATE POLICY "tasks_update" ON tasks FOR UPDATE USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR user_id = auth_user_id()
  )
);
CREATE POLICY "tasks_delete" ON tasks FOR DELETE USING (
  user_id = auth_user_id()
);

-- ─── Metas por vendedor ──────────────────────────────────────

CREATE TABLE sales_goals (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id              UUID NOT NULL REFERENCES companies(id),
  period_start            DATE NOT NULL,
  period_end              DATE NOT NULL,
  goal_calls_per_day      INTEGER DEFAULT 10,
  goal_meetings_per_day   INTEGER DEFAULT 3,
  goal_deals_per_month    INTEGER DEFAULT 5,
  goal_revenue_per_month  DECIMAL(15,2),
  goal_companies_per_day  INTEGER DEFAULT 5,
  created_by              UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period_start)
);

ALTER TABLE sales_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goals_select" ON sales_goals FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR user_id = auth_user_id()
  )
);
CREATE POLICY "goals_write" ON sales_goals FOR ALL USING (
  company_id = auth_company_id() AND auth_user_role() IN ('manager', 'admin')
);

-- ─── KPIs diários calculados ─────────────────────────────────

CREATE TABLE daily_kpis (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id),
  date             DATE NOT NULL,
  -- Atividades realizadas
  calls_done       INTEGER NOT NULL DEFAULT 0,
  meetings_done    INTEGER NOT NULL DEFAULT 0,
  emails_sent      INTEGER NOT NULL DEFAULT 0,
  whatsapp_sent    INTEGER NOT NULL DEFAULT 0,
  -- Negócios
  deals_won        INTEGER NOT NULL DEFAULT 0,
  revenue_won      DECIMAL(15,2) NOT NULL DEFAULT 0,
  deals_worked     INTEGER NOT NULL DEFAULT 0,   -- negócios únicos tocados
  companies_reached INTEGER NOT NULL DEFAULT 0,  -- empresas únicas contatadas
  -- Tarefas
  tasks_created    INTEGER NOT NULL DEFAULT 0,
  tasks_done       INTEGER NOT NULL DEFAULT 0,
  tasks_overdue    INTEGER NOT NULL DEFAULT 0,
  -- Pipeline snapshot
  pipeline_value   DECIMAL(15,2) NOT NULL DEFAULT 0,
  active_deals     INTEGER NOT NULL DEFAULT 0,
  -- Metas do dia (copiadas para histórico)
  goal_calls       INTEGER,
  goal_meetings    INTEGER,
  goal_companies   INTEGER,
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_kpis_user_date ON daily_kpis(user_id, date DESC);
ALTER TABLE daily_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpis_select" ON daily_kpis FOR SELECT USING (
  company_id = auth_company_id() AND (
    auth_user_role() IN ('manager', 'admin') OR user_id = auth_user_id()
  )
);

-- ─── View: KPIs do dia atual (tempo real) ────────────────────

CREATE OR REPLACE VIEW v_today_kpis AS
SELECT
  u.id                                                              AS user_id,
  u.company_id,
  CURRENT_DATE                                                      AS date,
  -- Ligações hoje (Bitrix24 sincronizado)
  COUNT(a.id) FILTER (WHERE a.type = 'call'     AND a.completed = true
                        AND a.completed_at::date = CURRENT_DATE)   AS calls_done,
  COUNT(a.id) FILTER (WHERE a.type = 'meeting'  AND a.completed = true
                        AND a.completed_at::date = CURRENT_DATE)   AS meetings_done,
  COUNT(a.id) FILTER (WHERE a.type = 'email'    AND a.completed = true
                        AND a.completed_at::date = CURRENT_DATE)   AS emails_sent,
  COUNT(a.id) FILTER (WHERE a.type = 'whatsapp' AND a.completed = true
                        AND a.completed_at::date = CURRENT_DATE)   AS whatsapp_sent,
  -- Vendas hoje
  COUNT(DISTINCT d_won.id) FILTER (WHERE d_won.stage = 'won'
    AND d_won.updated_at::date = CURRENT_DATE)                     AS deals_won,
  COALESCE(SUM(d_won.value) FILTER (WHERE d_won.stage = 'won'
    AND d_won.updated_at::date = CURRENT_DATE), 0)                 AS revenue_won,
  -- Negócios únicos tratados hoje (qualquer atividade)
  COUNT(DISTINCT a.deal_id) FILTER (WHERE a.created_at::date = CURRENT_DATE
                                      AND a.deal_id IS NOT NULL)   AS deals_worked,
  -- Empresas únicas atingidas hoje
  COUNT(DISTINCT d_act.company_name) FILTER (
    WHERE a2.created_at::date = CURRENT_DATE AND d_act.company_name IS NOT NULL
  )                                                                 AS companies_reached,
  -- Pipeline atual
  COALESCE(SUM(d_pipe.value) FILTER (
    WHERE d_pipe.stage NOT IN ('won','lost')), 0)                  AS pipeline_value,
  COUNT(d_pipe.id) FILTER (
    WHERE d_pipe.stage NOT IN ('won','lost'))                      AS active_deals
FROM users u
LEFT JOIN activities a   ON a.assigned_user_id = u.id
LEFT JOIN deals      d_won  ON d_won.assigned_user_id = u.id
LEFT JOIN deals      d_pipe ON d_pipe.assigned_user_id = u.id
LEFT JOIN activities a2  ON a2.assigned_user_id = u.id
LEFT JOIN deals      d_act ON d_act.id = a2.deal_id
WHERE u.active = true
GROUP BY u.id, u.company_id;

-- ─── Função: gera tarefas automáticas do dia para um vendedor ─

CREATE OR REPLACE FUNCTION generate_daily_tasks(p_user_id UUID)
RETURNS TABLE (
  deal_id      TEXT,
  deal_title   TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  deal_value   DECIMAL,
  task_type    TEXT,
  priority     TEXT,
  reason       TEXT
) AS $$
  SELECT
    d.id          AS deal_id,
    d.title       AS deal_title,
    d.contact_name,
    d.contact_phone,
    d.value       AS deal_value,
    CASE
      WHEN d.stage = 'negotiation'            THEN 'call'
      WHEN d.stage = 'proposal'               THEN 'follow_up'
      WHEN d.days_without_activity >= 7       THEN 'call'
      WHEN d.expected_close_date <= CURRENT_DATE + 3 THEN 'call'
      ELSE 'follow_up'
    END           AS task_type,
    CASE
      WHEN d.days_without_activity >= 7
        OR d.expected_close_date < CURRENT_DATE         THEN 'urgent'
      WHEN d.days_without_activity >= 3
        OR d.expected_close_date <= CURRENT_DATE + 7    THEN 'high'
      WHEN d.value >= 10000                              THEN 'high'
      ELSE 'medium'
    END           AS priority,
    CASE
      WHEN d.days_without_activity >= 7       THEN 'Sem contato há ' || d.days_without_activity || ' dias'
      WHEN d.expected_close_date < CURRENT_DATE THEN 'Prazo vencido em ' || d.expected_close_date::text
      WHEN d.expected_close_date <= CURRENT_DATE + 3 THEN 'Fecha em ' || d.expected_close_date::text
      WHEN d.stage = 'negotiation'            THEN 'Em negociação — pressionar para fechar'
      WHEN d.stage = 'proposal'               THEN 'Proposta enviada — acompanhar retorno'
      ELSE 'Manter contato e avançar etapa'
    END           AS reason
  FROM deals d
  WHERE d.assigned_user_id = p_user_id
    AND d.stage NOT IN ('won', 'lost')
    AND (
      d.days_without_activity >= 3
      OR d.expected_close_date <= CURRENT_DATE + 7
      OR d.stage IN ('negotiation', 'proposal')
    )
    -- Não gera se já há tarefa pendente para o negócio hoje
    AND NOT EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.deal_id = d.id
        AND t.user_id = p_user_id
        AND t.status IN ('pending','in_progress')
        AND t.due_date = CURRENT_DATE
    )
  ORDER BY
    CASE
      WHEN d.days_without_activity >= 7 OR d.expected_close_date < CURRENT_DATE THEN 1
      WHEN d.days_without_activity >= 3 OR d.expected_close_date <= CURRENT_DATE + 7 THEN 2
      ELSE 3
    END,
    d.value DESC NULLS LAST
  LIMIT 15;
$$ LANGUAGE SQL STABLE;
