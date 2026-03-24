FROM node:20-alpine AS base
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ─── Builder ──────────────────────────────────────────────────────────────
FROM base AS builder
# Copy manifest files first — pnpm install layer is cached independently of src changes
COPY package.json pnpm-lock.yaml* .npmrc* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm prisma:generate
RUN pnpm build

# ─── Production image ─────────────────────────────────────────────────────
FROM node:20-alpine AS production
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

RUN chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 3000
CMD ["node", "dist/main.js"]
