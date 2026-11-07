require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const app  = express();
const PORT = process.env.PORT || 3000;

const apiKeys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2
].filter(Boolean);

const modelsSequence = [
  'gemini-3.6-flash',
  'gemini-3.6-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
];

async function generateWithFallback(prompt, imageBuffer, mimeType, aiName) {
  const systemInstruction = `Senin adın ${aiName || '67'}. Zeynep World kişisel moodboard uygulamasının samimi, tatlı ve yardımsever yapay zeka asistanısın. Türkçe konuş, kısa ve tatlı cevaplar ver.`;

  for (let kIndex = 0; kIndex < apiKeys.length; kIndex++) {
    const apiKey = apiKeys[kIndex];
    if (!apiKey) continue;
    
    const genAI = new GoogleGenerativeAI(apiKey);

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

        const text = result.response?.text();
        if (text) return text;
      } catch (err) {}
    }
  }

  try {
    const fullQuery = `${systemInstruction}\nKullanıcı: ${prompt || 'Selam'}`;
    const aiRes = await fetch(`https://text.pollinations.ai/${encodeURIComponent(fullQuery)}`);
    const fallbackText = await aiRes.text();
    if (fallbackText && !fallbackText.includes('<html>')) return fallbackText;
  } catch (e) {}

  throw new Error('Yanıt oluşturulamadı.');
}

