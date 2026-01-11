FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files first (ensure pnpm workspace context is present)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy package manifests to leverage Docker layer caching
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
COPY packages/api/tsconfig.json ./packages/api/

# Install pnpm and workspace dependencies
RUN npm install -g pnpm@9
RUN pnpm install --frozen-lockfile

# Copy all source files
COPY . .

# Build shared first, then API
RUN pnpm --filter @sentinal-rag/shared build
RUN pnpm --filter @sentinal-rag/api build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy the package manifests so pnpm can install production deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/

RUN npm install -g pnpm@9
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist

EXPOSE 3000

# Run the built API
CMD ["node", "packages/api/dist/index.js"]
