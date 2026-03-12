exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE evidences (
      id            SERIAL PRIMARY KEY,
      assignment_id INT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      row_index     INT NOT NULL,
      status        VARCHAR NOT NULL DEFAULT 'pending',
      image_data    TEXT,
      rotation      INT DEFAULT 0,
      observations  TEXT,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX idx_evidences_assignment_row ON evidences(assignment_id, row_index);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS evidences;`);
};
