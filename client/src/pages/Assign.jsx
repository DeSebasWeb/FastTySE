import { useState, useEffect, useCallback } from 'react';
import NavBar from '../components/NavBar.jsx';
import FilterBar from '../components/FilterBar.jsx';
import FilteredTable from '../components/FilteredTable.jsx';
import { getFilterOptions, getDashboardRows, getMultiRows, getAnalysts, createAssignments } from '../lib/api.js';
import styles from './Assign.module.css';

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
    if (q.filters.diferencia) parts.push(q.filters.diferencia === 'ganando' ? 'Gan.' : 'Perd.');
    return parts.join(' ');
  }).filter(Boolean);

  let label = shared.join(' / ');
  if (unique.length > 0 && unique.some((u) => u)) {
    // Show max 2 unique parts, then "+ N más"
    const shown = unique.slice(0, 2);
    const rest = unique.length - shown.length;
    label += ' — ' + shown.join(', ');
    if (rest > 0) label += ` +${rest} más`;
  }
  return label || 'Todos los datos';
}

export default function Assign() {
  const [filters, setFiltersState] = useState(EMPTY_FILTERS);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);

  const [queue, setQueue] = useState([]);

  const [analysts, setAnalysts] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [userRanges, setUserRanges] = useState({});
  const [assigning, setAssigning] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [doneAssignments, setDoneAssignments] = useState([]);

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
    setPage(1);
  }, []);

  useEffect(() => {
    getFilterOptions(apiFilters()).then(setOptions).catch(console.error);
  }, [filters.nomCorporacion, filters.nomDepartamento, filters.nomMunicipio]);

  useEffect(() => {
    setLoadingRows(true);

    if (queue.length > 0) {
      const blocks = queue.map((q) => q.filters);
      getMultiRows(blocks, page, 100, { excludeWithEvidence: hideCompleted })
        .then((data) => {
          setRows(data.rows);
          setTotalPages(data.pagination.totalPages);
          setTotal(data.pagination.total);
        })
        .catch(console.error)
        .finally(() => setLoadingRows(false));
    } else {
      getDashboardRows(apiFilters(), page, { excludeWithEvidence: hideCompleted })
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
      filters.nomCandidato, filters.diferencia, page, hideCompleted]);

  useEffect(() => {
    getAnalysts().then(setAnalysts).catch(console.error);
  }, []);

  // Redistribute ranges when total changes
  useEffect(() => {
    if (selectedUsers.size > 0) {
      setUserRanges(distributeRanges(selectedUsers));
    }
  }, [total]);

  function handleAddToQueue() {
    const snapshot = { ...filters };
    const label = buildLabel(snapshot);
    setQueue((prev) => [...prev, { filters: snapshot, label, id: Date.now() }]);
    setFiltersState((prev) => ({ ...prev, nomLista: null, nomCandidato: null }));
    setPage(1);
  }

  function removeFromQueue(id) {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }

  // Recalculate equitable ranges whenever selectedUsers changes
  function distributeRanges(userIds) {
    if (userIds.size === 0 || total === 0) return {};
    const ids = [...userIds];
    const perUser = Math.floor(total / ids.length);
    const remainder = total % ids.length;
    const ranges = {};
    let start = 1;
    for (let i = 0; i < ids.length; i++) {
      const extra = i < remainder ? 1 : 0;
      const end = start + perUser + extra - 1;
      ranges[ids[i]] = { from: start, to: end };
      start = end + 1;
    }
    return ranges;
  }

  function toggleUser(user) {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(user.id)) {
        next.delete(user.id);
      } else {
        next.add(user.id);
      }
      setUserRanges(distributeRanges(next));
      return next;
    });
  }

  function setRange(userId, field, value) {
    setUserRanges((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: Number(value) || 0 },
    }));
  }

  async function handleAssign() {
    if (selectedUsers.size === 0 || queue.length === 0) return;
    setAssigning(true);
    try {
      const users = analysts.filter((a) => selectedUsers.has(a.id));
      const allBlocks = queue.map((q) => q.filters);
      const label = autoLabel;

      // ONE assignment per user, with ALL filter blocks combined
      const usersWithRanges = users.map((u) => ({
        ...u,
        rangeFrom: userRanges[u.id]?.from || 1,
        rangeTo: userRanges[u.id]?.to || total,
      }));
      await createAssignments(usersWithRanges, allBlocks, label);

      setDoneAssignments((prev) => [
        ...prev,
        {
          label,
          users: users.map((u) => {
            const r = userRanges[u.id];
            return `${u.nombres} ${u.apellidos} (${r?.from || 1}-${r?.to || total})`;
          }),
          ts: Date.now(),
        },
      ]);
      setQueue([]);
      setSelectedUsers(new Set());
      setUserRanges({});
    } catch (err) {
      console.error('Assign error:', err);
    } finally {
      setAssigning(false);
    }
  }

  const hasActiveFilter = Object.values(filters).some((v) => v != null);

  return (
    <div className={styles.page}>
      <NavBar />
      <main className={styles.main}>
        <h2 className={styles.title}>Asignar a Analistas</h2>

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
              <button
                className={hideCompleted ? styles.hideCompletedActive : styles.hideCompletedBtn}
                onClick={() => { setHideCompleted((v) => !v); setPage(1); }}
              >
                {hideCompleted ? 'Mostrando solo pendientes' : 'Omitir realizadas'}
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

        <div className={styles.assignSection}>
          <h3 className={styles.sectionTitle}>Seleccionar Analistas</h3>
          <div className={styles.userList}>
            {analysts.map((a) => (
              <div key={a.id} className={styles.userRow}>
                <label className={styles.userItem}>
                  <input
                    type="checkbox"
                    checked={selectedUsers.has(a.id)}
                    onChange={() => toggleUser(a)}
                  />
                  <span>{a.nombres} {a.apellidos}</span>
                  <span className={styles.cedula}>{a.cedula}</span>
                </label>
                {selectedUsers.has(a.id) && (
                  <div className={styles.rangeInputs}>
                    <label className={styles.rangeLabel}>
                      Desde
                      <input
                        type="number"
                        min={1}
                        max={total}
                        value={userRanges[a.id]?.from || 1}
                        onChange={(e) => setRange(a.id, 'from', e.target.value)}
                        className={styles.rangeInput}
                      />
                    </label>
                    <label className={styles.rangeLabel}>
                      Hasta
                      <input
                        type="number"
                        min={1}
                        max={total}
                        value={userRanges[a.id]?.to || total}
                        onChange={(e) => setRange(a.id, 'to', e.target.value)}
                        className={styles.rangeInput}
                      />
                    </label>
                    <span className={styles.rangeCount}>
                      ({Math.max(0, (userRanges[a.id]?.to || total) - (userRanges[a.id]?.from || 1) + 1)} filas)
                    </span>
                  </div>
                )}
              </div>
            ))}
            {analysts.length === 0 && (
              <p className={styles.empty}>No hay analistas disponibles</p>
            )}
          </div>

          <button
            className={styles.assignBtn}
            onClick={handleAssign}
            disabled={selectedUsers.size === 0 || queue.length === 0 || assigning}
          >
            {assigning
              ? 'Asignando...'
              : `Asignar a ${selectedUsers.size} analista(s)`}
          </button>

          {doneAssignments.length > 0 && (
            <div className={styles.doneList}>
              <h4 className={styles.doneTitle}>Asignaciones realizadas</h4>
              {doneAssignments.map((d) => (
                <div key={d.ts} className={styles.doneTag}>
                  <span className={styles.doneLabel}>{d.label}</span>
                  <span className={styles.doneUsers}>{d.users.join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
