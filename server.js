const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Directories ─────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const DB_FILE     = path.join(__dirname, 'db.json');

[UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── DB helpers ───────────────────────────────────────────────────────────────
function readDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (_) {}
  return { photos: [], quotes: [], playlist: [], settings: { theme: 'midnight', moods: [] } };
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename:    (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },          // 10 MB
  fileFilter: (_, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API: Settings ─────────────────────────────────────────────────────────────
app.get('/api/settings', (_, res) => {
  const db = readDB();
  res.json(db.settings);
});

app.patch('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json(db.settings);
});

// ── API: Photos ───────────────────────────────────────────────────────────────
app.get('/api/photos', (_, res) => {
  res.json(readDB().photos);
});

app.post('/api/photos', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });

  const db = readDB();
  const rots = [-7, -5, -3, -1, 1, 3, 5, 7];
  const photo = {
    id:       uuidv4(),
    filename: req.file.filename,
    caption:  req.body.caption || '',
    rot:      rots[Math.floor(Math.random() * rots.length)],
    taped:    Math.random() > 0.55,
    tapeRot:  (Math.random() * 10 - 5).toFixed(1),
    order:    Date.now(),
    type:     'photo'
  };

  db.photos.push(photo);
  writeDB(db);
  res.status(201).json(photo);
});

app.delete('/api/photos/:id', (req, res) => {
  const db = readDB();
  const photo = db.photos.find(p => p.id === req.params.id);
  if (photo) {
    const filePath = path.join(UPLOADS_DIR, photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.photos = db.photos.filter(p => p.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── API: Quotes ───────────────────────────────────────────────────────────────
app.get('/api/quotes', (_, res) => {
  res.json(readDB().quotes);
});

app.post('/api/quotes', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text' });

  const db = readDB();
  const bubbleStyles = ['standard', 'alt', 'center'];
  const quote = {
    id:    uuidv4(),
    text:  text.trim(),
    style: bubbleStyles[db.quotes.length % bubbleStyles.length],
    stars: Math.floor(Math.random() * 3) + 3,
    order: Date.now(),
    type:  'quote'
  };

  db.quotes.push(quote);
  writeDB(db);
  res.status(201).json(quote);
});

app.delete('/api/quotes/:id', (req, res) => {
  const db = readDB();
  db.quotes = db.quotes.filter(q => q.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── API: Playlist ─────────────────────────────────────────────────────────────
app.get('/api/playlist', (_, res) => {
  res.json(readDB().playlist);
});

app.post('/api/playlist', (req, res) => {
  const { videoId, title, channel, thumb } = req.body;
  const db = readDB();
  if (!db.playlist.find(t => t.videoId === videoId)) {
    db.playlist.push({ videoId, title, channel, thumb });
    writeDB(db);
  }
  res.json(db.playlist);
});

app.delete('/api/playlist/:videoId', (req, res) => {
  const db = readDB();
  db.playlist = db.playlist.filter(t => t.videoId !== req.params.videoId);
  writeDB(db);
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✦ Zeynep World — http://localhost:${PORT}\n`);
});
