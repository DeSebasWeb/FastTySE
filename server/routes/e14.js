import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import externalPool from '../db/externalPool.js';

const router = Router();

// In-memory cache for TOC mappings
let tocCache = null;
let tocFetchedAt = 0;
const TOC_TTL = 60 * 60 * 1000; // 1 hour

const CORP_MAP = {
  SENADO: 'SEN',
  CAMARA: 'CAM',
  CÁMARA: 'CAM',
  CONSULTA: 'CON',
  CON: 'CON',
  CNS: 'CON',
  CTP: 'CTP',
};

/**
 * POST /api/e14/auto-load
 * Auto-find and extract the E14 page for a given CSV row.
 */
router.post('/auto-load', authMiddleware, async (req, res) => {
  try {
    const { nomCorporacion, nomDepartamento, nomMunicipio, zona, nomPuesto, codPuesto, mesa, codLista } = req.body;

    console.log('[auto-load E14] input:', JSON.stringify({ nomCorporacion, nomDepartamento, nomMunicipio, zona, nomPuesto, codPuesto, mesa, codLista }));

    if (!nomDepartamento || !nomMunicipio || !mesa) {
      return res.json({ success: false, message: 'Datos insuficientes para buscar E14' });
    }

    // Step 1: Resolve text names → divipol codes via external DB
    const divipol = await resolveDivipol({ nomDepartamento, nomMunicipio, zona, nomPuesto, codPuesto, mesa });
    console.log('[auto-load E14] step1 divipol:', divipol ? JSON.stringify(divipol) : 'null');
    if (!divipol) {
      return res.json({ success: false, message: 'No se encontró la mesa en divipol' });
    }

    // Step 2: Find E14 in e14_index
    const corpKey = CORP_MAP[(nomCorporacion || '').toUpperCase().trim()] || 'SEN';
    const e14 = await findE14(divipol, corpKey);
    console.log('[auto-load E14] step2 e14:', e14 ? `found (${e14.fuente})` : 'null', 'corpKey:', corpKey);
    if (!e14) {
      return res.json({ success: false, message: 'No se encontró E14 para esta mesa' });
    }

    // Step 3: Determine page from TOC
    const codPartido = parseInt(codLista);
    console.log('[auto-load E14] step3 codPartido:', codPartido, 'from codLista:', codLista);
    let page = null;
    if (codPartido) {
      const toc = await getTocMappings();
      console.log('[auto-load E14] step3 toc loaded:', !!toc, toc ? `SEN:${toc.SEN?.length} CAM keys:${toc.CAM ? Object.keys(toc.CAM).length : 0}` : '');
      if (toc) {
        page = findPageInToc(toc, corpKey, divipol.coddepto, codPartido);
        console.log('[auto-load E14] step3 page:', page);
      }
    }

    if (!page) {
      return res.json({ success: false, message: 'E14 encontrado pero no se identificó la página del partido' });
    }

    // Step 4: Extract page as image via Auditor API
    const pathToken = Buffer.from(e14.ruta_archivo).toString('base64url');
    const imagen = await fetchPageImage(pathToken, page);
    if (!imagen) {
      return res.json({ success: false, message: 'Error extrayendo página del E14' });
    }

    return res.json({
      success: true,
      imagen_base64: imagen,
      fuente: e14.fuente,
      page,
      label: `Auto E14 — ${e14.fuente}, pág. ${page}`,
    });
  } catch (err) {
    console.error('[auto-load E14]', err.message, err.stack?.split('\n')[1]);
    return res.json({ success: false, message: 'Error interno buscando E14' });
  }
});

// ---- Helper functions ----

