import { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import { getRows } from '../lib/api.js';
import styles from './DataTable.module.css';

const PAGE_SIZE = 100;

export default function DataTable({ upload }) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  // Reset page when upload changes
  useEffect(() => {
    setPage(1);
    setRows([]);
  }, [upload?.id]);

  useEffect(() => {
    if (!upload) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await getRows(upload.id, page, PAGE_SIZE);
        if (!cancelled) {
          setRows(data.rows);
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }
      } catch (err) {
        console.error('Failed to load rows:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [upload?.id, page]);

  const columns = useMemo(() => {
    if (!upload) return [];
    return upload.columns.map((col) => ({
      accessorKey: col,
      header: col,
      cell: (info) => info.getValue() ?? '',
    }));
  }, [upload]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  if (!upload) return null;

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>{upload.filename}</h3>

      {loading ? (
        <p className={styles.loading}>Loading rows...</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => (
                      <th key={header.id}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className={styles.pageInfo}>
              Page {page} of {totalPages} ({total} rows)
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
