#!/usr/bin/env bash
# ==============================================================
# FastTySE — Script de despliegue en producción
# ==============================================================
# Uso: bash deploy.sh
#
# Requisitos en el servidor:
#   - Docker instalado
#   - Acceso SSH configurado como "web-root"
#   - Nginx configurado en el servidor
# ==============================================================
set -euo pipefail

# ---- Configuración ----
SSH_HOST="web-root"
REMOTE_DIR="/opt/fastyse"
DB_HOST="192.168.0.54"
COMPOSE_FILE="docker-compose.prod.yml"

echo "========================================="
echo "  FastTySE — Deploy a producción"
echo "========================================="

# ---- 1. Sincronizar código al servidor ----
echo ""
echo "[1/4] Sincronizando código al servidor..."
ssh "$SSH_HOST" "mkdir -p $REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude 'client/dist' \
  ./ "$SSH_HOST:$REMOTE_DIR/"
echo "  ✓ Código sincronizado en $REMOTE_DIR"

# ---- 2. Crear .env en el servidor (si no existe) ----
echo ""
echo "[2/4] Verificando .env..."
ssh "$SSH_HOST" bash -s <<ENVSSH
if [ ! -f "$REMOTE_DIR/.env" ]; then
  cat > "$REMOTE_DIR/.env" <<'ENVFILE'
DATABASE_URL=postgresql://postgres:postgres@${DB_HOST}:5432/fastyse
EXTERNAL_DB_URL=postgresql://postgres:postgres@${DB_HOST}:5432/AuditorEscrutinioCongreso2026_PROD
JWT_SECRET=fastyse-secret-2026
PORT=3001
NODE_ENV=production
ENVFILE
  echo "  ✓ .env creado"
else
  echo "  ✓ .env ya existe (no se sobreescribe)"
fi
ENVSSH

# ---- 3. Build y arranque del contenedor ----
echo ""
echo "[3/4] Construyendo y arrancando contenedor..."
ssh "$SSH_HOST" "cd $REMOTE_DIR && docker compose -f $COMPOSE_FILE down 2>/dev/null || true && docker compose -f $COMPOSE_FILE up -d --build"
echo "  ✓ Contenedor fastyse arrancado"

# ---- 4. Verificar health ----
echo ""
echo "[4/4] Verificando health check..."
sleep 5
HTTP_CODE=$(ssh "$SSH_HOST" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health")
if [ "$HTTP_CODE" = "200" ]; then
  echo "  ✓ Health check OK (HTTP $HTTP_CODE)"
else
  echo "  ✗ Health check falló (HTTP $HTTP_CODE)"
  echo "    Revisa logs: ssh $SSH_HOST \"docker logs fastyse\""
  exit 1
fi

echo ""
echo "========================================="
echo "  ✓ Deploy completado exitosamente"
echo ""
echo "  App: http://127.0.0.1:3001 (local)"
echo "  URL: https://tyseapps.com/fastyse/"
echo ""
echo "  Si es la primera vez, agrega el bloque"
echo "  de nginx. Ver: nginx-fastyse.conf"
echo "========================================="
