import { useState, useRef, useEffect } from 'react';
import styles from './EvidenceModal.module.css';

export default function EvidenceModal({ evidence, onSave, onDelete, onClose, readOnly }) {
  const hasExisting = evidence?.status === 'uploaded';
  const [editing, setEditing] = useState(!hasExisting);
  const [imageData, setImageData] = useState(evidence?.image_data || null);
  const [rotation, setRotation] = useState(evidence?.rotation || 0);
  const [observations, setObservations] = useState(evidence?.observations || '');
  const [saving, setSaving] = useState(false);
  const dropRef = useRef(null);

  function imageTransform(deg) {
    const isVertical = deg % 180 !== 0;
    return isVertical
      ? `rotate(${deg}deg) scale(0.65)`
      : `rotate(${deg}deg)`;
  }

  // Listen for paste events (only in edit mode)
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
    if (file && file.type.startsWith('image/')) {
      readFile(file);
    }
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
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h3>Evidencia E14</h3>
            <button className={styles.closeBtn} onClick={onClose}>&times;</button>
          </div>

          {hasExisting ? (
            <>
              <div className={styles.imageWrap}>
                <img
                  src={evidence.image_data}
                  alt="Evidencia"
                  className={styles.image}
                  style={{ transform: imageTransform(evidence.rotation || 0) }}
                />
              </div>
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
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h3>Evidencia E14</h3>
            <button className={styles.closeBtn} onClick={onClose}>&times;</button>
          </div>

          <div className={styles.imageWrap}>
            <img
              src={imageData}
              alt="Evidencia"
              className={styles.image}
              style={{ transform: imageTransform(rotation) }}
            />
          </div>

          {observations && (
            <div className={styles.field}>
              <label className={styles.label}>Observaciones</label>
              <p className={styles.obsText}>{observations}</p>
            </div>
          )}

          <div className={styles.actions}>
            <button
              className={styles.saveBtn}
              onClick={() => setEditing(true)}
            >
              Actualizar
            </button>
            <button
              className={styles.deleteEvidenceBtn}
              onClick={handleDelete}
              disabled={saving}
            >
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

        <div
          ref={dropRef}
          className={styles.dropZone}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {imageData ? (
            <div className={styles.imageWrap}>
              <img
                src={imageData}
                alt="Evidencia"
                className={styles.image}
                style={{ transform: imageTransform(rotation) }}
              />
              <div className={styles.rotateControls}>
                <button onClick={rotateLeft} className={styles.rotateBtn}>Rotar izq.</button>
                <button onClick={rotateRight} className={styles.rotateBtn}>Rotar der.</button>
                <button onClick={() => setImageData(null)} className={styles.removeBtn}>Quitar</button>
              </div>
            </div>
          ) : (
            <div className={styles.placeholder}>
              <p>Arrastra una imagen, pega con Ctrl+V, o</p>
              <label className={styles.fileLabel}>
                Seleccionar archivo
                <input type="file" accept="image/*" onChange={handleFileSelect} hidden />
              </label>
            </div>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Observaciones (opcional)</label>
          <textarea
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            className={styles.textarea}
            rows={3}
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
            <button
              className={styles.noEvidenceBtn}
              onClick={() => handleSave('no_evidence')}
              disabled={saving}
            >
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
