# Imagen de la API. Se construye desde la raíz del monorepo:
#   docker build -f apps/api/Dockerfile -t petbf-api .
# Migraciones (antes de arrancar una versión nueva):
#   docker build -f apps/api/Dockerfile --target migrate -t petbf-api-migrate .
#   docker run --rm -e DATABASE_URL=... petbf-api-migrate

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# 1) Dependencias y compilación.
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter api... --ignore-scripts
COPY apps/api apps/api
RUN pnpm --filter api rebuild argon2 @prisma/engines prisma \
 && pnpm --filter api build \
 && pnpm --filter api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist

# 2) Migraciones: usa la CLI de Prisma de la etapa de compilación.
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# 3) Imagen final: solo dependencias de producción y el código compilado.
FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
