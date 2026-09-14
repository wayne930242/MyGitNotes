# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
RUN npm install --global pnpm@9.15.9
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN CI=true pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml ./
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/packages ./packages
COPY --from=build /build/scripts/lib ./scripts/lib
COPY --from=build /build/apps/local-server/package.json ./apps/local-server/package.json
COPY --from=build /build/apps/local-server/node_modules ./apps/local-server/node_modules
COPY --from=build /build/apps/local-server/dist ./apps/local-server/dist
COPY --from=build /build/apps/web/dist ./apps/web/dist
RUN mkdir -p /app/.github-notes-sessions && chown node:node /app/.github-notes-sessions \
    && git config --system --add safe.directory /workspace
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/local-server/dist/index.js"]
