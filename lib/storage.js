const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.connect()
  .then(client => {
    console.log('✅ DATABASE CONNECTED: Supabase is now saving your data!');
    client.release();
  })
  .catch(err => {
    console.error('❌ DATABASE CONNECTION ERROR:', err.stack);
  });

async function ensureCollection(name) {
  const query = `CREATE TABLE IF NOT EXISTS "${name}" (id SERIAL PRIMARY KEY, data JSONB);`;
  const client = await pool.connect();
  try {
    await client.query(query);
  } catch (err) {
    console.error(`Error creating table ${name}:`, err);
  } finally {
    client.release();
  }
}

async function readCollection(name) {
  const client = await pool.connect();
  try {
    await ensureCollection(name);
    const res = await client.query(`SELECT data FROM "${name}" ORDER BY id ASC`);
    return res.rows.map(row => row.data);
  } catch (e) {
    console.error(`Error reading collection ${name}:`, e);
    return [];
  } finally {
    client.release();
  }
}

async function writeCollection(name, dataArray) {
  const client = await pool.connect();
  try {
    await ensureCollection(name);
    await client.query('BEGIN');
    await client.query(`DELETE FROM "${name}"`);
    for (const item of dataArray) {
      await client.query(`INSERT INTO "${name}" (data) VALUES ($1)`, [item]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`Error writing collection ${name}:`, e);
  } finally {
    client.release();
  }
}

function nextId(items) {
  if (!items || items.length === 0) return 1;
  const ids = items.map(x => Number(x.id) || 0);
  return Math.max(...ids) + 1;
}

module.exports = {
  ensureCollection,
  readCollection,
  writeCollection,
  nextId
};
