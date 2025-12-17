# Stage 1: Build
FROM node:25-alpine AS builder

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm i

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:25-alpine

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache sqlite

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/staffConfig.json ./src/staffConfig.json

# Create directory for SQLite database
RUN mkdir -p /app/data

# Create directory for logs
RUN mkdir -p /app/.logs

# Set environment variables defaults
ENV NODE_ENV=production
ENV SQLITE_PATH=/app/data/staffrep.sqlite

# Run the bot
CMD ["node", "dist/index.js"]