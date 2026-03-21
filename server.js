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
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve the existing static site (index.html, etc.)
const staticRoot = path.join(__dirname, '..');
app.use(express.static(staticRoot));

// Ensure uploads directories exist
const uploadsAssignments = path.join(staticRoot, 'uploads', 'assignments');
const uploadsMaterials = path.join(staticRoot, 'uploads', 'materials');
fs.mkdirSync(uploadsAssignments, { recursive: true });
fs.mkdirSync(uploadsMaterials, { recursive: true });

// Multer storage config for assignments
const storageAssignments = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsAssignments);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + safeName);
  }
});

// Multer storage config for materials (PDF, Word, PowerPoint, etc.)
const storageMaterials = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsMaterials);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + safeName);
  }
});

const upload = multer({ storage: storageAssignments });
const uploadMaterial = multer({ storage: storageMaterials });

// --- Persistent collections (JSON files) ---
ensureCollection('dictionary', [
  { id: 1, word: 'ლმობიერი', definition: 'შემბრალებელი, გულჩვილი.' },
  { id: 2, word: 'ნუკრი', definition: 'შველის (ან ირმის) ნაშიერი.' },
  { id: 3, word: 'აბჯარი', definition: 'მეომრის დამცავი აღჭურვილობა.' }
]);
ensureCollection('forumPosts', []);
ensureCollection('textMaterials', []);
ensureCollection('materials', []);
ensureCollection('assignmentSubmissions', []);
ensureCollection('quizzes', []);
ensureCollection('quizAttempts', []);
ensureCollection('notifications', []);
ensureCollection('grades', []);
ensureCollection('studentGroups', []);
ensureCollection('students', []);
ensureCollection('manualJournal', []);
ensureCollection('editTasks', []);
ensureCollection('editSubmissions', []);

// --- Basic health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// --- Dictionary endpoints ---
app.get('/api/dictionary', (req, res) => {
  const dictionary = readCollection('dictionary', []);
  res.json(dictionary);
});

app.post('/api/dictionary', (req, res) => {
  const { word, definition } = req.body || {};
  if (!word || !definition) {
    return res.status(400).json({ error: 'word and definition are required' });
  }
  const dictionary = readCollection('dictionary', []);
  const newItem = {
    id: nextId(dictionary),
    word,
    definition
  };
  dictionary.push(newItem);
  writeCollection('dictionary', dictionary);
  res.status(201).json(newItem);
});

// --- Forum endpoints ---
app.get('/api/forum/posts', (req, res) => {
  const forumPosts = readCollection('forumPosts', []);
  res.json(forumPosts);
});

app.post('/api/forum/posts', (req, res) => {
  const { author, title, body } = req.body || {};
  if (!author || !title || !body) {
    return res.status(400).json({ error: 'author, title and body are required' });
  }
  const forumPosts = readCollection('forumPosts', []);
  const newPost = {
    id: nextId(forumPosts),
    author,
    title,
    body,
    createdAt: new Date().toISOString()
  };
  forumPosts.push(newPost);
  writeCollection('forumPosts', forumPosts);
  res.status(201).json(newPost);
});

// --- Text materials (teacher upload, student download) ---
app.get('/api/text-materials', (req, res) => {
  const textMaterials = readCollection('textMaterials', []);
  res.json(textMaterials);
});

app.post('/api/text-materials', (req, res) => {
  const { title, content } = req.body || {};
  if (!title || content === undefined) {
    return res.status(400).json({ error: 'title and content are required' });
  }
  const textMaterials = readCollection('textMaterials', []);
  const id = nextId(textMaterials);
  const item = { id, title, content, createdAt: new Date().toISOString() };
  textMaterials.push(item);
  writeCollection('textMaterials', textMaterials);
  res.status(201).json(item);
});

app.delete('/api/text-materials/:id', (req, res) => {
  const textMaterials = readCollection('textMaterials', []);
  const id = parseInt(req.params.id, 10);
  const idx = textMaterials.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  textMaterials.splice(idx, 1);
  writeCollection('textMaterials', textMaterials);
  res.json({ ok: true });
});

// --- Materials metadata ---
app.get('/api/materials', (req, res) => {
  const materials = readCollection('materials', []);
  res.json(materials);
});

