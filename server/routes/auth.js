import { Router } from 'express';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import externalPool from '../db/externalPool.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { cedula, contrasena } = req.body;
    if (!cedula || !contrasena) {
      return res.status(400).json({ error: 'Cedula and password are required' });
    }

    // Hash password with SHA-256 (no salt, matching Python's hashlib.sha256)
    const hash = createHash('sha256').update(contrasena, 'utf-8').digest('hex');

    // Look up user in external DB
    const result = await externalPool.query(
      `SELECT u.id, u.cedula, u.nombres, u.apellidos, u.id_perfil, p.nombre AS rol
       FROM usuarios u
       JOIN perfiles p ON p.id = u.id_perfil
       WHERE u.cedula = $1 AND u.contrasena = $2`,
      [cedula, hash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    const token = jwt.sign(
      {
        id: user.id,
        cedula: user.cedula,
        nombres: user.nombres,
        apellidos: user.apellidos,
        id_perfil: user.id_perfil,
        rol: user.rol,
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        cedula: user.cedula,
        nombres: user.nombres,
        apellidos: user.apellidos,
        rol: user.rol,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me — get current user from token
router.get('/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/analysts — list users with Analista role (for assignment)
router.get('/auth/analysts', authMiddleware, async (_req, res) => {
  try {
    const result = await externalPool.query(
      `SELECT u.id, u.cedula, u.nombres, u.apellidos
       FROM usuarios u
       JOIN perfiles p ON p.id = u.id_perfil
       WHERE p.nombre = 'Analista'
       ORDER BY u.nombres`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Analysts error:', err);
    res.status(500).json({ error: 'Failed to fetch analysts' });
  }
});

export default router;
