const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
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

const staticRoot = path.join(__dirname);
app.use(express.static(staticRoot));

const uploadsAssignments = path.join(staticRoot, 'uploads', 'assignments');
const uploadsMaterials = path.join(staticRoot, 'uploads', 'materials');
fs.mkdirSync(uploadsAssignments, { recursive: true });
fs.mkdirSync(uploadsMaterials, { recursive: true });

const storageAssignments = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadsAssignments); },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + '-' + safeName);
  }
});

const storageMaterials = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadsMaterials); },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + '-' + safeName);
  }
});

const upload = multer({ storage: storageAssignments });
const uploadMaterial = multer({ storage: storageMaterials });

(async () => {
  await ensureCollection('dictionary');
  await ensureCollection('forumPosts');
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
})();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(staticRoot, 'index.html'));
});

// --- Dictionary ---
app.get('/api/dictionary', async (req, res) => {
  const dictionary = await readCollection('dictionary');
  res.json(dictionary);
});

app.post('/api/dictionary', async (req, res) => {
  const { word, definition } = req.body || {};
  if (!word || !definition) return res.status(400).json({ error: 'word and definition are required' });
  const dictionary = await readCollection('dictionary');
  const newItem = { id: nextId(dictionary), word, definition };
  dictionary.push(newItem);
  await writeCollection('dictionary', dictionary);
  res.status(201).json(newItem);
});

// --- Forum ---
app.get('/api/forum/posts', async (req, res) => {
  const forumPosts = await readCollection('forumPosts');
  res.json(forumPosts);
});

app.post('/api/forum/posts', async (req, res) => {
  const { author, title, body } = req.body || {};
  if (!author || !title || !body) return res.status(400).json({ error: 'author, title and body are required' });
  const forumPosts = await readCollection('forumPosts');
  const newPost = { id: nextId(forumPosts), author, title, body, createdAt: new Date().toISOString() };
  forumPosts.push(newPost);
  await writeCollection('forumPosts', forumPosts);
  res.status(201).json(newPost);
});

// --- Text Materials ---
app.get('/api/text-materials', async (req, res) => {
  const textMaterials = await readCollection('textMaterials');
  res.json(textMaterials);
});

app.post('/api/text-materials', async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || content === undefined) return res.status(400).json({ error: 'title and content are required' });
  const textMaterials = await readCollection('textMaterials');
  const item = { id: nextId(textMaterials), title, content, createdAt: new Date().toISOString() };
  textMaterials.push(item);
  await writeCollection('textMaterials', textMaterials);
  res.status(201).json(item);
});

app.delete('/api/text-materials/:id', async (req, res) => {
  const textMaterials = await readCollection('textMaterials');
  const id = parseInt(req.params.id, 10);
  const idx = textMaterials.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  textMaterials.splice(idx, 1);
  await writeCollection('textMaterials', textMaterials);
  res.json({ ok: true });
});

// --- Materials ---
app.get('/api/materials', async (req, res) => {
  const materials = await readCollection('materials');
  res.json(materials);
});

app.post('/api/materials/upload', uploadMaterial.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    const { title, originalFilename } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
    const displayName = (originalFilename && originalFilename.trim()) ? originalFilename.trim() : req.file.originalname;
    const fileUrl = '/' + path.join('uploads', 'materials', req.file.filename).replace(/\\/g, '/');
    const materials = await readCollection('materials');
    const item = { id: nextId(materials), title: title.trim(), type: 'file', originalName: displayName, fileUrl, createdAt: new Date().toISOString() };
    materials.push(item);
    await writeCollection('materials', materials);
    res.status(201).json(item);
  } catch (e) {
    console.error('Materials upload error', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/api/materials/youtube', async (req, res) => {
  const { title, url } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: 'title and url are required' });
  const materials = await readCollection('materials');
  const item = { id: nextId(materials), title: title.trim(), type: 'youtube', url: url.trim(), createdAt: new Date().toISOString() };
  materials.push(item);
  await writeCollection('materials', materials);
  res.status(201).json(item);
});

app.delete('/api/materials/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const materials = await readCollection('materials');
  const idx = materials.findIndex((m) => m.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  materials.splice(idx, 1);
  await writeCollection('materials', materials);
  res.json({ ok: true });
});

