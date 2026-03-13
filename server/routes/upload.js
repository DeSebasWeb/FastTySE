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
    const markCompleted = req.body.markCompleted === '1';

    // Parse fecha from filename: Vot20260308 -> 2026-03-08
    const dateMatch = filename.match(/(\d{4})(\d{2})(\d{2})/);
    const fechaCsv = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const uploadResult = await client.query(
        `INSERT INTO csv_uploads (filename, columns, row_count, fecha_csv)
         VALUES ($1, $2, $3, $4)
         RETURNING id, uploaded_at`,
        [filename, JSON.stringify(columns), rowCount, fechaCsv]
      );

      const { id: uploadId, uploaded_at: uploadedAt } = uploadResult.rows[0];

      // Bulk insert rows in batches of 500
      // ON CONFLICT DO NOTHING — skips duplicate rows (same business key)
      const BATCH_SIZE = 500;
      let insertedCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < processed.length; i += BATCH_SIZE) {
        const batch = processed.slice(i, i + BATCH_SIZE);
        const values = [];
        const params = [];
        batch.forEach((row, idx) => {
          const offset = idx * 5;
          values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
          params.push(uploadId, JSON.stringify(row), i + idx, fechaCsv, false);
        });

        const result = await client.query(
          `INSERT INTO csv_rows (upload_id, row_data, row_index, fecha_csv, completed)
           VALUES ${values.join(', ')}
           ON CONFLICT ((row_data->>'nomCorporacion'), (row_data->>'nomDepartamento'),
                        (row_data->>'nomMunicipio'), (row_data->>'zona'),
                        (row_data->>'codPuesto'), (row_data->>'mesa'),
                        (row_data->>'candidato'))
           DO NOTHING`,
          params
        );
        insertedCount += result.rowCount;
        skippedCount += batch.length - result.rowCount;
      }

      // If markCompleted, build the unique business keys from the CSV data
      // and mark ALL matching rows in csv_rows as completed
      if (markCompleted) {
        // Deduplicate business keys from the processed CSV
        const seen = new Set();
        const uniqueKeys = [];
        for (const row of processed) {
          const bk = [
            row.nomCorporacion || '', row.nomDepartamento || '',
            row.nomMunicipio || '', row.zona || '',
            row.codPuesto || '', row.mesa || '',
            row.candidato || '',
          ].join('\x00');
          if (seen.has(bk)) continue;
          seen.add(bk);
          uniqueKeys.push(row);
        }

        // Mark in batches
        let markedCount = 0;
        for (let i = 0; i < uniqueKeys.length; i += BATCH_SIZE) {
          const batch = uniqueKeys.slice(i, i + BATCH_SIZE);
          const conditions = [];
          const params = [];
          batch.forEach((row, idx) => {
            const o = idx * 7;
            conditions.push(
              `(row_data->>'nomCorporacion' = $${o+1} AND row_data->>'nomDepartamento' = $${o+2} AND row_data->>'nomMunicipio' = $${o+3} AND row_data->>'zona' = $${o+4} AND row_data->>'codPuesto' = $${o+5} AND row_data->>'mesa' = $${o+6} AND row_data->>'candidato' = $${o+7})`
            );
            params.push(
              row.nomCorporacion || '', row.nomDepartamento || '',
              row.nomMunicipio || '', row.zona || '',
              row.codPuesto || '', row.mesa || '',
              row.candidato || ''
            );
          });
          const markResult = await client.query(
            `UPDATE csv_rows SET completed = TRUE
             WHERE completed = FALSE AND (${conditions.join(' OR ')})`,
            params
          );
          markedCount += markResult.rowCount;
        }
        insertedCount = markedCount;
      }

      await client.query('COMMIT');

      // Emit socket event to all connected clients
      const io = req.app.get('io');
      io.emit('csv:uploaded', {
        uploadId,
        filename,
        fechaCsv,
        columns,
        rowCount,
        insertedCount,
        skippedCount,
        uploadedAt,
      });

      res.json({ uploadId, filename, fechaCsv, columns, rowCount, insertedCount, skippedCount, uploadedAt });
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
      `SELECT u.id, u.filename, u.columns, u.row_count, u.uploaded_at, u.fecha_csv,
              COALESCE(SUM(CASE WHEN r.completed THEN 1 ELSE 0 END), 0)::int AS completed_count
       FROM csv_uploads u
       LEFT JOIN csv_rows r ON r.upload_id = u.id
       GROUP BY u.id, u.filename, u.columns, u.row_count, u.uploaded_at, u.fecha_csv
       ORDER BY u.uploaded_at DESC`
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

// GET /api/csv-dates — lista fechas únicas disponibles en csv_rows
router.get('/csv-dates', authMiddleware, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT fecha_csv::text AS fecha
       FROM csv_rows
       WHERE fecha_csv IS NOT NULL
       ORDER BY fecha_csv DESC`
    );
    res.json(result.rows.map((r) => r.fecha));
  } catch (err) {
    console.error('CSV dates error:', err);
    res.status(500).json({ error: 'Failed to fetch dates' });
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

// POST /api/uploads/:id/mark-completed — marca todas las filas de un upload como completadas
router.post('/uploads/:id/mark-completed', authMiddleware, requireRole('Administrador'), async (req, res) => {
  try {
    const { id } = req.params;

    const upload = await pool.query(`SELECT id, filename FROM csv_uploads WHERE id = $1`, [id]);
    if (upload.rows.length === 0) return res.status(404).json({ error: 'Upload not found' });

    const result = await pool.query(
      `UPDATE csv_rows SET completed = TRUE WHERE upload_id = $1 AND completed = FALSE`,
      [id]
    );

    res.json({ success: true, markedCount: result.rowCount, filename: upload.rows[0].filename });
  } catch (err) {
    console.error('Mark completed error:', err);
    res.status(500).json({ error: 'Failed to mark rows as completed' });
  }
});

// POST /api/uploads/:id/unmark-completed — desmarca las filas de un upload
router.post('/uploads/:id/unmark-completed', authMiddleware, requireRole('Administrador'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE csv_rows SET completed = FALSE WHERE upload_id = $1 AND completed = TRUE`,
      [id]
    );
    res.json({ success: true, unmarkedCount: result.rowCount });
  } catch (err) {
    console.error('Unmark completed error:', err);
    res.status(500).json({ error: 'Failed to unmark rows' });
  }
});

export default router;
