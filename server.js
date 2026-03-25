const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const {
  ensureCollection,
  readCollection,
  writeCollection,
  upsertItem,
  deleteItem,
  readItem,
  nextId,
  nextIdFor
} = require('./lib/storage');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const upload = multer({ storage: multer.memoryStorage() });

(async () => {
  await ensureCollection('users');
  await ensureCollection('siteContent');
  await ensureCollection('dictionary');
  await ensureCollection('phrases');
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
  await ensureCollection('proverbs');
  await ensureCollection('aboutPage');
})();

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- AUTH ---
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const users = await readCollection('users');
  if (users.find(u => u.username === username)) return res.status(409).json({ error: 'username taken' });
  const newUser = { id: await nextIdFor('users'), username, password };
  await upsertItem('users', newUser);
  res.status(201).json({ id: newUser.id, username: newUser.username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (username === 'admin' && password === '1234') return res.json({ role: 'teacher', username: 'admin' });
  const users = await readCollection('users');
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  user.lastSeen = new Date().toISOString();
  user.online = true;
  await upsertItem('users', user);
  res.json({ role: 'student', username: user.username });
});

// --- ONLINE STATUS ---
app.post('/api/online-status', async (req, res) => {
  const { username, online } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  const users = await readCollection('users');
  const user = users.find(u => u.username === username);
  if (user) {
    user.online = online !== false;
    user.lastSeen = new Date().toISOString();
    await upsertItem('users', user);
  }
  res.json({ ok: true });
});

app.get('/api/online-status', async (req, res) => {
  const users = await readCollection('users');
  const now = Date.now();
  const statuses = users.map(u => ({
    username: u.username,
    online: !!(u.online && u.lastSeen && (now - new Date(u.lastSeen).getTime()) < 3 * 60 * 1000),
    lastSeen: u.lastSeen || null
  }));
  res.json(statuses);
});

// --- SITE CONTENT ---
app.get('/api/site-content', async (req, res) => {
  const items = await readCollection('siteContent');
  res.json(items[0] || { content: null });
});
app.post('/api/site-content', async (req, res) => {
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content required' });
  await upsertItem('siteContent', { id: 1, content });
  res.json({ ok: true });
});

