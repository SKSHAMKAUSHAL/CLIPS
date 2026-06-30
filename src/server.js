// =============================================
// SKATE — Express + WebSocket Server
// =============================================

import express from 'express';
import { WebSocketServer } from 'ws';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { runPipeline, stopPipeline, getPipelineState } from './pipeline.js';
import { runDemoPipeline } from './demo.js';
import { checkDependencies } from './doctor.js';
import { renderClips } from './renderer.js';

// ─── Load .env manually (no extra dependency) ────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

try {
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
  }
} catch (e) { /* ignore */ }

// ─── App Setup ───────────────────────────────────────
const app = express();
app.use(express.json());

// Serve static files
app.use(express.static(path.join(rootDir, 'public')));
app.use('/output', express.static(path.join(rootDir, 'output')));
app.use('/temp', express.static(path.join(rootDir, 'temp')));

// Serve raw video for the Live Editor
app.get('/api/raw_video', (req, res) => {
  const state = getPipelineState();
  if (!state || !state.videoPath || !fs.existsSync(state.videoPath)) {
    return res.status(404).send('Raw video not available');
  }
  
  const stat = fs.statSync(state.videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(state.videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(state.videoPath).pipe(res);
  }
});

// Ensure directories exist
fs.mkdirSync(path.join(rootDir, 'output'), { recursive: true });
fs.mkdirSync(path.join(rootDir, 'temp'), { recursive: true });

// ─── WebSocket ───────────────────────────────────────
const clients = new Set();
let isProcessing = false;

const broadcast = (message) => {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) client.send(data);
  }
};

// ─── API Routes ──────────────────────────────────────

/**
 * GET /api/status — Check installed dependencies
 */
app.get('/api/status', async (req, res) => {
  const status = await checkDependencies();
  res.json(status);
});

/**
 * POST /api/video-info — Fetch YouTube video metadata
 */
