FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/api ./packages/api
COPY packages/shared ./packages/shared
COPY tsconfig.json ./

# Build
RUN pnpm --filter @sentinal-rag/api build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/api/dist ./packages/api/dist

# Install production dependencies only
RUN npm install -g pnpm
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000

CMD ["node", "packages/api/dist/index.js"]
