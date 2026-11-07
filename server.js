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

const modelsSequence = ['gemini-3.6-flash', 'gemini-3.6-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];

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
          const imagePart = { inlineData: { data: imageBuffer.toString("base64"), mimeType: mimeType } };
          result = await model.generateContent([systemInstruction, prompt || "Bu dosyayı yorumla.", imagePart]);
        } else {
          result = await model.generateContent([systemInstruction, prompt]);
        }
        const text = result.response?.text();
        if (text) return text;
      } catch (err) {}
    }
  }
  try {
    const aiRes = await fetch(`https://text.pollinations.ai/${encodeURIComponent(systemInstruction + '\n' + prompt)}`);
    const fallbackText = await aiRes.text();
    if (fallbackText && !fallbackText.includes('<html>')) return fallbackText;
  } catch (e) {}
  throw new Error('Yanıt oluşturulamadı.');
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get('/', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const DEFAULT_DATA = { photos: [], quotes: [], playlist: [], letters: [], countdowns: [], capsules: [], settings: { theme: 'midnight', aiName: '67' } };

async function readDB() {
  if (!supabase) return DEFAULT_DATA;
  try {
    const { data } = await supabase.from('zw_store').select('data').eq('id', 'main_db').single();
    return { ...DEFAULT_DATA, ...(data?.data || {}) };
  } catch (_) { return DEFAULT_DATA; }
}

async function writeDB(data) {
  if (!supabase) return;
  try { await supabase.from('zw_store').upsert({ id: 'main_db', data }); } catch (e) {}
}

app.get('/api/settings', async (_, res) => {
  const db = await readDB();
  res.json(db.settings);
});

app.patch('/api/settings', async (req, res) => {
  const db = await readDB();
  db.settings = { ...db.settings, ...req.body };
  await writeDB(db);
  res.json(db.settings);
});

// YouTube Arama API (Daha kararlı alternatif endpoint)
app.get('/api/youtube/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const response = await fetch(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=videos`);
    const data = await response.json();
    const results = (data.items || []).slice(0, 6).map(item => ({
      videoId: item.url.split('/watch?v=')[1] || item.videoId,
      title: item.title,
      channel: item.uploaderName,
      thumb: item.thumbnail || ''
    }));
    res.json(results);
  } catch (e) {
    res.json([]);
  }
});

