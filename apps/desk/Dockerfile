# Desk service image. Build from the repo root:  docker build -f apps/desk/Dockerfile -t contour-desk .
FROM node:22-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/desk ./apps/desk
COPY fixtures ./fixtures
RUN pnpm install --frozen-lockfile --filter @contour/desk...
WORKDIR /app/apps/desk
ENV NODE_ENV=production PORT=4000 DB_PATH=/data/desk.sqlite RECORDER_ENABLED=true
VOLUME ["/data"]
EXPOSE 4000
# Keys are mounted at runtime (never baked into the image): DESK_KEYPAIR_PATH=/keys/desk.json etc.
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
