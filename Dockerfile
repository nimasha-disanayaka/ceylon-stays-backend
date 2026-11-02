# ==========================================
# Multi-Stage Production Dockerfile for Backend
# ==========================================

# Stage 1: Build TypeScript & Generate Prisma Client
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl

WORKDIR /app

# Install dependencies first for Docker caching
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Copy source code and build
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2: Minimal Production Runtime
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built artifacts and prisma schema
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Create directory for file uploads
RUN mkdir -p uploads

EXPOSE 5000

# Run migrations and start production server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
