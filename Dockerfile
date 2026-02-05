# ========================
# Build stage
# ========================
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# ========================
# Production stage
# ========================
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache dumb-init curl

# Copy everything needed
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/eng.traineddata ./eng.traineddata

# Create uploads directory
RUN mkdir -p ./uploads

# Set production environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

# Run migrations then start server
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
