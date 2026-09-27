import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import infoRoute from './routes/info.js';
import downloadRoute from './routes/download.js';
import analyticsRoute from './routes/analytics.js';
import { recordVisit } from './utils/analytics.js';
import { getYtDlpPath } from './utils/ytdlp.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers configured for media downloads and external thumbnails
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        mediaSrc: ["'self'", 'blob:', 'https:', 'http:'],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', infoRoute);
app.use('/api', downloadRoute);
app.use('/api', analyticsRoute);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    ytdlp: getYtDlpPath(),
    uptime: process.uptime()
  });
});

// Fallback to index.html for SPA/frontend navigation
app.get('*', (req, res) => {
  try {
    recordVisit(req);
  } catch (e) {}
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`🚀 AnyVideo Downloader Server Running!`);
  console.log(`📡 Local URL: http://localhost:${PORT}`);
  console.log(`🔧 Engine: ${getYtDlpPath()}`);
  console.log(`=========================================`);
});
