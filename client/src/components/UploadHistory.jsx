import { useState } from 'react';
import { deleteUpload, markUploadCompleted, unmarkUploadCompleted } from '../lib/api.js';
import styles from './UploadHistory.module.css';

export default function UploadHistory({ uploads, loading, selectedId, onSelect, onRefresh }) {
  const [busy, setBusy] = useState(null);

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!window.confirm('¿Eliminar este upload y todas sus filas?')) return;
    try {
      await deleteUpload(id);
      if (selectedId === id) onSelect(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  async function handleToggleCompleted(e, upload) {
    e.stopPropagation();
    const isCompleted = upload.completed_count >= upload.row_count && upload.row_count > 0;
    setBusy(upload.id);
    try {
      if (isCompleted) {
        await unmarkUploadCompleted(upload.id);
      } else {
        await markUploadCompleted(upload.id);
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Toggle completed failed:', err);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p className={styles.loading}>Cargando uploads...</p>;
  }

  if (uploads.length === 0) {
    return <p className={styles.empty}>No hay uploads. Sube un CSV para empezar.</p>;
  }

  return (
    <div className={styles.list}>
      {uploads.map((u) => {
        const isCompleted = u.completed_count >= u.row_count && u.row_count > 0;
        const isBusy = busy === u.id;
        return (
          <div
            key={u.id}
            className={`${styles.item} ${selectedId === u.id ? styles.selected : ''} ${isCompleted ? styles.completedItem : ''}`}
            onClick={() => onSelect(u.id === selectedId ? null : u.id)}
          >
            <div className={styles.info}>
              <div className={styles.filenameRow}>
                <span className={styles.filename}>{u.filename}</span>
                {isCompleted && <span className={styles.completedBadge}>Completado</span>}
              </div>
              <span className={styles.meta}>
                {u.row_count} filas
                {u.fecha_csv && ` · Fecha: ${u.fecha_csv}`}
                {u.completed_count > 0 && !isCompleted && ` · ${u.completed_count} completadas`}
                {' · '}{new Date(u.uploaded_at).toLocaleString()}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                className={isCompleted ? styles.unmarkBtn : styles.markBtn}
                onClick={(e) => handleToggleCompleted(e, u)}
                disabled={isBusy}
              >
                {isBusy ? '...' : isCompleted ? 'Desmarcar' : 'Marcar hecho'}
              </button>
              <button
                className={styles.deleteBtn}
                onClick={(e) => handleDelete(e, u.id)}
              >
                Eliminar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
