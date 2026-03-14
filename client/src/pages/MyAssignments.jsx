import { useState, useEffect, useMemo, useCallback } from 'react';
import NavBar from '../components/NavBar.jsx';
import FilteredTable from '../components/FilteredTable.jsx';
import EvidenceModal from '../components/EvidenceModal.jsx';
import {
  getAssignments, getMultiRows, getEvidences, getEvidenceDetail, saveEvidence, deleteEvidence,
  deleteAssignment, getAssignmentSiblings, getAnalysts, createAssignments,
  getAssignmentsProgress, toggleAssignmentComplete, batchLoadEvidenceDetails, batchRotateEvidences,
} from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
import styles from './MyAssignments.module.css';

export default function MyAssignments() {
  const { user } = useAuth();
  const isAdmin = user?.rol === 'Administrador';

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);

  // Evidence state
  const [evidences, setEvidences] = useState({});
  const [modalRow, setModalRow] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Admin: siblings + assign form
  const [siblings, setSiblings] = useState([]);
  const [analysts, setAnalysts] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [userRanges, setUserRanges] = useState({});
  const [assigning, setAssigning] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pending' | 'done' | 'no_evidence'
  const [selectedEvIds, setSelectedEvIds] = useState(new Set()); // row_index set for batch rotation
  const [batchRotating, setBatchRotating] = useState(false);
  const [progressData, setProgressData] = useState([]);

  // List view filters (analyst)
  const [viewMode, setViewMode] = useState('active'); // 'active' | 'completed' | 'all'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    getAssignments()
      .then(setAssignments)
      .catch(console.error)
      .finally(() => setLoading(false));
    if (isAdmin) {
      getAssignmentsProgress().then(setProgressData).catch(console.error);
    }
  }, []);

  // Load rows when an assignment is selected
  useEffect(() => {
    if (!selected) return;
    setLoadingRows(true);

    const rangeOpts = {};
    if (!isAdmin && selected.range_from && selected.range_to) {
      rangeOpts.rangeFrom = selected.range_from;
      rangeOpts.rangeTo = selected.range_to;
    }

    const blocks = Array.isArray(selected.filters) ? selected.filters : [selected.filters];

    Promise.all([
      getMultiRows(blocks, page, 100, rangeOpts),
      page === 1 ? getEvidences(selected.id, { siblings: isAdmin }) : Promise.resolve(null),
    ])
      .then(([data, evMap]) => {
        setRows(data.rows);
        setTotalPages(data.pagination.totalPages);
        setTotal(data.pagination.total);
        if (evMap) setEvidences(evMap);
      })
      .catch(console.error)
      .finally(() => setLoadingRows(false));
  }, [selected?.id, page]);

  // Load evidences when assignment changes, then prefetch image_data in background
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getEvidences(selected.id, { siblings: isAdmin }).then(async (evMap) => {
      if (cancelled) return;
      setEvidences(evMap);
      // Prefetch image_data in batches of 20 in background
      const needFetch = Object.values(evMap).filter((e) => e.id && e.status === 'uploaded' && !e.image_data);
      if (needFetch.length === 0) return;
      const BATCH = 20;
      for (let i = 0; i < needFetch.length; i += BATCH) {
        if (cancelled) return;
        const batch = needFetch.slice(i, i + BATCH);
        const ids = batch.map((e) => e.id);
        try {
          const details = await batchLoadEvidenceDetails(ids);
          if (cancelled) return;
          setEvidences((prev) => ({ ...prev, ...details }));
        } catch (err) {
          console.error('Prefetch batch error:', err);
        }
      }
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [selected?.id]);

  // Reset on assignment change
  useEffect(() => {
    setPage(1);
    setRows([]);
    setEvidences({});
    setSiblings([]);
    setSelectedUsers(new Set());
    setUserRanges({});
    setSelectedEvIds(new Set());
  }, [selected?.id]);

  // Admin: load siblings + analysts
  useEffect(() => {
    if (!selected || !isAdmin) return;
    getAssignmentSiblings(selected.id).then(setSiblings).catch(console.error);
    getAnalysts().then(setAnalysts).catch(console.error);
  }, [selected?.id, isAdmin]);

  function handleBack() {
    setSelected(null);
    setRows([]);
    setPage(1);
    setEvidences({});
    setSiblings([]);
  }

  // Toggle assignment completed status
  async function handleToggleComplete(e, id) {
    e.stopPropagation();
    try {
      const updated = await toggleAssignmentComplete(id);
      setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, completed_at: updated.completed_at } : a)));
    } catch (err) {
      console.error('Toggle complete error:', err);
    }
  }

  // Filter assignments for list view
  const filteredAssignments = useMemo(() => {
    let list = assignments;

    // For non-admin: filter by active/completed
    if (!isAdmin) {
      if (viewMode === 'active') list = list.filter((a) => !a.completed_at);
      else if (viewMode === 'completed') list = list.filter((a) => !!a.completed_at);
    }

    // Date filters
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      list = list.filter((a) => new Date(a.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter((a) => new Date(a.created_at) <= to);
    }

    return list;
  }, [assignments, viewMode, dateFrom, dateTo, isAdmin]);

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!confirm('¿Eliminar esta asignación?')) return;
    try {
      await deleteAssignment(id);
      setAssignments((prev) => prev.filter((a) => a.id !== id));
      if (selected?.id === id) handleBack();
    } catch (err) {
      console.error('Delete error:', err);
    }
  }

  async function handleDeleteSibling(id) {
    if (!confirm('¿Eliminar esta asignación?')) return;
    try {
      await deleteAssignment(id);
      setSiblings((prev) => prev.filter((s) => s.id !== id));
      setAssignments((prev) => prev.filter((a) => a.id !== id));
      if (selected?.id === id) handleBack();
    } catch (err) {
      console.error('Delete sibling error:', err);
    }
  }

  async function handleSaveEvidence({ status, imageData, rotation, observations }) {
    if (!modalRow || !selected) return;
    const result = await saveEvidence({
      assignmentId: selected.id,
      rowIndex: modalRow.rowIndex,
      status,
      imageData,
      rotation,
      observations,
    });
    setEvidences((prev) => ({ ...prev, [modalRow.rowIndex]: result }));
  }

  async function handleDeleteEvidence(evidenceId) {
    if (!modalRow) return;
    const { row_index } = await deleteEvidence(evidenceId);
    setEvidences((prev) => {
      const next = { ...prev };
      delete next[row_index];
      return next;
    });
  }

  // Open modal and lazy-load image_data if not already present
  async function openModal(rowIndex, row) {
    setModalRow({ rowIndex, row });
    const ev = evidences[rowIndex];
    if (ev && ev.id && !ev.image_data) {
      setLoadingDetail(true);
      try {
        const detail = await getEvidenceDetail(ev.id);
        setEvidences((prev) => ({ ...prev, [rowIndex]: detail }));
      } catch (err) {
        console.error('Load evidence detail error:', err);
      } finally {
        setLoadingDetail(false);
      }
    }
  }

  // --- Admin: assign remaining rows ---
  function computeAssignedRanges() {
    return siblings
      .filter((s) => s.range_from && s.range_to)
      .map((s) => ({ from: s.range_from, to: s.range_to, user: s.user_name, id: s.id }))
      .sort((a, b) => a.from - b.from);
  }

  function computeNextFrom() {
    const ranges = computeAssignedRanges();
    if (ranges.length === 0) return 1;
    return Math.max(...ranges.map((r) => r.to)) + 1;
  }

  function toggleUser(analyst) {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(analyst.id)) {
        next.delete(analyst.id);
        setUserRanges((r) => { const n = { ...r }; delete n[analyst.id]; return n; });
      } else {
        next.add(analyst.id);
        const nextFrom = computeNextFrom();
        setUserRanges((r) => ({ ...r, [analyst.id]: { from: nextFrom, to: total } }));
      }
      return next;
    });
  }

  function setRange(userId, field, value) {
    setUserRanges((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: Number(value) || 0 },
    }));
  }

  async function handleDownloadSinglePdf(assignmentId, rowIndex, { noReclamar = false } = {}) {
    try {
      const token = localStorage.getItem('token');
      const url = `${import.meta.env.BASE_URL}api/assignments/${assignmentId}/report/${rowIndex}${noReclamar ? '?noReclamar=1' : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        try { alert(JSON.parse(text).error); } catch { alert('Error generando PDF'); }
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = noReclamar ? `investigacion-fila-${rowIndex}.pdf` : `evidencia-fila-${rowIndex}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
      console.error('Single PDF error:', err);
      alert('Error generando PDF');
    }
  }

  async function handleGenerateReport({ noReclamar = false } = {}) {
    if (!selected) return;
    setGeneratingReport(true);
    try {
      const token = localStorage.getItem('token');
      const url = `${import.meta.env.BASE_URL}api/assignments/${selected.id}/report${noReclamar ? '?noReclamar=1' : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Error generando el informe');
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const prefix = noReclamar ? 'investigacion' : 'informe';
      a.download = `${prefix}-${selected.label.replace(/[^a-z0-9]/gi, '_')}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
      console.error('Report error:', err);
      alert('Error generando el informe');
    } finally {
      setGeneratingReport(false);
    }
  }

  async function handleDownloadFile(format) {
    if (!selected) return;
    try {
      const token = localStorage.getItem('token');
      const url = `${import.meta.env.BASE_URL}api/assignments/${selected.id}/${format}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const ext = format === 'excel' ? 'xlsx' : 'csv';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `asignacion-${selected.label.replace(/[^a-z0-9]/gi, '_')}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) {
      console.error(`Download ${format} error:`, err);
      alert(`Error descargando ${format.toUpperCase()}`);
    }
  }

  async function handleAssignMore() {
    if (selectedUsers.size === 0 || !selected) return;
    setAssigning(true);
    try {
      const users = analysts.filter((a) => selectedUsers.has(a.id));
      const blocks = Array.isArray(selected.filters) ? selected.filters : [selected.filters];

      const usersWithRanges = users.map((u) => ({
        ...u,
        rangeFrom: userRanges[u.id]?.from || 1,
        rangeTo: userRanges[u.id]?.to || total,
      }));

      await createAssignments(usersWithRanges, blocks, selected.label);

      const [newSiblings, newAssignments] = await Promise.all([
        getAssignmentSiblings(selected.id),
        getAssignments(),
      ]);
      setSiblings(newSiblings);
      setAssignments(newAssignments);
      setSelectedUsers(new Set());
      setUserRanges({});
    } catch (err) {
      console.error('Assign more error:', err);
    } finally {
      setAssigning(false);
    }
  }

  // Progress calculation
  const progress = useMemo(() => {
    if (!selected || total === 0) return { uploaded: 0, noEvidence: 0, pending: 0, total: 0, pct: 0 };
    const evValues = Object.values(evidences);
    const uploaded = evValues.filter((e) => e.status === 'uploaded').length;
    const noEvidence = evValues.filter((e) => e.status === 'no_evidence').length;
    const done = uploaded + noEvidence;
    return { uploaded, noEvidence, pending: total - done, total, pct: Math.round((done / total) * 100) };
  }, [evidences, total, selected]);

  // Filter rows by evidence status — preserve original global index
  // Use _rn (ROW_NUMBER from server) when available for correct global numbering
  const filteredRows = useMemo(() => {
    const pageStart = (page - 1) * 100 + 1;
    const tagged = rows.map((row, i) => ({ ...row, _globalIndex: row._rn ?? (pageStart + i) }));
    if (statusFilter === 'all') return tagged;
    return tagged.filter((row) => {
      const ev = evidences[row._globalIndex];
      if (statusFilter === 'pending') return !ev;
      if (statusFilter === 'done') return ev?.status === 'uploaded';
      if (statusFilter === 'no_evidence') return ev?.status === 'no_evidence';
      return true;
    });
  }, [rows, evidences, statusFilter, page]);

  // Navigate between rows in modal (respects active filter)
  const navigateModal = useCallback((direction) => {
    if (!modalRow || !selected || filteredRows.length === 0) return;
    const curIdx = filteredRows.findIndex((r) => r._globalIndex === modalRow.rowIndex);
    if (curIdx === -1) return;
    const nextIdx = curIdx + direction;
    if (nextIdx < 0 || nextIdx >= filteredRows.length) return;
    const nextRow = filteredRows[nextIdx];
    openModal(nextRow._globalIndex, nextRow);
  }, [modalRow, selected, filteredRows, evidences]);

  // Keyboard shortcuts for modal navigation
  useEffect(() => {
    if (!modalRow) return;
    function handleKey(e) {
      // Don't capture keys when user is typing in an input field
      if (e.target.matches('input, textarea, select, [contenteditable]')) {
        if (e.key === 'Escape') setModalRow(null);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateModal(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigateModal(1);
      } else if (e.key === 'Escape') {
        setModalRow(null);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [modalRow, navigateModal]);

  // Bulk mark as no_evidence
  async function handleBulkNoEvidence() {
    if (!selected) return;
    const pending = [];
    const pageStart = (page - 1) * 100 + 1;
    for (let i = 0; i < rows.length; i++) {
      const gi = rows[i]._rn ?? (pageStart + i);
      if (!evidences[gi]) pending.push(gi);
    }
    if (pending.length === 0) { alert('No hay filas pendientes en esta página'); return; }
    if (!confirm(`¿Marcar ${pending.length} filas como "Sin evidencia"?`)) return;
    for (const rowIndex of pending) {
      try {
        const result = await saveEvidence({ assignmentId: selected.id, rowIndex, status: 'no_evidence', imageData: null, rotation: 0, observations: null });
        setEvidences((prev) => ({ ...prev, [rowIndex]: result }));
      } catch (err) { console.error('Bulk no_evidence error:', err); }
    }
  }

  // Batch rotate selected evidences
  function toggleEvSelection(rowIndex) {
    setSelectedEvIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function selectAllPageEvidences() {
    const uploaded = filteredRows.filter((r) => evidences[r._globalIndex]?.status === 'uploaded');
    setSelectedEvIds(new Set(uploaded.map((r) => r._globalIndex)));
  }

  async function handleBatchRotate(rotation) {
    if (selectedEvIds.size === 0) return;
    const ids = [];
    for (const rowIndex of selectedEvIds) {
      const ev = evidences[rowIndex];
      if (ev?.id) ids.push(ev.id);
    }
    if (ids.length === 0) return;
    setBatchRotating(true);
    try {
      const updated = await batchRotateEvidences(ids, rotation);
      setEvidences((prev) => {
        const next = { ...prev };
        for (const u of updated) {
          if (next[u.row_index]) next[u.row_index] = { ...next[u.row_index], rotation: u.rotation };
        }
        return next;
      });
      setSelectedEvIds(new Set());
    } catch (err) {
      console.error('Batch rotate error:', err);
    } finally {
      setBatchRotating(false);
    }
  }

  // Extra columns: evidence status for both admin and analyst
  const extraColumns = useMemo(() => {
    if (!selected) return undefined;
    return [
      {
        id: '_evidence',
        header: 'Evidencia',
        cell: (info) => {
          const globalIndex = info.row.original._globalIndex ?? ((page - 1) * 100 + info.row.index + 1);
          const ev = evidences[globalIndex];

          if (isAdmin) {
            // Admin: status badge + click to view
            const label = ev?.status === 'uploaded'
              ? 'Hecho'
              : ev?.status === 'no_evidence'
              ? 'Sin evidencia'
              : 'Faltante';
            const color = ev?.status === 'uploaded'
              ? 'var(--success, #27ae60)'
              : ev?.status === 'no_evidence'
              ? 'var(--text-muted)'
              : 'var(--danger, #e74c3c)';

            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {ev?.status === 'uploaded' && (
                  <input
                    type="checkbox"
                    checked={selectedEvIds.has(globalIndex)}
                    onChange={() => toggleEvSelection(globalIndex)}
                    title="Seleccionar para rotación en lote"
                    style={{ cursor: 'pointer' }}
                  />
                )}
                <button
                  onClick={() => openModal(globalIndex, info.row.original)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color,
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '0.15rem 0',
                    textDecoration: ev?.status === 'uploaded' ? 'underline' : 'none',
                  }}
                >
                  {label}{ev?.rotation ? ` (${ev.rotation}°)` : ''}
                </button>
                {ev?.status === 'uploaded' && (
                  <>
                    <button
                      onClick={() => handleDownloadSinglePdf(selected.id, globalIndex)}
                      title="Descargar PDF individual"
                      style={{
                        background: '#2c3e6b',
                        color: '#fff',
                        border: 'none',
                        fontSize: '0.65rem',
                        padding: '0.15rem 0.4rem',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      PDF
                    </button>
                    <button
                      onClick={() => handleDownloadSinglePdf(selected.id, globalIndex, { noReclamar: true })}
                      title="PDF sin reclamación — solo investigación"
                      style={{
                        background: '#c0392b',
                        color: '#fff',
                        border: 'none',
                        fontSize: '0.6rem',
                        padding: '0.15rem 0.35rem',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        fontWeight: 700,
                      }}
                    >
                      NO RECLAMAR
                    </button>
                  </>
                )}
              </div>
            );
          }

          // Analyst: upload/view button
          const statusLabel = ev?.status === 'uploaded'
            ? 'Cargada'
            : ev?.status === 'no_evidence'
            ? 'Sin evidencia'
            : null;

          return (
            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <button
                onClick={() => openModal(globalIndex, info.row.original)}
                style={{
                  background: ev?.status === 'uploaded' ? 'var(--success)' : 'var(--accent)',
                  color: '#fff',
                  fontSize: '0.72rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--radius)',
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {ev?.status === 'uploaded' ? 'Ver' : ev?.status === 'no_evidence' ? 'Editar' : 'Cargar'}
              </button>
              {statusLabel && (
                <span style={{
                  fontSize: '0.68rem',
                  color: ev?.status === 'uploaded' ? 'var(--success)' : 'var(--text-muted)',
                  fontWeight: 500,
                }}>
                  {statusLabel}
                </span>
              )}
              {ev?.status === 'uploaded' && (
                <>
                  <button
                    onClick={() => handleDownloadSinglePdf(selected.id, globalIndex)}
                    title="Descargar PDF individual"
                    style={{
                      background: '#2c3e6b',
                      color: '#fff',
                      border: 'none',
                      fontSize: '0.65rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    PDF
                  </button>
                  <button
                    onClick={() => handleDownloadSinglePdf(selected.id, globalIndex, { noReclamar: true })}
                    title="PDF sin reclamación — solo investigación"
                    style={{
                      background: '#c0392b',
                      color: '#fff',
                      border: 'none',
                      fontSize: '0.6rem',
                      padding: '0.15rem 0.35rem',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontWeight: 700,
                    }}
                  >
                    NO RECLAMAR
                  </button>
                </>
              )}
            </div>
          );
        },
      },
    ];
  }, [selected, page, evidences, isAdmin, selectedEvIds]);

  const assignedRanges = selected && isAdmin ? computeAssignedRanges() : [];

  return (
    <div className={styles.page}>
      <NavBar />
      <main className={styles.main}>
        {!selected ? (
          <>
            <h2 className={styles.title}>
              {isAdmin ? 'Asignaciones' : 'Mis Asignaciones'}
            </h2>

            {/* Analyst: filter toolbar */}
            {!isAdmin && !loading && assignments.length > 0 && (
              <div className={styles.listFilters}>
                <div className={styles.viewModeGroup}>
                  {['active', 'completed', 'all'].map((mode) => (
                    <button
                      key={mode}
                      className={`${styles.viewModeBtn} ${viewMode === mode ? styles.viewModeBtnActive : ''}`}
                      onClick={() => setViewMode(mode)}
                    >
                      {mode === 'active' ? 'Activas' : mode === 'completed' ? 'Completadas' : 'Todas'}
                      <span className={styles.viewModeCount}>
                        {mode === 'active'
                          ? assignments.filter((a) => !a.completed_at).length
                          : mode === 'completed'
                          ? assignments.filter((a) => !!a.completed_at).length
                          : assignments.length}
                      </span>
                    </button>
                  ))}
                </div>
                <div className={styles.dateFilters}>
                  <label className={styles.dateLabel}>
                    Desde
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={styles.dateInput} />
                  </label>
                  <label className={styles.dateLabel}>
                    Hasta
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={styles.dateInput} />
                  </label>
                  {(dateFrom || dateTo) && (
                    <button className={styles.clearDatesBtn} onClick={() => { setDateFrom(''); setDateTo(''); }}>
                      Limpiar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Admin: progress summary */}
            {isAdmin && progressData.length > 0 && !loading && (
              <div className={styles.progressPanel}>
                <h3 className={styles.progressPanelTitle}>Progreso por analista</h3>
                <div className={styles.progressTable}>
                  {(() => {
                    // Group by user_name
                    const grouped = {};
                    for (const r of progressData) {
                      const name = r.user_name || 'Sin asignar';
                      if (!grouped[name]) grouped[name] = { totalRows: 0, uploaded: 0, noEvidence: 0 };
                      grouped[name].totalRows += Number(r.total_rows) || 0;
                      grouped[name].uploaded += Number(r.uploaded) || 0;
                      grouped[name].noEvidence += Number(r.no_evidence) || 0;
                    }
                    return Object.entries(grouped).map(([name, d]) => {
                      const done = d.uploaded + d.noEvidence;
                      const pct = d.totalRows > 0 ? Math.round((done / d.totalRows) * 100) : 0;
                      return (
                        <div key={name} className={styles.progressRow}>
                          <span className={styles.progressName}>{name}</span>
                          <div className={styles.progressBarSmall}>
                            <div className={styles.progressFillSmall} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={styles.progressRowPct}>{pct}%</span>
                          <span className={styles.progressRowDetail}>
                            {done}/{d.totalRows}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {loading ? (
              <p className={styles.muted}>Cargando...</p>
            ) : filteredAssignments.length === 0 ? (
              <p className={styles.muted}>
                {assignments.length === 0
                  ? 'No tienes asignaciones aun.'
                  : viewMode === 'active'
                  ? 'No tienes asignaciones activas.'
                  : viewMode === 'completed'
                  ? 'No tienes asignaciones completadas.'
                  : 'No hay asignaciones en este rango de fechas.'}
              </p>
            ) : (
              <div className={styles.list}>
                {filteredAssignments.map((a) => (
                  <div
                    key={a.id}
                    className={`${styles.card} ${a.completed_at ? styles.cardCompleted : ''}`}
                    onClick={() => setSelected(a)}
                  >
                    <div>
                      <span className={styles.label}>{a.label}</span>
                      {a.range_from && a.range_to && (
                        <span className={styles.range}> (filas {a.range_from} - {a.range_to})</span>
                      )}
                      {isAdmin && a.user_name && (
                        <span className={styles.userName}> — {a.user_name}</span>
                      )}
                      {a.completed_at && (
                        <span className={styles.completedBadge}>
                          Completada {new Date(a.completed_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className={styles.cardRight}>
                      <span className={styles.date}>
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                      {!isAdmin && (
                        <button
                          className={a.completed_at ? styles.reactivateBtn : styles.completeBtn}
                          onClick={(e) => handleToggleComplete(e, a.id)}
                        >
                          {a.completed_at ? 'Reactivar' : 'Completar'}
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          className={styles.deleteBtn}
                          onClick={(e) => handleDelete(e, a.id)}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className={styles.header}>
              <button className={styles.backBtn} onClick={handleBack}>
                Volver
              </button>
              <h2 className={styles.title}>{selected.label}</h2>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  className={styles.reportBtn}
                  onClick={() => handleGenerateReport()}
                  disabled={generatingReport}
                >
                  {generatingReport ? 'Generando...' : 'Generar Informe PDF'}
                </button>
                <button
                  onClick={() => handleGenerateReport({ noReclamar: true })}
                  disabled={generatingReport}
                  style={{
                    background: '#c0392b',
                    color: '#fff',
                    border: 'none',
                    fontSize: '0.8rem',
                    padding: '0.4rem 0.8rem',
                    borderRadius: 'var(--radius)',
                    cursor: generatingReport ? 'not-allowed' : 'pointer',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    opacity: generatingReport ? 0.6 : 1,
                  }}
                >
                  OJO - NO RECLAMAR
                </button>
                <button
                  onClick={() => handleDownloadFile('csv')}
                  style={{
                    background: '#27ae60',
                    color: '#fff',
                    border: 'none',
                    fontSize: '0.8rem',
                    padding: '0.4rem 0.8rem',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Descargar CSV
                </button>
                <button
                  onClick={() => handleDownloadFile('excel')}
                  style={{
                    background: '#2980b9',
                    color: '#fff',
                    border: 'none',
                    fontSize: '0.8rem',
                    padding: '0.4rem 0.8rem',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Descargar Excel
                </button>
              </div>
            </div>

            {/* Admin: show assigned ranges summary */}
            {isAdmin && assignedRanges.length > 0 && (
              <div className={styles.rangesSection}>
                <h4 className={styles.rangesTitle}>Rangos asignados</h4>
                <div className={styles.rangesList}>
                  {assignedRanges.map((r) => (
                    <div key={r.id} className={styles.rangeTag}>
                      <span className={styles.rangeUser}>{r.user}</span>
                      <span className={styles.rangeValues}>Filas {r.from} - {r.to}</span>
                      <button
                        className={styles.rangDeleteBtn}
                        onClick={() => handleDeleteSibling(r.id)}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
                {total > 0 && (
                  <p className={styles.rangesSummary}>
                    Total filas: {total} — Asignadas: {assignedRanges.reduce((sum, r) => sum + (r.to - r.from + 1), 0)}
                    {' '} — Pendientes: {Math.max(0, total - assignedRanges.reduce((sum, r) => sum + (r.to - r.from + 1), 0))}
                  </p>
                )}
              </div>
            )}

            {/* Progress bar */}
            {total > 0 && (
              <div className={styles.progressSection}>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
                </div>
                <div className={styles.progressStats}>
                  <span className={styles.progressPct}>{progress.pct}%</span>
                  <span className={styles.progressDetail}>
                    {progress.uploaded} hechas · {progress.noEvidence} sin evidencia · {progress.pending} pendientes · {progress.total} total
                  </span>
                </div>
                <div className={styles.progressActions}>
                  <select
                    className={styles.statusFilterSelect}
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">Todas</option>
                    <option value="pending">Pendientes</option>
                    <option value="done">Hechas</option>
                    <option value="no_evidence">Sin evidencia</option>
                  </select>
                  {!isAdmin && (
                    <button className={styles.bulkNoEvBtn} onClick={handleBulkNoEvidence}>
                      Marcar página sin evidencia
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Admin: batch rotation toolbar */}
            {isAdmin && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
                padding: '0.5rem 0.8rem', background: 'var(--bg-card, #f8f9fa)',
                borderRadius: 'var(--radius)', marginBottom: '0.5rem',
                border: '1px solid var(--border, #e0e0e0)',
              }}>
                <button
                  onClick={selectAllPageEvidences}
                  style={{
                    background: 'var(--accent, #2c3e6b)', color: '#fff', border: 'none',
                    fontSize: '0.72rem', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                  }}
                >
                  Seleccionar todas
                </button>
                <button
                  onClick={() => setSelectedEvIds(new Set())}
                  style={{
                    background: 'transparent', border: '1px solid var(--border, #ccc)',
                    fontSize: '0.72rem', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                  }}
                >
                  Deseleccionar
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>
                  {selectedEvIds.size} seleccionada{selectedEvIds.size !== 1 ? 's' : ''}
                </span>
                <span style={{ borderLeft: '1px solid var(--border, #ccc)', height: '1.2rem' }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Rotar a:</span>
                {[0, 90, 180, 270].map((deg) => (
                  <button
                    key={deg}
                    onClick={() => handleBatchRotate(deg)}
                    disabled={selectedEvIds.size === 0 || batchRotating}
                    style={{
                      background: deg === 0 ? '#27ae60' : '#2c3e6b', color: '#fff', border: 'none',
                      fontSize: '0.7rem', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius)',
                      cursor: selectedEvIds.size === 0 || batchRotating ? 'not-allowed' : 'pointer',
                      opacity: selectedEvIds.size === 0 || batchRotating ? 0.5 : 1,
                    }}
                  >
                    {deg === 0 ? 'Original (0°)' : `${deg}°`}
                  </button>
                ))}
                {batchRotating && <span style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>Rotando...</span>}
              </div>
            )}

            <FilteredTable
              rows={filteredRows}
              page={page}
              totalPages={totalPages}
              total={total}
              loading={loadingRows}
              setPage={setPage}
              highlightDiferencia
              showIndex
              extraColumns={extraColumns}
            />

            {/* Admin: assign more analysts */}
            {isAdmin && (
              <div className={styles.assignSection}>
                <h3 className={styles.sectionTitle}>Asignar filas pendientes</h3>
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
                          <label className={styles.rangeInputLabel}>
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
                          <label className={styles.rangeInputLabel}>
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
                </div>
                <button
                  className={styles.assignBtn}
                  onClick={handleAssignMore}
                  disabled={selectedUsers.size === 0 || assigning}
                >
                  {assigning ? 'Asignando...' : `Asignar a ${selectedUsers.size} analista(s)`}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {modalRow && (
        <EvidenceModal
          evidence={evidences[modalRow.rowIndex]}
          row={modalRow.row}
          onSave={handleSaveEvidence}
          onDelete={handleDeleteEvidence}
          onClose={() => setModalRow(null)}
          readOnly={isAdmin}
          onRotateSave={(rowIndex, newRotation) => {
            setEvidences((prev) => {
              if (!prev[rowIndex]) return prev;
              return { ...prev, [rowIndex]: { ...prev[rowIndex], rotation: newRotation } };
            });
          }}
          rowLabel={`Fila ${modalRow.rowIndex} de ${total}`}
          onPrev={filteredRows.findIndex((r) => r._globalIndex === modalRow.rowIndex) > 0 ? () => navigateModal(-1) : null}
          onNext={filteredRows.findIndex((r) => r._globalIndex === modalRow.rowIndex) < filteredRows.length - 1 ? () => navigateModal(1) : null}
        />
      )}
    </div>
  );
}
