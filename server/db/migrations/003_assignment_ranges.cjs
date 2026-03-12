exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE assignments
      ADD COLUMN range_from INT,
      ADD COLUMN range_to   INT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE assignments
      DROP COLUMN IF EXISTS range_from,
      DROP COLUMN IF EXISTS range_to;
  `);
};
