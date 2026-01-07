FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/web/package.json ./packages/web/

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

# Copy built assets
COPY --from=builder /app/packages/web/.next ./.next
COPY --from=builder /app/packages/web/public ./public
COPY --from=builder /app/packages/web/package.json ./
COPY --from=builder /app/packages/web/next.config.js ./

# Install production dependencies
RUN npm install -g pnpm
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3001

CMD ["pnpm", "start"]
