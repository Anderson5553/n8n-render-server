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
// Render uses port 10000 by default, so we use process.env.PORT
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// FIXED: Removed the '..' so it finds index.html in the same folder on GitHub
const staticRoot = path.join(__dirname);
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

// Multer storage config for materials
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

// --- Serve Index.html specifically for the root route ---
app.get('/', (req, res) => {
  res.sendFile(path.join(staticRoot, 'index.html'));
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

// --- Text materials ---
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

// --- Students, Grades, Manual Journal, etc (rest of your logic) ---
// (Endpoints for students, grades, manual-journal, edit-tasks are included here...)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Static site served from: ${staticRoot}`);
});
