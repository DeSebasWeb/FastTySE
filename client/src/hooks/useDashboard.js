import { useState, useEffect, useCallback, useRef } from 'react';
import { getDashboardStats, getFilterOptions, getDashboardRows } from '../lib/api.js';

const EMPTY_FILTERS = {
  nomCorporacion: null,
  nomDepartamento: null,
  nomMunicipio: null,
  zona: null,
  codPuesto: null,
  mesa: null,
  nomLista: null,
  nomCandidato: null,
};

const EMPTY_OPTIONS = {
  corporaciones: [],
  departamentos: [],
  municipios: [],
  zonas: [],
  puestos: [],
  mesas: [],
  listas: [],
};

export function useDashboard() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [stats, setStats] = useState({});
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);

  // Debounce ref for nomLista
  const listaTimer = useRef(null);
  const [debouncedFilters, setDebouncedFilters] = useState(EMPTY_FILTERS);

  // Debounce nomLista, pass others immediately
  useEffect(() => {
    if (listaTimer.current) clearTimeout(listaTimer.current);
    listaTimer.current = setTimeout(() => {
      setDebouncedFilters(filters);
    }, (filters.nomLista !== debouncedFilters.nomLista || filters.nomCandidato !== debouncedFilters.nomCandidato) ? 300 : 0);
    return () => clearTimeout(listaTimer.current);
  }, [filters]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedFilters]);

  // Fetch stats
  useEffect(() => {
    let cancelled = false;
    setLoadingStats(true);
    getDashboardStats(debouncedFilters)
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoadingStats(false); });
    return () => { cancelled = true; };
  }, [debouncedFilters]);

  // Fetch filter options
  useEffect(() => {
    let cancelled = false;
    getFilterOptions(debouncedFilters)
      .then((data) => { if (!cancelled) setOptions(data); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [debouncedFilters]);

  // Fetch rows
  useEffect(() => {
    let cancelled = false;
    setLoadingRows(true);
    getDashboardRows(debouncedFilters, page)
      .then((data) => {
        if (!cancelled) {
          setRows(data.rows);
          setTotalPages(data.pagination.totalPages);
          setTotal(data.pagination.total);
        }
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoadingRows(false); });
    return () => { cancelled = true; };
  }, [debouncedFilters, page]);

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value || null };
      // Cascade resets
      if (key === 'nomCorporacion') {
        next.nomDepartamento = null;
        next.nomMunicipio = null;
        next.zona = null;
        next.codPuesto = null;
        next.mesa = null;
      }
      if (key === 'nomDepartamento') {
        next.nomMunicipio = null;
        next.zona = null;
        next.codPuesto = null;
        next.mesa = null;
      }
      if (key === 'nomMunicipio') {
        next.zona = null;
        next.codPuesto = null;
        next.mesa = null;
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  return {
    filters,
    stats,
    options,
    rows,
    page,
    totalPages,
    total,
    loadingStats,
    loadingRows,
    setFilter,
    clearFilters,
    setPage,
  };
}
