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
FROM base AS production
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Install prod deps directly — avoids pnpm virtual-store symlink issues when
# copying node_modules across Docker stages
COPY package.json pnpm-lock.yaml* .npmrc* ./
COPY prisma ./prisma
RUN pnpm install --prod --frozen-lockfile --ignore-scripts && pnpm prisma:generate

COPY --from=builder /app/dist ./dist

RUN chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 3000
CMD ["node", "dist/main.js"]
