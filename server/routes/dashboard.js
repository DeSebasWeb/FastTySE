import { Router } from 'express';
import pool from '../db/pool.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// All dashboard routes require authentication
router.use(authMiddleware);

// Shared helper: builds dynamic WHERE clause from filter query params
function buildWhere(query, startParam = 1) {
  const conditions = [];
  const values = [];
  let p = startParam;

  const exact = [
    ['nomCorporacion', 'nomCorporacion'],
    ['nomDepartamento', 'nomDepartamento'],
    ['nomMunicipio', 'nomMunicipio'],
    ['zona', 'zona'],
    ['codPuesto', 'codPuesto'],
    ['mesa', 'mesa'],
  ];

  for (const [param, field] of exact) {
    if (query[param]) {
      conditions.push(`row_data->>'${field}' = $${p}`);
      values.push(query[param]);
      p++;
    }
  }

  if (query.nomLista) {
    conditions.push(`row_data->>'nomLista' ILIKE $${p}`);
    values.push(`%${query.nomLista}%`);
    p++;
  }

  if (query.nomCandidato) {
    conditions.push(`row_data->>'candidato' ILIKE $${p}`);
    values.push(`%${query.nomCandidato}%`);
    p++;
  }

  const text = conditions.length > 0
    ? 'AND ' + conditions.join(' AND ')
    : '';

  return { text, values, nextParam: p };
}