// AI Chat
app.post('/api/ai/chat', upload.single('image'), async (req, res) => {
  try {
    const { prompt, aiName } = req.body;
    let responseText = '';
    let generatedImageUrl = null;
    if ((prompt || '').toLowerCase().includes('çiz')) {
      generatedImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true`;
      responseText = `İstediğin görseli hazırladım ✦`;
    } else {
      responseText = await generateWithFallback(prompt, req.file?.buffer, req.file?.mimetype, aiName);
    }
    res.json({ text: responseText, image: generatedImageUrl });
  } catch (err) {
    res.status(500).json({ error: 'Yapay zeka yanıt veremiyor.' });
  }
});

// Photos & Videos
app.get('/api/photos', async (_, res) => { const db = await readDB(); res.json(db.photos || []); });
app.post('/api/photos', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yok' });
  try {
    const isVideo = req.file.mimetype.startsWith('video/');
    const uploadStream = () => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: 'zeynep-world', resource_type: isVideo ? 'video' : 'image', quality: 'auto:good', fetch_format: 'auto' }, (err, result) => {
        if (result) resolve(result); else reject(err);
      });
      stream.end(req.file.buffer);
    });
    const result = await uploadStream();
    const db = await readDB();
    const rots = [-7, -5, -3, -1, 1, 3, 5, 7];
    const item = { id: uuidv4(), url: result.secure_url, public_id: result.public_id, media_type: isVideo ? 'video' : 'image', caption: req.body.caption || '', rot: rots[Math.floor(Math.random() * rots.length)], taped: Math.random() > 0.55, tapeRot: (Math.random() * 10 - 5).toFixed(1), x: 0, y: 0 };
    if (!db.photos) db.photos = [];
    db.photos.push(item);
    await writeDB(db);
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: 'Yükleme hatası' }); }
});
app.patch('/api/photos/:id/pos', async (req, res) => {
  const db = await readDB();
  const p = db.photos?.find(x => x.id === req.params.id);
  if (p) { p.x = req.body.x; p.y = req.body.y; await writeDB(db); }
  res.json({ ok: true });
});
app.delete('/api/photos/:id', async (req, res) => {
  const db = await readDB();
  const p = db.photos?.find(x => x.id === req.params.id);
  if (p?.public_id) { try { await cloudinary.uploader.destroy(p.public_id, { resource_type: p.media_type === 'video' ? 'video' : 'image' }); } catch(e){} }
  db.photos = (db.photos || []).filter(x => x.id !== req.params.id);
  await writeDB(db); res.json({ ok: true });
});

// Quotes
app.get('/api/quotes', async (_, res) => { const db = await readDB(); res.json(db.quotes || []); });
app.post('/api/quotes', async (req, res) => {
  const { text } = req.body; if (!text) return res.status(400).json({ error: 'Boş' });
  const db = await readDB(); if (!db.quotes) db.quotes = [];
  const q = { id: uuidv4(), text, style: 'standard', stars: 5, x: 0, y: 0 };
  db.quotes.push(q); await writeDB(db); res.status(201).json(q);
});
app.patch('/api/quotes/:id/pos', async (req, res) => {
  const db = await readDB(); const q = db.quotes?.find(x => x.id === req.params.id);
  if (q) { q.x = req.body.x; q.y = req.body.y; await writeDB(db); } res.json({ ok: true });
});
app.delete('/api/quotes/:id', async (req, res) => {
  const db = await readDB(); db.quotes = (db.quotes || []).filter(x => x.id !== req.params.id); await writeDB(db); res.json({ ok: true });
});

// Playlist
app.get('/api/playlist', async (_, res) => { const db = await readDB(); res.json(db.playlist || []); });
app.post('/api/playlist', async (req, res) => {
  const { videoId, title, channel, thumb } = req.body;
  const db = await readDB(); if (!db.playlist) db.playlist = [];
  if (!db.playlist.find(x => x.videoId === videoId)) {
    db.playlist.push({ videoId, title, channel, thumb });
    await writeDB(db);
  }
  res.json(db.playlist);
});
app.delete('/api/playlist/:videoId', async (req, res) => {
  const db = await readDB();
  db.playlist = (db.playlist || []).filter(x => x.videoId !== req.params.videoId);
  await writeDB(db); res.json({ ok: true });
});

// Letters, Countdowns, Capsules
app.get('/api/letters', async (_, res) => { res.json((await readDB()).letters || []); });
app.post('/api/letters', async (req, res) => {
  const db = await readDB(); if (!db.letters) db.letters = [];
  const l = { id: uuidv4(), ...req.body }; db.letters.push(l); await writeDB(db); res.status(201).json(l);
});
app.delete('/api/letters/:id', async (req, res) => {
  const db = await readDB(); db.letters = (db.letters || []).filter(x => x.id !== req.params.id); await writeDB(db); res.json({ ok: true });
});

app.get('/api/countdowns', async (_, res) => { res.json((await readDB()).countdowns || []); });
app.post('/api/countdowns', async (req, res) => {
  const db = await readDB(); if (!db.countdowns) db.countdowns = [];
  const c = { id: uuidv4(), ...req.body }; db.countdowns.push(c); await writeDB(db); res.status(201).json(c);
});
app.delete('/api/countdowns/:id', async (req, res) => {
  const db = await readDB(); db.countdowns = (db.countdowns || []).filter(x => x.id !== req.params.id); await writeDB(db); res.json({ ok: true });
});

app.get('/api/capsules', async (_, res) => { res.json((await readDB()).capsules || []); });
app.post('/api/capsules', async (req, res) => {
  const db = await readDB(); if (!db.capsules) db.capsules = [];
  const cap = { id: uuidv4(), ...req.body }; db.capsules.push(cap); await writeDB(db); res.status(201).json(cap);
});

app.listen(PORT, () => console.log(`✦ Server running on port ${PORT}`));