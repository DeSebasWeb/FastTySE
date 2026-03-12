import { useState, useRef } from 'react';
import { uploadCsv } from '../lib/api.js';
import styles from './CsvUploader.module.css';

export default function CsvUploader() {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  async function processFile(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only .csv files are allowed');
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess(null);
    setProgress(0);

    try {
      const result = await uploadCsv(file, setProgress);
      setSuccess(`Uploaded "${result.filename}" — ${result.rowCount} rows, ${result.columns.length} columns`);
      setProgress(null);
    } catch (err) {
      const msg = err.response?.data?.error || 'Upload failed';
      setError(msg);
      setProgress(null);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleChange(e) {
    processFile(e.target.files?.[0]);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    processFile(e.dataTransfer.files?.[0]);
  }

  return (
    <div className={styles.container}>
      <div
        className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={handleChange}
          className={styles.hiddenInput}
        />
        <p className={styles.dropText}>
          {dragging ? 'Drop your CSV here' : 'Drag & drop a CSV file or click to browse'}
        </p>
      </div>

      {progress !== null && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          <span className={styles.progressText}>{progress}%</span>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>{success}</p>}
    </div>
  );
}