// --- DICTIONARY ---
app.get('/api/dictionary', async (req, res) => res.json(await readCollection('dictionary')));
app.post('/api/dictionary', async (req, res) => {
  const { word, definition } = req.body || {};
  if (!word || !definition) return res.status(400).json({ error: 'word and definition required' });
  const item = { id: await nextIdFor('dictionary'), word, definition };
  await upsertItem('dictionary', item);
  res.status(201).json(item);
});
app.delete('/api/dictionary/:id', async (req, res) => {
  await deleteItem('dictionary', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- PHRASES ---
app.get('/api/phrases', async (req, res) => res.json(await readCollection('phrases')));
app.post('/api/phrases', async (req, res) => {
  const { phrase, meaning } = req.body || {};
  if (!phrase || !meaning) return res.status(400).json({ error: 'phrase and meaning required' });
  const item = { id: await nextIdFor('phrases'), phrase, meaning };
  await upsertItem('phrases', item);
  res.status(201).json(item);
});
app.delete('/api/phrases/:id', async (req, res) => {
  await deleteItem('phrases', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- PROVERBS (ანდაზები და გამონათქვამები) ---
app.get('/api/proverbs', async (req, res) => res.json(await readCollection('proverbs')));
app.post('/api/proverbs', async (req, res) => {
  const { proverb, meaning } = req.body || {};
  if (!proverb || !meaning) return res.status(400).json({ error: 'proverb and meaning required' });
  const item = { id: await nextIdFor('proverbs'), proverb, meaning, createdAt: new Date().toISOString() };
  await upsertItem('proverbs', item);
  res.status(201).json(item);
});
app.delete('/api/proverbs/:id', async (req, res) => {
  await deleteItem('proverbs', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- ABOUT PAGE ---
app.get('/api/about', async (req, res) => {
  const items = await readCollection('aboutPage');
  res.json(items[0] || { bio: '', photoUrl: '', name: '', title: '' });
});
app.post('/api/about', async (req, res) => {
  const { bio, name, title } = req.body || {};
  const existing = await readCollection('aboutPage');
  const current = existing[0] || { id: 1 };
  const updated = { ...current, id: 1, bio: bio ?? current.bio ?? '', name: name ?? current.name ?? '', title: title ?? current.title ?? '', updatedAt: new Date().toISOString() };
  await upsertItem('aboutPage', updated);
  res.json({ ok: true, data: updated });
});
app.post('/api/about/photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'photo required' });
    const safeName = 'about/teacher-photo-' + Date.now() + path.extname(req.file.originalname);
    const { error: uploadError } = await supabase.storage.from('uploads').upload(safeName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(safeName);
    const existing = await readCollection('aboutPage');
    const current = existing[0] || { id: 1 };
    await upsertItem('aboutPage', { ...current, id: 1, photoUrl: publicUrl });
    res.json({ ok: true, photoUrl: publicUrl });
  } catch (e) {
    console.error('About photo upload error:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});

// --- FORUM ---
app.get('/api/forum/posts', async (req, res) => {
  const posts = await readCollection('forumPosts');
  const comments = await readCollection('forumComments');
  res.json(posts.map(p => ({ ...p, comments: comments.filter(c => c.postId === p.id) })));
});
app.post('/api/forum/posts', async (req, res) => {
  const { author, title, body } = req.body || {};
  if (!author || !title || !body) return res.status(400).json({ error: 'author, title and body required' });
  const item = { id: await nextIdFor('forumPosts'), author, title, body, createdAt: new Date().toISOString() };
  await upsertItem('forumPosts', item);
  res.status(201).json(item);
});
app.delete('/api/forum/posts/:id', async (req, res) => {
  await deleteItem('forumPosts', parseInt(req.params.id));
  res.json({ ok: true });
});
app.post('/api/forum/posts/:id/comments', async (req, res) => {
  const postId = parseInt(req.params.id);
  const { author, text } = req.body || {};
  if (!author || !text) return res.status(400).json({ error: 'author and text required' });
  const item = { id: await nextIdFor('forumComments'), postId, author, text, createdAt: new Date().toISOString() };
  await upsertItem('forumComments', item);
  res.status(201).json(item);
});

// --- MATERIALS ---
app.get('/api/materials', async (req, res) => res.json(await readCollection('materials')));
app.post('/api/materials/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const { title, originalFilename } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    const displayName = (originalFilename && originalFilename.trim()) ? originalFilename.trim() : req.file.originalname;
    const safeName = Date.now() + '-' + req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const { error: uploadError } = await supabase.storage.from('uploads').upload('materials/' + safeName, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl('materials/' + safeName);
    const item = { id: await nextIdFor('materials'), title: title.trim(), type: 'file', originalName: displayName, fileUrl: publicUrl, createdAt: new Date().toISOString() };
    await upsertItem('materials', item);
    res.status(201).json(item);
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});
app.post('/api/materials/youtube', async (req, res) => {
  const { title, url } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: 'title and url required' });
  const item = { id: await nextIdFor('materials'), title: title.trim(), type: 'youtube', url: url.trim(), createdAt: new Date().toISOString() };
  await upsertItem('materials', item);
  res.status(201).json(item);
});
app.delete('/api/materials/:id', async (req, res) => {
  await deleteItem('materials', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- ASSIGNMENTS ---
app.get('/api/assignments/submissions', async (req, res) => res.json(await readCollection('assignmentSubmissions')));
app.post('/api/assignments/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const { title, author, originalFilename } = req.body || {};
    if (!title || !author) return res.status(400).json({ error: 'title and author required' });
    const displayName = (originalFilename && originalFilename.trim()) ? originalFilename.trim() : req.file.originalname;
    const safeName = Date.now() + '-' + req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const { error: uploadError } = await supabase.storage.from('uploads').upload('assignments/' + safeName, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl('assignments/' + safeName);
    const item = { id: await nextIdFor('assignmentSubmissions'), title, author, originalName: displayName, fileUrl: publicUrl, createdAt: new Date().toISOString() };
    await upsertItem('assignmentSubmissions', item);
    res.status(201).json(item);
  } catch (e) {
    console.error('Assignment upload error:', e);
    res.status(500).json({ error: 'upload failed' });
  }
});
app.delete('/api/assignments/submissions/:id', async (req, res) => {
  await deleteItem('assignmentSubmissions', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- QUIZZES ---
app.get('/api/quizzes', async (req, res) => res.json(await readCollection('quizzes')));
app.post('/api/quizzes', async (req, res) => {
  const { title, questions } = req.body || {};
  if (!title || !questions) return res.status(400).json({ error: 'title and questions required' });
  const item = { id: await nextIdFor('quizzes'), title, questions, createdAt: new Date().toISOString() };
  await upsertItem('quizzes', item);
  res.status(201).json(item);
});
app.delete('/api/quizzes/:id', async (req, res) => {
  await deleteItem('quizzes', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- QUIZ ATTEMPTS ---
app.get('/api/quiz-attempts', async (req, res) => res.json(await readCollection('quizAttempts')));
app.post('/api/quiz-attempts', async (req, res) => {
  const { quizId, user, score, total } = req.body || {};
  const item = { id: await nextIdFor('quizAttempts'), quizId, user, score, total, createdAt: new Date().toISOString() };
  await upsertItem('quizAttempts', item);
  res.status(201).json(item);
});

// --- NOTIFICATIONS ---
app.get('/api/notifications', async (req, res) => {
  const user = req.query.user || 'all';
  const items = await readCollection('notifications');
  res.json(items.filter(n => n.user === user || n.user === 'all'));
});
app.post('/api/notifications', async (req, res) => {
  const { user, kind, message } = req.body || {};
  const item = { id: await nextIdFor('notifications'), user: user || 'all', kind, message, read: false, createdAt: new Date().toISOString() };
  await upsertItem('notifications', item);
  res.status(201).json(item);
});
app.patch('/api/notifications/:id/read', async (req, res) => {
  const id = parseInt(req.params.id);
  const item = await readItem('notifications', id);
  if (!item) return res.status(404).json({ error: 'not found' });
  item.read = true;
  await upsertItem('notifications', item);
  res.json({ ok: true });
});

// --- STUDENTS ---
app.get('/api/students', async (req, res) => res.json(await readCollection('students')));
app.post('/api/students', async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const items = await readCollection('students');
  const existing = items.find(s => s.name === name);
  if (existing) return res.json(existing);
  const item = { id: await nextIdFor('students'), name, createdAt: new Date().toISOString() };
  await upsertItem('students', item);
  res.status(201).json(item);
});
app.delete('/api/students/:name', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const items = await readCollection('students');
  const student = items.find(s => s.name === name);
  if (!student) return res.status(404).json({ error: 'not found' });
  await deleteItem('students', student.id);
  res.json({ ok: true });
});

// --- GRADES ---
app.get('/api/grades', async (req, res) => res.json(await readCollection('grades')));
app.post('/api/grades', async (req, res) => {
  const { user, score, note } = req.body || {};
  if (!user) return res.status(400).json({ error: 'user required' });
  const items = await readCollection('grades');
  const existing = items.find(x => x.user === user);
  if (existing) {
    await upsertItem('grades', { ...existing, score, note });
  } else {
    await upsertItem('grades', { id: await nextIdFor('grades'), user, score, note });
  }
  res.json({ ok: true });
});

// --- STUDENT GROUPS ---
app.get('/api/student-groups', async (req, res) => res.json(await readCollection('studentGroups')));
app.post('/api/student-groups', async (req, res) => {
  const { user, group } = req.body || {};
  if (!user) return res.status(400).json({ error: 'user required' });
  const items = await readCollection('studentGroups');
  const existing = items.find(x => x.user === user);
  if (existing) {
    await upsertItem('studentGroups', { ...existing, group });
  } else {
    await upsertItem('studentGroups', { id: await nextIdFor('studentGroups'), user, group });
  }
  res.json({ ok: true });
});

// --- MANUAL JOURNAL ---
app.get('/api/manual-journal', async (req, res) => res.json(await readCollection('manualJournal')));
app.post('/api/manual-journal', async (req, res) => {
  const payload = req.body || {};
  if (!payload.studentName) return res.status(400).json({ error: 'studentName required' });
  const item = { id: await nextIdFor('manualJournal'), ...payload, createdAt: new Date().toISOString() };
  await upsertItem('manualJournal', item);
  res.status(201).json(item);
});
app.put('/api/manual-journal/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const existing = await readItem('manualJournal', id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  await upsertItem('manualJournal', { ...existing, ...req.body });
  res.json({ ok: true });
});
app.delete('/api/manual-journal/:id', async (req, res) => {
  await deleteItem('manualJournal', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- EDIT TASKS ---
app.get('/api/edit-tasks', async (req, res) => res.json(await readCollection('editTasks')));
app.post('/api/edit-tasks', async (req, res) => {
  const { title, instructions, sourceText, correctText, createdBy } = req.body || {};
  if (!title || !sourceText) return res.status(400).json({ error: 'title and sourceText required' });
  const item = { id: await nextIdFor('editTasks'), title, instructions, sourceText, correctText, createdBy, createdAt: new Date().toISOString() };
  await upsertItem('editTasks', item);
  res.status(201).json(item);
});
app.delete('/api/edit-tasks/:id', async (req, res) => {
  await deleteItem('editTasks', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- EDIT SUBMISSIONS ---
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
  const item = { id: await nextIdFor('editSubmissions'), taskId, student, text, autoStatus, teacherStatus: null, teacherNote: '', score: 0, createdAt: new Date().toISOString() };
  await upsertItem('editSubmissions', item);
  res.status(201).json(item);
});
app.patch('/api/edit-submissions/:id/review', async (req, res) => {
  const id = parseInt(req.params.id);
  const { teacherStatus, teacherNote, score } = req.body || {};
  const existing = await readItem('editSubmissions', id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  await upsertItem('editSubmissions', { ...existing, teacherStatus, teacherNote, score });
  res.json({ ok: true });
});

// --- TEXT MATERIALS ---
app.get('/api/text-materials', async (req, res) => res.json(await readCollection('textMaterials')));
app.post('/api/text-materials', async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || content === undefined) return res.status(400).json({ error: 'title and content required' });
  const item = { id: await nextIdFor('textMaterials'), title, content, createdAt: new Date().toISOString() };
  await upsertItem('textMaterials', item);
  res.status(201).json(item);
});
app.delete('/api/text-materials/:id', async (req, res) => {
  await deleteItem('textMaterials', parseInt(req.params.id));
  res.json({ ok: true });
});

// --- STUDENT PROFILE VIEW (for teacher) ---
app.get('/api/student-profile/:username', async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  try {
    const [attempts, assignments, grades, groups] = await Promise.all([
      readCollection('quizAttempts'),
      readCollection('assignmentSubmissions'),
      readCollection('grades'),
      readCollection('studentGroups')
    ]);
    const myAttempts = attempts.filter(a => (a.user || '').replace('👤 ', '') === username);
    const myAssignments = assignments.filter(a => (a.author || '').replace('👤 ', '') === username);
    const grade = grades.find(g => g.user === username) || {};
    const group = groups.find(g => g.user === username) || {};
    const avgScore = myAttempts.length
      ? Math.round(myAttempts.reduce((s, x) => s + (x.total ? (x.score / x.total) * 100 : 0), 0) / myAttempts.length)
      : 0;
    res.json({
      username,
      group: group.group || '',
      score: grade.score || 0,
      note: grade.note || '',
      quizCount: myAttempts.length,
      assignmentCount: myAssignments.length,
      avgScore,
      recentAttempts: myAttempts.slice(-5).reverse(),
      recentAssignments: myAssignments.slice(-5).reverse()
    });
  } catch (e) {
    res.status(500).json({ error: 'profile load failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
