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
  let videoPath = state?.videoPath;

  // Fallback: If server restarted and state is lost, find latest .mp4 in temp dir
  if (!videoPath || !fs.existsSync(videoPath)) {
    const tempDir = path.join(rootDir, 'temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.mp4'));
      if (files.length > 0) {
        files.sort((a, b) => fs.statSync(path.join(tempDir, b)).mtimeMs - fs.statSync(path.join(tempDir, a)).mtimeMs);
        videoPath = path.join(tempDir, files[0]);
      }
    }
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).send('Raw video not available');
  }
  
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
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
    fs.createReadStream(videoPath).pipe(res);
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

    broadcast({ type: 'log', level: 'info', msg: `🎞️  Rendering ${toRender.length} clips...` });

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

/**
 * POST /api/re-render — Re-render a single clip after editing
 */
app.post('/api/re-render', async (req, res) => {
  const { clipIndex, clipData } = req.body;
  const state = getPipelineState();

  if (!state || !state.videoPath) {
    return res.status(400).json({ error: 'No pipeline data. Run the pipeline first.' });
  }

  res.json({ success: true, message: 'Re-rendering clip...' });

  try {
    const videoName = path.basename(state.videoPath, path.extname(state.videoPath));
    const outputDir = path.join(rootDir, 'output', videoName);
    const clipsDir = path.join(outputDir, 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });

    const clipNum = String(clipIndex + 1).padStart(2, '0');

    // Build the clip object for rendering
    const chunk = {
      start: clipData.start || 0,
      end: clipData.end || 0,
      text: clipData.text || '',
      words: clipData.words || [],
    };

    const toRender = [{
      chunk,
      custom: clipData,
    }];

    broadcast({ type: 'log', level: 'info', msg: `🔄 Re-rendering clip ${clipNum}...` });

    await renderClips(state.videoPath, toRender, 'tiktok', outputDir, (msg) => {
      broadcast({ type: 'log', level: 'info', msg: `  ${msg}` });
    });

    const fileUrl = `/output/${videoName}/clips/clip-01.mp4`;

    // Rename the re-rendered file to the correct clip number
    const renderedPath = path.join(clipsDir, 'clip-01.mp4');
    const targetPath = path.join(clipsDir, `clip-${clipNum}.mp4`);
    if (clipNum !== '01' && fs.existsSync(renderedPath)) {
      fs.renameSync(renderedPath, targetPath);
    }

    const finalUrl = `/output/${videoName}/clips/clip-${clipNum}.mp4`;

    broadcast({ type: 'log', level: 'success', msg: `✅ Clip ${clipNum} re-rendered!` });
    broadcast({
      type: 're_render_done',
      clipIndex,
      fileUrl: finalUrl,
    });

  } catch (err) {
    broadcast({ type: 'error', msg: `Re-render failed: ${err.message}` });
  }
});

/**
 * POST /api/connect/:platform — Connect social media account (stub)
 */
app.post('/api/connect/:platform', (req, res) => {
  const { platform } = req.params;

  if (platform === 'instagram') {
    const clientId = process.env.INSTAGRAM_CLIENT_ID;
    const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
    if (clientId && clientSecret) {
      const redirectUri = `http://localhost:${process.env.PORT || 3000}/api/auth/callback/instagram`;
      const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user_profile,user_media&response_type=code`;
      return res.json({ success: false, authUrl, message: 'Redirecting to Instagram login...' });
    }
    return res.json({ success: false, message: 'Instagram OAuth not configured. Add INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET to .env' });
  }

  if (platform === 'youtube') {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (clientId && clientSecret) {
      const redirectUri = `http://localhost:${process.env.PORT || 3000}/api/auth/callback/youtube`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload')}&access_type=offline`;
      return res.json({ success: false, authUrl, message: 'Redirecting to YouTube login...' });
    }
    return res.json({ success: false, message: 'YouTube OAuth not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env' });
  }

  res.status(400).json({ error: `Unknown platform: ${platform}` });
});

/**
 * GET /api/auth/callback/:platform — OAuth callback handler (stub)
 */
app.get('/api/auth/callback/:platform', (req, res) => {
  const { platform } = req.params;
  // TODO: Exchange code for tokens and store them
  res.send(`<html><body><h2>Connected to ${platform}!</h2><p>You can close this window.</p><script>window.close()</script></body></html>`);
});

/**
 * POST /api/publish — Publish clips to connected platforms (stub)
 */
app.post('/api/publish', (req, res) => {
  const { clips, files, workflow } = req.body;

  if (!clips || clips.length === 0) {
    return res.status(400).json({ error: 'No clips to publish' });
  }

  const platforms = [];
  if (workflow?.instagram) platforms.push('Instagram');
  if (workflow?.youtube) platforms.push('YouTube');

  broadcast({ type: 'log', level: 'info', msg: `📤 Publishing ${clips.length} clips to: ${platforms.join(', ')}` });
  broadcast({ type: 'log', level: 'warning', msg: '⚠️ Social media publishing requires OAuth credentials in .env' });
  broadcast({ type: 'log', level: 'info', msg: '💡 Add INSTAGRAM_CLIENT_ID, INSTAGRAM_CLIENT_SECRET, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET to your .env file' });

  res.json({
    success: false,
    message: `Publishing to ${platforms.join(' & ')} requires OAuth setup. Add API credentials to .env file.`,
    published: 0,
  });
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
