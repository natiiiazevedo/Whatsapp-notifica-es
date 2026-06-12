#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Sales Platform — Setup Local
#  Pré-requisitos: Docker Desktop, Node.js 18+, pnpm 8+
# ──────────────────────────────────────────────────────────────
set -e
G='\033[0;32m'; B='\033[0;34m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'

echo -e "${B}"
echo "╔══════════════════════════════════════════╗"
echo "║   Sales Platform — Setup Local  v1.0     ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${N}"

# ─── 1. Verifica pré-requisitos ──────────────────────────────
echo -e "${B}[1/5] Verificando pré-requisitos...${N}"

ok() { echo -e "  ${G}✓${N} $1"; }
fail() { echo -e "  ${R}✗ $1${N}"; echo -e "${R}Instale antes de continuar.${N}"; exit 1; }

command -v docker &>/dev/null && ok "Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" || fail "Docker não encontrado → https://docs.docker.com/get-docker/"
command -v node &>/dev/null && ok "Node.js $(node -v)" || fail "Node.js não encontrado → https://nodejs.org (versão 18+)"
command -v pnpm &>/dev/null && ok "pnpm $(pnpm -v)" || {
  echo -e "  ${Y}⚠ pnpm não encontrado — instalando...${N}"
  npm install -g pnpm@9
  ok "pnpm instalado"
}

# ─── 2. Cria .env ────────────────────────────────────────────
echo -e "\n${B}[2/5] Configurando variáveis de ambiente...${N}"

if [ -f .env ]; then
  echo -e "  ${G}✓${N} .env já existe — pulando"
else
  cp .env.example .env
  echo -e "  ${Y}⚠  .env criado a partir de .env.example${N}"
  echo ""
  echo -e "  ${Y}Preencha agora os valores obrigatórios:${N}"
  echo ""

  read -rp "  🔑 ANTHROPIC_API_KEY (sk-ant-...): " ANT
  read -rp "  🔑 OPENAI_API_KEY (sk-...) [Enter para pular]: " OAI
  read -rp "  🔐 JWT_SECRET [Enter para gerar automático]: " JWT

  [ -z "$JWT" ] && JWT=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  # sed -i '' para macOS (BSD), sed -i para Linux (GNU)
  SED_INPLACE=(sed -i '')
  uname | grep -q Linux && SED_INPLACE=(sed -i)

  "${SED_INPLACE[@]}" "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${ANT}|" .env
  [ -n "$OAI" ] && "${SED_INPLACE[@]}" "s|OPENAI_API_KEY=.*|OPENAI_API_KEY=${OAI}|" .env
  "${SED_INPLACE[@]}" "s|JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env

  echo -e "\n  ${G}✓${N} .env configurado"
fi

# ─── 3. Instala dependências ─────────────────────────────────
echo -e "\n${B}[3/5] Instalando dependências (pnpm install)...${N}"
pnpm install
echo -e "  ${G}✓${N} Dependências instaladas"

# ─── 4. Sobe infraestrutura Docker ──────────────────────────
echo -e "\n${B}[4/5] Iniciando PostgreSQL + Redis (Docker)...${N}"
docker-compose up -d postgres redis

echo -ne "  Aguardando banco de dados"
for i in $(seq 1 30); do
  docker-compose exec -T postgres pg_isready -U postgres &>/dev/null && break
  printf '.'
  sleep 2
done
echo -e "\n  ${G}✓${N} PostgreSQL pronto"

# ─── 5. Cria usuário demo ────────────────────────────────────
echo -e "\n${B}[5/5] Criando usuário demo...${N}"

PGPASSWORD=postgres psql -h localhost -U postgres -d sales_platform 2>/dev/null <<'SQL' || true
-- Garante colunas adicionais caso a migração ainda não rodou
ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'pro';
ALTER TABLE users     ADD COLUMN IF NOT EXISTS password_hash TEXT;

INSERT INTO companies (id, name, plan, settings)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Company', 'pro', '{}')
ON CONFLICT (id) DO NOTHING;

-- Senha: demo123 (SHA-256)
INSERT INTO users (id, company_id, email, password_hash, name, role, active, settings)
VALUES
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'gestor@demo.com',
   'd3ad9315b7be5dd53b31a273b3b3aba5defe700808305aa16a3062b76658a791',
   'Gestor Demo', 'manager', true, '{}'),
  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'vendedor@demo.com',
   'd3ad9315b7be5dd53b31a273b3b3aba5defe700808305aa16a3062b76658a791',
   'Vendedor Demo', 'salesperson', true, '{}')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
SQL

echo -e "  ${G}✓${N} Usuários demo criados"

# ─── Resumo ──────────────────────────────────────────────────
echo ""
echo -e "${G}╔══════════════════════════════════════════╗${N}"
echo -e "${G}║   ✅  Setup concluído!                   ║${N}"
echo -e "${G}╚══════════════════════════════════════════╝${N}"
echo ""
echo -e "Para iniciar a plataforma:"
echo ""
echo -e "  ${Y}pnpm dev${N}              (inicia API + Web juntos)"
echo ""
echo -e "  ou em terminais separados:"
echo -e "  ${Y}pnpm --filter api dev${N}  → API em http://localhost:3001"
echo -e "  ${Y}pnpm --filter web dev${N}  → Web em http://localhost:3000"
echo ""
echo -e "Logins demo (senha: ${Y}demo123${N}):"
echo -e "  ${G}gestor@demo.com${N}    → visão de gestor"
echo -e "  ${G}vendedor@demo.com${N}  → visão de vendedor"
echo ""
echo -e "Agent Lab: Dashboard → menu lateral → ${B}Agent Lab${N} (ícone de rede)"
echo ""
