import { Router } from 'express';
import pool from '../db/pool.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import puppeteer from 'puppeteer';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

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

// PATCH /api/assignments/:id/complete — Toggle completed_at
router.patch('/assignments/:id/complete', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    // Verify ownership (analyst) or admin
    const check = await pool.query(`SELECT * FROM assignments WHERE id = $1`, [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const assignment = check.rows[0];
    if (req.user.rol !== 'Administrador' && assignment.user_id !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // Toggle: if completed_at is set, clear it; otherwise set it
    const newValue = assignment.completed_at ? null : new Date();
    const result = await pool.query(
      `UPDATE assignments SET completed_at = $1 WHERE id = $2 RETURNING *`,
      [newValue, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Toggle complete error:', err);
    res.status(500).json({ error: 'Failed to toggle completion' });
  }
});

// GET /api/assignments/progress — Admin: progress summary per analyst
router.get(
  '/assignments/progress',
  authMiddleware,
  requireRole('Administrador'),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          a.id AS assignment_id,
          a.user_name,
          a.label,
          a.range_from,
          a.range_to,
          COALESCE(a.range_to - a.range_from + 1, 0) AS total_rows,
          COUNT(e.id) FILTER (WHERE e.status = 'uploaded') AS uploaded,
          COUNT(e.id) FILTER (WHERE e.status = 'no_evidence') AS no_evidence,
          a.created_at
        FROM assignments a
        LEFT JOIN evidences e ON e.assignment_id = a.id
        GROUP BY a.id
        ORDER BY a.user_name, a.created_at DESC
      `);
      res.json(result.rows);
    } catch (err) {
      console.error('Progress error:', err);
      res.status(500).json({ error: 'Failed to fetch progress' });
    }
  }
);

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

// GET /api/assignments/:id/report — Generate HTML report for an assignment
router.get('/assignments/:id/report', authMiddleware, async (req, res) => {
  try {
    // Get assignment info
    const assignResult = await pool.query(
      `SELECT * FROM assignments WHERE id = $1`, [req.params.id]
    );
    if (assignResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const assignment = assignResult.rows[0];

    // Optional fecha filter — passed as ?fecha=2026-03-08
    const fechaFilter = req.query.fecha || null;
    const noReclamar = req.query.noReclamar === '1';

    // Get evidences — admin gets all siblings' evidences, analyst gets only own
    let evResult;
    if (req.user.rol === 'Administrador') {
      const siblingIds = await pool.query(
        `SELECT id FROM assignments WHERE filters = $1::jsonb`,
        [JSON.stringify(Array.isArray(assignment.filters) ? assignment.filters : [assignment.filters])]
      );
      const ids = siblingIds.rows.map((r) => r.id);
      evResult = await pool.query(
        `SELECT DISTINCT ON (row_index) * FROM evidences WHERE assignment_id = ANY($1) AND status = 'uploaded' ORDER BY row_index, updated_at DESC`,
        [ids]
      );
    } else {
      evResult = await pool.query(
        `SELECT * FROM evidences WHERE assignment_id = $1 AND status = 'uploaded' ORDER BY row_index`,
        [req.params.id]
      );
    }
    if (evResult.rows.length === 0) {
      return res.status(404).json({ error: 'No hay evidencias subidas para esta asignación' });
    }

    // Get row_data directly from csv_rows using csv_row_id (stable key)
    // For evidences without csv_row_id, fall back to UNION query
    const csvRowIds = evResult.rows.filter((e) => e.csv_row_id).map((e) => e.csv_row_id);
    const csvRowsResult = csvRowIds.length > 0
      ? await pool.query(`SELECT id, row_data, fecha_csv FROM csv_rows WHERE id = ANY($1)`, [csvRowIds])
      : { rows: [] };

    const csvRowMap = {};
    for (const r of csvRowsResult.rows) {
      csvRowMap[r.id] = { data: r.row_data, fecha: r.fecha_csv ? r.fecha_csv.toISOString().slice(0, 10) : null };
    }

    // Build a map rn -> { row_data, fecha_csv } using csv_row_id
    const rowMap = {};
    for (const ev of evResult.rows) {
      if (ev.csv_row_id && csvRowMap[ev.csv_row_id]) {
        rowMap[ev.row_index] = csvRowMap[ev.csv_row_id];
      }
    }

    // Apply range if set — only for analysts, admin sees all
    const applyRange = req.user.rol !== 'Administrador';
    const rangeFrom = applyRange ? assignment.range_from : null;
    const rangeTo = applyRange ? assignment.range_to : null;

    // Build HTML
    const now = new Date();
    const tzOpts = { timeZone: 'America/Bogota' };
    const fecha = now.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', ...tzOpts });

    function getTitle(row) {
      const corp = (row.nomCorporacion || '').toUpperCase().includes('SENADO') ? 'SENADO' : 'CÁMARA';
      if (noReclamar) return `INVESTIGACIÓN - ${corp} 2026`;
      const dif = Number(row['Diferencia'] || 0);
      if (dif < 0) return `RECLAMACIÓN POR FALTA DE VOTOS - ${corp} 2026`;
      if (dif === 0) return `RECLAMACIÓN POR VOTACIÓN EN CERO - ${corp} 2026`;
      return `RECLAMACIÓN POR EXCESO DE VOTOS - ${corp} 2026`;
    }

    const noReclamarBanner = noReclamar
      ? `<div style="background:#c0392b;color:#fff;text-align:center;padding:8px 0;font-size:20px;font-weight:900;letter-spacing:1px;border-radius:4px;margin-bottom:8px;">OJO — NO ES RECLAMACIÓN — PARA CUIDAR</div>`
      : '';

    function escapeHtml(str) {
      return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    const pages = [];
    for (const ev of evResult.rows) {
      const rn = ev.row_index;
      // Skip if outside range
      if (rangeFrom && rangeTo && (rn < rangeFrom || rn > rangeTo)) continue;
      const entry = rowMap[rn];
      if (!entry) continue;
      // Skip if fecha filter provided and row doesn't match
      if (fechaFilter && entry.fecha !== fechaFilter) continue;
      const row = entry.data;

      const title = getTitle(row);
      const dif = Number(row['Diferencia'] || 0);
      const difColor = dif < 0 ? '#c0392b' : dif > 0 ? '#27ae60' : '#e67e22';
      const difLabel = dif < 0
        ? `<span style="color:${difColor};font-weight:700">${dif} (Falta de votos)</span>`
        : dif === 0
        ? `<span style="color:${difColor};font-weight:700">0 (Cero)</span>`
        : `<span style="color:${difColor};font-weight:700">+${dif} (Exceso de votos)</span>`;

      const rotation = [0, 90, 180, 270].includes(ev.rotation) ? ev.rotation : 0;

      pages.push(`
        <div class="page">
          <div class="header-section">
            ${noReclamarBanner}
            <h1 class="report-title">${escapeHtml(title)}</h1>
            <hr class="title-line"/>
            <div class="date-row">Fecha: ${fecha}</div>
            <table class="info-table">
              <thead>
                <tr>
                  <th>Departamento</th>
                  <th>Municipio</th>
                  <th>Zona</th>
                  <th>Puesto</th>
                  <th>Mesa</th>
                  <th>Partido</th>
                  <th>Candidato</th>
                  <th>E14</th>
                  <th>Votos Escrutinio<br/>(MMV)</th>
                  <th>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>${escapeHtml(row.nomDepartamento)}</td>
                  <td>${escapeHtml(row.nomMunicipio)}</td>
                  <td>${escapeHtml(row.zona)}</td>
                  <td>${escapeHtml(row.nomPuesto)}</td>
                  <td>${escapeHtml(row.mesa)}</td>
                  <td>${escapeHtml(row.nomLista)}</td>
                  <td>${escapeHtml(row.candidato)}</td>
                  <td>${escapeHtml(row['Votos E14'])}</td>
                  <td>${escapeHtml(row['Votos MMV'])}</td>
                  <td>${difLabel}</td>
                </tr>
              </tbody>
            </table>
            <div class="section-title">1. Evidencias Documentales</div>
            <div class="formulario-label">Formulario E-14</div>
            <hr class="blue-line"/>
          </div>

          <div class="image-section">
            <div class="img-rotate-wrapper rot-${rotation}">
              <img src="${ev.image_data}" alt="Formulario E-14"/>
            </div>
          </div>

          ${ev.observations ? `
          <div class="obs-section">
            <div class="obs-title">Observaciones</div>
            <hr class="obs-line"/>
            <div class="obs-content">
              <div class="obs-bar"></div>
              <span>${escapeHtml(ev.observations)}</span>
            </div>
          </div>` : ''}

          <div class="footer">
            Documento generado por Auditoría Escrutinio Congreso 2026 — ${now.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
          </div>
        </div>
      `);

      // E24 second page (if exists)
      if (ev.image_data_e24) {
        const rotationE24 = [0, 90, 180, 270].includes(ev.rotation_e24) ? ev.rotation_e24 : 0;
        pages.push(`
          <div class="page">
            <div class="header-section">
              ${noReclamarBanner}
              <h1 class="report-title">${escapeHtml(title)}</h1>
              <hr class="title-line"/>
              <div class="date-row">Fecha: ${fecha}</div>
              <table class="info-table">
                <thead>
                  <tr>
                    <th>Departamento</th>
                    <th>Municipio</th>
                    <th>Zona</th>
                    <th>Puesto</th>
                    <th>Mesa</th>
                    <th>Partido</th>
                    <th>Candidato</th>
                    <th>E14</th>
                    <th>Votos Escrutinio<br/>(MMV)</th>
                    <th>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>${escapeHtml(row.nomDepartamento)}</td>
                    <td>${escapeHtml(row.nomMunicipio)}</td>
                    <td>${escapeHtml(row.zona)}</td>
                    <td>${escapeHtml(row.nomPuesto)}</td>
                    <td>${escapeHtml(row.mesa)}</td>
                    <td>${escapeHtml(row.nomLista)}</td>
                    <td>${escapeHtml(row.candidato)}</td>
                    <td>${escapeHtml(row['Votos E14'])}</td>
                    <td>${escapeHtml(row['Votos MMV'])}</td>
                    <td>${difLabel}</td>
                  </tr>
                </tbody>
              </table>
              <div class="section-title">1. Evidencias Documentales</div>
              <div class="formulario-label">Formulario E-24</div>
              <hr class="blue-line"/>
            </div>

            <div class="image-section">
              <div class="img-rotate-wrapper rot-${rotationE24}">
                <img src="${ev.image_data_e24}" alt="Formulario E-24"/>
              </div>
            </div>

            <div class="footer">
              Documento generado por Auditoría Escrutinio Congreso 2026 — ${now.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
            </div>
          </div>
        `);
      }
    }

    if (pages.length === 0) {
      return res.status(404).json({ error: 'No hay evidencias dentro del rango asignado' });
    }

    const PAGE_CSS = `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #222; background: #fff; }
    .page {
      width: 210mm; height: 297mm;
      padding: 12mm 14mm 10mm 14mm;
      page-break-after: always;
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .page:last-child { page-break-after: avoid; }
    .header-section { flex-shrink: 0; }
    .report-title { font-size: 16px; font-weight: 900; text-align: center; color: #1a2744; letter-spacing: 0.5px; margin-bottom: 6px; }
    .title-line { border: none; border-top: 2px solid #1a2744; margin-bottom: 6px; }
    .date-row { text-align: right; font-size: 10px; color: #555; margin-bottom: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; table-layout: fixed; }
    .info-table th { background: #2c3e6b; color: #fff; padding: 4px 3px; text-align: center; font-size: 9px; border: 1px solid #2c3e6b; word-wrap: break-word; }
    .info-table td { padding: 5px 3px; text-align: center; border: 1px solid #ccc; font-size: 9px; vertical-align: middle; word-wrap: break-word; }
    .section-title { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
    .formulario-label { color: #2980b9; font-weight: 700; font-size: 12px; margin-bottom: 3px; }
    .blue-line { border: none; border-top: 2px solid #2980b9; margin-bottom: 6px; }
    .image-section {
      flex: 1; min-height: 0;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .img-rotate-wrapper {
      display: flex; align-items: center; justify-content: center;
      width: 100%; height: 100%;
    }
    .img-rotate-wrapper img {
      max-width: 100%; max-height: 100%;
      object-fit: contain;
      border: 1px solid #ddd; border-radius: 4px;
      display: block;
    }
    .rot-90 { transform: rotate(90deg); }
    .rot-90 img { max-width: 90vh; max-height: 60vw; }
    .rot-180 { transform: rotate(180deg); }
    .rot-270 { transform: rotate(270deg); }
    .rot-270 img { max-width: 90vh; max-height: 60vw; }
    .obs-section { flex-shrink: 0; margin-top: 6px; }
    .obs-title { font-weight: 700; font-size: 11px; color: #555; margin-bottom: 3px; }
    .obs-line { border: none; border-top: 1px solid #aaa; margin-bottom: 6px; }
    .obs-content { display: flex; align-items: flex-start; gap: 8px; background: #f5f5f5; padding: 6px 10px; border-radius: 4px; font-size: 10px; }
    .obs-bar { width: 3px; min-height: 20px; background: #2c3e6b; border-radius: 2px; flex-shrink: 0; }
    .footer { flex-shrink: 0; margin-top: 6px; text-align: center; font-size: 9px; color: #888; border-top: 1px solid #eee; padding-top: 4px; }`;

    // Generate PDF in parallel batches for speed
    const BATCH_SIZE = 10;
    const CONCURRENCY = 3; // number of parallel browser tabs
    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
               '--disable-gpu', '--disable-extensions'],
      });

      // Split pages into batches
      const batches = [];
      for (let i = 0; i < pages.length; i += BATCH_SIZE) {
        batches.push(pages.slice(i, i + BATCH_SIZE));
      }

      // Process a single batch into a PDF buffer
      async function processBatch(batch) {
        const batchHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><style>${PAGE_CSS}</style></head><body>${batch.join('\n')}</body></html>`;
        const browserPage = await browser.newPage();
        await browserPage.setContent(batchHtml, { waitUntil: 'domcontentloaded', timeout: 120000 });
        const pdfBytes = await browserPage.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
        await browserPage.close();
        return pdfBytes;
      }

      // Process batches with limited concurrency
      const pdfBuffers = new Array(batches.length);
      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        const chunk = batches.slice(i, i + CONCURRENCY);
        const results = await Promise.all(chunk.map((b) => processBatch(b)));
        results.forEach((buf, j) => { pdfBuffers[i + j] = buf; });
      }

      // Merge all PDF buffers in order
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const doc = await PDFDocument.load(buf);
        const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
        for (const pg of copiedPages) mergedPdf.addPage(pg);
      }

      const finalPdf = await mergedPdf.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="informe-${assignment.id}.pdf"`);
      return res.send(Buffer.from(finalPdf));
    } finally {
      if (browser) await browser.close();
    }
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/assignments/:assignmentId/report/:rowIndex — PDF individual de una fila
router.get('/assignments/:assignmentId/report/:rowIndex', authMiddleware, async (req, res) => {
  try {
    const { assignmentId, rowIndex } = req.params;
    const rn = Number(rowIndex);
    const noReclamar = req.query.noReclamar === '1';

    const assignResult = await pool.query(`SELECT * FROM assignments WHERE id = $1`, [assignmentId]);
    if (assignResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const assignment = assignResult.rows[0];

    // Search across all sibling assignments (same filters) for the evidence
    const siblingIds = await pool.query(
      `SELECT id FROM assignments WHERE filters = $1::jsonb`,
      [JSON.stringify(assignment.filters)]
    );
    const allIds = siblingIds.rows.map((r) => r.id);
    if (!allIds.includes(Number(assignmentId))) allIds.push(Number(assignmentId));

    const evResult = await pool.query(
      `SELECT DISTINCT ON (row_index) * FROM evidences
       WHERE assignment_id = ANY($1) AND row_index = $2 AND status = 'uploaded'
       ORDER BY row_index, updated_at DESC`,
      [allIds, rn]
    );
    if (evResult.rows.length === 0) return res.status(404).json({ error: 'No hay evidencia para esta fila' });
    const ev = evResult.rows[0];

    // Get row_data directly from csv_rows using csv_row_id (stable key)
    let row;
    if (ev.csv_row_id) {
      const csvRow = await pool.query(`SELECT row_data FROM csv_rows WHERE id = $1`, [ev.csv_row_id]);
      if (csvRow.rows.length === 0) return res.status(404).json({ error: 'Fila no encontrada' });
      row = csvRow.rows[0].row_data;
    } else {
      return res.status(404).json({ error: 'Evidencia sin referencia a fila CSV' });
    }

    const now = new Date();
    const tzOpts = { timeZone: 'America/Bogota' };
    const fecha = now.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', ...tzOpts });
    const corp = (row.nomCorporacion || '').toUpperCase().includes('SENADO') ? 'SENADO' : 'CÁMARA';
    const dif = Number(row['Diferencia'] || 0);
    const title = noReclamar
      ? `INVESTIGACIÓN - ${corp} 2026`
      : dif < 0 ? `RECLAMACIÓN POR FALTA DE VOTOS - ${corp} 2026`
      : dif === 0 ? `RECLAMACIÓN POR VOTACIÓN EN CERO - ${corp} 2026`
      : `RECLAMACIÓN POR EXCESO DE VOTOS - ${corp} 2026`;
    const difColor = dif < 0 ? '#c0392b' : dif > 0 ? '#27ae60' : '#e67e22';
    const difLabel = dif < 0 ? `<span style="color:${difColor};font-weight:700">${dif} (Falta de votos)</span>`
      : dif === 0 ? `<span style="color:${difColor};font-weight:700">0 (Cero)</span>`
      : `<span style="color:${difColor};font-weight:700">+${dif} (Exceso de votos)</span>`;
    const escapeHtml = (str) => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const rotation = [0, 90, 180, 270].includes(ev.rotation) ? ev.rotation : 0;

    const noReclamarBanner = noReclamar
      ? `<div style="background:#c0392b;color:#fff;text-align:center;padding:8px 0;font-size:20px;font-weight:900;letter-spacing:1px;border-radius:4px;margin-bottom:8px;">OJO — NO ES RECLAMACIÓN — PARA CUIDAR</div>`
      : '';

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #222; background: #fff; }
  .page {
    width: 210mm; height: 297mm;
    padding: 12mm 14mm 10mm 14mm;
    page-break-after: always;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .page:last-child { page-break-after: avoid; }
  .header-section { flex-shrink: 0; }
  .report-title { font-size: 16px; font-weight: 900; text-align: center; color: #1a2744; letter-spacing: 0.5px; margin-bottom: 6px; }
  .title-line { border: none; border-top: 2px solid #1a2744; margin-bottom: 6px; }
  .date-row { text-align: right; font-size: 10px; color: #555; margin-bottom: 8px; }
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; table-layout: fixed; }
  .info-table th { background: #2c3e6b; color: #fff; padding: 4px 3px; text-align: center; font-size: 9px; border: 1px solid #2c3e6b; word-wrap: break-word; }
  .info-table td { padding: 5px 3px; text-align: center; border: 1px solid #ccc; font-size: 9px; vertical-align: middle; word-wrap: break-word; }
  .section-title { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
  .formulario-label { color: #2980b9; font-weight: 700; font-size: 12px; margin-bottom: 3px; }
  .blue-line { border: none; border-top: 2px solid #2980b9; margin-bottom: 6px; }
  .image-section {
    flex: 1; min-height: 0;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .img-rotate-wrapper {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 100%;
  }
  .img-rotate-wrapper img {
    max-width: 100%; max-height: 100%;
    object-fit: contain;
    border: 1px solid #ddd; border-radius: 4px;
    display: block;
  }
  .rot-90 { transform: rotate(90deg); }
  .rot-90 img { max-width: 90vh; max-height: 60vw; }
  .rot-180 { transform: rotate(180deg); }
  .rot-270 { transform: rotate(270deg); }
  .rot-270 img { max-width: 90vh; max-height: 60vw; }
  .obs-section { flex-shrink: 0; margin-top: 6px; }
  .obs-title { font-weight: 700; font-size: 11px; color: #555; margin-bottom: 3px; }
  .obs-line { border: none; border-top: 1px solid #aaa; margin-bottom: 6px; }
  .obs-content { display: flex; align-items: flex-start; gap: 8px; background: #f5f5f5; padding: 6px 10px; border-radius: 4px; font-size: 10px; }
  .obs-bar { width: 3px; min-height: 20px; background: #2c3e6b; border-radius: 2px; flex-shrink: 0; }
  .footer { flex-shrink: 0; margin-top: 6px; text-align: center; font-size: 9px; color: #888; border-top: 1px solid #eee; padding-top: 4px; }
</style></head><body>
<div class="page">
  <div class="header-section">
    ${noReclamarBanner}
    <h1 class="report-title">${escapeHtml(title)}</h1>
    <hr class="title-line"/>
    <div class="date-row">Fecha: ${fecha}</div>
    <table class="info-table"><thead><tr>
      <th>Departamento</th><th>Municipio</th><th>Zona</th><th>Puesto</th><th>Mesa</th>
      <th>Partido</th><th>Candidato</th><th>E14</th><th>Votos Escrutinio<br/>(MMV)</th><th>Diferencia</th>
    </tr></thead><tbody><tr>
      <td>${escapeHtml(row.nomDepartamento)}</td><td>${escapeHtml(row.nomMunicipio)}</td>
      <td>${escapeHtml(row.zona)}</td><td>${escapeHtml(row.nomPuesto)}</td><td>${escapeHtml(row.mesa)}</td>
      <td>${escapeHtml(row.nomLista)}</td><td>${escapeHtml(row.candidato)}</td>
      <td>${escapeHtml(row['Votos E14'])}</td><td>${escapeHtml(row['Votos MMV'])}</td><td>${difLabel}</td>
    </tr></tbody></table>
    <div class="section-title">1. Evidencias Documentales</div>
    <div class="formulario-label">Formulario E-14</div>
    <hr class="blue-line"/>
  </div>
  <div class="image-section">
    <div class="img-rotate-wrapper rot-${rotation}"><img src="${ev.image_data}" alt="Formulario E-14"/></div>
  </div>
  ${ev.observations ? `<div class="obs-section"><div class="obs-title">Observaciones</div><hr class="obs-line"/>
  <div class="obs-content"><div class="obs-bar"></div><span>${escapeHtml(ev.observations)}</span></div></div>` : ''}
  <div class="footer">Documento generado por Auditoría Escrutinio Congreso 2026 — ${now.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</div>
</div>
${ev.image_data_e24 ? (() => {
  const rotE24 = [0, 90, 180, 270].includes(ev.rotation_e24) ? ev.rotation_e24 : 0;
  return `<div class="page">
  <div class="header-section">
    ${noReclamarBanner}
    <h1 class="report-title">${escapeHtml(title)}</h1>
    <hr class="title-line"/>
    <div class="date-row">Fecha: ${fecha}</div>
    <table class="info-table"><thead><tr>
      <th>Departamento</th><th>Municipio</th><th>Zona</th><th>Puesto</th><th>Mesa</th>
      <th>Partido</th><th>Candidato</th><th>E14</th><th>Votos Escrutinio<br/>(MMV)</th><th>Diferencia</th>
    </tr></thead><tbody><tr>
      <td>${escapeHtml(row.nomDepartamento)}</td><td>${escapeHtml(row.nomMunicipio)}</td>
      <td>${escapeHtml(row.zona)}</td><td>${escapeHtml(row.nomPuesto)}</td><td>${escapeHtml(row.mesa)}</td>
      <td>${escapeHtml(row.nomLista)}</td><td>${escapeHtml(row.candidato)}</td>
      <td>${escapeHtml(row['Votos E14'])}</td><td>${escapeHtml(row['Votos MMV'])}</td><td>${difLabel}</td>
    </tr></tbody></table>
    <div class="section-title">1. Evidencias Documentales</div>
    <div class="formulario-label">Formulario E-24</div>
    <hr class="blue-line"/>
  </div>
  <div class="image-section">
    <div class="img-rotate-wrapper rot-${rotE24}"><img src="${ev.image_data_e24}" alt="Formulario E-24"/></div>
  </div>
  <div class="footer">Documento generado por Auditoría Escrutinio Congreso 2026 — ${now.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</div>
</div>`;
})() : ''}
</body></html>`;

    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const browserPage = await browser.newPage();
      await browserPage.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const pdfBuffer = await browserPage.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="evidencia-fila-${rn}.pdf"`);
      return res.send(Buffer.from(pdfBuffer));
    } finally {
      if (browser) await browser.close();
    }
  } catch (err) {
    console.error('Single row report error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ---- Shared helpers for CSV / Excel export ----
const EXPORT_COLUMNS = [
  { field: 'nomCorporacion', label: 'Corporacion' },
  { field: 'codDepartamento', label: 'Cod. Depto' },
  { field: 'nomDepartamento', label: 'Departamento' },
  { field: 'codMunicipio', label: 'Cod. Municipio' },
  { field: 'nomMunicipio', label: 'Municipio' },
  { field: 'zona', label: 'Zona' },
  { field: 'codPuesto', label: 'Cod. Puesto' },
  { field: 'nomPuesto', label: 'Puesto' },
  { field: 'mesa', label: 'Mesa' },
  { field: 'codLista', label: 'Cod. Lista' },
  { field: 'nomLista', label: 'Partido' },
  { field: 'codCandidato', label: 'Cod. Candidato' },
  { field: 'candidato', label: 'Candidato' },
  { field: 'Votos E14', label: 'Votos E14' },
  { field: 'Votos MMV', label: 'Votos MMV' },
  { field: 'Diferencia', label: 'Diferencia' },
];

function escapeCsvCell(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

async function getAssignmentRows(assignmentId, { applyRange = true } = {}) {
  const assignResult = await pool.query(`SELECT * FROM assignments WHERE id = $1`, [assignmentId]);
  if (assignResult.rows.length === 0) return null;
  const assignment = assignResult.rows[0];

  const filters = Array.isArray(assignment.filters) ? assignment.filters : [assignment.filters];
  const unionParts = [];
  const allValues = [];
  let p = 1;

  for (const block of filters) {
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
    unionParts.push(`SELECT row_data, row_index FROM csv_rows WHERE ${where}`);
  }

  const combined = unionParts.join(' UNION ');
  const numbered = `SELECT *, ROW_NUMBER() OVER (ORDER BY row_index) AS rn FROM (${combined}) AS combined`;

  let rangeFilter = '';
  if (applyRange && assignment.range_from && assignment.range_to) {
    rangeFilter = ` WHERE rn >= $${p} AND rn <= $${p + 1}`;
    allValues.push(assignment.range_from, assignment.range_to);
  }

  const result = await pool.query(
    `SELECT row_data FROM (${numbered}) AS numbered${rangeFilter} ORDER BY row_index`,
    allValues
  );
  return { assignment, rows: result.rows.map((r) => r.row_data) };
}

// GET /api/assignments/:id/csv — Download assignment rows as CSV
router.get('/assignments/:id/csv', authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.rol === 'Administrador';
    const data = await getAssignmentRows(req.params.id, { applyRange: !isAdmin });
    if (!data) return res.status(404).json({ error: 'Not found' });

    const BOM = '\uFEFF';
    const sep = ';';
    const header = EXPORT_COLUMNS.map((c) => c.label).join(sep);
    const lines = data.rows.map((r) =>
      EXPORT_COLUMNS.map((c) => escapeCsvCell(r[c.field])).join(sep)
    );
    const csv = BOM + header + '\n' + lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="asignacion-${req.params.id}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Assignment CSV error:', err);
    res.status(500).json({ error: 'Failed to generate CSV' });
  }
});

// GET /api/assignments/:id/excel — Download assignment rows as Excel
router.get('/assignments/:id/excel', authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.rol === 'Administrador';
    const data = await getAssignmentRows(req.params.id, { applyRange: !isAdmin });
    if (!data) return res.status(404).json({ error: 'Not found' });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Datos');

    sheet.columns = EXPORT_COLUMNS.map((c) => ({
      header: c.label,
      key: c.field,
      width: c.field === 'candidato' || c.field === 'nomPuesto' ? 25 : 15,
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E6B' } };
    headerRow.alignment = { horizontal: 'center' };

    for (const row of data.rows) {
      sheet.addRow(row);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="asignacion-${req.params.id}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Assignment Excel error:', err);
    res.status(500).json({ error: 'Failed to generate Excel' });
  }
});

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
