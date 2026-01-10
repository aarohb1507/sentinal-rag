FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./
COPY packages/web/package.json ./packages/web/
COPY packages/web/tsconfig.json ./packages/web/

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/web ./packages/web

# Build
WORKDIR /app/packages/web
RUN pnpm build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy production dependencies lock file and config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --from=builder /app/packages/web/package.json ./packages/web/
COPY --from=builder /app/packages/web/.next ./packages/web/.next
COPY --from=builder /app/packages/web/next.config.js ./packages/web/

# Install production dependencies
RUN npm install -g pnpm
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3001

CMD ["pnpm", "--filter", "@sentinal-rag/web", "start"]
