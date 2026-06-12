-- Adiciona colunas que faltavam no schema inicial

ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'pro';
ALTER TABLE users     ADD COLUMN IF NOT EXISTS password_hash TEXT;
