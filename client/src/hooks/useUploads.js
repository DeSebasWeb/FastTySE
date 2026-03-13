import { useState, useEffect, useCallback } from 'react';
import { getUploads } from '../lib/api.js';
import socket from '../lib/socket.js';

export function useUploads() {
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUploads = useCallback(async () => {
    try {
      const data = await getUploads();
      setUploads(data);
    } catch (err) {
      console.error('Failed to fetch uploads:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUploads();

    function onUploaded(payload) {
      setUploads((prev) => {
        if (prev.some((u) => u.id === payload.uploadId)) return prev;
        return [
          {
            id: payload.uploadId,
            filename: payload.filename,
            columns: payload.columns,
            row_count: payload.rowCount,
            uploaded_at: payload.uploadedAt,
            fecha_csv: payload.fechaCsv || null,
            completed_count: 0,
          },
          ...prev,
        ];
      });
    }

    function onDeleted(payload) {
      setUploads((prev) => prev.filter((u) => u.id !== payload.uploadId));
    }

    socket.on('csv:uploaded', onUploaded);
    socket.on('csv:deleted', onDeleted);

    return () => {
      socket.off('csv:uploaded', onUploaded);
      socket.off('csv:deleted', onDeleted);
    };
  }, [fetchUploads]);

  return { uploads, loading, refetch: fetchUploads };
}
