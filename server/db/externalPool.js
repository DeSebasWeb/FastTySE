import pg from 'pg';

let pool;

export default new Proxy({}, {
  get(_, prop) {
    if (!pool) {
      pool = new pg.Pool({
        connectionString: process.env.EXTERNAL_DB_URL,
      });
    }
    const value = pool[prop];
    return typeof value === 'function' ? value.bind(pool) : value;
  },
});
