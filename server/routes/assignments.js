import { Router } from 'express';
import pool from '../db/pool.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/assignments — Admin creates assignments for selected users
router.post(
  '/assignments',
  authMiddleware,
  requireRole('Administrador'),
  async (req, res) => {
    try {
      const { userIds, filters, label } = req.body;
      // filters can be a single object or array of filter blocks
      const filterBlocks = Array.isArray(filters) ? filters : [filters];

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'No users selected' });
      }
      if (!filterBlocks.length) {
        return res.status(400).json({ error: 'No filters provided' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const u of userIds) {
          const userId = Number(u.id);
          await client.query(
            `INSERT INTO assignments (user_id, user_name, filters, label, range_from, range_to)
             VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
            [userId, `${u.nombres} ${u.apellidos}`, JSON.stringify(filterBlocks), label,
             u.rangeFrom || null, u.rangeTo || null]
          );
        }

        await client.query('COMMIT');
        res.json({ success: true, count: userIds.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Create assignment error:', err);
      res.status(500).json({ error: 'Failed to create assignments' });
    }
  }
);

// GET /api/assignments — list assignments (Admin sees all, Analyst sees own)
router.get('/assignments', authMiddleware, async (req, res) => {
  try {
    let result;
    if (req.user.rol === 'Administrador') {
      result = await pool.query(
        `SELECT * FROM assignments ORDER BY created_at DESC`
      );
    } else {
      result = await pool.query(
        `SELECT * FROM assignments WHERE user_id = $1 ORDER BY created_at DESC`,
        [Number(req.user.id)]
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('List assignments error:', err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// GET /api/assignments/:id/siblings — Get all assignments sharing same filters (for seeing assigned ranges)
router.get(
  '/assignments/:id/siblings',
  authMiddleware,
  requireRole('Administrador'),
  async (req, res) => {
    try {
      // Get the target assignment's filters
      const target = await pool.query(
        `SELECT filters, label FROM assignments WHERE id = $1`, [req.params.id]
      );
      if (target.rows.length === 0) return res.status(404).json({ error: 'Not found' });

      const { filters, label } = target.rows[0];

      // Find all assignments with same filters
      const result = await pool.query(
        `SELECT id, user_id, user_name, range_from, range_to, created_at
         FROM assignments
         WHERE filters = $1::jsonb
         ORDER BY range_from ASC NULLS LAST`,
        [JSON.stringify(filters)]
      );
      res.json(result.rows);
    } catch (err) {
      console.error('Siblings error:', err);
      res.status(500).json({ error: 'Failed to fetch siblings' });
    }
  }
);

// DELETE /api/assignments/:id — Admin deletes an assignment
router.delete(
  '/assignments/:id',
  authMiddleware,
  requireRole('Administrador'),
  async (req, res) => {
    try {
      await pool.query(`DELETE FROM assignments WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error('Delete assignment error:', err);
      res.status(500).json({ error: 'Failed to delete assignment' });
    }
  }
);

export default router;
