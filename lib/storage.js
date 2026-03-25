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
    console.log('✅ DATABASE CONNECTED!');
    client.release();
  })
  .catch(err => {
    console.error('❌ DATABASE CONNECTION ERROR:', err.stack);
  });

// Cache: table names we've already ensured exist — avoids repeated CREATE IF NOT EXISTS
const ensuredTables = new Set();

async function ensureTable(client, name) {
  if (ensuredTables.has(name)) return;
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${name}" (id INTEGER PRIMARY KEY, data JSONB);`
  );
  // Index on data for faster JSON queries
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

// ✅ OPTIMIZED: Instead of DELETE-all + INSERT-all,
// we use UPSERT for existing items and DELETE only removed ones.
// For a list of 50 items where 1 is deleted: was 51 queries, now 2 queries.
async function writeCollection(name, dataArray) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
    await client.query('BEGIN');

    if (!dataArray || dataArray.length === 0) {
      // Just clear the table
      await client.query(`DELETE FROM "${name}"`);
    } else {
      const ids = dataArray.map(item => Number(item.id) || 0);

      // Delete rows that are no longer in the array
      await client.query(
        `DELETE FROM "${name}" WHERE id != ALL($1::int[])`,
        [ids]
      );

      // Upsert all current items in one go using unnest
      const idList = dataArray.map(item => Number(item.id) || 0);
      const dataList = dataArray.map(item => JSON.stringify(item));

      await client.query(
        `INSERT INTO "${name}" (id, data)
         SELECT * FROM unnest($1::int[], $2::jsonb[])
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [idList, dataList]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error(`Error writing collection ${name}:`, e);
  } finally {
    client.release();
  }
}

// ✅ NEW: Write a single item (insert or update) — much faster for single-record ops
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
  } finally {
    client.release();
  }
}

// ✅ NEW: Delete a single item by id — no need to rewrite entire collection
async function deleteItem(name, id) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
    await client.query(`DELETE FROM "${name}" WHERE id = $1`, [Number(id)]);
  } catch (e) {
    console.error(`Error deleting item from ${name}:`, e);
  } finally {
    client.release();
  }
}

// ✅ NEW: Read a single item by id — avoids loading entire collection
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

// Simple nextId from an in-memory array (still used in some places)
function nextId(items) {
  if (!items || items.length === 0) return 1;
  const ids = items.map(x => Number(x.id) || 0);
  return Math.max(...ids) + 1;
}

// ✅ FIXED: Get next id directly from DB — avoids id explosion after deletes
async function nextIdFor(name) {
  const client = await pool.connect();
  try {
    await ensureTable(client, name);
    const res = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM "${name}"`);
    return Number(res.rows[0].next_id);
  } catch (e) {
    console.error(`Error getting nextId for ${name}:`, e);
    return Date.now(); // fallback
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
