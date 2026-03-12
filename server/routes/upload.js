import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import pool from '../db/pool.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/upload — recibe CSV, parsea, inserta, emite socket
router.post('/upload', authMiddleware, requireRole('Administrador'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
      return res.status(400).json({ error: 'Only CSV files are allowed' });
    }

    const csvBuffer = req.file.buffer.toString('utf-8');

    // Auto-detect delimiter from the first line
    const firstLine = csvBuffer.split(/\r?\n/)[0] || '';
    const delimiters = [',', ';', '\t', '|'];
    let delimiter = ',';
    let maxCount = 0;
    for (const d of delimiters) {
      const count = firstLine.split(d).length;
      if (count > maxCount) {
        maxCount = count;
        delimiter = d;
      }
    }

    const records = await new Promise((resolve, reject) => {
      parse(csvBuffer, {
        columns: true,
        skip_empty_lines: true,
        delimiter,
        quote: '"',
        relax_quotes: true,
        relax_column_count: true,
        trim: true,
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty or has no data rows' });
    }

    // --- CSV Processing ---
    const DROP_COLS = new Set([
      'instanciaAntes', 'instanciaNueva',
      'idComisionNueva', 'fechaVotosNuevos',
      'nomComisionAntes', 'idComisionAntes',
      'fechaVotosAntes', 'nomComisionNueva',
    ]);

    const processed = records.map((row) => {
      const out = {};
      for (const [key, val] of Object.entries(row)) {
        if (DROP_COLS.has(key)) continue;
        if (key === 'votosAntes') {
          out['Votos E14'] = val;
        } else if (key === 'votosNuevos') {
          out['Votos MMV'] = val;
        } else {
          out[key] = val;
        }
      }
      const e14 = parseInt(out['Votos E14']) || 0;
      const mmv = parseInt(out['Votos MMV']) || 0;
      out['Diferencia'] = String(mmv - e14);
      return out;
    });

    const columns = Object.keys(processed[0]);
    const filename = req.file.originalname;
    const rowCount = processed.length;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const uploadResult = await client.query(
        `INSERT INTO csv_uploads (filename, columns, row_count)
         VALUES ($1, $2, $3)
         RETURNING id, uploaded_at`,
        [filename, JSON.stringify(columns), rowCount]
      );

      const { id: uploadId, uploaded_at: uploadedAt } = uploadResult.rows[0];

      // Bulk insert rows in batches of 500
      const BATCH_SIZE = 500;
      for (let i = 0; i < processed.length; i += BATCH_SIZE) {
        const batch = processed.slice(i, i + BATCH_SIZE);
        const values = [];
        const params = [];
        batch.forEach((row, idx) => {
          const offset = idx * 3;
          values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
          params.push(uploadId, JSON.stringify(row), i + idx);
        });

        await client.query(
          `INSERT INTO csv_rows (upload_id, row_data, row_index) VALUES ${values.join(', ')}`,
          params
        );
      }

      await client.query('COMMIT');

      // Emit socket event to all connected clients
      const io = req.app.get('io');
      io.emit('csv:uploaded', {
        uploadId,
        filename,
        columns,
        rowCount,
        uploadedAt,
      });

      res.json({ uploadId, filename, columns, rowCount, uploadedAt });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process CSV file' });
  }
});

// GET /api/uploads — lista todos los uploads
router.get('/uploads', authMiddleware, requireRole('Administrador'), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, filename, columns, row_count, uploaded_at
       FROM csv_uploads
       ORDER BY uploaded_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List uploads error:', err);
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// GET /api/uploads/:id/rows — devuelve filas con paginación
router.get('/uploads/:id/rows', authMiddleware, requireRole('Administrador'), async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 100));
    const offset = (page - 1) * limit;

    const [rowsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT row_data, row_index FROM csv_rows
         WHERE upload_id = $1
         ORDER BY row_index
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM csv_rows WHERE upload_id = $1`,
        [id]
      ),
    ]);

    const total = parseInt(countResult.rows[0].total);

    res.json({
      rows: rowsResult.rows.map(r => r.row_data),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Fetch rows error:', err);
    res.status(500).json({ error: 'Failed to fetch rows' });
  }
});

// DELETE /api/uploads/:id — elimina upload y filas (CASCADE)
router.delete('/uploads/:id', authMiddleware, requireRole('Administrador'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM csv_uploads WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const io = req.app.get('io');
    io.emit('csv:deleted', { uploadId: id });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete upload' });
  }
});

export default router;
