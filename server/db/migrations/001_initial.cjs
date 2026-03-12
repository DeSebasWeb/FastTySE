exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE csv_uploads (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename    VARCHAR NOT NULL,
      columns     JSONB NOT NULL,
      row_count   INT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE csv_rows (
      id        SERIAL PRIMARY KEY,
      upload_id UUID REFERENCES csv_uploads(id) ON DELETE CASCADE,
      row_data  JSONB NOT NULL,
      row_index INT
    );

    CREATE INDEX idx_csv_rows_upload ON csv_rows(upload_id);
    CREATE INDEX idx_csv_rows_data   ON csv_rows USING GIN(row_data);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS csv_rows;
    DROP TABLE IF EXISTS csv_uploads;
  `);
};
