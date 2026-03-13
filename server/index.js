import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import runner from 'node-pg-migrate';
import uploadRoutes from './routes/upload.js';
import dashboardRoutes from './routes/dashboard.js';
import authRoutes from './routes/auth.js';
import assignmentRoutes from './routes/assignments.js';
import evidenceRoutes from './routes/evidences.js';
import e14Routes from './routes/e14.js';

const PORT = process.env.PORT || 3001;

// Run migrations before starting the server
async function migrate() {
  console.log('Running migrations...');
  await runner({
    databaseUrl: process.env.DATABASE_URL,
    migrationsTable: 'pgmigrations',
    dir: resolve(__dirname, 'db/migrations'),
    direction: 'up',
    log: () => {},
  });
  console.log('Migrations complete.');
}

async function start() {
  await migrate();

  const app = express();
  const httpServer = createServer(app);

  // CORS: in production the client is served from the same origin (no CORS needed).
  // In development, allow localhost Vite dev server and optional CLIENT_URL.
  const allowedOrigins = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map((u) => u.trim())
    : [];

  const corsOptions = {
    origin: allowedOrigins.length > 0
      ? allowedOrigins
      : process.env.NODE_ENV === 'production'
        ? false          // same-origin, no CORS headers needed
        : 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  };

  const io = new Server(httpServer, { cors: corsOptions });

  app.set('io', io);

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // API routes
  app.use('/api', authRoutes);
  app.use('/api', uploadRoutes);
  app.use('/api', dashboardRoutes);
  app.use('/api', assignmentRoutes);
  app.use('/api', evidenceRoutes);
  app.use('/api/e14', e14Routes);

  // Serve React build in production
  const clientDist = resolve(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(resolve(clientDist, 'index.html'));
  });

  // Socket.io connection logging
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