// --- Assignment Submissions ---
app.get('/api/assignments/submissions', async (req, res) => {
  const submissions = await readCollection('assignmentSubmissions');
  res.json(submissions);
});

app.post('/api/assignments/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    const { title, author, originalFilename } = req.body || {};
    if (!title || !author) return res.status(400).json({ error: 'title and author are required' });
    const displayName = (originalFilename && originalFilename.trim()) ? originalFilename.trim() : req.file.originalname;
    const fileUrl = '/' + path.join('uploads', 'assignments', req.file.filename).replace(/\\/g, '/');
    const submissions = await readCollection('assignmentSubmissions');
    const item = { id: nextId(submissions), title, author, originalName: displayName, fileUrl, createdAt: new Date().toISOString() };
    submissions.push(item);
    await writeCollection('assignmentSubmissions', submissions);
    res.status(201).json(item);
  } catch (e) {
    console.error('Upload error', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// --- Students ---
app.get('/api/students', async (req, res) => {
  const students = await readCollection('students');
  res.json(students);
});

app.post('/api/students', async (req, res) => {
  const { name, group } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const students = await readCollection('students');
  const item = { id: nextId(students), name, group: group || '', createdAt: new Date().toISOString() };
  students.push(item);
  await writeCollection('students', students);
  res.status(201).json(item);
});

app.delete('/api/students/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const students = await readCollection('students');
  const idx = students.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  students.splice(idx, 1);
  await writeCollection('students', students);
  res.json({ ok: true });
});

// --- Grades ---
app.get('/api/grades', async (req, res) => {
  const grades = await readCollection('grades');
  res.json(grades);
});

app.post('/api/grades', async (req, res) => {
  const { studentId, subject, grade } = req.body || {};
  if (!studentId || !subject || grade === undefined) return res.status(400).json({ error: 'studentId, subject and grade are required' });
  const grades = await readCollection('grades');
  const item = { id: nextId(grades), studentId, subject, grade, createdAt: new Date().toISOString() };
  grades.push(item);
  await writeCollection('grades', grades);
  res.status(201).json(item);
});

// --- Manual Journal ---
app.get('/api/manual-journal', async (req, res) => {
  const manualJournal = await readCollection('manualJournal');
  res.json(manualJournal);
});

app.post('/api/manual-journal', async (req, res) => {
  const { studentId, date, status } = req.body || {};
  if (!studentId || !date || !status) return res.status(400).json({ error: 'studentId, date and status are required' });
  const manualJournal = await readCollection('manualJournal');
  const item = { id: nextId(manualJournal), studentId, date, status, createdAt: new Date().toISOString() };
  manualJournal.push(item);
  await writeCollection('manualJournal', manualJournal);
  res.status(201).json(item);
});

// --- Notifications ---
app.get('/api/notifications', async (req, res) => {
  const notifications = await readCollection('notifications');
  res.json(notifications);
});

app.post('/api/notifications', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });
  const notifications = await readCollection('notifications');
  const item = { id: nextId(notifications), message, createdAt: new Date().toISOString() };
  notifications.push(item);
  await writeCollection('notifications', notifications);
  res.status(201).json(item);
});

// --- Quizzes ---
app.get('/api/quizzes', async (req, res) => {
  const quizzes = await readCollection('quizzes');
  res.json(quizzes);
});

app.post('/api/quizzes', async (req, res) => {
  const { title, questions } = req.body || {};
  if (!title || !questions) return res.status(400).json({ error: 'title and questions are required' });
  const quizzes = await readCollection('quizzes');
  const item = { id: nextId(quizzes), title, questions, createdAt: new Date().toISOString() };
  quizzes.push(item);
  await writeCollection('quizzes', quizzes);
  res.status(201).json(item);
});

// --- Edit Tasks ---
app.get('/api/edit-tasks', async (req, res) => {
  const editTasks = await readCollection('editTasks');
  res.json(editTasks);
});

app.post('/api/edit-tasks', async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
  const editTasks = await readCollection('editTasks');
  const item = { id: nextId(editTasks), title, content, createdAt: new Date().toISOString() };
  editTasks.push(item);
  await writeCollection('editTasks', editTasks);
  res.status(201).json(item);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Static site served from: ${staticRoot}`);
});
