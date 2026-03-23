const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const {
  ensureCollection,
  readCollection,
  writeCollection,
  nextId
} = require('./lib/storage');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Supabase Storage client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Multer — store in memory, then upload to Supabase
const upload = multer({ storage: multer.memoryStorage() });

(async () => {
  await ensureCollection('users');
  await ensureCollection('siteContent');
  await ensureCollection('dictionary');
  await ensureCollection('phrases');
  await ensureCollection('proverbs');
  await ensureCollection('forumPosts');
  await ensureCollection('forumComments');
  await ensureCollection('textMaterials');
  await ensureCollection('materials');
  await ensureCollection('assignmentSubmissions');
  await ensureCollection('quizzes');
  await ensureCollection('quizAttempts');
  await ensureCollection('notifications');
  await ensureCollection('grades');
  await ensureCollection('studentGroups');
  await ensureCollection('students');
  await ensureCollection('manualJournal');
  await ensureCollection('editTasks');
  await ensureCollection('editSubmissions');
  await ensureCollection('aboutPage');
  await ensureCollection('studentActivity');
  await ensureCollection('studentProgress');
  await ensureCollection('essays');
})();

// Run cleanup after server is ready — direct SQL, no pool contention
async function runStartupCleanup() {
  try {
    const { Pool } = require('pg');
    const cleanPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
      connectionTimeoutMillis: 8000,
    });
    const client = await cleanPool.connect();
    try {
      // cleanup duplicate users — keep latest per username
      const u = await client.query(`
        DELETE FROM "users" WHERE id NOT IN (
          SELECT DISTINCT ON ((data->>'username')) id
          FROM "users" ORDER BY (data->>'username'), id DESC
        )
      `);
      if (u.rowCount > 0) console.log(`✅ Cleaned up ${u.rowCount} duplicate users`);

      // cleanup duplicate students — keep latest per name
      const s = await client.query(`
        DELETE FROM "students" WHERE id NOT IN (
          SELECT DISTINCT ON ((data->>'name')) id
          FROM "students" ORDER BY (data->>'name'), id DESC
        )
      `);
      if (s.rowCount > 0) console.log(`✅ Cleaned up ${s.rowCount} duplicate students`);
    } finally {
      client.release();
      await cleanPool.end();
    }
  } catch(e) {
    console.log('Cleanup skipped:', e.message);
  }
}

// delay cleanup by 5s so main pool settles first
setTimeout(runStartupCleanup, 5000);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── AUTH (bcrypt) ───────────────────────────────────────────────────────────
let bcrypt;
try { bcrypt = require('bcrypt'); } catch (e) { bcrypt = null; }

