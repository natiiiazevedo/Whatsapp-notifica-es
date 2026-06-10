FROM node:20-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/bitrix/package.json packages/bitrix/
COPY packages/memory/package.json packages/memory/
COPY packages/agents/package.json packages/agents/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/
COPY . .

WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
