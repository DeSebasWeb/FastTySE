import { useState, useRef, useEffect } from 'react';
import styles from './EvidenceModal.module.css';

function ImageViewer({ src, rotation, size, showRotate, onRotateLeft, onRotateRight, extraTools }) {
  const [zoom, setZoom] = useState(1);

  const viewerClass = size === 'large' ? styles.imageViewerLarge : styles.imageViewerSmall;

  return (
    <>
      <div className={styles.toolbar}>
        <button className={styles.toolBtn} onClick={() => setZoom((z) => Math.max(0.15, z / 1.3))}>-</button>
        <span className={styles.toolLabel}>{Math.round(zoom * 100)}%</span>
        <button className={styles.toolBtn} onClick={() => setZoom((z) => Math.min(5, z * 1.3))}>+</button>
        <button className={styles.toolBtn} onClick={() => setZoom(1)}>Reset</button>
        {showRotate && (
          <>
            <span className={styles.toolSep} />
            <button className={styles.toolBtn} onClick={onRotateLeft}>Rotar izq.</button>
            <button className={styles.toolBtn} onClick={onRotateRight}>Rotar der.</button>
          </>
        )}
        {extraTools}
      </div>
      <div className={viewerClass}>
        <div className={styles.imageInner}>
          <img
            src={src}
            alt="Evidencia"
            className={styles.image}
            style={{ transform: `rotate(${rotation}deg) scale(${zoom})`, transformOrigin: 'center center' }}
          />
        </div>
      </div>
    </>
  );
}

export default function EvidenceModal({ evidence, onSave, onDelete, onClose, readOnly }) {
  const hasExisting = evidence?.status === 'uploaded';
  const [editing, setEditing] = useState(!hasExisting);
  const [imageData, setImageData] = useState(evidence?.image_data || null);
  const [rotation, setRotation] = useState(evidence?.rotation || 0);
  const [observations, setObservations] = useState(evidence?.observations || '');
  const [saving, setSaving] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    if (readOnly) return;
    function handlePaste(e) {
      if (!editing) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          readFile(file);
          break;
        }
      }
    }
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [editing, readOnly]);

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => setImageData(e.target.result);
    reader.readAsDataURL(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    if (readOnly || !editing) return;
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) readFile(file);
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) readFile(file);
  }

  function rotateLeft() { setRotation((r) => (r - 90 + 360) % 360); }
  function rotateRight() { setRotation((r) => (r + 90) % 360); }

  async function handleSave(status) {
    setSaving(true);
    try {
      await onSave({
        status,
        imageData: status === 'uploaded' ? imageData : null,
        rotation: status === 'uploaded' ? rotation : 0,
        observations: observations || null,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar esta evidencia?')) return;
    setSaving(true);
    try {
      await onDelete(evidence.id);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // ---- READ ONLY MODE (Admin viewing) ----
  if (readOnly) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modalLarge} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h3>Evidencia E14</h3>
            <button className={styles.closeBtn} onClick={onClose}>&times;</button>
          </div>
          {hasExisting ? (
            <>
              <ImageViewer src={evidence.image_data} rotation={evidence.rotation || 0} size="large" />
              {evidence.observations && (
                <div className={styles.field}>
                  <label className={styles.label}>Observaciones</label>
                  <p className={styles.obsText}>{evidence.observations}</p>
                </div>
              )}
            </>
          ) : evidence?.status === 'no_evidence' ? (
            <p className={styles.noEvText}>El analista marcó esta fila como "Sin evidencia"</p>
          ) : (
            <p className={styles.noEvText}>Aún no se ha cargado evidencia para esta fila</p>
          )}
        </div>
      </div>
    );
  }

  // ---- VIEW MODE (Analyst has existing evidence) ----
  if (hasExisting && !editing) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modalLarge} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h3>Evidencia E14</h3>
            <button className={styles.closeBtn} onClick={onClose}>&times;</button>
          </div>

          <ImageViewer src={imageData} rotation={rotation} size="large" />

          <div className={styles.field}>
            <label className={styles.label}>Observaciones</label>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              className={styles.textarea}
              rows={2}
              placeholder="Notas adicionales..."
            />
          </div>

          <div className={styles.actions}>
            <button
              className={styles.saveBtn}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave({ status: 'uploaded', imageData, rotation, observations: observations || null });
                  onClose();
                } catch (err) { console.error(err); } finally { setSaving(false); }
              }}
              disabled={saving}
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
            <button className={styles.deleteEvidenceBtn} onClick={handleDelete} disabled={saving}>
              {saving ? 'Eliminando...' : 'Eliminar evidencia'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- EDIT MODE (new upload or updating) ----
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>{hasExisting ? 'Actualizar evidencia' : 'Evidencia E14'}</h3>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        {imageData ? (
          <>
            <ImageViewer
              src={imageData}
              rotation={rotation}
              size="small"
              showRotate
              onRotateLeft={rotateLeft}
              onRotateRight={rotateRight}
              extraTools={
                <>
                  <span className={styles.toolSep} />
                  <button className={styles.toolBtn} onClick={() => setImageData(null)} style={{ color: 'var(--danger)' }}>Quitar</button>
                </>
              }
            />

            <div
              ref={dropRef}
              className={styles.dropZone}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              style={{ minHeight: '50px', padding: '0.5rem' }}
            >
              <div className={styles.placeholder}>
                <label className={styles.fileLabel}>
                  Cambiar imagen
                  <input type="file" accept="image/*" onChange={handleFileSelect} hidden />
                </label>
              </div>
            </div>
          </>
        ) : (
          <div
            ref={dropRef}
            className={styles.dropZone}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <div className={styles.placeholder}>
              <p>Arrastra una imagen, pega con Ctrl+V, o</p>
              <label className={styles.fileLabel}>
                Seleccionar archivo
                <input type="file" accept="image/*" onChange={handleFileSelect} hidden />
              </label>
            </div>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label}>Observaciones (opcional)</label>
          <textarea
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            className={styles.textarea}
            rows={2}
            placeholder="Notas adicionales..."
          />
        </div>

        <div className={styles.actions}>
          <button
            className={styles.saveBtn}
            onClick={() => handleSave('uploaded')}
            disabled={!imageData || saving}
          >
            {saving ? 'Guardando...' : hasExisting ? 'Actualizar evidencia' : 'Guardar evidencia'}
          </button>
          {!hasExisting && (
            <button className={styles.noEvidenceBtn} onClick={() => handleSave('no_evidence')} disabled={saving}>
              Sin evidencia
            </button>
          )}
          {hasExisting && (
            <button
              className={styles.noEvidenceBtn}
              onClick={() => { setEditing(false); setImageData(evidence?.image_data || null); setRotation(evidence?.rotation || 0); setObservations(evidence?.observations || ''); }}
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
