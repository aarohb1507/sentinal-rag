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

# Build shared first, then api
RUN pnpm --filter @sentinal-rag/shared build
RUN pnpm --filter @sentinal-rag/api build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy entire workspace structure with node_modules from builder
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/node_modules ./node_modules

# Create symlinks for workspace packages
RUN mkdir -p /app/node_modules/@sentinal-rag && \
    ln -sf /app/packages/shared /app/node_modules/@sentinal-rag/shared

EXPOSE 3000

CMD ["node", "packages/api/dist/index.js"]