async function hashPassword(pw) {
  if (bcrypt) return bcrypt.hash(pw, 10);
  return pw; // fallback if bcrypt not installed yet
}
async function verifyPassword(pw, hash) {
  if (!bcrypt) return pw === hash;
  // support old plain-text passwords during migration
  if (!hash.startsWith('$2')) return pw === hash;
  return bcrypt.compare(pw, hash);
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const users = await readCollection('users');
  if (users.find(u => u.username === username)) return res.status(409).json({ error: 'username taken' });
  const hashed = await hashPassword(password);
  const newUser = { id: nextId(users), username, password: hashed, status: 'pending' };
  users.push(newUser);
  await writeCollection('users', users);
  res.status(201).json({ id: newUser.id, username: newUser.username, status: 'pending' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (username === 'admin' && password === '1234') return res.json({ role: 'teacher', username: 'admin' });
  const users = await readCollection('users');
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await verifyPassword(password, user.password);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  if (user.status === 'pending') return res.status(403).json({ error: 'pending' });
  if (user.status === 'rejected') return res.status(403).json({ error: 'rejected' });
  // users with no status = old accounts, treat as approved
  // migrate plain-text → hashed on successful login
  if (bcrypt && !user.password.startsWith('$2')) {
    user.password = await hashPassword(password);
    await writeCollection('users', users);
  }
  res.json({ role: 'student', username: user.username });
});

// ─── USER APPROVAL ──────────────────────────────────────────────────────────
app.get('/api/users/pending', async (req, res) => {
  const users = await readCollection('users');
  // deduplicate by username, keep latest
  const seen = new Set();
  const unique = users.filter(u => u.status === 'pending').reverse().filter(u => {
    if (seen.has(u.username)) return false;
    seen.add(u.username);
    return true;
  });
  res.json(unique.map(u => ({ id: u.id, username: u.username, status: u.status })));
});

app.get('/api/users/all', async (req, res) => {
  const users = await readCollection('users');
  // deduplicate by username, keep latest
  const seen = new Set();
  const unique = users.slice().reverse().filter(u => {
    if (!u.username || seen.has(u.username)) return false;
    seen.add(u.username);
    return true;
  }).reverse();
  res.json(unique.map(u => ({ id: u.id, username: u.username, status: u.status || 'approved' })));
});

// ─── USER APPROVAL (optimized — direct SQL) ──────────────────────────────────
const pg = require('pg');
const _pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

async function updateUserStatus(id, status) {
  const client = await _pool.connect();
  try {
    // find and update just the one record directly in JSONB
    const res = await client.query(`SELECT id, data FROM "users" WHERE (data->>'id')::int = $1 LIMIT 1`, [id]);
    if (!res.rows.length) return false;
    const rowId = res.rows[0].id;
    const updated = { ...res.rows[0].data, status };
    await client.query(`UPDATE "users" SET data = $1 WHERE id = $2`, [updated, rowId]);
    return true;
  } finally { client.release(); }
}

async function deleteUserById(id) {
  const client = await _pool.connect();
  try {
    await client.query(`DELETE FROM "users" WHERE (data->>'id')::int = $1`, [id]);
    return true;
  } finally { client.release(); }
}

app.patch('/api/users/:id/approve', async (req, res) => {
  const id = parseInt(req.params.id);
  const ok = await updateUserStatus(id, 'approved');
  if (!ok) return res.status(404).json({ error: 'not found' });
  // send notification
  try {
    const users = await readCollection('users');
    const user = users.find(u => u.id === id);
    if (user) {
      const notifs = await readCollection('notifications');
      notifs.push({ id: nextId(notifs), user: user.username, kind: 'approval', message: 'თქვენი ანგარიში დამტკიცებულია! შეგიძლიათ შეხვიდეთ სისტემაში.', read: false, createdAt: new Date().toISOString() });
      await writeCollection('notifications', notifs);
    }
  } catch(e) {}
  res.json({ ok: true });
});

app.patch('/api/users/:id/reject', async (req, res) => {
  const id = parseInt(req.params.id);
  const ok = await updateUserStatus(id, 'rejected');
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.delete('/api/users/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const client = await _pool.connect();
  try {
    const r = await client.query(
      `DELETE FROM "users" WHERE (data->>'id')::text = $1::text`,
      [id]
    );
    res.json({ ok: true, deleted: r.rowCount });
  } catch(e) {
    console.error('Delete user error:', e);
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.delete('/api/users/by-username/:username', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const client = await _pool.connect();
  try {
    const r = await client.query(
      `DELETE FROM "users" WHERE data->>'username' = $1`,
      [username]
    );
    res.json({ ok: true, deleted: r.rowCount });
  } catch(e) {
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ─── STUDENT PROGRESS SYNC ──────────────────────────────────────────────────
app.get('/api/progress/:username', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const items = await readCollection('studentProgress');
  const rec = items.find(x => x.username === username) || { username, points: 0, badges: [] };
  res.json(rec);
});

app.post('/api/progress/:username', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const { points, badges } = req.body || {};
  const items = await readCollection('studentProgress');
  const idx = items.findIndex(x => x.username === username);
  if (idx !== -1) {
    items[idx] = { ...items[idx], points: points ?? items[idx].points, badges: badges ?? items[idx].badges };
  } else {
    items.push({ id: nextId(items), username, points: points || 0, badges: badges || [] });
  }
  await writeCollection('studentProgress', items);
  res.json({ ok: true });
});

// ─── STUDENT ACTIVITY (heartbeat + last seen) ─────────────────────────────
app.post('/api/activity/ping', async (req, res) => {
  const { username } = req.body || {};
  if (!username || username === 'სტუმარი') return res.json({ ok: true });
  const items = await readCollection('studentActivity');
  const idx = items.findIndex(x => x.username === username);
  const now = new Date().toISOString();
  if (idx !== -1) {
    items[idx].lastSeen = now;
    items[idx].online = true;
  } else {
    items.push({ id: nextId(items), username, lastSeen: now, online: true });
  }
  await writeCollection('studentActivity', items);
  res.json({ ok: true });
});

// Mark user offline
app.post('/api/activity/offline', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.json({ ok: true });
  const items = await readCollection('studentActivity');
  const idx = items.findIndex(x => x.username === username);
  if (idx !== -1) {
    items[idx].online = false;
    items[idx].lastSeen = new Date().toISOString();
    await writeCollection('studentActivity', items);
  }
  res.json({ ok: true });
});

// Get all student activity (teacher only)
app.get('/api/activity', async (req, res) => {
  const activity = await readCollection('studentActivity');
  const students = await readCollection('students');
  const grades = await readCollection('grades');
  const groups = await readCollection('studentGroups');
  const assignments = await readCollection('assignmentSubmissions');
  const quizAttempts = await readCollection('quizAttempts');

  // deduplicate students by name
  const seen = new Set();
  const uniqueStudents = students.filter(s => {
    if (!s.name || seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  const now = Date.now();
  const enriched = uniqueStudents.map(s => {
    const act = activity.find(a => a.username === s.name) || {};
    const lastSeen = act.lastSeen ? new Date(act.lastSeen) : null;
    const diffMin = lastSeen ? (now - lastSeen.getTime()) / 60000 : Infinity;
    const online = diffMin < 3;
    const grade = grades.find(g => g.user === s.name) || {};
    const group = groups.find(g => g.user === s.name) || {};
    const assignCount = assignments.filter(a => (a.author || '').replace('👤 ', '') === s.name).length;
    const quizzes = quizAttempts.filter(q => (q.user || '').replace('👤 ', '') === s.name);
    const avgScore = quizzes.length ? Math.round(quizzes.reduce((sum, q) => sum + (q.total ? (q.score / q.total) * 100 : 0), 0) / quizzes.length) : 0;
    return {
      username: s.name,
      online,
      lastSeen: act.lastSeen || null,
      group: group.group || '',
      score: grade.score || 0,
      note: grade.note || '',
      assignments: assignCount,
      quizzes: quizzes.length,
      avgScore
    };
  });
  res.json(enriched);
});

// cleanup duplicate students
app.post('/api/users/cleanup', async (req, res) => {
  try {
    const client = await _pool.connect();
    try {
      // keep only the latest row per username, delete the rest
      await client.query(`
        DELETE FROM "users"
        WHERE id NOT IN (
          SELECT DISTINCT ON ((data->>'username')) id
          FROM "users"
          ORDER BY (data->>'username'), id DESC
        )
      `);
      res.json({ ok: true, removed: 'duplicates cleared' });
    } finally { client.release(); }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/students/cleanup', async (req, res) => {
  try {
    const client = await _pool.connect();
    try {
      await client.query(`
        DELETE FROM "students"
        WHERE id NOT IN (
          SELECT DISTINCT ON ((data->>'name')) id
          FROM "students"
          ORDER BY (data->>'name'), id DESC
        )
      `);
      res.json({ ok: true });
    } finally { client.release(); }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ABOUT PAGE ────────────────────────────────────────────────────────────
app.get('/api/about', async (req, res) => {
  const items = await readCollection('aboutPage');
  res.json(items[0] || { bio: '', photoUrl: '', extraText: '' });
});

app.post('/api/about', async (req, res) => {
  const { bio, extraText } = req.body || {};
  const items = await readCollection('aboutPage');
  if (items.length) {
    items[0].bio = bio || items[0].bio;
    items[0].extraText = extraText || items[0].extraText;
  } else {
    items.push({ id: 1, bio: bio || '', extraText: extraText || '', photoUrl: '' });
  }
  await writeCollection('aboutPage', items);
  res.json({ ok: true });
});

app.post('/api/about/photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'photo required' });
    const safeName = 'about-photo-' + Date.now() + path.extname(req.file.originalname);
    const filePath = 'about/' + safeName;
    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filePath);
    const items = await readCollection('aboutPage');
    if (items.length) { items[0].photoUrl = publicUrl; }
    else { items.push({ id: 1, bio: '', extraText: '', photoUrl: publicUrl }); }
    await writeCollection('aboutPage', items);
    res.json({ ok: true, photoUrl: publicUrl });
  } catch (e) {
    console.error('About photo upload error:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

// ─── PROVERBS ─────────────────────────────────────────────────────────────
app.get('/api/proverbs', async (req, res) => res.json(await readCollection('proverbs')));

app.post('/api/proverbs', async (req, res) => {
  const { text, meaning, source } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const items = await readCollection('proverbs');
  const item = { id: nextId(items), text, meaning: meaning || '', source: source || '', createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('proverbs', items);
  res.status(201).json(item);
});

app.put('/api/proverbs/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('proverbs');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items[idx] = { ...items[idx], ...req.body };
  await writeCollection('proverbs', items);
  res.json({ ok: true });
});

app.delete('/api/proverbs/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('proverbs');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('proverbs', items);
  res.json({ ok: true });
});

// ─── SITE CONTENT ──────────────────────────────────────────────────────────
app.get('/api/site-content', async (req, res) => {
  const items = await readCollection('siteContent');
  res.json(items[0] ? items[0] : { content: null });
});
app.post('/api/site-content', async (req, res) => {
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content required' });
  const items = await readCollection('siteContent');
  if (items.length) { items[0].content = content; } else { items.push({ id: 1, content }); }
  await writeCollection('siteContent', items);
  res.json({ ok: true });
});

// ─── DICTIONARY ────────────────────────────────────────────────────────────
app.get('/api/dictionary', async (req, res) => res.json(await readCollection('dictionary')));
app.post('/api/dictionary', async (req, res) => {
  const { word, definition } = req.body || {};
  if (!word || !definition) return res.status(400).json({ error: 'word and definition required' });
  const items = await readCollection('dictionary');
  const item = { id: nextId(items), word, definition };
  items.push(item);
  await writeCollection('dictionary', items);
  res.status(201).json(item);
});
app.delete('/api/dictionary/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('dictionary');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('dictionary', items);
  res.json({ ok: true });
});

// ─── PHRASES ───────────────────────────────────────────────────────────────
app.get('/api/phrases', async (req, res) => res.json(await readCollection('phrases')));
app.post('/api/phrases', async (req, res) => {
  const { phrase, meaning } = req.body || {};
  if (!phrase || !meaning) return res.status(400).json({ error: 'phrase and meaning required' });
  const items = await readCollection('phrases');
  const item = { id: nextId(items), phrase, meaning };
  items.push(item);
  await writeCollection('phrases', items);
  res.status(201).json(item);
});
app.delete('/api/phrases/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('phrases');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('phrases', items);
  res.json({ ok: true });
});

// ─── FORUM ─────────────────────────────────────────────────────────────────
app.get('/api/forum/posts', async (req, res) => {
  const posts = await readCollection('forumPosts');
  const comments = await readCollection('forumComments');
  res.json(posts.map(p => ({ ...p, comments: comments.filter(c => c.postId === p.id) })));
});
app.post('/api/forum/posts', async (req, res) => {
  const { author, title, body } = req.body || {};
  if (!author || !title || !body) return res.status(400).json({ error: 'author, title and body required' });
  const posts = await readCollection('forumPosts');
  const item = { id: nextId(posts), author, title, body, createdAt: new Date().toISOString() };
  posts.push(item);
  await writeCollection('forumPosts', posts);
  res.status(201).json(item);
});
app.delete('/api/forum/posts/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const posts = await readCollection('forumPosts');
  const idx = posts.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  posts.splice(idx, 1);
  await writeCollection('forumPosts', posts);
  res.json({ ok: true });
});
app.post('/api/forum/posts/:id/comments', async (req, res) => {
  const postId = parseInt(req.params.id);
  const { author, text } = req.body || {};
  if (!author || !text) return res.status(400).json({ error: 'author and text required' });
  const comments = await readCollection('forumComments');
  const item = { id: nextId(comments), postId, author, text, createdAt: new Date().toISOString() };
  comments.push(item);
  await writeCollection('forumComments', comments);
  res.status(201).json(item);
});

// ─── MATERIALS ─────────────────────────────────────────────────────────────
app.get('/api/materials', async (req, res) => res.json(await readCollection('materials')));

app.post('/api/materials/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const { title, originalFilename } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    const displayName = (originalFilename && originalFilename.trim()) ? originalFilename.trim() : req.file.originalname;
    const safeName = Date.now() + '-' + req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = 'materials/' + safeName;
    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filePath);
    const items = await readCollection('materials');
    const item = { id: nextId(items), title: title.trim(), type: 'file', originalName: displayName, fileUrl: publicUrl, createdAt: new Date().toISOString() };
    items.push(item);
    await writeCollection('materials', items);
    res.status(201).json(item);
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

app.post('/api/materials/youtube', async (req, res) => {
  const { title, url } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: 'title and url required' });
  const items = await readCollection('materials');
  const item = { id: nextId(items), title: title.trim(), type: 'youtube', url: url.trim(), createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('materials', items);
  res.status(201).json(item);
});

app.delete('/api/materials/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('materials');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('materials', items);
  res.json({ ok: true });
});

// ─── ASSIGNMENTS ───────────────────────────────────────────────────────────
app.get('/api/assignments/submissions', async (req, res) => res.json(await readCollection('assignmentSubmissions')));

app.post('/api/assignments/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const { title, author, originalFilename } = req.body || {};
    if (!title || !author) return res.status(400).json({ error: 'title and author required' });
    const displayName = (originalFilename && originalFilename.trim()) ? originalFilename.trim() : req.file.originalname;
    const safeName = Date.now() + '-' + req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = 'assignments/' + safeName;
    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filePath);
    const items = await readCollection('assignmentSubmissions');
    const item = { id: nextId(items), title, author, originalName: displayName, fileUrl: publicUrl, createdAt: new Date().toISOString() };
    items.push(item);
    await writeCollection('assignmentSubmissions', items);
    res.status(201).json(item);
  } catch (e) {
    console.error('Assignment upload error:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

app.delete('/api/assignments/submissions/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('assignmentSubmissions');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('assignmentSubmissions', items);
  res.json({ ok: true });
});

// ─── QUIZZES ───────────────────────────────────────────────────────────────
app.get('/api/quizzes', async (req, res) => res.json(await readCollection('quizzes')));
app.post('/api/quizzes', async (req, res) => {
  const { title, questions } = req.body || {};
  if (!title || !questions) return res.status(400).json({ error: 'title and questions required' });
  const items = await readCollection('quizzes');
  const item = { id: nextId(items), title, questions, createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('quizzes', items);
  res.status(201).json(item);
});
app.delete('/api/quizzes/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('quizzes');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('quizzes', items);
  res.json({ ok: true });
});

// ─── QUIZ ATTEMPTS ─────────────────────────────────────────────────────────
app.get('/api/quiz-attempts', async (req, res) => res.json(await readCollection('quizAttempts')));
app.post('/api/quiz-attempts', async (req, res) => {
  const { quizId, user, score, total } = req.body || {};
  const items = await readCollection('quizAttempts');
  const item = { id: nextId(items), quizId, user, score, total, createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('quizAttempts', items);
  res.status(201).json(item);
});

// ─── NOTIFICATIONS ─────────────────────────────────────────────────────────
app.get('/api/notifications', async (req, res) => {
  const user = req.query.user || 'all';
  const items = await readCollection('notifications');
  res.json(items.filter(n => n.user === user || n.user === 'all'));
});
app.post('/api/notifications', async (req, res) => {
  const { user, kind, message } = req.body || {};
  const items = await readCollection('notifications');
  const item = { id: nextId(items), user: user || 'all', kind, message, read: false, createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('notifications', items);
  res.status(201).json(item);
});
app.patch('/api/notifications/:id/read', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('notifications');
  const item = items.find(x => x.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });
  item.read = true;
  await writeCollection('notifications', items);
  res.json({ ok: true });
});

// ─── STUDENTS ──────────────────────────────────────────────────────────────
app.get('/api/students', async (req, res) => res.json(await readCollection('students')));
app.post('/api/students', async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const items = await readCollection('students');
  if (items.find(s => s.name === name)) return res.json(items.find(s => s.name === name));
  const item = { id: nextId(items), name, createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('students', items);
  res.status(201).json(item);
});
app.delete('/api/students/:name', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const client = await _pool.connect();
  try {
    await client.query(`DELETE FROM "students" WHERE data->>'name' = $1`, [name]);
    res.json({ ok: true });
  } catch(e) {
    console.error('Delete student error:', e);
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.delete('/api/assignments/by-author/:author', async (req, res) => {
  const author = decodeURIComponent(req.params.author);
  const client = await _pool.connect();
  try {
    await client.query(
      `DELETE FROM "assignmentSubmissions" WHERE data->>'author' LIKE $1 OR data->>'author' = $2`,
      ['%' + author, author]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

app.delete('/api/grades/by-user/:user', async (req, res) => {
  const user = decodeURIComponent(req.params.user);
  const client = await _pool.connect();
  try {
    await client.query(`DELETE FROM "grades" WHERE data->>'user' = $1`, [user]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});


app.get('/api/grades', async (req, res) => res.json(await readCollection('grades')));
app.post('/api/grades', async (req, res) => {
  const { user, score, note } = req.body || {};
  if (!user) return res.status(400).json({ error: 'user required' });
  const items = await readCollection('grades');
  const idx = items.findIndex(x => x.user === user);
  if (idx !== -1) { items[idx] = { ...items[idx], score, note }; }
  else { items.push({ id: nextId(items), user, score, note }); }
  await writeCollection('grades', items);
  res.json({ ok: true });
});

// ─── STUDENT GROUPS ────────────────────────────────────────────────────────
app.get('/api/student-groups', async (req, res) => res.json(await readCollection('studentGroups')));
app.post('/api/student-groups', async (req, res) => {
  const { user, group } = req.body || {};
  if (!user) return res.status(400).json({ error: 'user required' });
  const items = await readCollection('studentGroups');
  const idx = items.findIndex(x => x.user === user);
  if (idx !== -1) { items[idx].group = group; }
  else { items.push({ id: nextId(items), user, group }); }
  await writeCollection('studentGroups', items);
  res.json({ ok: true });
});

// ─── MANUAL JOURNAL ────────────────────────────────────────────────────────
app.get('/api/manual-journal', async (req, res) => res.json(await readCollection('manualJournal')));
app.post('/api/manual-journal', async (req, res) => {
  const payload = req.body || {};
  if (!payload.studentName) return res.status(400).json({ error: 'studentName required' });
  const items = await readCollection('manualJournal');
  const item = { id: nextId(items), ...payload, createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('manualJournal', items);
  res.status(201).json(item);
});
app.put('/api/manual-journal/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('manualJournal');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items[idx] = { ...items[idx], ...req.body };
  await writeCollection('manualJournal', items);
  res.json({ ok: true });
});
app.delete('/api/manual-journal/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('manualJournal');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('manualJournal', items);
  res.json({ ok: true });
});

// ─── EDIT TASKS ────────────────────────────────────────────────────────────
app.get('/api/edit-tasks', async (req, res) => res.json(await readCollection('editTasks')));
app.post('/api/edit-tasks', async (req, res) => {
  const { title, instructions, sourceText, correctText, createdBy } = req.body || {};
  if (!title || !sourceText) return res.status(400).json({ error: 'title and sourceText required' });
  const items = await readCollection('editTasks');
  const item = { id: nextId(items), title, instructions, sourceText, correctText, createdBy, createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('editTasks', items);
  res.status(201).json(item);
});
app.delete('/api/edit-tasks/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('editTasks');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('editTasks', items);
  res.json({ ok: true });
});

// ─── EDIT SUBMISSIONS ──────────────────────────────────────────────────────
app.get('/api/edit-submissions', async (req, res) => res.json(await readCollection('editSubmissions')));
app.post('/api/edit-submissions', async (req, res) => {
  const { taskId, student, text } = req.body || {};
  if (!taskId || !student || !text) return res.status(400).json({ error: 'taskId, student and text required' });
  const tasks = await readCollection('editTasks');
  const task = tasks.find(t => t.id === taskId);
  let autoStatus = 'unchecked';
  if (task && task.correctText) {
    autoStatus = text.trim() === task.correctText.trim() ? 'correct' : 'incorrect';
  }
  const items = await readCollection('editSubmissions');
  const item = { id: nextId(items), taskId, student, text, autoStatus, teacherStatus: null, teacherNote: '', score: 0, createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('editSubmissions', items);
  res.status(201).json(item);
});
app.patch('/api/edit-submissions/:id/review', async (req, res) => {
  const id = parseInt(req.params.id);
  const { teacherStatus, teacherNote, score } = req.body || {};
  const items = await readCollection('editSubmissions');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items[idx] = { ...items[idx], teacherStatus, teacherNote, score };
  await writeCollection('editSubmissions', items);
  res.json({ ok: true });
});

// ─── ESSAYS (მაღალქულიანი ნაშრომები) ─────────────────────────────────────────
app.get('/api/essays', async (req, res) => res.json(await readCollection('essays')));

app.post('/api/essays/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const { title, author, grade, description } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    const safeName = Date.now() + '-' + req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = 'essays/' + safeName;
    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filePath);
    const items = await readCollection('essays');
    const item = {
      id: nextId(items), title: title.trim(),
      author: author || 'უცნობი', grade: grade || '',
      description: description || '',
      originalName: req.file.originalname,
      fileUrl: publicUrl,
      mimeType: req.file.mimetype,
      createdAt: new Date().toISOString()
    };
    items.push(item);
    await writeCollection('essays', items);
    res.status(201).json(item);
  } catch (e) {
    console.error('Essay upload error:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

app.delete('/api/essays/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('essays');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('essays', items);
  res.json({ ok: true });
});

// ─── TEXT MATERIALS ────────────────────────────────────────────────────────
app.get('/api/text-materials', async (req, res) => res.json(await readCollection('textMaterials')));
app.post('/api/text-materials', async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || content === undefined) return res.status(400).json({ error: 'title and content required' });
  const items = await readCollection('textMaterials');
  const item = { id: nextId(items), title, content, createdAt: new Date().toISOString() };
  items.push(item);
  await writeCollection('textMaterials', items);
  res.status(201).json(item);
});
app.delete('/api/text-materials/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const items = await readCollection('textMaterials');
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  items.splice(idx, 1);
  await writeCollection('textMaterials', items);
  res.json({ ok: true });
});


// ─── SOCKET.IO + HTTP SERVER ─────────────────────────────────────────────────
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

// online users map: socketId -> { username, room }
const onlineUsers = new Map();

io.on('connection', (socket) => {
  // user joins with their username
  socket.on('join', ({ username }) => {
    socket.username = username;
    onlineUsers.set(socket.id, { username, socketId: socket.id });
    io.emit('users-online', [...onlineUsers.values()]);
  });

  // ── CHAT ──
  socket.on('chat-message', ({ to, text, group }) => {
    const from = socket.username;
    const msg = { from, text, time: new Date().toISOString(), id: Date.now() };
    if (to === 'all') {
      // broadcast to everyone
      io.emit('chat-message', { ...msg, channel: 'all' });
    } else if (group) {
      // broadcast to specific group tag
      io.emit('chat-message', { ...msg, channel: 'group:' + group });
    } else {
      // private message
      const target = [...onlineUsers.values()].find(u => u.username === to);
      if (target) {
        io.to(target.socketId).emit('chat-message', { ...msg, channel: 'private:' + from });
        socket.emit('chat-message', { ...msg, channel: 'private:' + to, mine: true });
      }
    }
  });

  // ── CALL SIGNALING (WebRTC) ──
  socket.on('call-invite', ({ to, group, callType, offer }) => {
    const from = socket.username;
    if (to === 'all') {
      socket.broadcast.emit('call-invite', { from, callType, offer, channel: 'all' });
    } else if (group) {
      socket.broadcast.emit('call-invite', { from, callType, offer, channel: 'group:' + group });
    } else {
      const target = [...onlineUsers.values()].find(u => u.username === to);
      if (target) io.to(target.socketId).emit('call-invite', { from, callType, offer, channel: 'private' });
    }
  });

  socket.on('call-answer', ({ to, answer }) => {
    const target = [...onlineUsers.values()].find(u => u.username === to);
    if (target) io.to(target.socketId).emit('call-answer', { from: socket.username, answer });
  });

  socket.on('call-ice', ({ to, candidate }) => {
    if (to === 'all') {
      socket.broadcast.emit('call-ice', { from: socket.username, candidate });
    } else {
      const target = [...onlineUsers.values()].find(u => u.username === to);
      if (target) io.to(target.socketId).emit('call-ice', { from: socket.username, candidate });
    }
  });

  socket.on('call-end', ({ to }) => {
    if (to === 'all') {
      socket.broadcast.emit('call-end', { from: socket.username });
    } else {
      const target = [...onlineUsers.values()].find(u => u.username === to);
      if (target) io.to(target.socketId).emit('call-end', { from: socket.username });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('users-online', [...onlineUsers.values()]);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
