import { useState, useRef, useEffect } from 'react';
import styles from './EvidenceModal.module.css';
import ImageAnnotator from './ImageAnnotator';
import { autoLoadE14 } from '../lib/api';

function ImageViewer({ src, rotation, size, showRotate, onRotateLeft, onRotateRight, extraTools }) {
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const containerRef = useRef(null);

  const [naturalSize, setNaturalSize] = useState(null);

  // Auto-fit: calculate zoom so image fits inside the viewer container
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ w: img.width, h: img.height });
      const container = containerRef.current;
      if (!container) return;
      const swap = rotation === 90 || rotation === 270;
      const imgW = swap ? img.height : img.width;
      const imgH = swap ? img.width : img.height;
      const pad = 32;
      const cW = container.clientWidth - pad;
      const cH = container.clientHeight - pad;
      if (imgW > cW || imgH > cH) {
        const fit = Math.min(cW / imgW, cH / imgH);
        setZoom(fit);
        setFitZoom(fit);
      } else {
        setZoom(1);
        setFitZoom(1);
      }
    };
    img.src = src;
  }, [src, rotation]);

  const viewerClass = size === 'large' ? styles.imageViewerLarge : styles.imageViewerSmall;

  return (
    <>
      <div className={styles.toolbar}>
        <button className={styles.toolBtn} onClick={() => setZoom((z) => Math.max(0.05, z / 1.3))}>-</button>
        <span className={styles.toolLabel}>{Math.round(zoom * 100)}%</span>
        <button className={styles.toolBtn} onClick={() => setZoom((z) => Math.min(5, z * 1.3))}>+</button>
        <button className={styles.toolBtn} onClick={() => setZoom(fitZoom)}>Ajustar</button>
        <button className={styles.toolBtn} onClick={() => setZoom(1)}>100%</button>
        {showRotate && (
          <>
            <span className={styles.toolSep} />
            <button className={styles.toolBtn} onClick={onRotateLeft}>Rotar izq.</button>
            <button className={styles.toolBtn} onClick={onRotateRight}>Rotar der.</button>
          </>
        )}
        {extraTools}
      </div>
      <div className={viewerClass} ref={containerRef}>
        <div className={styles.imageInner}>
          <img
            src={src}
            alt="Evidencia"
            className={styles.image}
            style={naturalSize ? {
              width: naturalSize.w * zoom,
              height: naturalSize.h * zoom,
              transform: rotation ? `rotate(${rotation}deg)` : undefined,
              transformOrigin: 'center center',
            } : { transform: rotation ? `rotate(${rotation}deg)` : undefined }}
          />
        </div>
      </div>
    </>
  );
}

