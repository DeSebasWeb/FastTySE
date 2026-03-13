import { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Rect, Ellipse, Arrow, Transformer, Group } from 'react-konva';
import styles from './ImageAnnotator.module.css';

const TOOLS = [
  { id: 'select', label: 'Seleccionar' },
  { id: 'pencil', label: 'Lapiz' },
  { id: 'highlighter', label: 'Resaltador' },
  { id: 'line', label: 'Linea' },
  { id: 'arrow', label: 'Flecha' },
  { id: 'rect', label: 'Rectangulo' },
  { id: 'ellipse', label: 'Circulo' },
  { id: 'crop', label: 'Recorte' },
];

const WIDTHS = [
  { id: 2, label: 'Fino' },
  { id: 4, label: 'Medio' },
  { id: 8, label: 'Grueso' },
];

export default function ImageAnnotator({ imageSrc, onApply, onCancel }) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const trRef = useRef(null);

  const [tool, setTool] = useState('pencil');
  const [color, setColor] = useState('#FFD600');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [annotations, setAnnotations] = useState([]);
  const [currentAnnotation, setCurrentAnnotation] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Crop state
  const [cropRect, setCropRect] = useState(null);
  const [isCropping, setIsCropping] = useState(false);

  // Image & stage sizing
  const [bgImage, setBgImage] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);

  // Load image
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      setBgImage(img);
      fitStage(img);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Resize handler
  useEffect(() => {
    function handleResize() {
      if (bgImage) fitStage(bgImage);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [bgImage]);

  function fitStage(img) {
    if (!containerRef.current) return;
    const cw = containerRef.current.offsetWidth;
    const ch = containerRef.current.offsetHeight;
    const s = Math.min(cw / img.width, ch / img.height, 1);
    setScale(s);
    setStageSize({ width: img.width * s, height: img.height * s });
  }

  // Pointer position in image space
  function getPointerPos() {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return { x: pos.x / scale, y: pos.y / scale };
  }

  // Keyboard shortcut: Ctrl+Z for undo
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && tool === 'select') {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
      if (e.key === 'Escape') {
        if (tool === 'crop') {
          setCropRect(null);
          setIsCropping(false);
          setTool('select');
        } else {
          onCancel();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, tool, annotations.length]);

  // Attach transformer to selected shape
  useEffect(() => {
    if (!trRef.current || !stageRef.current) return;
    if (selectedId && tool === 'select') {
      const node = stageRef.current.findOne('#' + selectedId);
      if (node) {
        trRef.current.nodes([node]);
        trRef.current.getLayer().batchDraw();
        return;
      }
    }
    trRef.current.nodes([]);
    trRef.current.getLayer()?.batchDraw();
  }, [selectedId, tool, annotations]);

  // ---- Drawing handlers ----

  function handleMouseDown() {
    const pos = getPointerPos();
    if (!pos) return;

    if (tool === 'select') {
      // Deselect if clicking empty area (handled by stage click)
      return;
    }

    if (tool === 'crop') {
      setCropRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
      setIsCropping(true);
      return;
    }

    setIsDrawing(true);
    setSelectedId(null);
    const id = crypto.randomUUID();
    const isHighlighter = tool === 'highlighter';

    if (tool === 'pencil' || tool === 'highlighter') {
      setCurrentAnnotation({
        id, tool, points: [pos.x, pos.y],
        color, strokeWidth: isHighlighter ? strokeWidth * 3 : strokeWidth,
        opacity: isHighlighter ? 0.4 : 1,
      });
    } else if (tool === 'line' || tool === 'arrow') {
      setCurrentAnnotation({
        id, tool, points: [pos.x, pos.y, pos.x, pos.y],
        color, strokeWidth, opacity: 1,
      });
    } else if (tool === 'rect' || tool === 'ellipse') {
      setCurrentAnnotation({
        id, tool, x: pos.x, y: pos.y, width: 0, height: 0,
        color, strokeWidth, opacity: 1,
      });
    }
  }

  function handleMouseMove() {
    const pos = getPointerPos();
    if (!pos) return;

    if (tool === 'crop' && isCropping && cropRect) {
      setCropRect((prev) => ({
        ...prev,
        width: pos.x - prev.x,
        height: pos.y - prev.y,
      }));
      return;
    }

    if (!isDrawing || !currentAnnotation) return;

    if (currentAnnotation.tool === 'pencil' || currentAnnotation.tool === 'highlighter') {
      setCurrentAnnotation((prev) => ({
        ...prev,
        points: [...prev.points, pos.x, pos.y],
      }));
    } else if (currentAnnotation.tool === 'line' || currentAnnotation.tool === 'arrow') {
      setCurrentAnnotation((prev) => ({
        ...prev,
        points: [prev.points[0], prev.points[1], pos.x, pos.y],
      }));
    } else if (currentAnnotation.tool === 'rect' || currentAnnotation.tool === 'ellipse') {
      setCurrentAnnotation((prev) => ({
        ...prev,
        width: pos.x - prev.x,
        height: pos.y - prev.y,
      }));
    }
  }

  function handleMouseUp() {
    if (tool === 'crop' && isCropping) {
      setIsCropping(false);
      return;
    }

    if (!isDrawing || !currentAnnotation) return;
    setIsDrawing(false);

    // Only add if the shape has some size
    const a = currentAnnotation;
    let hasSize = true;
    if (a.tool === 'pencil' || a.tool === 'highlighter') {
      hasSize = a.points.length > 2;
    } else if (a.tool === 'line' || a.tool === 'arrow') {
      const dx = a.points[2] - a.points[0];
      const dy = a.points[3] - a.points[1];
      hasSize = Math.sqrt(dx * dx + dy * dy) > 2;
    } else if (a.tool === 'rect' || a.tool === 'ellipse') {
      hasSize = Math.abs(a.width) > 2 || Math.abs(a.height) > 2;
    }

    if (hasSize) {
      setAnnotations((prev) => [...prev, a]);
    }
    setCurrentAnnotation(null);
  }

  function handleStageClick(e) {
    if (tool !== 'select') return;
    // If clicking on empty area, deselect
    if (e.target === e.target.getStage() || e.target.attrs?.id === 'bg-image') {
      setSelectedId(null);
    }
  }

  function handleShapeClick(id) {
    if (tool === 'select') {
      setSelectedId(id);
    }
  }

  // ---- Actions ----

  function handleUndo() {
    setAnnotations((prev) => prev.slice(0, -1));
    setSelectedId(null);
  }

  function handleDeleteSelected() {
    if (!selectedId) return;
    setAnnotations((prev) => prev.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  }

  function handleCropConfirm() {
    if (!cropRect || !bgImage) return;

    // Normalize crop rect (handle negative width/height)
    let { x, y, width, height } = cropRect;
    if (width < 0) { x += width; width = -width; }
    if (height < 0) { y += height; height = -height; }

    // Clamp to image bounds
    x = Math.max(0, Math.min(x, bgImage.width));
    y = Math.max(0, Math.min(y, bgImage.height));
    width = Math.min(width, bgImage.width - x);
    height = Math.min(height, bgImage.height - y);

    if (width < 10 || height < 10) {
      setCropRect(null);
      return;
    }

    // First flatten current annotations onto the image
    const flatCanvas = document.createElement('canvas');
    flatCanvas.width = bgImage.width;
    flatCanvas.height = bgImage.height;
    const flatCtx = flatCanvas.getContext('2d');
    flatCtx.drawImage(bgImage, 0, 0);

    // Draw the stage annotations layer onto the flat canvas
    const stage = stageRef.current;
    if (stage) {
      // Export just the annotations at natural resolution
      const tempScale = stage.scaleX();
      stage.scale({ x: 1, y: 1 });
      stage.size({ width: bgImage.width, height: bgImage.height });
      const annotLayer = stage.getLayers()[1]; // annotations layer
      if (annotLayer) {
        const annotCanvas = annotLayer.toCanvas();
        flatCtx.drawImage(annotCanvas, 0, 0);
      }
      stage.scale({ x: tempScale, y: tempScale });
      stage.size(stageSize);
    }

    // Now crop from the flattened canvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width;
    cropCanvas.height = height;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(flatCanvas, x, y, width, height, 0, 0, width, height);

    const croppedDataUrl = cropCanvas.toDataURL('image/png');

    // Load cropped image as new background
    const newImg = new window.Image();
    newImg.onload = () => {
      setBgImage(newImg);
      fitStage(newImg);
      setAnnotations([]);
      setCropRect(null);
      setTool('select');
    };
    newImg.src = croppedDataUrl;
  }

  function handleCropCancel() {
    setCropRect(null);
    setIsCropping(false);
    setTool('select');
  }

  function handleApply() {
    const stage = stageRef.current;
    if (!stage || !bgImage) return;

    // Hide transformer before export
    setSelectedId(null);

    // Export at natural resolution
    setTimeout(() => {
      const st = stageRef.current;
      const prevScale = st.scaleX();
      const prevSize = st.size();
      st.scale({ x: 1, y: 1 });
      st.size({ width: bgImage.width, height: bgImage.height });

      // Hide crop overlay if any
      const dataUrl = st.toDataURL({ pixelRatio: 1 });

      st.scale({ x: prevScale, y: prevScale });
      st.size(prevSize);

      onApply(dataUrl);
    }, 50);
  }

  // ---- Render annotations ----

  function renderAnnotation(a, isPreview = false) {
    const key = isPreview ? 'preview' : a.id;
    const draggable = tool === 'select' && !isPreview;
    const commonProps = {
      id: a.id,
      key,
      onClick: () => !isPreview && handleShapeClick(a.id),
      onTap: () => !isPreview && handleShapeClick(a.id),
    };

    if (a.tool === 'pencil' || a.tool === 'highlighter') {
      return (
        <Line
          {...commonProps}
          points={a.points}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          opacity={a.opacity}
          tension={0.5}
          lineCap="round"
          lineJoin="round"
          globalCompositeOperation={a.tool === 'highlighter' ? 'multiply' : 'source-over'}
          draggable={draggable}
          onDragEnd={(e) => {
            if (!draggable) return;
            const dx = e.target.x();
            const dy = e.target.y();
            e.target.position({ x: 0, y: 0 });
            setAnnotations((prev) =>
              prev.map((ann) =>
                ann.id === a.id
                  ? { ...ann, points: ann.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy)) }
                  : ann
              )
            );
          }}
        />
      );
    }

    if (a.tool === 'line') {
      return (
        <Line
          {...commonProps}
          points={a.points}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          lineCap="round"
          draggable={draggable}
          onDragEnd={(e) => {
            if (!draggable) return;
            const dx = e.target.x();
            const dy = e.target.y();
            e.target.position({ x: 0, y: 0 });
            setAnnotations((prev) =>
              prev.map((ann) =>
                ann.id === a.id
                  ? { ...ann, points: ann.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy)) }
                  : ann
              )
            );
          }}
        />
      );
    }

    if (a.tool === 'arrow') {
      return (
        <Arrow
          {...commonProps}
          points={a.points}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          fill={a.color}
          pointerLength={a.strokeWidth * 3}
          pointerWidth={a.strokeWidth * 3}
          lineCap="round"
          draggable={draggable}
          onDragEnd={(e) => {
            if (!draggable) return;
            const dx = e.target.x();
            const dy = e.target.y();
            e.target.position({ x: 0, y: 0 });
            setAnnotations((prev) =>
              prev.map((ann) =>
                ann.id === a.id
                  ? { ...ann, points: ann.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy)) }
                  : ann
              )
            );
          }}
        />
      );
    }

    if (a.tool === 'rect') {
      return (
        <Rect
          {...commonProps}
          x={a.x}
          y={a.y}
          width={a.width}
          height={a.height}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          draggable={draggable}
          onDragEnd={(e) => {
            if (!draggable) return;
            setAnnotations((prev) =>
              prev.map((ann) =>
                ann.id === a.id
                  ? { ...ann, x: e.target.x(), y: e.target.y() }
                  : ann
              )
            );
          }}
          onTransformEnd={(e) => {
            const node = e.target;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            setAnnotations((prev) =>
              prev.map((ann) =>
                ann.id === a.id
                  ? { ...ann, x: node.x(), y: node.y(), width: node.width() * scaleX, height: node.height() * scaleY }
                  : ann
              )
            );
          }}
        />
      );
    }

    if (a.tool === 'ellipse') {
      const rx = Math.abs(a.width) / 2;
      const ry = Math.abs(a.height) / 2;
      return (
        <Ellipse
          {...commonProps}
          x={a.x + a.width / 2}
          y={a.y + a.height / 2}
          radiusX={rx}
          radiusY={ry}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          draggable={draggable}
          onDragEnd={(e) => {
            if (!draggable) return;
            setAnnotations((prev) =>
              prev.map((ann) => {
                if (ann.id !== a.id) return ann;
                const cx = e.target.x();
                const cy = e.target.y();
                return { ...ann, x: cx - ann.width / 2, y: cy - ann.height / 2 };
              })
            );
          }}
          onTransformEnd={(e) => {
            const node = e.target;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            const newRx = node.radiusX() * scaleX;
            const newRy = node.radiusY() * scaleY;
            setAnnotations((prev) =>
              prev.map((ann) => {
                if (ann.id !== a.id) return ann;
                return {
                  ...ann,
                  x: node.x() - newRx,
                  y: node.y() - newRy,
                  width: newRx * 2,
                  height: newRy * 2,
                };
              })
            );
          }}
        />
      );
    }

    return null;
  }

  // Crop overlay: dim everything outside the crop rect
  function renderCropOverlay() {
    if (!cropRect || !bgImage) return null;
    let { x, y, width, height } = cropRect;
    if (width < 0) { x += width; width = -width; }
    if (height < 0) { y += height; height = -height; }

    return (
      <Group>
        {/* Dim overlay */}
        <Rect x={0} y={0} width={bgImage.width} height={bgImage.height} fill="rgba(0,0,0,0.5)" />
        {/* Clear the crop area */}
        <Rect x={x} y={y} width={width} height={height} fill="rgba(0,0,0,0.5)" globalCompositeOperation="destination-out" />
        {/* Border around crop */}
        <Rect x={x} y={y} width={width} height={height} stroke="#fff" strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
      </Group>
    );
  }

  const showCropActions = tool === 'crop' && cropRect && !isCropping && (Math.abs(cropRect.width) > 10 || Math.abs(cropRect.height) > 10);

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        {/* Tool buttons */}
        <div className={styles.topToolbar}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? styles.toolBtnActive : styles.toolBtn}
              onClick={() => { setTool(t.id); setSelectedId(null); setCropRect(null); }}
            >
              {t.label}
            </button>
          ))}

          <span className={styles.toolSep} />

          <button className={styles.toolBtn} onClick={handleUndo} disabled={annotations.length === 0}>
            Deshacer
          </button>
          <button
            className={styles.dangerBtn}
            onClick={handleDeleteSelected}
            disabled={!selectedId}
          >
            Eliminar
          </button>
        </div>

        {/* Config bar */}
        <div className={styles.configBar}>
          <span className={styles.configLabel}>Color:</span>
          <input
            type="color"
            className={styles.colorInput}
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />

          <span className={styles.toolSep} />

          <span className={styles.configLabel}>Grosor:</span>
          {WIDTHS.map((w) => (
            <button
              key={w.id}
              className={strokeWidth === w.id ? styles.widthBtnActive : styles.widthBtn}
              onClick={() => setStrokeWidth(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className={styles.canvasArea} ref={containerRef}>
          {bgImage && (
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              scaleX={scale}
              scaleY={scale}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchMove={handleMouseMove}
              onTouchEnd={handleMouseUp}
              onClick={handleStageClick}
              onTap={handleStageClick}
              style={{ cursor: tool === 'select' ? 'default' : tool === 'crop' ? 'crosshair' : 'crosshair' }}
            >
              {/* Background image layer */}
              <Layer listening={false}>
                <KonvaImage id="bg-image" image={bgImage} width={bgImage.width} height={bgImage.height} />
              </Layer>

              {/* Annotations layer */}
              <Layer>
                {annotations.map((a) => renderAnnotation(a))}
                {currentAnnotation && renderAnnotation(currentAnnotation, true)}
                {tool === 'crop' && renderCropOverlay()}
                <Transformer
                  ref={trRef}
                  rotateEnabled={false}
                  enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 5 || newBox.height < 5) return oldBox;
                    return newBox;
                  }}
                />
              </Layer>
            </Stage>
          )}

          {showCropActions && (
            <div className={styles.cropConfirm}>
              <button className={styles.applyBtn} onClick={handleCropConfirm}>Recortar</button>
              <button className={styles.cancelBtn} onClick={handleCropCancel}>Cancelar recorte</button>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className={styles.bottomBar}>
          <button className={styles.cancelBtn} onClick={onCancel}>Cancelar</button>
          <button className={styles.applyBtn} onClick={handleApply}>Aplicar</button>
        </div>
      </div>
    </div>
  );
}
