import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import styles from './DataTable.module.css';

const TABLE_COLUMNS = [
  { key: 'nomDepartamento', label: 'Depto', codKey: 'codDepartamento' },
  { key: 'nomMunicipio', label: 'Municipio', codKey: 'codMunicipio' },
  { key: 'zona', label: 'Zona' },
  { key: 'nomPuesto', label: 'Puesto', codKey: 'codPuesto' },
  { key: 'mesa', label: 'Mesa' },
  { key: 'codLista', label: 'Cod. Lista' },
  { key: 'nomLista', label: 'Partido' },
  { key: 'codCandidato', label: 'Cod. Candidato' },
  { key: 'candidato', label: 'Candidato' },
  { key: 'Votos E14', label: 'E14' },
  { key: 'Votos MMV', label: 'MMV' },
  { key: 'Diferencia', label: 'Dif' },
];

export default function FilteredTable({
  rows, page, totalPages, total, loading, setPage,
  highlightDiferencia, showIndex, extraColumns,
}) {
  // Extract location context from first row for header
  const first = rows.length > 0 ? rows[0] : null;
  const headerParts = first
    ? [first.nomCorporacion, first.nomDepartamento, first.nomMunicipio].filter(Boolean)
    : [];

  const columns = useMemo(() => {
    const cols = [];

    if (showIndex) {
      cols.push({
        id: '_index',
        header: '#',
        cell: (info) => info.row.original._globalIndex ?? ((page - 1) * 100 + info.row.index + 1),
        size: 50,
      });
    }

    for (const { key, label, codKey } of TABLE_COLUMNS) {
      cols.push({
        accessorKey: key,
        header: label,
        cell: (info) => {
          const val = info.getValue();
          if (key === 'Diferencia') {
            const n = Number(val);
            const color = n > 0 ? 'var(--success)' : n < 0 ? 'var(--danger)' : 'inherit';
            const arrow = n > 0 ? '\u25B2' : n < 0 ? '\u25BC' : '';
            return <span style={{ color, fontWeight: 600 }}>{arrow} {val}</span>;
          }
          if (codKey) {
            const cod = info.row.original[codKey];
            return (
              <span>
                {cod != null && <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', marginRight: 3 }}>{cod}</span>}
                {val ?? ''}
              </span>
            );
          }
          return val ?? '';
        },
      });
    }

    // Extra columns (e.g., evidence buttons)
    if (extraColumns) {
      cols.push(...extraColumns);
    }

    return cols;
  }, [showIndex, page, extraColumns]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  if (loading && rows.length === 0) {
    return <p className={styles.loading}>Cargando...</p>;
  }

  return (
    <div className={styles.container}>
      {headerParts.length > 0 && (
        <div className={styles.corpHeader}>
          {headerParts.join(' \u203A ')}
        </div>
      )}
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
            {table.getRowModel().rows.map((row) => {
              let rowStyle = {};
              if (highlightDiferencia) {
                const dif = Number(row.original['Diferencia']);
                if (dif > 0) rowStyle = { background: 'rgba(46, 204, 113, 0.08)' };
                else if (dif < 0) rowStyle = { background: 'rgba(231, 76, 60, 0.08)' };
              }
              return (
                <tr key={row.id} style={rowStyle}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </button>
        <span className={styles.pageInfo}>
          Pagina {page} de {totalPages} ({total} filas)
        </span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Siguiente
        </button>
      </div>
    </div>
  );
}
