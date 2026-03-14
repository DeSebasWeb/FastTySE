exports.up = (pgm) => {
  // B-tree indexes on extracted JSONB fields used in WHERE clauses.
  // The GIN index on row_data does NOT help with row_data->>'field' = $1 queries.
  // These partial indexes (WHERE completed = FALSE) match the app's query pattern.

  // Primary cascade filters (used in almost every query)
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_csv_rows_corporacion
    ON csv_rows ((row_data->>'nomCorporacion'))
    WHERE completed = FALSE`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_csv_rows_departamento
    ON csv_rows ((row_data->>'nomDepartamento'))
    WHERE completed = FALSE`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_csv_rows_municipio
    ON csv_rows ((row_data->>'nomMunicipio'))
    WHERE completed = FALSE`);

  // Secondary filters
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_csv_rows_zona
    ON csv_rows ((row_data->>'zona'))
    WHERE completed = FALSE`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_csv_rows_codpuesto
    ON csv_rows ((row_data->>'codPuesto'))
    WHERE completed = FALSE`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_csv_rows_mesa
    ON csv_rows ((row_data->>'mesa'))
    WHERE completed = FALSE`);

  // Composite index for the most common filter combination (corp + depto + muni)
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_csv_rows_cascade
    ON csv_rows (
      (row_data->>'nomCorporacion'),
      (row_data->>'nomDepartamento'),
      (row_data->>'nomMunicipio')
    )
    WHERE completed = FALSE`);

  // row_index ordering (used in ORDER BY row_index on every query)
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_csv_rows_row_index
    ON csv_rows (row_index)
    WHERE completed = FALSE`);

  // For ILIKE searches on nomLista: pg_trgm trigram index (optional, may fail if extension not available)
  pgm.sql(`
    DO $$ BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX IF NOT EXISTS idx_csv_rows_nomlista_trgm
        ON csv_rows USING GIN ((row_data->>'nomLista') gin_trgm_ops)
        WHERE completed = FALSE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_trgm not available, skipping trigram index';
    END $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_corporacion`);
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_departamento`);
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_municipio`);
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_zona`);
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_codpuesto`);
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_mesa`);
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_cascade`);
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_row_index`);
  pgm.sql(`DROP INDEX IF EXISTS idx_csv_rows_nomlista_trgm`);
};
