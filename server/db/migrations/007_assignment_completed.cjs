exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE assignments ADD COLUMN completed_at TIMESTAMPTZ`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE assignments DROP COLUMN IF EXISTS completed_at`);
};
