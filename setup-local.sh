#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Sales Platform — Setup Local           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

# ─── Verifica pré-requisitos ─────────────────────────────────
check() {
  command -v "$1" &>/dev/null || { echo -e "${RED}✗ $1 não encontrado. Instale antes de continuar.${NC}"; exit 1; }
  echo -e "${GREEN}✓ $1${NC}"
}

echo "Verificando dependências..."
check docker
check "docker-compose"
check node
check pnpm
echo ""

# ─── Cria .env se não existir ────────────────────────────────
if [ ! -f .env ]; then
  echo -e "${YELLOW}Criando arquivo .env...${NC}"
  read -p "🔑 Sua ANTHROPIC_API_KEY (sk-ant-...): " ANTHROPIC_KEY
  echo ""
  read -p "🤖 OpenAI API Key para embeddings (sk-...): " OPENAI_KEY
  echo ""

  cat > .env <<EOF
# ─── Banco de dados ───────────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sales_platform

# ─── Redis ───────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ─── API de IA ───────────────────────────────────────────────
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
OPENAI_API_KEY=${OPENAI_KEY}

# ─── JWT ─────────────────────────────────────────────────────
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "change-this-super-secret-key-in-production")

# ─── WhatsApp (Evolution API — opcional) ─────────────────────
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=changeme
EVOLUTION_INSTANCE=sales

# ─── Bitrix24 (opcional) ─────────────────────────────────────
BITRIX_WEBHOOK_URL=
BITRIX_CLIENT_ID=
BITRIX_CLIENT_SECRET=

# ─── App ─────────────────────────────────────────────────────
API_PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001
EOF
  echo -e "${GREEN}✓ .env criado${NC}\n"
else
  echo -e "${GREEN}✓ .env já existe${NC}\n"
fi

# ─── Instala dependências ────────────────────────────────────
echo -e "${BLUE}Instalando dependências (pnpm install)...${NC}"
pnpm install
echo ""

# ─── Sobe postgres + redis ───────────────────────────────────
echo -e "${BLUE}Iniciando PostgreSQL + Redis via Docker...${NC}"
docker-compose up -d postgres redis
echo ""

echo -e "${YELLOW}Aguardando banco de dados ficar pronto...${NC}"
until docker-compose exec -T postgres pg_isready -U postgres &>/dev/null; do
  printf '.'
  sleep 2
done
echo -e "\n${GREEN}✓ PostgreSQL pronto${NC}"

# ─── Roda migrations ────────────────────────────────────────
echo -e "${BLUE}Aplicando migrations...${NC}"
PGPASSWORD=postgres psql -h localhost -U postgres -d sales_platform \
  -f supabase/migrations/001_initial_schema.sql 2>/dev/null || true
PGPASSWORD=postgres psql -h localhost -U postgres -d sales_platform \
  -f supabase/migrations/002_tasks_kpis.sql 2>/dev/null || true
echo -e "${GREEN}✓ Migrations aplicadas${NC}\n"

# ─── Seed (usuário demo) ─────────────────────────────────────
echo -e "${BLUE}Criando usuário demo...${NC}"
PGPASSWORD=postgres psql -h localhost -U postgres -d sales_platform <<'SQLEOF' 2>/dev/null || true
INSERT INTO companies (id, name, plan, settings)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Company', 'pro', '{}')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, company_id, email, password_hash, name, role, active, settings)
VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001',
   'gestor@demo.com', '$2b$10$demo_hash_gestor', 'Gestor Demo', 'manager', true, '{}'),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001',
   'vendedor@demo.com', '$2b$10$demo_hash_vendedor', 'Vendedor Demo', 'salesperson', true, '{}')
ON CONFLICT DO NOTHING;
SQLEOF
echo -e "${GREEN}✓ Usuário demo criado${NC}\n"

# ─── Build packages ──────────────────────────────────────────
echo -e "${BLUE}Compilando packages (shared, memory, agents, bitrix)...${NC}"
pnpm --filter @sales/shared build 2>/dev/null || pnpm --filter @sales/shared run build || true
pnpm --filter @sales/memory build 2>/dev/null || true
pnpm --filter @sales/agents build 2>/dev/null || true
echo -e "${GREEN}✓ Packages compilados${NC}\n"

# ─── Resumo final ────────────────────────────────────────────
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ✅ Setup concluído!                    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"
echo -e "Para iniciar a plataforma, rode em terminais separados:\n"
echo -e "  ${YELLOW}Terminal 1:${NC} pnpm --filter api dev"
echo -e "  ${YELLOW}Terminal 2:${NC} pnpm --filter web dev\n"
echo -e "Ou tudo junto:"
echo -e "  ${YELLOW}pnpm dev${NC}\n"
echo -e "Acesse: ${GREEN}http://localhost:3000${NC}"
echo -e "Login demo: ${GREEN}gestor@demo.com${NC} (gestor) ou ${GREEN}vendedor@demo.com${NC} (vendedor)\n"
echo -e "🎯 ${BLUE}Agent Lab:${NC} Dashboard → menu lateral → ${YELLOW}Agent Lab${NC}\n"
