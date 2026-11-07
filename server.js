require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Multi-Key & Multi-Model Fallback Yapılandırması ─────────────────────────
const apiKeys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2
].filter(Boolean);

// İstediğin model sırası: Flash -> Lite -> Flash -> Lite
const modelsSequence = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b'
];

async function generateWithFallback(prompt, imageBuffer, mimeType, aiName) {
  if (apiKeys.length === 0) {
    throw new Error('Hiçbir GEMINI_API_KEY bulunamadı! Render environment ayarlarına GEMINI_API_KEY_1 ve GEMINI_API_KEY_2 eklemelisin.');
  }

  const systemInstruction = `Senin adın ${aiName || 'Zeynep AI'}. Zeynep World kişisel moodboard uygulamasının samimi, tatlı ve yardımsever yapay zeka asistanısın. Türkçe konuş, kısa ve tatlı cevaplar ver.`;

  let lastError = null;

  // 1. Key bittiğinde 2. Key'e geçiş döngüsü
  for (let kIndex = 0; kIndex < apiKeys.length; kIndex++) {
    const apiKey = apiKeys[kIndex];
    const genAI = new GoogleGenerativeAI(apiKey);

    // Her key için model sırasını baştan uygula
    for (const modelName of modelsSequence) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        let result;

        if (imageBuffer) {
          const imagePart = {
            inlineData: {
              data: imageBuffer.toString("base64"),
              mimeType: mimeType
            }
          };
          result = await model.generateContent([
            systemInstruction,
            prompt || "Bu fotoğrafı kısaca yorumla.",
            imagePart
          ]);
        } else {
          result = await model.generateContent([
            systemInstruction,
            prompt
          ]);
        }

        const text = result.response.text();
        if (text) {
          console.log(`[AI Başarılı] Key #${kIndex + 1} | Model: ${modelName}`);
          return text;
        }
      } catch (err) {
        console.warn(`[AI Hata / Kota] Key #${kIndex + 1} (${modelName}):`, err.message);
        lastError = err;
        // Hata durumunda sıradaki modele veya diğer anahtara geçer
      }
    }
  }

  throw lastError || new Error('Tüm API anahtarları ve modeller tükendi.');
}

// ── Directories ─────────────────────────────────────────────────────────────
const PUBLIC_DIR  = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const DB_FILE     = path.join(__dirname, 'db.json');

[UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Rate Limiter (Anti-Abuse) ────────────────────────────────────────────────
const aiLimits = {};
const DAILY_LIMIT = 50;

function checkRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const today = new Date().toISOString().split('T')[0];
  
  if (!aiLimits[ip] || aiLimits[ip].date !== today) {
    aiLimits[ip] = { count: 0, date: today };
  }
  
  if (aiLimits[ip].count >= DAILY_LIMIT) {
    return res.status(429).json({ error: 'Günlük yapay zeka kullanım sınırına ulaştın! Yarın tekrar deneyebilirsin ✦' });
  }
  
  aiLimits[ip].count++;
  next();
}

// ── DB helpers ───────────────────────────────────────────────────────────────
function readDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (_) {}
  return { photos: [], quotes: [], playlist: [], settings: { theme: 'midnight', moods: [], aiName: 'Zeynep AI' } };
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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get('/', (_, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── API: Settings ─────────────────────────────────────────────────────────────
app.get('/api/settings', (_, res) => {
  const db = readDB();
  if (!db.settings.aiName) db.settings.aiName = 'Zeynep AI';
  res.json(db.settings);
});

app.patch('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json(db.settings);
});

// ── API: AI Chat & Image Generation ──────────────────────────────────────────
app.post('/api/ai/chat', checkRateLimit, upload.single('image'), async (req, res) => {
  try {
    const { prompt, aiName } = req.body;
    let responseText = '';
    let generatedImageUrl = null;

    const lowerPrompt = (prompt || '').toLowerCase();
    const isImageGenRequest = lowerPrompt.includes('çiz') || 
                               lowerPrompt.includes('oluştur') || 
                               lowerPrompt.includes('resmini yap') || 
                               lowerPrompt.includes('görsel üret');

    if (isImageGenRequest) {
      const encodedPrompt = encodeURIComponent(prompt);
      generatedImageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?nologo=true`;
      responseText = `İstediğin görseli senin için hazırladım ✦`;
    } else {
      const imageBuffer = req.file ? fs.readFileSync(req.file.path) : null;
      const mimeType = req.file ? req.file.mimetype : null;

      responseText = await generateWithFallback(prompt, imageBuffer, mimeType, aiName);
    }

    res.json({
      text: responseText,
      image: generatedImageUrl
    });

  } catch (err) {
    console.error('AI Error:', err);
    res.status(500).json({ error: 'Yapay zeka yanıt verirken bir hata oluştu veya tüm anahtarlar tükendi.' });
  }
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