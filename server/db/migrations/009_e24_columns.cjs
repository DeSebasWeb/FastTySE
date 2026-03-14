exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE evidences ADD COLUMN IF NOT EXISTS image_data_e24 TEXT;
    ALTER TABLE evidences ADD COLUMN IF NOT EXISTS rotation_e24 INT DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE evidences DROP COLUMN IF EXISTS image_data_e24;
    ALTER TABLE evidences DROP COLUMN IF EXISTS rotation_e24;
  `);
};