async function resolveDivipol({ nomDepartamento, nomMunicipio, zona, nomPuesto, codPuesto, mesa }) {
  // Build query dynamically based on available data
  // divipol_2026: coddepto(int), codmipio(int), codzona(int), codpuesto(varchar)
  // divipolmesa_2026: mesa(int)
  let query = `
    SELECT d.coddepto, d.codmipio, d.codzona, d.codpuesto, dm.idmesa, dm.mesa
    FROM divipol_2026 d
    JOIN divipolmesa_2026 dm ON dm.iddivipol = d.iddivipol
    WHERE d.clase = 'P'
      AND UPPER(d.nomdepto) = UPPER($1)
      AND UPPER(d.nommipio) = UPPER($2)
      AND dm.mesa = $3::int
  `;
  const params = [nomDepartamento.trim(), nomMunicipio.trim(), parseInt(mesa) || 0];

  // Filter by puesto: codpuesto is varchar in divipol_2026
  if (codPuesto && /^\d+$/.test(String(codPuesto).trim())) {
    query += ` AND d.codpuesto = LPAD($${params.length + 1}::text, 2, '0')`;
    params.push(String(codPuesto).trim());
  } else if (nomPuesto) {
    query += ` AND UPPER(d.nompuesto) LIKE UPPER($${params.length + 1})`;
    params.push(`%${nomPuesto.trim()}%`);
  }

  // Filter by zona: codzona is integer in divipol_2026
  if (zona && /^\d+$/.test(String(zona).trim())) {
    query += ` AND d.codzona = $${params.length + 1}::int`;
    params.push(parseInt(String(zona).trim()));
  }

  query += ' LIMIT 1';

  const { rows } = await externalPool.query(query, params);
  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    coddepto: String(r.coddepto).padStart(2, '0'),
    codmipio: String(r.codmipio).padStart(3, '0'),
    codzona: String(r.codzona).padStart(3, '0'),
    codpuesto: String(r.codpuesto).padStart(2, '0'),
    mesa: String(r.mesa).padStart(3, '0'),
    idmesa: r.idmesa,
  };
}

async function findE14(divipol, corpKey) {
  const { rows } = await externalPool.query(
    `SELECT ruta_archivo, fuente, corporacion
     FROM e14_index
     WHERE coddepto = $1 AND codmipio = $2 AND codzona = $3
       AND codpuesto = $4 AND mesa = $5
       AND corporacion = $6
     ORDER BY CASE fuente
       WHEN 'claveros' THEN 1
       WHEN 'delegados' THEN 2
       WHEN 'transmision' THEN 3
       ELSE 4
     END
     LIMIT 1`,
    [divipol.coddepto, divipol.codmipio, divipol.codzona, divipol.codpuesto, divipol.mesa, corpKey]
  );
  return rows[0] || null;
}

async function getTocMappings() {
  const now = Date.now();
  if (tocCache && now - tocFetchedAt < TOC_TTL) return tocCache;

  const auditorUrl = process.env.AUDITOR_BASE_URL;
  if (!auditorUrl) return null;

  try {
    const resp = await fetch(`${auditorUrl}/api/e14/toc-mappings`);
    if (!resp.ok) return tocCache || null;
    tocCache = await resp.json();
    tocFetchedAt = now;
    return tocCache;
  } catch (err) {
    console.warn('[TOC fetch]', err.message);
    return tocCache || null;
  }
}

function findPageInToc(toc, corpKey, coddepto, codPartido) {
  let entries = null;
  if (corpKey === 'CAM' && toc.CAM) {
    entries = toc.CAM[coddepto];
  } else {
    entries = toc[corpKey];
  }

  if (!entries) return null;

  for (const entry of entries) {
    if (entry.codpartidos && entry.codpartidos.includes(codPartido)) {
      return entry.page;
    }
  }
  return null;
}

async function fetchPageImage(pathToken, page) {
  const auditorUrl = process.env.AUDITOR_BASE_URL;
  if (!auditorUrl) return null;

  try {
    const resp = await fetch(
      `${auditorUrl}/api/e14/pagina-imagen?path_token=${encodeURIComponent(pathToken)}&page=${page}`,
      { signal: AbortSignal.timeout(30000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.success ? data.imagen_base64 : null;
  } catch (err) {
    console.warn('[Page image fetch]', err.message);
    return null;
  }
}

export default router;
