/**
 * One-time migration: populates csv_row_id on existing evidences
 * by reconstructing the same UNION/ROW_NUMBER query used by multi-rows.
 *
 * Run: node server/scripts/migrate-csv-row-id.js
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function buildUnionQuery(filters) {
  const blocks = Array.isArray(filters) ? filters : [filters];
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
      conditions.push(`(row_data->>'candidato' ILIKE $${p} OR row_data->>'codCandidato' ILIKE $${p})`);
      allValues.push(`%${block.nomCandidato}%`);
      p++;
    }
    if (block.diferencia === 'ganando') conditions.push(`(row_data->>'Diferencia')::numeric > 0`);
    else if (block.diferencia === 'perdiendo') conditions.push(`(row_data->>'Diferencia')::numeric < 0`);

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
    unionParts.push(`SELECT id AS csv_row_id, row_data, row_index FROM csv_rows WHERE completed = FALSE AND ${where}`);
  }

  const combined = unionParts.join(' UNION ');
  const numbered = `SELECT csv_row_id, ROW_NUMBER() OVER (ORDER BY row_index) AS rn FROM (${combined}) AS combined`;
  return { query: numbered, values: allValues };
}

async function main() {
  // Get all assignments that have evidences
  const assignments = await pool.query(`
    SELECT DISTINCT a.id, a.filters
    FROM assignments a
    JOIN evidences e ON e.assignment_id = a.id
    WHERE e.csv_row_id IS NULL
  `);

  console.log(`Found ${assignments.rows.length} assignments with evidences to migrate`);
  let updated = 0;

  for (const assignment of assignments.rows) {
    const { query, values } = buildUnionQuery(assignment.filters);
    const rnResult = await pool.query(query, values);

    // Build rn -> csv_row_id map
    const rnMap = {};
    for (const row of rnResult.rows) {
      rnMap[Number(row.rn)] = Number(row.csv_row_id);
    }

    // Get evidences for this assignment
    const evidences = await pool.query(
      `SELECT id, row_index FROM evidences WHERE assignment_id = $1 AND csv_row_id IS NULL`,
      [assignment.id]
    );

    for (const ev of evidences.rows) {
      const csvRowId = rnMap[ev.row_index];
      if (csvRowId) {
        await pool.query(`UPDATE evidences SET csv_row_id = $1 WHERE id = $2`, [csvRowId, ev.id]);
        updated++;
      } else {
        console.warn(`  WARNING: No csv_row found for assignment ${assignment.id}, rn ${ev.row_index}`);
      }
    }
  }

  console.log(`Migration complete: ${updated} evidences updated`);
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
