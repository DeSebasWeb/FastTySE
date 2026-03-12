import { deleteUpload } from '../lib/api.js';
import styles from './UploadHistory.module.css';

export default function UploadHistory({ uploads, loading, selectedId, onSelect }) {
  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this upload?')) return;
    try {
      await deleteUpload(id);
      if (selectedId === id) onSelect(null);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  if (loading) {
    return <p className={styles.loading}>Loading uploads...</p>;
  }

  if (uploads.length === 0) {
    return <p className={styles.empty}>No uploads yet. Upload a CSV to get started.</p>;
  }

  return (
    <div className={styles.list}>
      {uploads.map((u) => (
        <div
          key={u.id}
          className={`${styles.item} ${selectedId === u.id ? styles.selected : ''}`}
          onClick={() => onSelect(u.id === selectedId ? null : u.id)}
        >
          <div className={styles.info}>
            <span className={styles.filename}>{u.filename}</span>
            <span className={styles.meta}>
              {u.row_count} rows &middot; {u.columns.length} cols &middot;{' '}
              {new Date(u.uploaded_at).toLocaleString()}
            </span>
          </div>
          <button
            className={styles.deleteBtn}
            onClick={(e) => handleDelete(e, u.id)}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
