exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE assignments (
      id          SERIAL PRIMARY KEY,
      user_id     INT NOT NULL,
      user_name   VARCHAR NOT NULL,
      filters     JSONB NOT NULL,
      label       VARCHAR NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX idx_assignments_user ON assignments(user_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS assignments;`);
};
