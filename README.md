# ✦ Zeynep World

Kişisel moodboard sitesi — fotoğraflar, havalı sözler, müzik.

## Kurulum

```bash
# 1. Klasöre gir
cd zeynep-world

# 2. Paketleri yükle
npm install

# 3. Siteyi başlat
npm start
```

Tarayıcıda aç: **http://localhost:3000**

---

## Özellikler

- 🌙🌸🤍 **3 tema** — Midnight / Pastel / Minimal
- 📌 **Fotoğraf panosu** — iğneli/bantlı polaroid efekti, başlık ekle
- 💬 **Havalı sözler** — konuşma balonu tasarımı
- 🎵 **YouTube müzik** — arama, çalma, playlist
- 💾 **Backend** — tüm veriler sunucuda saklanır (db.json)

## Nasıl Kullanılır?

### Fotoğraf ekle
→ Sol alttaki **📷 ikonuna hover et** → "ekle" görünür → tıkla

### Söz ekle
→ Sağ alttaki **💬 ikonuna hover et** → "ekle" görünür → tıkla

### Şarkı çal
→ Sağ paneldeki arama kutusuna şarkı adı yaz → ARA → listeden seç

---

## Dosya Yapısı

```
zeynep-world/
├── server.js        ← Express backend
├── package.json
├── db.json          ← Otomatik oluşur (veriler burada)
└── public/
    ├── index.html   ← Frontend
    └── uploads/     ← Yüklenen fotoğraflar buraya gider
```
