require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cloudinary = require('cloudinary').v2;

// Cloudinary Yapılandırması
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const app  = express();
const PORT = process.env.PORT || 3000;

// API Anahtarları
const apiKeys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2
].filter(Boolean);

// İstediğin Model Sıralaması: 3.6 Flash -> 3.6 Flash-Lite -> 3.5 Flash -> 3.5 Flash-Lite
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
        if (text) {
          console.log(`[AI Başarılı] Key #${kIndex + 1} | Model: ${modelName}`);
          return text;
        }
      } catch (err) {
        console.warn(`[AI Uyarı] Key #${kIndex + 1} (${modelName}) başarısız:`, err.message);
      }
    }
  }

  // Yedek Servis (Pollinations)
  console.log('[AI Bilgi] Gemini limitleri doldu, kesintisiz yedek servise geçiliyor...');
  try {
    const fullQuery = `${systemInstruction}\nKullanıcı: ${prompt || 'Selam'}`;
    const aiRes = await fetch(`https://text.pollinations.ai/${encodeURIComponent(fullQuery)}`);
    const fallbackText = await aiRes.text();
    if (fallbackText && !fallbackText.includes('<html>')) {
      return fallbackText;
    }
  } catch (e) {
    console.error('Yedek AI servisi hatası:', e);
  }

  throw new Error('Yanıt oluşturulamadı.');
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE    = path.join(__dirname, 'db.json');

// Multer (Geçici bellek depolama - Cloudinary'ye göndermek için)
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

// DB Helpers
function readDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (_) {}
  return { photos: [], quotes: [], playlist: [], settings: { theme: 'midnight', moods: [], aiName: '67' } };
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Settings API
app.get('/api/settings', (_, res) => {
  const db = readDB();
  if (!db.settings.aiName) db.settings.aiName = '67';
  res.json(db.settings);
});

app.patch('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json(db.settings);
});

// AI Chat API
const aiLimits = {};
const DAILY_LIMIT = 50;

function checkRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const today = new Date().toISOString().split('T')[0];
  if (!aiLimits[ip] || aiLimits[ip].date !== today) {
    aiLimits[ip] = { count: 0, date: today };
  }
  if (aiLimits[ip].count >= DAILY_LIMIT) {
    return res.status(429).json({ error: 'Günlük yapay zeka kullanım sınırına ulaştın! Yarın tekrar dene ✦' });
  }
  aiLimits[ip].count++;
  next();
}

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
      let imageBuffer = null;
      let mimeType = null;

      if (req.file) {
        imageBuffer = req.file.buffer;
        mimeType = req.file.mimetype;
      }

      responseText = await generateWithFallback(prompt, imageBuffer, mimeType, aiName);
    }

    res.json({ text: responseText, image: generatedImageUrl });
  } catch (err) {
    console.error('AI Error:', err);
    res.status(500).json({ error: 'Yapay zeka şu an yanıt veremiyor, lütfen az sonra tekrar dene.' });
  }
});

// Photos API (Cloudinary Destekli - Asla Silinmez)
app.get('/api/photos', (_, res) => {
  res.json(readDB().photos);
});

app.post('/api/photos', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });

  try {
    // Cloudinary'ye yükle
    const uploadStream = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'zeynep-world' },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        stream.end(req.file.buffer);
      });
    };

    const uploadResult = await uploadStream();
    const db = readDB();
    const rots = [-7, -5, -3, -1, 1, 3, 5, 7];
    
    const photo = {
      id:       uuidv4(),
      url:      uploadResult.secure_url, // Cloudinary Kalıcı URL
      public_id: uploadResult.public_id,
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
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ error: 'Fotoğraf yüklenirken hata oluştu.' });
  }
});

app.delete('/api/photos/:id', async (req, res) => {
  const db = readDB();
  const photo = db.photos.find(p => p.id === req.params.id);
  if (photo && photo.public_id) {
    try {
      await cloudinary.uploader.destroy(photo.public_id);
    } catch(e) {}
  }
  db.photos = db.photos.filter(p => p.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// Quotes API
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

// Playlist API
app.get('/api/playlist', (_, res) => {
  res.json(readDB().playlist);
});

app.post('/api/playlist', (req, res) => {
  const { videoId, title, channel, thumb } = req.body;
  const db = readDB();
  if (!db.playlist.front && !db.playlist.find(t => t.videoId === videoId)) {
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

app.listen(PORT, () => {
  console.log(`\n✦ Zeynep World — http://localhost:${PORT}\n`);
});