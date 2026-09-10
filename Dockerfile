FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* must be set at build time for client bundle
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GIT_SHA
ARG SOURCE_COMMIT
ARG GIT_COMMIT
ARG COOLIFY_HASH
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_GIT_SHA=$NEXT_PUBLIC_GIT_SHA
ENV SOURCE_COMMIT=$SOURCE_COMMIT
ENV GIT_COMMIT=$GIT_COMMIT
ENV COOLIFY_HASH=$COOLIFY_HASH

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Coolify injects SOURCE_COMMIT as a build-arg. GIT_COMMIT is the explicit runtime override
# so GET /api/health can report which commit is running.
ARG SOURCE_COMMIT
ARG GIT_COMMIT
ARG COOLIFY_HASH
ARG NEXT_PUBLIC_GIT_SHA
ENV SOURCE_COMMIT=$SOURCE_COMMIT
ENV GIT_COMMIT=$GIT_COMMIT
ENV COOLIFY_HASH=$COOLIFY_HASH
ENV NEXT_PUBLIC_GIT_SHA=$NEXT_PUBLIC_GIT_SHA

RUN apk add --no-cache postgresql-client
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs supabase/migrations ./supabase/migrations
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --chown=nextjs:nodejs scripts/wait-for-sql-pool.cjs ./wait-for-sql-pool.cjs
COPY --chown=nextjs:nodejs scripts/ensure-schema.sql ./scripts/ensure-schema.sql
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["./docker-entrypoint.sh"]
