const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
});

pool.connect()
  .then(client => {
    console.log('✅ DATABASE CONNECTED!');
    client.release();
  })
  .catch(err => {
    console.error('❌ DATABASE CONNECTION ERROR:', err.stack);
  });

// Cache: table names we've already ensured exist
const ensuredTables = new Set();

async function ensureTable(client, name) {
  if (ensuredTables.has(name)) return;
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${name}" (id INTEGER PRIMARY KEY, data JSONB);`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS "idx_${name}_data" ON "${name}" USING GIN (data);`
  );
  ensuredTables.add(name);
}

async function ensureCollection(name) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
  } catch (err) {
    console.error(`Error creating table ${name}:`, err);
  } finally {
    client.release();
  }
}

async function readCollection(name) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
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
    await ensureTable(client, name);
    await client.query('BEGIN');

    if (!dataArray || dataArray.length === 0) {
      await client.query(`DELETE FROM "${name}"`);
    } else {
      // ✅ FIX: Deduplicate by id — keep last occurrence
      // This prevents "ON CONFLICT DO UPDATE command cannot affect row a second time"
      const seen = new Map();
      for (const item of dataArray) {
        const id = Number(item.id) || 0;
        seen.set(id, item); // last one wins
      }
      const unique = Array.from(seen.values());
      const ids = unique.map(item => Number(item.id) || 0);

      // Delete rows no longer in the array
      await client.query(
        `DELETE FROM "${name}" WHERE id != ALL($1::int[])`,
        [ids]
      );

      // ✅ FIX: Use individual upserts instead of batch unnest
      // unnest crashes when duplicate ids appear in the same batch
      for (const item of unique) {
        const id = Number(item.id) || 0;
        await client.query(
          `INSERT INTO "${name}" (id, data) VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
          [id, JSON.stringify(item)]
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error(`Error writing collection ${name}:`, e);
    throw e; // re-throw so callers know it failed
  } finally {
    client.release();
  }
}

// Write a single item (insert or update)
async function upsertItem(name, item) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
    const id = Number(item.id) || 0;
    await client.query(
      `INSERT INTO "${name}" (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [id, JSON.stringify(item)]
    );
  } catch (e) {
    console.error(`Error upserting item in ${name}:`, e);
    throw e;
  } finally {
    client.release();
  }
}

// Delete a single item by id
async function deleteItem(name, id) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
    await client.query(`DELETE FROM "${name}" WHERE id = $1`, [Number(id)]);
  } catch (e) {
    console.error(`Error deleting item from ${name}:`, e);
    throw e;
  } finally {
    client.release();
  }
}

// Read a single item by id
async function readItem(name, id) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
    const res = await client.query(`SELECT data FROM "${name}" WHERE id = $1`, [Number(id)]);
    return res.rows.length ? res.rows[0].data : null;
  } catch (e) {
    console.error(`Error reading item from ${name}:`, e);
    return null;
  } finally {
    client.release();
  }
}

// nextId from in-memory array
function nextId(items) {
  if (!items || items.length === 0) return 1;
  const ids = items.map(x => Number(x.id) || 0);
  return Math.max(...ids) + 1;
}

// Get next id directly from DB
async function nextIdFor(name) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
    const res = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM "${name}"`);
    return Number(res.rows[0].next_id);
  } catch (e) {
    console.error(`Error getting nextId for ${name}:`, e);
    return Date.now();
  } finally {
    client.release();
  }
}

module.exports = {
  ensureCollection,
  readCollection,
  writeCollection,
  upsertItem,
  deleteItem,
  readItem,
  nextId,
  nextIdFor
};