// --- Materials upload (PDF, Word, PowerPoint, etc.) ---
app.post('/api/materials/upload', uploadMaterial.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }
    const { title, originalFilename } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const displayName = (originalFilename && originalFilename.trim()) ? originalFilename.trim() : req.file.originalname;
    const relativePath = path.join('uploads', 'materials', req.file.filename).replace(/\\/g, '/');
    const fileUrl = '/' + relativePath;
    const materials = readCollection('materials', []);
    const item = {
      id: nextId(materials),
      title: title.trim(),
      type: 'file',
      originalName: displayName,
      fileUrl,
      createdAt: new Date().toISOString()
    };
    materials.push(item);
    writeCollection('materials', materials);
    res.status(201).json(item);
  } catch (e) {
    console.error('Materials upload error', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/api/materials/youtube', (req, res) => {
  const { title, url } = req.body || {};
  if (!title || !url) {
    return res.status(400).json({ error: 'title and url are required' });
  }
  const materials = readCollection('materials', []);
  const item = {
    id: nextId(materials),
    title: title.trim(),
    type: 'youtube',
    url: url.trim(),
    createdAt: new Date().toISOString()
  };
  materials.push(item);
  writeCollection('materials', materials);
  res.status(201).json(item);
});

app.delete('/api/materials/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const materials = readCollection('materials', []);
  const idx = materials.findIndex((m) => m.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  materials.splice(idx, 1);
  writeCollection('materials', materials);
  res.json({ ok: true });
});

app.get('/api/assignments/submissions', (req, res) => {
  const submissions = readCollection('assignmentSubmissions', []);
  res.json(submissions);
});

// --- Assignment upload endpoint ---
app.post('/api/assignments/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }
    const { title, author, originalFilename } = req.body || {};
    if (!title || !author) {
      return res.status(400).json({ error: 'title and author are required' });
    }
    const displayName = (originalFilename && originalFilename.trim()) ? originalFilename.trim() : req.file.originalname;
    const relativePath = path.join('uploads', 'assignments', req.file.filename).replace(/\\/g, '/');
    const fileUrl = '/' + relativePath;

    const submissions = readCollection('assignmentSubmissions', []);
    const item = {
      id: nextId(submissions),
      title,
      author,
      originalName: displayName,
      fileUrl,
      createdAt: new Date().toISOString()
    };
    submissions.push(item);
    writeCollection('assignmentSubmissions', submissions);
    res.status(201).json(item);
  } catch (e) {
    console.error('Upload error', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// --- Quizzes ---
app.get('/api/quizzes', (req, res) => {
  const quizzes = readCollection('quizzes', []);
  res.json(quizzes);
});

app.post('/api/quizzes', (req, res) => {
  const { title, questions, createdBy } = req.body || {};
  if (!title || !Array.isArray(questions) || !questions.length) {
    return res.status(400).json({ error: 'title and questions are required' });
  }
  const normalized = questions
    .map((q) => ({
      text: (q.text || '').trim(),
      options: Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [],
      correctIndex: Number.isInteger(q.correctIndex) ? q.correctIndex : 0
    }))
    .filter((q) => q.text && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length);

  if (!normalized.length) {
    return res.status(400).json({ error: 'at least one valid question is required' });
  }

  const quizzes = readCollection('quizzes', []);
  const item = {
    id: nextId(quizzes),
    title: title.trim(),
    questions: normalized,
    createdBy: createdBy || 'teacher',
    createdAt: new Date().toISOString()
  };
  quizzes.push(item);
  writeCollection('quizzes', quizzes);
  res.status(201).json(item);
});

app.delete('/api/quizzes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const quizzes = readCollection('quizzes', []);
  const idx = quizzes.findIndex((q) => q.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  quizzes.splice(idx, 1);
  writeCollection('quizzes', quizzes);
  res.json({ ok: true });
});

app.get('/api/quiz-attempts', (req, res) => {
  const attempts = readCollection('quizAttempts', []);
  res.json(attempts);
});

app.post('/api/quiz-attempts', (req, res) => {
  const { quizId, user, score, total } = req.body || {};
  if (!quizId || !user || total === undefined || score === undefined) {
    return res.status(400).json({ error: 'quizId, user, score and total are required' });
  }
  const attempts = readCollection('quizAttempts', []);
  const item = {
    id: nextId(attempts),
    quizId,
    user,
    score,
    total,
    createdAt: new Date().toISOString()
  };
  attempts.push(item);
  writeCollection('quizAttempts', attempts);
  res.status(201).json(item);
});

// --- Notifications ---
app.get('/api/notifications', (req, res) => {
  const notifications = readCollection('notifications', []);
  const user = (req.query.user || '').toString().trim();
  if (!user) return res.json(notifications);
  res.json(notifications.filter((n) => n.user === user || n.user === 'all'));
});

app.post('/api/notifications', (req, res) => {
  const { user = 'all', message, kind = 'info' } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });
  const notifications = readCollection('notifications', []);
  const item = {
    id: nextId(notifications),
    user,
    kind,
    message,
    read: false,
    createdAt: new Date().toISOString()
  };
  notifications.push(item);
  writeCollection('notifications', notifications);
  res.status(201).json(item);
});

