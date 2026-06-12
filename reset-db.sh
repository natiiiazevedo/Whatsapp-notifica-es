#!/bin/bash
set -e

CONTAINER=$(docker ps --filter name=postgres -q | head -1)

if [ -z "$CONTAINER" ]; then
  echo "❌ Container postgres não encontrado. Rode: docker-compose up -d postgres redis"
  exit 1
fi

echo "🗑  Recriando banco de dados..."
docker exec -i "$CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS sales;"
docker exec -i "$CONTAINER" psql -U postgres -c "CREATE DATABASE sales;"

echo "📦 Aplicando migrations..."
docker exec -i "$CONTAINER" psql -U postgres -d sales < supabase/migrations/001_initial_schema.sql
echo "  ✓ 001_initial_schema"

docker exec -i "$CONTAINER" psql -U postgres -d sales < supabase/migrations/002_tasks_kpis.sql
echo "  ✓ 002_tasks_kpis"

docker exec -i "$CONTAINER" psql -U postgres -d sales < supabase/migrations/003_auth_passwords.sql
echo "  ✓ 003_auth_passwords"

docker exec -i "$CONTAINER" psql -U postgres -d sales < supabase/migrations/004_agent_configs.sql
echo "  ✓ 004_agent_configs"

docker exec -i "$CONTAINER" psql -U postgres -d sales < supabase/migrations/005_demo_seed.sql
echo "  ✓ 005_demo_seed"

echo ""
echo "✅ Banco recriado com sucesso!"
echo ""
echo "Credenciais de acesso:"
echo "  gestor@demo.com   / demo123"
echo "  vendedor@demo.com / demo123"
