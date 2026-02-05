# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Production stage
FROM node:20-alpine
WORKDIR /app

# Install dumb-init to handle signals properly
RUN apk add --no-cache dumb-init curl

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create upload directory
RUN mkdir -p uploads

# Set environment
ENV NODE_ENV=production
EXPOSE 3001

# Use dumb-init to handle signals
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "src/server.js"]

# Health check using curl
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
