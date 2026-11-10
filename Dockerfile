# One container: the Fastify server (API, MCP) and the built web app. Built from a clean `git archive`
# of HEAD by deploy/deploy.sh. Stage 1 builds; stage 2 carries only what the server reads at run time.
FROM node:22-alpine AS build
WORKDIR /app
# Toolchain only for the case where better-sqlite3 has no prebuilt binary for this platform.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 IZIN_DB=/app/data/izin.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
# Paths the server resolves next to dist/: config, UI text, prompts, benchmark files, synthetic fixtures (the test shop).
COPY config ./config
COPY lang ./lang
COPY prompts ./prompts
COPY bench ./bench
COPY fixtures ./fixtures
# The data folder exists in the image so a fresh named volume mounted on it is owned by the app user.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
