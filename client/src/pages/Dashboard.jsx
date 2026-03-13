import { useState, useEffect, useCallback } from 'react';
import NavBar from '../components/NavBar.jsx';
import StatsCards from '../components/StatsCards.jsx';
import FilterBar from '../components/FilterBar.jsx';
import FilteredTable from '../components/FilteredTable.jsx';
import {
  getDashboardStats, getFilterOptions, getDashboardRows, getMultiRows,
} from '../lib/api.js';
import styles from './Dashboard.module.css';

const EMPTY_FILTERS = {
  nomCorporacion: null,
  nomDepartamento: null,
  nomMunicipio: null,
  zona: null,
  codPuesto: null,
  mesa: null,
  nomLista: null,
  nomCandidato: null,
  diferencia: null,
};

const EMPTY_OPTIONS = {
  corporaciones: [], departamentos: [], municipios: [],
  zonas: [], puestos: [], mesas: [], listas: [],
};

function buildLabel(filters) {
  const parts = [];
  if (filters.nomCorporacion) parts.push(filters.nomCorporacion);
  if (filters.nomDepartamento) parts.push(filters.nomDepartamento);
  if (filters.nomMunicipio) parts.push(filters.nomMunicipio);
  if (filters.nomLista) parts.push(filters.nomLista);
  if (filters.nomCandidato) parts.push(filters.nomCandidato);
  if (filters.diferencia) parts.push(filters.diferencia === 'ganando' ? 'Ganando' : 'Perdiendo');
  return parts.length > 0 ? parts.join(' / ') : 'Todos';
}

function buildCombinedLabel(queue) {
  if (queue.length === 0) return 'Sin filtros';
  const first = queue[0].filters;
  const shared = [first.nomCorporacion, first.nomDepartamento, first.nomMunicipio].filter(Boolean);
  const unique = queue.map((q) => {
    const parts = [];
    if (q.filters.nomLista) parts.push(q.filters.nomLista);
    if (q.filters.nomCandidato) parts.push(q.filters.nomCandidato);
    if (q.filters.diferencia) parts.push(q.filters.diferencia === 'ganando' ? 'Ganando' : 'Perdiendo');
    return parts.join(' ');
  }).filter(Boolean);

  let label = shared.join(' / ');
  if (unique.length > 0 && unique.some((u) => u)) {
    label += ' — ' + unique.join(', ');
  }
  return label || 'Todos los datos';
}

