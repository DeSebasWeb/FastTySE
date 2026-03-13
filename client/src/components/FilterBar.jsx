import styles from './FilterBar.module.css';

export default function FilterBar({ filters, options, setFilter, clearFilters, extraFilters }) {
  return (
    <div className={styles.bar}>
      <div className={styles.filters}>
        <select
          value={filters.nomCorporacion || ''}
          onChange={(e) => setFilter('nomCorporacion', e.target.value)}
          className={styles.select}
        >
          <option value="">Corporacion</option>
          {options.corporaciones.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          value={filters.nomDepartamento || ''}
          onChange={(e) => setFilter('nomDepartamento', e.target.value)}
          className={styles.select}
        >
          <option value="">Departamento</option>
          {options.departamentos.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          value={filters.nomMunicipio || ''}
          onChange={(e) => setFilter('nomMunicipio', e.target.value)}
          className={styles.select}
          disabled={!filters.nomDepartamento}
        >
          <option value="">Municipio</option>
          {options.municipios.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Zona"
          maxLength={2}
          value={filters.zona || ''}
          onChange={(e) => setFilter('zona', e.target.value)}
          className={styles.input}
        />

        <input
          type="text"
          placeholder="Puesto"
          maxLength={2}
          value={filters.codPuesto || ''}
          onChange={(e) => setFilter('codPuesto', e.target.value)}
          className={styles.input}
        />

        <input
          type="text"
          placeholder="Mesa"
          maxLength={3}
          value={filters.mesa || ''}
          onChange={(e) => setFilter('mesa', e.target.value)}
          className={styles.input}
        />

        <input
          type="text"
          placeholder="Buscar partido..."
          value={filters.nomLista || ''}
          onChange={(e) => setFilter('nomLista', e.target.value)}
          className={`${styles.input} ${styles.partyInput}`}
        />

        <input
          type="text"
          placeholder="Candidato (nombre o código)..."
          value={filters.nomCandidato || ''}
          onChange={(e) => setFilter('nomCandidato', e.target.value)}
          className={`${styles.input} ${styles.partyInput}`}
        />

        {extraFilters}
      </div>

      <button className={styles.clearBtn} onClick={clearFilters}>
        Limpiar filtros
      </button>
    </div>
  );
}
