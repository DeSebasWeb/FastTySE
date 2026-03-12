# ============================================================
# FastTyse — Multi-stage production Dockerfile
# ============================================================
# Stage 1: Build the React client
# Stage 2: Production image with Node.js server + static build
# ============================================================

# ---- Stage 1: Build client ----
FROM node:20-alpine AS client-build

ARG VITE_BASE_PATH=/
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN VITE_BASE_PATH=${VITE_BASE_PATH} npm run build

# ---- Stage 2: Production server ----
# Use Debian-based image — required for Puppeteer/Chromium
FROM node:20-slim AS production

# Install Chromium and its dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  wget \
  --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install only server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server/ ./server/

# Copy built client from Stage 1
COPY --from=client-build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
