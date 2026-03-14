exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE evidences ADD COLUMN IF NOT EXISTS csv_row_id INT REFERENCES csv_rows(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_evidences_csv_row_id ON evidences(csv_row_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_evidences_csv_row_id;
    ALTER TABLE evidences DROP COLUMN IF EXISTS csv_row_id;
  `);
};
