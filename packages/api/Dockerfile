FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json ./

# Copy all package.json files first
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
COPY packages/api/tsconfig.json ./packages/api/

# Install pnpm and dependencies
RUN npm install -g pnpm@9
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/src ./packages/shared/src
COPY packages/api/src ./packages/api/src

# Build shared package FIRST, then API
RUN pnpm --filter @sentinal-rag/shared build
RUN pnpm --filter @sentinal-rag/api build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package.json files
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/

# Install pnpm and production dependencies only
RUN npm install -g pnpm@9
RUN pnpm install --prod --frozen-lockfile

# Copy built files from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "packages/api/dist/index.js"]
