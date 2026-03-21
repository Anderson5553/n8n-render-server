const { Client } = require('pg');

// Uses the DATABASE_URL you added to Render Environment
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect()
  .then(() => console.log('✅ DATABASE CONNECTED: Supabase is now saving your data!'))
  .catch(err => {
    console.error('❌ DATABASE CONNECTION ERROR:', err.stack);
    console.log('TIP: Check if your password Anderson_55 is correct in the Render URL.');
  });

/**
 * Ensures a table exists in the database.
 * Storing data as JSONB allows us to keep your existing object format.
 */
async function ensureCollection(name) {
  const query = `CREATE TABLE IF NOT EXISTS ${name} (id SERIAL PRIMARY KEY, data JSONB);`;
  try {
    await client.query(query);
  } catch (err) {
    console.error(`Error creating table ${name}:`, err);
  }
}

/**
 * Reads all data from a Supabase table.
 */
async function readCollection(name) {
  try {
    await ensureCollection(name);
    const res = await client.query(`SELECT data FROM ${name} ORDER BY id ASC`);
    return res.rows.map(row => row.data);
  } catch (e) {
    console.error(`Error reading collection ${name}:`, e);
    return [];
  }
}

/**
 * Writes the entire array to the Supabase table.
 * (Clears old data and inserts new to match your previous file logic)
 */
async function writeCollection(name, dataArray) {
  try {
    await ensureCollection(name);
    // Transaction to ensure data safety
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${name}`);
    
    for (const item of dataArray) {
      await client.query(`INSERT INTO ${name} (data) VALUES ($1)`, [item]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`Error writing collection ${name}:`, e);
  }
}

/**
 * Calculates the next ID for a new item.
 */
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
