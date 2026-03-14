import { Router } from 'express';
import pool from '../db/pool.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /api/evidences — save or update evidence for a row
router.post('/evidences', authMiddleware, async (req, res) => {
  try {
    const { assignmentId, rowIndex, status, imageData, rotation, observations, imageDataE24, rotationE24, csvRowId } = req.body;

    if (!assignmentId || rowIndex == null || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO evidences (assignment_id, row_index, status, image_data, rotation, observations, image_data_e24, rotation_e24, csv_row_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (assignment_id, row_index)
       DO UPDATE SET status = $3, image_data = $4, rotation = $5, observations = $6, image_data_e24 = $7, rotation_e24 = $8, csv_row_id = COALESCE($9, evidences.csv_row_id), updated_at = NOW()
       RETURNING *`,
      [assignmentId, rowIndex, status, imageData || null, rotation || 0, observations || null, imageDataE24 || null, rotationE24 || 0, csvRowId || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Save evidence error:', err);
    res.status(500).json({ error: 'Failed to save evidence' });
  }
});

// Columns to return in the list endpoint (excludes heavy image_data)
const LIST_COLS = 'id, assignment_id, row_index, status, rotation, rotation_e24, observations, updated_at, (image_data_e24 IS NOT NULL) AS has_e24';

// GET /api/evidences/detail/:id — get a single evidence WITH image_data (for modal)
// Must be registered BEFORE /:assignmentId to avoid route conflict
router.get('/evidences/detail/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM evidences WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Evidence not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get evidence detail error:', err);
    res.status(500).json({ error: 'Failed to fetch evidence detail' });
  }
});

// GET /api/evidences/:assignmentId — get all evidences for an assignment
// Admin with ?siblings=true gets evidences from all assignments sharing same filters
// Does NOT return image_data (use GET /api/evidences/detail/:id for that)
router.get('/evidences/:assignmentId', authMiddleware, async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId;
    let result;

    if (req.query.siblings === 'true' && req.user.rol === 'Administrador') {
      // Get the filters of this assignment, then find all sibling assignment IDs
      const target = await pool.query(
        `SELECT filters FROM assignments WHERE id = $1`, [assignmentId]
      );
      if (target.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });

      const siblingIds = await pool.query(
        `SELECT id FROM assignments WHERE filters = $1::jsonb`,
        [JSON.stringify(target.rows[0].filters)]
      );
      const ids = siblingIds.rows.map((r) => r.id);

      result = await pool.query(
        `SELECT ${LIST_COLS} FROM evidences WHERE assignment_id = ANY($1) ORDER BY row_index`,
        [ids]
      );
    } else {
      result = await pool.query(
        `SELECT ${LIST_COLS} FROM evidences WHERE assignment_id = $1 ORDER BY row_index`,
        [assignmentId]
      );
    }

    const map = {};
    for (const row of result.rows) {
      // If multiple evidences exist for the same row_index (from different siblings),
      // prefer the one with status 'uploaded' over others
      if (!map[row.row_index] || (row.status === 'uploaded' && map[row.row_index].status !== 'uploaded')) {
        map[row.row_index] = row;
      }
    }
    res.json(map);
  } catch (err) {
    console.error('Get evidences error:', err);
    res.status(500).json({ error: 'Failed to fetch evidences' });
  }
});

// POST /api/evidences/batch-detail — get image_data for multiple evidence IDs in one request
router.post('/evidences/batch-detail', authMiddleware, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    // Limit to 50 at a time to avoid huge payloads
    const limited = ids.slice(0, 50);
    const result = await pool.query(
      `SELECT id, assignment_id, row_index, status, image_data, rotation, observations, updated_at, image_data_e24, rotation_e24
       FROM evidences WHERE id = ANY($1)`,
      [limited]
    );
    // Return as map keyed by row_index for easy merging
    const map = {};
    for (const row of result.rows) {
      map[row.row_index] = row;
    }
    res.json(map);
  } catch (err) {
    console.error('Batch detail error:', err);
    res.status(500).json({ error: 'Failed to fetch batch details' });
  }
});

// PATCH /api/evidences/batch-rotate — set rotation for multiple evidences at once
router.patch('/evidences/batch-rotate', authMiddleware, async (req, res) => {
  try {
    const { ids, rotation, target } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || rotation == null) {
      return res.status(400).json({ error: 'ids array and rotation required' });
    }
    const validRotation = [0, 90, 180, 270].includes(rotation) ? rotation : 0;
    const limited = ids.slice(0, 200);
    const col = target === 'e24' ? 'rotation_e24' : 'rotation';

    // Authorization: analysts can only rotate their own evidences
    if (req.user.rol !== 'Administrador') {
      const ownerCheck = await pool.query(
        `SELECT COUNT(*) AS cnt FROM evidences e
         JOIN assignments a ON e.assignment_id = a.id
         WHERE e.id = ANY($1) AND a.user_id != $2`,
        [limited, req.user.id]
      );
      if (Number(ownerCheck.rows[0].cnt) > 0) {
        return res.status(403).json({ error: 'No tienes permiso para rotar estas evidencias' });
      }
    }

    const result = await pool.query(
      `UPDATE evidences SET ${col} = $1, updated_at = NOW()
       WHERE id = ANY($2)
       RETURNING id, row_index, rotation, rotation_e24`,
      [validRotation, limited]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Batch rotate error:', err);
    res.status(500).json({ error: 'Failed to batch rotate' });
  }
});

// DELETE /api/evidences/:id — delete a single evidence
router.delete('/evidences/:id', authMiddleware, async (req, res) => {
  try {
    // Check ownership: analysts can only delete their own evidences
    const check = await pool.query(
      `SELECT e.id, e.csv_row_id, a.user_id FROM evidences e JOIN assignments a ON e.assignment_id = a.id WHERE e.id = $1`,
      [req.params.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Evidence not found' });
    if (req.user.rol !== 'Administrador' && check.rows[0].user_id !== Number(req.user.id)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta evidencia' });
    }

    const result = await pool.query(
      `DELETE FROM evidences WHERE id = $1 RETURNING assignment_id, row_index`,
      [req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Delete evidence error:', err);
    res.status(500).json({ error: 'Failed to delete evidence' });
  }
});

export default router;
