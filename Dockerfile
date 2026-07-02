# Build stage
FROM node:18-alpine AS builder

WORKDIR /build
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime stage
FROM node:18-alpine

WORKDIR /opt/aas-fleet-agent

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S agent && \
    adduser -S agent -u 1001

# Copy dependencies and built code
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package*.json ./

# Create logs directory
RUN mkdir -p ./logs && \
    chown -R agent:agent /opt/aas-fleet-agent

USER agent

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('fs').existsSync('/tmp/aas-fleet-agent.health') && process.exit(0) || process.exit(1)"

ENTRYPOINT ["/usr/sbin/dumb-init", "--"]
CMD ["node", "dist/index.js"]