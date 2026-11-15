# Izin's OpenServ agent: a small separate process with its own dependencies (see openserv/agent.ts).
# Build from the repository root:  docker build -f openserv/Dockerfile -t izin-openserv .
FROM node:22-alpine
ENV NODE_ENV=production IZIN_OPENSERV_STATE=/state IZIN_OPENSERV_REQUIRE_STATE=0
WORKDIR /app/openserv
COPY openserv/package.json openserv/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY openserv/agent.ts openserv/check.ts ./
# What the agent reads next to its own folder: prices and limits, listing texts, its system prompt.
COPY config/izin.json /app/config/izin.json
COPY lang/en.json /app/lang/en.json
COPY prompts/openserv-agent.v1.md /app/prompts/openserv-agent.v1.md
RUN mkdir -p /state && chown node:node /state
USER node
CMD ["node", "--import", "tsx", "agent.ts"]