// GET /api/dashboard/stats — aggregated votes for SENADO & CAMARA
router.get('/dashboard/stats', async (req, res) => {
  try {
    const where = buildWhere(req.query);

    const result = await pool.query(
      `SELECT
         row_data->>'nomCorporacion' AS corporacion,
         SUM(CASE WHEN (row_data->>'Diferencia')::numeric < 0
             THEN (row_data->>'Diferencia')::numeric ELSE 0 END) AS votos_perdidos,
         SUM(CASE WHEN (row_data->>'Diferencia')::numeric > 0
             THEN (row_data->>'Diferencia')::numeric ELSE 0 END) AS votos_ganados
       FROM csv_rows
       WHERE 1=1 ${where.text}
       GROUP BY row_data->>'nomCorporacion'`,
      where.values
    );

    const stats = {};
    for (const row of result.rows) {
      stats[row.corporacion] = {
        votosGanados: Number(row.votos_ganados) || 0,
        votosPerdidos: Number(row.votos_perdidos) || 0,
      };
    }

    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/dashboard/filter-options — distinct values for cascading dropdowns
router.get('/dashboard/filter-options', async (req, res) => {
  try {
    // Each dropdown only respects "upstream" filters
    const corpWhere = buildWhere({});
    const deptWhere = buildWhere({
      nomCorporacion: req.query.nomCorporacion,
    });
    const muniWhere = buildWhere({
      nomCorporacion: req.query.nomCorporacion,
      nomDepartamento: req.query.nomDepartamento,
    });
    const restWhere = buildWhere({
      nomCorporacion: req.query.nomCorporacion,
      nomDepartamento: req.query.nomDepartamento,
      nomMunicipio: req.query.nomMunicipio,
    });

    const [corporaciones, departamentos, municipios, zonas, puestos, mesas, listas] =
      await Promise.all([
        pool.query(
          `SELECT DISTINCT row_data->>'nomCorporacion' AS v FROM csv_rows
           WHERE 1=1 ${corpWhere.text} ORDER BY v`,
          corpWhere.values
        ),
        pool.query(
          `SELECT DISTINCT row_data->>'nomDepartamento' AS v FROM csv_rows
           WHERE 1=1 ${deptWhere.text} ORDER BY v`,
          deptWhere.values
        ),
        pool.query(
          `SELECT DISTINCT row_data->>'nomMunicipio' AS v FROM csv_rows
           WHERE 1=1 ${muniWhere.text} ORDER BY v`,
          muniWhere.values
        ),
        pool.query(
          `SELECT DISTINCT row_data->>'zona' AS v FROM csv_rows
           WHERE 1=1 ${restWhere.text} ORDER BY v`,
          restWhere.values
        ),
        pool.query(
          `SELECT DISTINCT row_data->>'codPuesto' AS v FROM csv_rows
           WHERE 1=1 ${restWhere.text} ORDER BY v`,
          restWhere.values
        ),
        pool.query(
          `SELECT DISTINCT row_data->>'mesa' AS v FROM csv_rows
           WHERE 1=1 ${restWhere.text} ORDER BY v`,
          restWhere.values
        ),
        pool.query(
          `SELECT DISTINCT row_data->>'nomLista' AS v FROM csv_rows
           WHERE 1=1 ${restWhere.text} ORDER BY v`,
          restWhere.values
        ),
      ]);

    res.json({
      corporaciones: corporaciones.rows.map((r) => r.v).filter(Boolean),
      departamentos: departamentos.rows.map((r) => r.v).filter(Boolean),
      municipios: municipios.rows.map((r) => r.v).filter(Boolean),
      zonas: zonas.rows.map((r) => r.v).filter(Boolean),
      puestos: puestos.rows.map((r) => r.v).filter(Boolean),
      mesas: mesas.rows.map((r) => r.v).filter(Boolean),
      listas: listas.rows.map((r) => r.v).filter(Boolean),
    });
  } catch (err) {
    console.error('Filter options error:', err);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

// GET /api/dashboard/rows — filtered + paginated rows
router.get('/dashboard/rows', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 100));
    const offset = (page - 1) * limit;

    const where = buildWhere(req.query);
    const p = where.nextParam;

    const [rowsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT row_data FROM csv_rows
         WHERE 1=1 ${where.text}
         ORDER BY row_index
         LIMIT $${p} OFFSET $${p + 1}`,
        [...where.values, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM csv_rows
         WHERE 1=1 ${where.text}`,
        where.values
      ),
    ]);

    const total = parseInt(countResult.rows[0].total);

    res.json({
      rows: rowsResult.rows.map((r) => r.row_data),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Dashboard rows error:', err);
    res.status(500).json({ error: 'Failed to fetch rows' });
  }
});

// CSV: map of JSON field -> CSV header label
const CSV_COLUMNS = [
  { field: 'nomCorporacion', label: 'Corporacion' },
  { field: 'nomDepartamento', label: 'Departamento' },
  { field: 'nomMunicipio', label: 'Municipio' },
  { field: 'zona', label: 'Zona' },
  { field: 'nomPuesto', label: 'Puesto' },
  { field: 'mesa', label: 'Mesa' },
  { field: 'nomLista', label: 'Partido' },
  { field: 'candidato', label: 'Candidato' },
  { field: 'Votos E14', label: 'Votos E14' },
  { field: 'Votos MMV', label: 'Votos MMV' },
  { field: 'Diferencia', label: 'Diferencia' },
];

function escapeCell(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function rowsToCsv(rows) {
  const BOM = '\uFEFF';
  const sep = ';';
  const header = CSV_COLUMNS.map((c) => c.label).join(sep);
  const lines = rows.map((r) =>
    CSV_COLUMNS.map((c) => escapeCell(r[c.field])).join(sep)
  );
  return BOM + header + '\n' + lines.join('\n');
}

// GET /api/dashboard/rows/csv — download filtered rows as CSV
router.get('/dashboard/rows/csv', async (req, res) => {
  try {
    const query = { ...req.query };
    const diferencia = query.diferencia;
    delete query.diferencia;
    delete query.page;
    delete query.limit;

    const where = buildWhere(query);

    let extraCondition = '';
    if (diferencia === 'ganando') {
      extraCondition = ` AND (row_data->>'Diferencia')::numeric > 0`;
    } else if (diferencia === 'perdiendo') {
      extraCondition = ` AND (row_data->>'Diferencia')::numeric < 0`;
    }

    const result = await pool.query(
      `SELECT row_data FROM csv_rows WHERE 1=1 ${where.text}${extraCondition} ORDER BY row_index`,
      where.values
    );

    const csv = rowsToCsv(result.rows.map((r) => r.row_data));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="datos.csv"');
    res.send(csv);
  } catch (err) {
    console.error('CSV download error:', err);
    res.status(500).json({ error: 'Failed to generate CSV' });
  }
});

// POST /api/dashboard/multi-rows/csv — download multi-filter rows as CSV
router.post('/dashboard/multi-rows/csv', async (req, res) => {
  try {
    const { blocks } = req.body;
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="datos.csv"');
      return res.send(CSV_COLUMNS.join(','));
    }

    const unionParts = [];
    const allValues = [];
    let p = 1;

    for (const block of blocks) {
      const conditions = [];
      const exact = [
        ['nomCorporacion', 'nomCorporacion'],
        ['nomDepartamento', 'nomDepartamento'],
        ['nomMunicipio', 'nomMunicipio'],
        ['zona', 'zona'],
        ['codPuesto', 'codPuesto'],
        ['mesa', 'mesa'],
      ];

      for (const [param, field] of exact) {
        if (block[param]) {
          conditions.push(`row_data->>'${field}' = $${p}`);
          allValues.push(block[param]);
          p++;
        }
      }

      if (block.nomLista) {
        conditions.push(`row_data->>'nomLista' ILIKE $${p}`);
        allValues.push(`%${block.nomLista}%`);
        p++;
      }

      if (block.nomCandidato) {
        conditions.push(`row_data->>'candidato' ILIKE $${p}`);
        allValues.push(`%${block.nomCandidato}%`);
        p++;
      }

      if (block.diferencia === 'ganando') {
        conditions.push(`(row_data->>'Diferencia')::numeric > 0`);
      } else if (block.diferencia === 'perdiendo') {
        conditions.push(`(row_data->>'Diferencia')::numeric < 0`);
      }

      const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
      unionParts.push(`SELECT row_data, row_index FROM csv_rows WHERE ${where}`);
    }

    const combined = unionParts.join(' UNION ');
    const result = await pool.query(
      `SELECT row_data FROM (${combined}) AS combined ORDER BY row_index`,
      allValues
    );

    const csv = rowsToCsv(result.rows.map((r) => r.row_data));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="datos.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Multi CSV download error:', err);
    res.status(500).json({ error: 'Failed to generate CSV' });
  }
});

// POST /api/dashboard/multi-rows — multiple filter blocks combined, original order
// Supports optional rangeFrom/rangeTo to slice a specific row range
router.post('/dashboard/multi-rows', async (req, res) => {
  try {
    const { blocks, page: rawPage, limit: rawLimit, rangeFrom, rangeTo } = req.body;
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
      return res.json({ rows: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } });
    }

    const page = Math.max(1, parseInt(rawPage) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(rawLimit) || 100));

    // Build a UNION of WHERE clauses, one per block
    const unionParts = [];
    const allValues = [];
    let p = 1;

    for (const block of blocks) {
      const conditions = [];

      const exact = [
        ['nomCorporacion', 'nomCorporacion'],
        ['nomDepartamento', 'nomDepartamento'],
        ['nomMunicipio', 'nomMunicipio'],
        ['zona', 'zona'],
        ['codPuesto', 'codPuesto'],
        ['mesa', 'mesa'],
      ];

      for (const [param, field] of exact) {
        if (block[param]) {
          conditions.push(`row_data->>'${field}' = $${p}`);
          allValues.push(block[param]);
          p++;
        }
      }

      if (block.nomLista) {
        conditions.push(`row_data->>'nomLista' ILIKE $${p}`);
        allValues.push(`%${block.nomLista}%`);
        p++;
      }

      if (block.nomCandidato) {
        conditions.push(`row_data->>'candidato' ILIKE $${p}`);
        allValues.push(`%${block.nomCandidato}%`);
        p++;
      }

      if (block.diferencia === 'ganando') {
        conditions.push(`(row_data->>'Diferencia')::numeric > 0`);
      } else if (block.diferencia === 'perdiendo') {
        conditions.push(`(row_data->>'Diferencia')::numeric < 0`);
      }

      const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
      unionParts.push(`SELECT row_data, row_index FROM csv_rows WHERE ${where}`);
    }

    const combined = unionParts.join(' UNION ');

    // Add ROW_NUMBER so we can slice by range
    const numbered = `SELECT *, ROW_NUMBER() OVER (ORDER BY row_index) AS rn FROM (${combined}) AS combined`;

    // If rangeFrom/rangeTo provided, filter by row number range
    let rangeFilter = '';
    if (rangeFrom && rangeTo) {
      rangeFilter = ` WHERE rn >= $${p} AND rn <= $${p + 1}`;
      allValues.push(rangeFrom, rangeTo);
      p += 2;
    }

    const rangedQuery = `SELECT * FROM (${numbered}) AS numbered${rangeFilter} ORDER BY row_index`;

    // Pagination within the (possibly range-filtered) result
    const offset = (page - 1) * limit;

    const [rowsResult, countResult] = await Promise.all([
      pool.query(
        `${rangedQuery} LIMIT $${p} OFFSET $${p + 1}`,
        [...allValues, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM (${numbered}) AS numbered${rangeFilter}`,
        allValues.slice(0, allValues.length) // same values
      ),
    ]);

    const total = parseInt(countResult.rows[0].total);

    res.json({
      rows: rowsResult.rows.map((r) => r.row_data),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Multi-rows error:', err);
    res.status(500).json({ error: 'Failed to fetch multi-rows' });
  }
});

export default router;