app.post('/api/video-info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    // Try with extractor-args first (avoids 403)
    let result = spawnSync('yt-dlp', [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=mediaconnect',
      '--no-check-certificates',
      url,
    ], {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Fallback: try with cookies
    if (result.error || result.status !== 0) {
      result = spawnSync('yt-dlp', [
        '--dump-json',
        '--no-download',
        '--no-warnings',
        '--cookies-from-browser', 'chrome',
        '--no-check-certificates',
        url,
      ], {
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    }

    if (result.error || result.status !== 0) {
      return res.status(400).json({ error: 'Could not fetch video info. Check the URL.' });
    }

    const info = JSON.parse(result.stdout.trim());
    res.json({
      title: info.title || 'Unknown',
      thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || '',
      duration: info.duration || 0,
      channel: info.uploader || info.channel || 'Unknown',
      viewCount: info.view_count || 0,
      description: (info.description || '').slice(0, 200),
    });
  } catch (e) {
    res.status(400).json({ error: 'Failed to parse video info' });
  }
});

/**
 * POST /api/process — Start the clip generation pipeline
 */
app.post('/api/process', async (req, res) => {
  if (isProcessing) {
    return res.status(409).json({ error: 'Pipeline already running. Stop it first.' });
  }

  const { source, genre, description, timestamps, clipMode } = req.body;
  if (!source) return res.status(400).json({ error: 'Source URL is required' });

  isProcessing = true;
  res.json({ success: true, message: 'Pipeline started' });

  // Check dependencies to decide real vs demo mode
  const deps = await checkDependencies();
  const hasAllTools = deps.ffmpeg.installed && deps.ytdlp.installed && deps.ollama.installed;

  broadcast({ type: 'log', level: 'info', msg: `🛹 Starting L2S pipeline for: ${source}` });
  broadcast({ type: 'log', level: 'info', msg: `🎯 Genre: ${genre || 'auto-detect'}` });

  if (description) {
    broadcast({ type: 'log', level: 'info', msg: `📝 Description filter: "${description}"` });
  }
  if (timestamps && timestamps.length > 0) {
    broadcast({ type: 'log', level: 'info', msg: `⏱️  Manual timestamps: ${timestamps.length} ranges provided` });
  }
  if (clipMode === 'only' && (description || (timestamps && timestamps.length > 0))) {
    broadcast({ type: 'log', level: 'info', msg: `🎯 Mode: Only description/timestamp clips (skipping AI ranking)` });
  }

  if (!hasAllTools) {
    const missing = [];
    if (!deps.ffmpeg.installed) missing.push('FFmpeg');
    if (!deps.ytdlp.installed) missing.push('yt-dlp');
    if (!deps.ollama.installed) missing.push('Ollama');
    broadcast({ type: 'log', level: 'warning', msg: `⚠️  Missing: ${missing.join(', ')} — Running in DEMO mode` });
    broadcast({ type: 'log', level: 'info', msg: '💡 Install missing tools for real processing' });
  } else {
    broadcast({ type: 'log', level: 'success', msg: '✅ All tools detected — Running FULL pipeline' });
  }

  try {
    if (hasAllTools) {
      await runPipeline(source, genre, broadcast, rootDir, { description, timestamps, clipMode });
    } else {
      await runDemoPipeline(source, genre, broadcast);
    }
    broadcast({ type: 'done' });
  } catch (err) {
    if (err.message === 'PIPELINE_CANCELLED') {
      broadcast({ type: 'stopped' });
    } else {
      broadcast({ type: 'error', msg: err.message, step: 'error' });
    }
  } finally {
    isProcessing = false;
  }
});

/**
 * POST /api/stop — Cancel a running pipeline
 */
app.post('/api/stop', (req, res) => {
  if (!isProcessing) {
    return res.json({ success: true, message: 'Nothing to stop' });
  }
  stopPipeline();
  isProcessing = false;
  broadcast({ type: 'log', level: 'warning', msg: '🛑 Pipeline cancelled by user' });
  broadcast({ type: 'stopped' });
  res.json({ success: true, message: 'Pipeline stopping...' });
});

/**
 * POST /api/render — Render selected clips with FFmpeg
 */
app.post('/api/render', async (req, res) => {
  const { selectedIndices, selectedClipsData } = req.body;
  const state = getPipelineState();

  if (!state || !state.videoPath || !state.selected) {
    return res.status(400).json({ error: 'No pipeline data. Run the pipeline first.' });
  }

  res.json({ success: true, message: 'Rendering started' });

  broadcast({ type: 'step', step: 'render', status: 'active' });
  broadcast({ type: 'log', level: 'info', msg: '🎬 Starting clip rendering with FFmpeg...' });

  try {
    // Determine which clips to render and merge any custom editor settings
    const indices = selectedIndices || state.selected.map((_, i) => i);
    const toRender = indices
      .map((clipIndex, arrayIndex) => {
        const baseClip = state.selected[clipIndex];
        if (!baseClip) return null;
        // Merge frontend editor adjustments if available
        const customData = selectedClipsData && selectedClipsData[arrayIndex] ? selectedClipsData[arrayIndex] : {};
        return { ...baseClip, custom: customData };
      })
      .filter(Boolean);

    if (toRender.length === 0) {
      throw new Error('No valid clips selected for rendering');
    }

    broadcast({ type: 'log', level: 'info', msg: `🎞️  Rendering ${toRender.length} clips in 9:16 vertical format...` });

    // Create output directory named after the video
    const videoName = path.basename(state.videoPath, path.extname(state.videoPath));
    const outputDir = path.join(rootDir, 'output', videoName);

    await renderClips(state.videoPath, toRender, 'tiktok', outputDir, (msg) => {
      broadcast({ type: 'log', level: 'info', msg: `  ${msg}` });
    });

    // Collect rendered files
    const clipsDir = path.join(outputDir, 'clips');
    let renderedFiles = [];
    if (fs.existsSync(clipsDir)) {
      renderedFiles = fs.readdirSync(clipsDir)
        .filter(f => f.endsWith('.mp4'))
        .sort()
        .map(f => `/output/${videoName}/clips/${f}`);
    }

    broadcast({ type: 'log', level: 'success', msg: `✅ Rendered ${renderedFiles.length} clips successfully!` });
    broadcast({ type: 'step', step: 'render', status: 'done' });

    // Send rendered file URLs to frontend
    broadcast({
      type: 'render_done',
      files: renderedFiles,
      outputDir: `/output/${videoName}`,
    });

  } catch (err) {
    broadcast({ type: 'step', step: 'render', status: 'error' });
    broadcast({ type: 'error', msg: `Render failed: ${err.message}` });
  }
});

// ─── Start Server ────────────────────────────────────
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n  🛹 L2S is running on http://localhost:${PORT}\n`);
  console.log(`  Turn long-form videos into viral shorts — 100% local, 100% free\n`);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});
