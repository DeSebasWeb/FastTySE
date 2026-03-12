# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is FastTySE

FastTySE es una app web ligera para escrutinio electoral rápido. Permite a administradores subir CSVs con datos electorales, asignar bloques de filas a analistas, y a estos registrar evidencias (capturas con observaciones). Parte del ecosistema TySE Scrutiny pero es una app standalone (no usa JHipster ni microservicios).

## Stack

- **Backend**: Express.js (ESM) + PostgreSQL (pg) + Socket.io para tiempo real
- **Frontend**: React 18 + Vite + React Router + TanStack Table + Axios
- **Auth**: JWT (jsonwebtoken), roles "Administrador" y analista
- **DB**: PostgreSQL con node-pg-migrate (migraciones auto al iniciar)
- **Producción**: Docker multi-stage (Node 20 Alpine), el backend sirve el build estático de React

## Development Commands

```bash
# Setup: copiar .env.example a .env y configurar DATABASE_URL, EXTERNAL_DB_URL, JWT_SECRET

# Instalar dependencias (root + server + client)
npm install && cd server && npm install && cd ../client && npm install && cd ..

# Desarrollo (arranca backend con --watch + Vite dev server concurrently)
npm run dev

# Solo backend (puerto 3001, hot-reload con --watch-path)
npm run dev:server

# Solo frontend (puerto 5173, proxy a :3001 para /api y /socket.io)
npm run dev:client

# Build producción del cliente
npm run build

# Producción
npm start

# Docker
docker compose up --build
```

## Architecture

### Two PostgreSQL connections

- `server/db/pool.js` → `DATABASE_URL`: BD local donde FastTySE almacena usuarios, uploads, asignaciones y evidencias
- `server/db/externalPool.js` → `EXTERNAL_DB_URL`: BD externa de solo lectura para consultar datos de escrutinio

Ambos usan lazy-init via Proxy (se conectan en el primer uso).

### Server structure

- `server/index.js` — Entry point: corre migraciones, configura Express + Socket.io, monta rutas
- `server/routes/` — Rutas Express montadas bajo `/api`:
  - `auth.js` — Login, /me, listado de analistas
  - `upload.js` — Subida de CSV (multer), listado y borrado de uploads
  - `dashboard.js` — Stats, filtros cascada, paginación de filas, multi-rows por bloques
  - `assignments.js` — CRUD de asignaciones de bloques a analistas
  - `evidences.js` — CRUD de evidencias (capturas base64 + observaciones)
- `server/middleware/auth.js` — `authMiddleware` (JWT verify) y `requireRole(...roles)`
- `server/db/migrations/` — Migraciones node-pg-migrate (formato .cjs)

### Client structure

- `client/src/App.jsx` — Router con rutas condicionales por rol (admin vs analista)
- `client/src/pages/` — Páginas: Login, Home (upload CSV), Dashboard, Assign, MyAssignments
- `client/src/components/` — Componentes reutilizables (DataTable, FilterBar, EvidenceModal, etc.)
- `client/src/hooks/` — Custom hooks: useAuth (context + JWT), useDashboard, useUploads, useTheme
- `client/src/lib/api.js` — Cliente Axios centralizado con interceptor JWT
- `client/src/lib/socket.js` — Instancia Socket.io client
- Estilos: CSS Modules (`.module.css` por componente)

### Key patterns

- Vite proxy en dev: `/api` y `/socket.io` se redirigen a `:3001`
- En producción el server Express sirve `client/dist` como estático y hace SPA fallback
- Socket.io se usa para notificaciones en tiempo real (accesible via `req.app.get('io')`)
- Las migraciones corren automáticamente al iniciar el server (antes de listen)
- Roles: "Administrador" tiene acceso completo; analistas solo ven `/assignments`
