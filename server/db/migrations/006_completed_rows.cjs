exports.up = (pgm) => {
  pgm.sql(`
    -- Track which rows are already completed (from previous days' work)
    ALTER TABLE csv_rows ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE;

    -- Index for fast filtering of pending rows
    CREATE INDEX IF NOT EXISTS idx_csv_rows_completed ON csv_rows (completed);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_csv_rows_completed;
    ALTER TABLE csv_rows DROP COLUMN IF EXISTS completed;
  `);
};