const PUBLIC_DIR = path.join(__dirname, 'public');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get('/', (_, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const DEFAULT_DATA = { 
  photos: [], 
  quotes: [], 
  playlist: [], 
  letters: [],
  countdowns: [],
  capsules: [],
  settings: { theme: 'midnight', moods: [], aiName: '67' } 
};

async function readDB() {
  if (!supabase) return DEFAULT_DATA;
  try {
    const { data, error } = await supabase.from('zw_store').select('data').eq('id', 'main_db').single();
    if (error || !data) return DEFAULT_DATA;
    return { ...DEFAULT_DATA, ...(data.data || {}) };
  } catch (_) {
    return DEFAULT_DATA;
  }
}

async function writeDB(data) {
  if (!supabase) return;
  try {
    await supabase.from('zw_store').upsert({ id: 'main_db', data });
  } catch (e) {}
}

app.get('/api/settings', async (_, res) => {
  const db = await readDB();
  if (!db.settings.aiName) db.settings.aiName = '67';
  res.json(db.settings);
});

app.patch('/api/settings', async (req, res) => {
  const db = await readDB();
  db.settings = { ...db.settings, ...req.body };
  await writeDB(db);
  res.json(db.settings);
});

// AI Chat
app.post('/api/ai/chat', upload.single('image'), async (req, res) => {
  try {
    const { prompt, aiName } = req.body;
    let responseText = '';
    let generatedImageUrl = null;

    const lowerPrompt = (prompt || '').toLowerCase();
    const isImageGenRequest = lowerPrompt.includes('çiz') || lowerPrompt.includes('oluştur') || lowerPrompt.includes('resmini yap') || lowerPrompt.includes('görsel üret');

    if (isImageGenRequest) {
      generatedImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true`;
      responseText = `İstediğin görseli senin için hazırladım ✦`;
    } else {
      let imageBuffer = req.file ? req.file.buffer : null;
      let mimeType = req.file ? req.file.mimetype : null;
      responseText = await generateWithFallback(prompt, imageBuffer, mimeType, aiName);
    }

    res.json({ text: responseText, image: generatedImageUrl });
  } catch (err) {
    res.status(500).json({ error: 'Yapay zeka şu an yanıt veremiyor.' });
  }
});

// Photos API
app.get('/api/photos', async (_, res) => {
  const db = await readDB();
  res.json(db.photos || []);
});

app.post('/api/photos', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });
  try {
    const uploadStream = () => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: 'zeynep-world' }, (error, result) => {
        if (result) resolve(result); else reject(error);
      });
      stream.end(req.file.buffer);
    });

    const uploadResult = await uploadStream();
    const db = await readDB();
    const rots = [-7, -5, -3, -1, 1, 3, 5, 7];
    
    const photo = {
      id: uuidv4(),
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      caption: req.body.caption || '',
      rot: rots[Math.floor(Math.random() * rots.length)],
      taped: Math.random() > 0.55,
      tapeRot: (Math.random() * 10 - 5).toFixed(1),
      order: Date.now(),
      x: 0, y: 0, // Drag & Drop koordinatları
      type: 'photo'
    };

    if (!db.photos) db.photos = [];
    db.photos.push(photo);
    await writeDB(db);
    res.status(201).json(photo);
  } catch (err) {
    res.status(500).json({ error: 'Yükleme hatası' });
  }
});

app.patch('/api/photos/:id/pos', async (req, res) => {
  const db = await readDB();
  const photo = db.photos?.find(p => p.id === req.params.id);
  if (photo) {
    photo.x = req.body.x;
    photo.y = req.body.y;
    await writeDB(db);
  }
  res.json({ ok: true });
});

app.delete('/api/photos/:id', async (req, res) => {
  const db = await readDB();
  const photo = db.photos?.find(p => p.id === req.params.id);
  if (photo && photo.public_id) {
    try { await cloudinary.uploader.destroy(photo.public_id); } catch(e) {}
  }
  db.photos = (db.photos || []).filter(p => p.id !== req.params.id);
  await writeDB(db);
  res.json({ ok: true });
});

// Quotes API
app.get('/api/quotes', async (_, res) => {
  const db = await readDB();
  res.json(db.quotes || []);
});

app.post('/api/quotes', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text' });
  const db = await readDB();
  if (!db.quotes) db.quotes = [];

  const bubbleStyles = ['standard', 'alt', 'center'];
  const quote = {
    id: uuidv4(),
    text: text.trim(),
    style: bubbleStyles[db.quotes.length % bubbleStyles.length],
    stars: Math.floor(Math.random() * 3) + 3,
    order: Date.now(),
    x: 0, y: 0,
    type: 'quote'
  };

  db.quotes.push(quote);
  await writeDB(db);
  res.status(201).json(quote);
});

app.patch('/api/quotes/:id/pos', async (req, res) => {
  const db = await readDB();
  const q = db.quotes?.find(item => item.id === req.params.id);
  if (q) {
    q.x = req.body.x;
    q.y = req.body.y;
    await writeDB(db);
  }
  res.json({ ok: true });
});

app.delete('/api/quotes/:id', async (req, res) => {
  const db = await readDB();
  db.quotes = (db.quotes || []).filter(q => q.id !== req.params.id);
  await writeDB(db);
  res.json({ ok: true });
});

// Playlist API
app.get('/api/playlist', async (_, res) => {
  const db = await readDB();
  res.json(db.playlist || []);
});

app.post('/api/playlist', async (req, res) => {
  const { videoId, title, channel, thumb } = req.body;
  const db = await readDB();
  if (!db.playlist) db.playlist = [];
  if (!db.playlist.find(t => t.videoId === videoId)) {
    db.playlist.push({ videoId, title, channel, thumb });
    await writeDB(db);
  }
  res.json(db.playlist);
});

app.delete('/api/playlist/:videoId', async (req, res) => {
  const db = await readDB();
  db.playlist = (db.playlist || []).filter(t => t.videoId !== req.params.videoId);
  await writeDB(db);
  res.json({ ok: true });
});

// Letters (Mektup Kutusu) API
app.get('/api/letters', async (_, res) => {
  const db = await readDB();
  res.json(db.letters || []);
});

app.post('/api/letters', async (req, res) => {
  const { title, content, unlockDate } = req.body;
  const db = await readDB();
  if (!db.letters) db.letters = [];
  const letter = { id: uuidv4(), title, content, unlockDate, createdAt: Date.now() };
  db.letters.push(letter);
  await writeDB(db);
  res.status(201).json(letter);
});

app.delete('/api/letters/:id', async (req, res) => {
  const db = await readDB();
  db.letters = (db.letters || []).filter(l => l.id !== req.params.id);
  await writeDB(db);
  res.json({ ok: true });
});

// Countdowns (Anı Sayaçları) API
app.get('/api/countdowns', async (_, res) => {
  const db = await readDB();
  res.json(db.countdowns || []);
});

app.post('/api/countdowns', async (req, res) => {
  const { title, targetDate } = req.body;
  const db = await readDB();
  if (!db.countdowns) db.countdowns = [];
  const cd = { id: uuidv4(), title, targetDate };
  db.countdowns.push(cd);
  await writeDB(db);
  res.status(201).json(cd);
});

app.delete('/api/countdowns/:id', async (req, res) => {
  const db = await readDB();
  db.countdowns = (db.countdowns || []).filter(c => c.id !== req.params.id);
  await writeDB(db);
  res.json({ ok: true });
});

// Capsules (Anı Kapsülü) API
app.get('/api/capsules', async (_, res) => {
  const db = await readDB();
  res.json(db.capsules || []);
});

app.post('/api/capsules', async (req, res) => {
  const { monthName, note } = req.body;
  const db = await readDB();
  if (!db.capsules) db.capsules = [];
  const cap = { id: uuidv4(), monthName, note, date: new Date().toLocaleDateString('tr-TR') };
  db.capsules.push(cap);
  await writeDB(db);
  res.status(201).json(cap);
});

app.listen(PORT, () => {
  console.log(`\n✦ Zeynep World — http://localhost:${PORT}\n`);
});