export default function EvidenceModal({ evidence, row, onSave, onDelete, onClose, readOnly, rowLabel, onPrev, onNext }) {
  const hasExisting = evidence?.status === 'uploaded';
  const [editing, setEditing] = useState(!hasExisting);
  const [imageData, setImageData] = useState(evidence?.image_data || null);
  const [rotation, setRotation] = useState(evidence?.rotation || 0);
  const [observations, setObservations] = useState(evidence?.observations || '');
  const [saving, setSaving] = useState(false);
  const [showAnnotator, setShowAnnotator] = useState(false);
  const [autoE14Status, setAutoE14Status] = useState('idle'); // idle | loading | done | error
  const autoE14StatusRef = useRef('idle');
  const [autoE14Label, setAutoE14Label] = useState('');
  const dropRef = useRef(null);

  // Reset state when evidence changes (navigation)
  useEffect(() => {
    setEditing(!evidence?.status || evidence?.status !== 'uploaded');
    setImageData(evidence?.image_data || null);
    setRotation(evidence?.rotation || 0);
    setObservations(evidence?.observations || '');
    setAutoE14Status('idle');
    autoE14StatusRef.current = 'idle';
    setAutoE14Label('');
  }, [evidence?.id, evidence?.row_index, rowLabel]);

  // Auto-load E14 when opening in edit mode without existing image
  // Use rowLabel as stable dependency instead of row object (new ref each render)
  const rowRef = useRef(row);
  rowRef.current = row;

  useEffect(() => {
    if (readOnly || !editing || imageData || hasExisting) return;
    if (autoE14StatusRef.current !== 'idle') return;
    const r = rowRef.current;
    if (!r?.nomDepartamento || !r?.nomMunicipio || !r?.mesa) return;

    let cancelled = false;
    setAutoE14Status('loading');
    autoE14StatusRef.current = 'loading';

    autoLoadE14({
      nomCorporacion: r.nomCorporacion || '',
      nomDepartamento: r.nomDepartamento,
      nomMunicipio: r.nomMunicipio,
      zona: r.zona || '',
      nomPuesto: r.nomPuesto || '',
      codPuesto: r.codPuesto || '',
      mesa: r.mesa,
      codLista: r.codLista || '',
    }).then((data) => {
      if (cancelled) return;
      if (data.success) {
        setImageData(data.imagen_base64);
        setAutoE14Label(data.label);
        setAutoE14Status('done');
        autoE14StatusRef.current = 'done';
      } else {
        setAutoE14Label(data.message || '');
        setAutoE14Status('error');
        autoE14StatusRef.current = 'error';
      }
    }).catch(() => {
      if (!cancelled) {
        setAutoE14Status('error');
        autoE14StatusRef.current = 'error';
      }
    });

    return () => { cancelled = true; };
  }, [editing, readOnly, imageData, hasExisting, rowLabel]);

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

  function openAnnotator() {
    if (rotation !== 0) {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const swap = rotation === 90 || rotation === 270;
        canvas.width = swap ? img.height : img.width;
        canvas.height = swap ? img.width : img.height;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        setImageData(canvas.toDataURL('image/png'));
        setRotation(0);
        setShowAnnotator(true);
      };
      img.src = imageData;
    } else {
      setShowAnnotator(true);
    }
  }

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

  const navBar = (
    <div className={styles.navBar}>
      <button className={styles.navBtn} onClick={onPrev} disabled={!onPrev}>&larr;</button>
      <span className={styles.navLabel}>{rowLabel || 'Evidencia'}</span>
      <button className={styles.navBtn} onClick={onNext} disabled={!onNext}>&rarr;</button>
    </div>
  );

  // ---- READ ONLY MODE (Admin viewing) ----
  if (readOnly) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modalLarge} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h3>Evidencia E14</h3>
            {navBar}
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
            {navBar}
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
            <button className={styles.annotateBtn} onClick={() => { setEditing(true); openAnnotator(); }}>Anotar imagen</button>
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
          {navBar}
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
                  <button className={styles.annotateBtn} onClick={openAnnotator}>Anotar imagen</button>
                  <span className={styles.toolSep} />
                  <button className={styles.toolBtn} onClick={() => setImageData(null)} style={{ color: 'var(--danger)' }}>Quitar</button>
                </>
              }
            />

            {autoE14Label && autoE14Status === 'done' && (
              <p className={styles.autoE14Label}>{autoE14Label}</p>
            )}

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
              {autoE14Status === 'loading' ? (
                <p className={styles.autoE14Loading}>Buscando E14...</p>
              ) : (
                <>
                  {autoE14Status === 'error' && autoE14Label && (
                    <p className={styles.autoE14Error}>{autoE14Label}</p>
                  )}
                  <p>Arrastra una imagen, pega con Ctrl+V, o</p>
                  <label className={styles.fileLabel}>
                    Seleccionar archivo
                    <input type="file" accept="image/*" onChange={handleFileSelect} hidden />
                  </label>
                </>
              )}
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

        {showAnnotator && imageData && (
          <ImageAnnotator
            imageSrc={imageData}
            onApply={(base64) => {
              setImageData(base64);
              setRotation(0);
              setShowAnnotator(false);
            }}
            onCancel={() => setShowAnnotator(false)}
          />
        )}
      </div>
    </div>
  );
}