app.patch('/api/notifications/:id/read', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const notifications = readCollection('notifications', []);
  const item = notifications.find((n) => n.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  item.read = true;
  writeCollection('notifications', notifications);
  res.json(item);
});

// --- Grades / Groups ---
app.get('/api/grades', (req, res) => {
  const grades = readCollection('grades', []);
  res.json(grades);
});

app.post('/api/grades', (req, res) => {
  const { user, score, note } = req.body || {};
  if (!user) return res.status(400).json({ error: 'user is required' });
  const grades = readCollection('grades', []);
  const existing = grades.find((g) => g.user === user);
  if (existing) {
    existing.score = Number(score) || 0;
    existing.note = (note || '').toString();
    existing.updatedAt = new Date().toISOString();
    writeCollection('grades', grades);
    return res.json(existing);
  }
  const item = {
    id: nextId(grades),
    user,
    score: Number(score) || 0,
    note: (note || '').toString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  grades.push(item);
  writeCollection('grades', grades);
  res.status(201).json(item);
});

app.get('/api/student-groups', (req, res) => {
  const groups = readCollection('studentGroups', []);
  res.json(groups);
});

app.post('/api/student-groups', (req, res) => {
  const { user, group } = req.body || {};
  if (!user) return res.status(400).json({ error: 'user is required' });
  const groups = readCollection('studentGroups', []);
  const existing = groups.find((g) => g.user === user);
  if (existing) {
    existing.group = (group || '').toString().trim();
    existing.updatedAt = new Date().toISOString();
    writeCollection('studentGroups', groups);
    return res.json(existing);
  }
  const item = {
    id: nextId(groups),
    user,
    group: (group || '').toString().trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  groups.push(item);
  writeCollection('studentGroups', groups);
  res.status(201).json(item);
});

app.get('/api/students', (req, res) => {
  const students = readCollection('students', []);
  res.json(students);
});

app.post('/api/students', (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const students = readCollection('students', []);
  const normalized = name.trim();
  const exists = students.find((s) => (s.name || '').toLowerCase() === normalized.toLowerCase());
  if (exists) return res.json(exists);
  const item = {
    id: nextId(students),
    name: normalized,
    createdAt: new Date().toISOString()
  };
  students.push(item);
  writeCollection('students', students);
  res.status(201).json(item);
});

app.delete('/api/students/:name', (req, res) => {
  const target = decodeURIComponent(req.params.name || '').trim().toLowerCase();
  const students = readCollection('students', []);
  const next = students.filter((s) => ((s.name || '').trim().toLowerCase() !== target));
  if (next.length === students.length) return res.status(404).json({ error: 'Not found' });
  writeCollection('students', next);
  res.json({ ok: true });
});

app.get('/api/manual-journal', (req, res) => {
  const rows = readCollection('manualJournal', []);
  res.json(rows);
});

app.post('/api/manual-journal', (req, res) => {
  const {
    studentName,
    groupName = '',
    assignments = 0,
    quizzes = 0,
    avgPercent = 0,
    score = 0,
    note = ''
  } = req.body || {};
  if (!studentName || !String(studentName).trim()) {
    return res.status(400).json({ error: 'studentName is required' });
  }
  const rows = readCollection('manualJournal', []);
  const item = {
    id: nextId(rows),
    studentName: String(studentName).trim(),
    groupName: String(groupName).trim(),
    assignments: Number(assignments) || 0,
    quizzes: Number(quizzes) || 0,
    avgPercent: Number(avgPercent) || 0,
    score: Number(score) || 0,
    note: String(note || ''),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  rows.push(item);
  writeCollection('manualJournal', rows);
  res.status(201).json(item);
});

app.put('/api/manual-journal/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = readCollection('manualJournal', []);
  const item = rows.find((r) => r.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const body = req.body || {};
  if (body.studentName !== undefined) item.studentName = String(body.studentName || '').trim();
  if (body.groupName !== undefined) item.groupName = String(body.groupName || '').trim();
  if (body.assignments !== undefined) item.assignments = Number(body.assignments) || 0;
  if (body.quizzes !== undefined) item.quizzes = Number(body.quizzes) || 0;
  if (body.avgPercent !== undefined) item.avgPercent = Number(body.avgPercent) || 0;
  if (body.score !== undefined) item.score = Number(body.score) || 0;
  if (body.note !== undefined) item.note = String(body.note || '');
  item.updatedAt = new Date().toISOString();
  writeCollection('manualJournal', rows);
  res.json(item);
});

app.delete('/api/manual-journal/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = readCollection('manualJournal', []);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  rows.splice(idx, 1);
  writeCollection('manualJournal', rows);
  res.json({ ok: true });
});

// --- Text editing tasks ---
app.get('/api/edit-tasks', (req, res) => {
  const tasks = readCollection('editTasks', []);
  res.json(tasks);
});

app.post('/api/edit-tasks', (req, res) => {
  const { title, sourceText, correctText = '', instructions = '', createdBy = 'teacher' } = req.body || {};
  if (!title || !sourceText) {
    return res.status(400).json({ error: 'title and sourceText are required' });
  }
  const tasks = readCollection('editTasks', []);
  const item = {
    id: nextId(tasks),
    title: String(title).trim(),
    sourceText: String(sourceText),
    correctText: String(correctText || ''),
    instructions: String(instructions || ''),
    createdBy: String(createdBy || 'teacher'),
    createdAt: new Date().toISOString()
  };
  tasks.push(item);
  writeCollection('editTasks', tasks);
  res.status(201).json(item);
});

app.delete('/api/edit-tasks/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tasks = readCollection('editTasks', []);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  tasks.splice(idx, 1);
  writeCollection('editTasks', tasks);
  res.json({ ok: true });
});

app.get('/api/edit-submissions', (req, res) => {
  const submissions = readCollection('editSubmissions', []);
  const taskId = Number(req.query.taskId || 0);
  if (!taskId) return res.json(submissions);
  res.json(submissions.filter((s) => Number(s.taskId) === taskId));
});

app.post('/api/edit-submissions', (req, res) => {
  const { taskId, student, text } = req.body || {};
  if (!taskId || !student || !text) {
    return res.status(400).json({ error: 'taskId, student, text are required' });
  }
  const tasks = readCollection('editTasks', []);
  const task = tasks.find((t) => t.id === Number(taskId));
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const isCorrect = task.correctText ? normalize(text) === normalize(task.correctText) : null;

  const submissions = readCollection('editSubmissions', []);
  const item = {
    id: nextId(submissions),
    taskId: Number(taskId),
    student: String(student),
    text: String(text),
    autoStatus: isCorrect === null ? 'unchecked' : (isCorrect ? 'correct' : 'incorrect'),
    teacherStatus: 'pending',
    teacherNote: '',
    score: isCorrect === true ? 100 : (isCorrect === false ? 0 : 0),
    createdAt: new Date().toISOString(),
    reviewedAt: null
  };
  submissions.push(item);
  writeCollection('editSubmissions', submissions);
  res.status(201).json(item);
});

app.patch('/api/edit-submissions/:id/review', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { teacherStatus = 'checked', teacherNote = '', score = 0 } = req.body || {};
  const submissions = readCollection('editSubmissions', []);
  const item = submissions.find((s) => s.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  item.teacherStatus = String(teacherStatus);
  item.teacherNote = String(teacherNote || '');
  item.score = Number(score) || 0;
  item.reviewedAt = new Date().toISOString();
  writeCollection('editSubmissions', submissions);
  res.json(item);
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Static site served from: ${staticRoot}`);
});

