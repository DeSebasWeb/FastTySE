exports.up = (pgm) => {
  pgm.sql(`
    -- Add fecha_csv to csv_uploads
    ALTER TABLE csv_uploads ADD COLUMN IF NOT EXISTS fecha_csv DATE;

    -- Add fecha_csv to csv_rows
    ALTER TABLE csv_rows ADD COLUMN IF NOT EXISTS fecha_csv DATE;

    -- Remove duplicate rows before creating unique index
    -- Keeps the row with the highest id (most recent insert)
    DELETE FROM csv_rows a
    USING csv_rows b
    WHERE a.id < b.id
      AND a.row_data->>'nomCorporacion' = b.row_data->>'nomCorporacion'
      AND a.row_data->>'nomDepartamento' = b.row_data->>'nomDepartamento'
      AND a.row_data->>'nomMunicipio' = b.row_data->>'nomMunicipio'
      AND a.row_data->>'zona' = b.row_data->>'zona'
      AND a.row_data->>'codPuesto' = b.row_data->>'codPuesto'
      AND a.row_data->>'mesa' = b.row_data->>'mesa'
      AND a.row_data->>'candidato' = b.row_data->>'candidato';

    -- Unique constraint: same logical row (by business key) can only appear once
    CREATE UNIQUE INDEX IF NOT EXISTS idx_csv_rows_business_key ON csv_rows (
      (row_data->>'nomCorporacion'),
      (row_data->>'nomDepartamento'),
      (row_data->>'nomMunicipio'),
      (row_data->>'zona'),
      (row_data->>'codPuesto'),
      (row_data->>'mesa'),
      (row_data->>'candidato')
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_csv_rows_business_key;
    ALTER TABLE csv_rows DROP COLUMN IF EXISTS fecha_csv;
    ALTER TABLE csv_uploads DROP COLUMN IF EXISTS fecha_csv;
  `);
};
