# ⚡ OmniFetch - Universal Media & Video Downloader

A professional, full-featured web application that allows users to download public media (videos, multi-photo carousels, reels, and audio) in highest quality (4K, 1080p FHD, 720p HD, and MP3 audio) for personal backup and offline fair-use archival.

---

## ⚖️ Legal & Compliance Architecture

OmniFetch is built with legal compliance, privacy, and safety in mind:

1. **Personal Fair-Use Archiving:** The application is framed strictly for personal offline archiving, educational, and fair-use research purposes.
2. **Safe Harbor & Zero File Hosting:** OmniFetch does not store, host, or index copyrighted files on the server. Streams are piped directly and ephemerally from public CDN endpoints.
3. **GDPR & CCPA Compliant Privacy:** Zero personal identifiers, search histories, or user downloads are saved. Telemetry uses anonymized cryptographic daily hashes.
4. **Cookie & Preference Transparency:** Includes a customizable Cookie Consent notice and comprehensive modals for **Terms of Service**, **Privacy Policy**, **DMCA Notice**, and **Supported Sites Directory**.
5. **18+ Age Verification & Disclaimer:** Adult platform extractors are clearly badged with 18+ legal majority notices and disclaimers.

---

## 📊 Built-In Real-Time Visitor & Download Analytics

OmniFetch includes a lightweight, privacy-respecting server-side analytics engine:
- **Metrics Tracked:** Total Site Visits, Today's Visits, Daily Unique Visitors (anonymized), Total Media Fetches, Total Downloads Processed, and Platform Breakdown.
- **Endpoints:**
  - `POST /api/analytics/ping` — Record client pageview.
  - `GET /api/analytics/stats` — Real-time summary statistics for admin/owner view.
- **Interactive UI Dashboard:** Click **"📊 Live Stats"** in the footer or the header counter to view real-time statistics directly in the browser!

---

## 🔒 GitHub: Should your repository be Public or Private?

### **Recommended: PRIVATE Repository**

**Why Private is Recommended for Video Downloaders:**
1. **DMCA & Brand Safety:** Media companies and automated bots frequently scan public GitHub repositories for scraper tools containing copyrighted brand names (like YouTube, TikTok, etc.) to file DMCA takedown requests against the repository.
2. **Security & Secrets:** If you ever configure custom `.env` variables, Instagram cookies (`cookies.txt`), or API credentials, having a private repository ensures these are never exposed to the public.
3. **Deployment Works Identically:** Cloud platforms like **Render**, **Railway**, and **DigitalOcean** can connect directly to **Private GitHub repositories** without any issues.

> **Tip:** If you do choose to make it Public, keep the repository name generic (e.g., `omnifetch-media-utility`) and ensure `.env` and `server/data/` remain in `.gitignore`.

---

## 📁 Project Folder Structure

```
any-video-downloader/
├── package.json              # Dependencies and start scripts
├── Dockerfile                # Production Docker container (Alpine + Node + FFmpeg + yt-dlp)
├── docker-compose.yml        # Docker Compose orchestration
├── .env.example              # Environment variables template
├── .gitignore                # Protects secrets & runtime data
├── server/
│   ├── index.js              # Express server & security middleware
│   ├── routes/
│   │   ├── info.js           # API route: extracts metadata (/api/info)
│   │   ├── download.js       # API route: streams media & ZIP archives (/api/download)
│   │   └── analytics.js      # API route: live visitor & download metrics (/api/analytics)
│   └── utils/
│       ├── analytics.js      # GDPR-compliant metrics & daily hash tracking
│       ├── helpers.js        # Formatting, byte calculations & platform detection
│       ├── ytdlp.js          # yt-dlp extraction & streaming pipeline
│       ├── instagram.js      # Dedicated Instagram Reels & carousel album extractor
│       ├── linkedin.js       # Dedicated LinkedIn post & document extractor
│       └── generic_scraper.js # Fallback DOM scraper for flashvars & adult networks
├── public/
│   ├── index.html            # HTML5 UI with glassmorphic modals & cookie banner
│   ├── css/
│   │   ├── main.css          # Design system, modals, cookie banner & responsive styles
│   │   └── animations.css    # Glowing effects, shimmer & micro-animations
│   ├── js/
│   │   ├── app.js            # Main controller, clipboard paste, modals & analytics
│   │   └── ui.js             # Format lists, toast notifications, carousel gallery
│   └── assets/
│       └── favicon.svg       # Glowing SVG logo
└── README.md
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer)
- [FFmpeg](https://ffmpeg.org/) (installed and in your system PATH)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (installed and in your system PATH)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
http://localhost:3000
```

---

## 🐳 Docker Deployment (1-Command Run)

Run the entire application in an isolated container with Node, FFmpeg, and yt-dlp pre-configured:

```bash
docker compose up -d --build
```
Open **`http://localhost:3000`**.

---

## 🌐 Production Cloud Deployment Guide

Because OmniFetch relies on `FFmpeg` and `yt-dlp` for video muxing, serverless platforms (like static Vercel) are not recommended. Use one of these persistent container platforms:

### Option 1: Render.com (Easiest & Most Popular)
1. Push your repository to GitHub (Public or Private).
2. Go to [Render.com](https://render.com) and click **New + > Web Service**.
3. Connect your GitHub repository.
4. Set **Runtime** to **Docker**.
5. Set the Port environment variable to `3000`.
6. Click **Deploy Web Service**. Render will build the `Dockerfile` automatically!

### Option 2: Railway.app (1-Click Docker)
1. Open [Railway.app](https://railway.app) and create a **New Project**.
2. Select **Deploy from GitHub repo**.
3. Railway detects the `Dockerfile` and deploys it automatically.

### Option 3: VPS / Ubuntu (DigitalOcean, Linode, Hetzner, AWS EC2)
```bash
# Clone your repository
git clone <your-repo-url>
cd any-video-downloader

# Run with Docker Compose
docker compose up -d --build
```

---

## 🔄 Automatic Deployment (Change Locally & Push)

Once your GitHub repository is connected to **Render** or **Railway**, every time you make a change on your computer:

```bash
# 1-Command shortcut:
npm run deploy

# Or standard Git commands:
git add .
git commit -m "Updated features"
git push origin main
```

**What happens automatically:**
1. GitHub receives your new code commit.
2. Render / Railway immediately detects the push, runs `docker build`, and spins up the new version within ~60 seconds.
3. Your live website is updated automatically with zero downtime!

---

## 📄 License & Fair Use Notice

This software is released for educational and personal fair-use archiving purposes only. OmniFetch is an independent project and is not affiliated with, endorsed, or sponsored by YouTube, Meta/Instagram, TikTok, Twitter/X, Reddit, or any third-party content platforms.

