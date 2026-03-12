import { Router } from 'express';
import pool from '../db/pool.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /api/evidences — save or update evidence for a row
router.post('/evidences', authMiddleware, async (req, res) => {
  try {
    const { assignmentId, rowIndex, status, imageData, rotation, observations } = req.body;

    if (!assignmentId || rowIndex == null || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO evidences (assignment_id, row_index, status, image_data, rotation, observations, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (assignment_id, row_index)
       DO UPDATE SET status = $3, image_data = $4, rotation = $5, observations = $6, updated_at = NOW()
       RETURNING *`,
      [assignmentId, rowIndex, status, imageData || null, rotation || 0, observations || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Save evidence error:', err);
    res.status(500).json({ error: 'Failed to save evidence' });
  }
});

// GET /api/evidences/:assignmentId — get all evidences for an assignment
router.get('/evidences/:assignmentId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM evidences WHERE assignment_id = $1 ORDER BY row_index`,
      [req.params.assignmentId]
    );
    const map = {};
    for (const row of result.rows) {
      map[row.row_index] = row;
    }
    res.json(map);
  } catch (err) {
    console.error('Get evidences error:', err);
    res.status(500).json({ error: 'Failed to fetch evidences' });
  }
});

// DELETE /api/evidences/:id — delete a single evidence
router.delete('/evidences/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM evidences WHERE id = $1 RETURNING assignment_id, row_index`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evidence not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Delete evidence error:', err);
    res.status(500).json({ error: 'Failed to delete evidence' });
  }
});

export default router;
