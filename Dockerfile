FROM node:22-bookworm-slim AS base

WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS migration

COPY prisma ./prisma
COPY prisma.config.ts ./
CMD ["npm", "run", "db:deploy"]

FROM dependencies AS builder

ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public

COPY . .
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

CMD ["node", "server.js"]

FROM postgres:17 AS database

COPY docker/init-app-role.sh /docker-entrypoint-initdb.d/10-create-app-role.sh
RUN chmod 755 /docker-entrypoint-initdb.d/10-create-app-role.sh