export default function Dashboard() {
  const [filters, setFiltersState] = useState(EMPTY_FILTERS);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [stats, setStats] = useState({});
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);

  const [queue, setQueue] = useState([]);
  const [downloading, setDownloading] = useState(false);

  const queueKey = queue.map((q) => q.id).join(',');
  const autoLabel = queue.length > 0 ? buildCombinedLabel(queue) : '';

  function apiFilters() {
    const f = { ...filters };
    delete f.diferencia;
    return f;
  }

  const setFilter = useCallback((key, value) => {
    setFiltersState((prev) => {
      const next = { ...prev, [key]: value || null };
      if (key === 'nomCorporacion') {
        next.nomDepartamento = null; next.nomMunicipio = null;
        next.zona = null; next.codPuesto = null; next.mesa = null;
      }
      if (key === 'nomDepartamento') {
        next.nomMunicipio = null; next.zona = null; next.codPuesto = null; next.mesa = null;
      }
      if (key === 'nomMunicipio') {
        next.zona = null; next.codPuesto = null; next.mesa = null;
      }
      return next;
    });
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(EMPTY_FILTERS);
    setQueue([]);
    setPage(1);
  }, []);

  // Fetch filter options
  useEffect(() => {
    getFilterOptions(apiFilters()).then(setOptions).catch(console.error);
  }, [filters.nomCorporacion, filters.nomDepartamento, filters.nomMunicipio]);

  // Fetch stats
  useEffect(() => {
    let cancelled = false;
    setLoadingStats(true);
    const statsFilters = queue.length > 0 ? queue[0].filters : apiFilters();
    getDashboardStats(statsFilters)
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoadingStats(false); });
    return () => { cancelled = true; };
  }, [queueKey, filters.nomCorporacion, filters.nomDepartamento, filters.nomMunicipio,
      filters.zona, filters.codPuesto, filters.mesa, filters.nomLista, filters.nomCandidato]);

  // Fetch rows
  useEffect(() => {
    setLoadingRows(true);

    if (queue.length > 0) {
      const blocks = queue.map((q) => q.filters);
      getMultiRows(blocks, page)
        .then((data) => {
          setRows(data.rows);
          setTotalPages(data.pagination.totalPages);
          setTotal(data.pagination.total);
        })
        .catch(console.error)
        .finally(() => setLoadingRows(false));
    } else {
      getDashboardRows(apiFilters(), page)
        .then((data) => {
          let filtered = data.rows;
          if (filters.diferencia === 'ganando') {
            filtered = filtered.filter((r) => Number(r['Diferencia']) > 0);
          } else if (filters.diferencia === 'perdiendo') {
            filtered = filtered.filter((r) => Number(r['Diferencia']) < 0);
          }
          setRows(filtered);
          setTotalPages(data.pagination.totalPages);
          setTotal(data.pagination.total);
        })
        .catch(console.error)
        .finally(() => setLoadingRows(false));
    }
  }, [queueKey, filters.nomCorporacion, filters.nomDepartamento, filters.nomMunicipio,
      filters.zona, filters.codPuesto, filters.mesa, filters.nomLista,
      filters.nomCandidato, filters.diferencia, page]);

  function handleAddToQueue() {
    const snapshot = { ...filters };
    const label = buildLabel(snapshot);
    setQueue((prev) => [...prev, { filters: snapshot, label, id: Date.now() }]);
    setFiltersState((prev) => ({ ...prev, nomLista: null, nomCandidato: null, diferencia: null }));
    setPage(1);
  }

  function removeFromQueue(id) {
    setQueue((prev) => prev.filter((q) => q.id !== id));
    setPage(1);
  }

  const hasActiveFilter = Object.values(filters).some((v) => v != null);
  const hasData = queue.length > 0 || hasActiveFilter;

  async function handleDownloadCsv() {
    setDownloading(true);
    try {
      const token = localStorage.getItem('token');
      let url;
      let fetchOpts;

      if (queue.length > 0) {
        const blocks = queue.map((q) => q.filters);
        url = `${import.meta.env.BASE_URL}api/dashboard/multi-rows/csv`;
        fetchOpts = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ blocks }),
        };
      } else {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(apiFilters())) {
          if (v != null && v !== '') params.set(k, v);
        }
        if (filters.diferencia) params.set('diferencia', filters.diferencia);
        url = `${import.meta.env.BASE_URL}api/dashboard/rows/csv?${params.toString()}`;
        fetchOpts = {
          headers: { Authorization: `Bearer ${token}` },
        };
      }

      const res = await fetch(url, fetchOpts);
      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `datos_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadExcel() {
    setDownloading(true);
    try {
      const token = localStorage.getItem('token');
      let url;
      let fetchOpts;

      if (queue.length > 0) {
        const blocks = queue.map((q) => q.filters);
        url = `${import.meta.env.BASE_URL}api/dashboard/multi-rows/excel`;
        fetchOpts = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ blocks }),
        };
      } else {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(apiFilters())) {
          if (v != null && v !== '') params.set(k, v);
        }
        if (filters.diferencia) params.set('diferencia', filters.diferencia);
        url = `${import.meta.env.BASE_URL}api/dashboard/rows/excel?${params.toString()}`;
        fetchOpts = {
          headers: { Authorization: `Bearer ${token}` },
        };
      }

      const res = await fetch(url, fetchOpts);
      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `datos_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error('Excel download error:', err);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={styles.page}>
      <NavBar />
      <main className={styles.main}>
        <StatsCards stats={stats} loading={loadingStats} />

        <FilterBar
          filters={filters}
          options={options}
          setFilter={setFilter}
          clearFilters={clearFilters}
          extraFilters={
            <>
              <select
                value={filters.diferencia || ''}
                onChange={(e) => setFilter('diferencia', e.target.value)}
                className={styles.select}
              >
                <option value="">Diferencia</option>
                <option value="ganando">Ganando votos</option>
                <option value="perdiendo">Perdiendo votos</option>
              </select>
              <button
                className={styles.addBtn}
                onClick={handleAddToQueue}
                disabled={!hasActiveFilter}
              >
                + Agregar filtro
              </button>
            </>
          }
        />

        {queue.length > 0 && (
          <div className={styles.queueSection}>
            <h4 className={styles.queueTitle}>{autoLabel}</h4>
            <div className={styles.queueList}>
              {queue.map((q) => (
                <div key={q.id} className={styles.queueTag}>
                  <span className={styles.queueLabel}>{q.label}</span>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeFromQueue(q.id)}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles.tableHeader}>
          {hasData && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className={styles.downloadBtn}
                onClick={handleDownloadCsv}
                disabled={downloading}
              >
                {downloading ? 'Descargando...' : 'Descargar CSV'}
              </button>
              <button
                className={styles.downloadBtn}
                onClick={handleDownloadExcel}
                disabled={downloading}
                style={{ background: '#2980b9' }}
              >
                {downloading ? 'Descargando...' : 'Descargar Excel'}
              </button>
            </div>
          )}
        </div>

        <FilteredTable
          rows={rows}
          page={page}
          totalPages={totalPages}
          total={total}
          loading={loadingRows}
          setPage={setPage}
          highlightDiferencia
          showIndex
        />
      </main>
    </div>
  );
}
