# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_PROVISIONED_ACCOUNTS_ONLY=1
RUN npm ci && npm run build

FROM base AS runtime
COPY --from=build --chown=node:node /app /app
RUN install -d -o node -g node storage
ENV NODE_ENV=production PROVISIONED_ACCOUNTS_ONLY=1
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_PROVISIONED_ACCOUNTS_ONLY=1
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
