const { Client } = require('pg');

// This uses the "DATABASE_URL" (the one with Anderson_55) that you added to Render
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect()
  .then(() => console.log('✅ DATABASE CONNECTED: Supabase is now saving your data!'))
  .catch(err => console.error('❌ DATABASE ERROR:', err.stack));

async function ensureCollection(name) {
  // This creates a table in Supabase if it doesn't exist
  await client.query(`CREATE TABLE IF NOT EXISTS ${name} (id SERIAL PRIMARY KEY, data JSONB);`);
}

async function readCollection(name) {
  try {
    const res = await client.query(`SELECT data FROM ${name}`);
    return res.rows.map(row => row.data);
  } catch (e) {
    console.error(`Error reading ${name}:`, e);
    return [];
  }
}

async function writeCollection(name, dataArray) {
  try {
    // Clear the table and save the new data
    await client.query(`DELETE FROM ${name}`);
    for (const item of dataArray) {
      await client.query(`INSERT INTO ${name} (data) VALUES ($1)`, [item]);
    }
  } catch (e) {
    console.error(`Error writing ${name}:`, e);
  }
}

function nextId(collection) {
  if (!collection || !collection.length) return 1;
  return Math.max(...collection.map(item => Number(item.id) || 0)) + 1;
}

module.exports = { ensureCollection, readCollection, writeCollection, nextId };
