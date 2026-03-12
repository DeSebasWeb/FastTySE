# ============================================================
# FastTyse — Multi-stage production Dockerfile
# ============================================================
# Stage 1: Build the React client
# Stage 2: Production image with Node.js server + static build
# ============================================================

# ---- Stage 1: Build client ----
FROM node:20-alpine AS client-build

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: Production server ----
FROM node:20-alpine AS production

WORKDIR /app

# Install only server dependencies
COPY package*.json ./
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev && cd ..

# Copy server source
COPY server/ ./server/

# Copy built client from Stage 1
COPY --from=client-build /app/client/dist ./client/dist

# The server serves the static client build in production
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
