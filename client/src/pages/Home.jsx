import { useState } from 'react';
import NavBar from '../components/NavBar.jsx';
import CsvUploader from '../components/CsvUploader.jsx';
import UploadHistory from '../components/UploadHistory.jsx';
import DataTable from '../components/DataTable.jsx';
import { useUploads } from '../hooks/useUploads.js';
import styles from './Home.module.css';

export default function Home() {
  const { uploads, loading } = useUploads();
  const [selectedId, setSelectedId] = useState(null);

  const selectedUpload = uploads.find((u) => u.id === selectedId) || null;

  return (
    <div className={styles.page}>
      <NavBar />

      <main className={styles.main}>
        <section className={styles.sidebar}>
          <CsvUploader />
          <UploadHistory
            uploads={uploads}
            loading={loading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </section>

        <section className={styles.content}>
          {selectedUpload ? (
            <DataTable upload={selectedUpload} />
          ) : (
            <div className={styles.placeholder}>
              <p>Select an upload to view its data</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
