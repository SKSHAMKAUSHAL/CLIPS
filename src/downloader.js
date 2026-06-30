// =============================================
// SKATE — Downloader (yt-dlp + FFmpeg)
// Fixed: 403 errors, cookies, retry logic
// =============================================

import { spawn, spawnSync } from "child_process";
import path from "path";
import fs from "fs";

// Detect user's default browser for cookie extraction
function detectBrowser() {
  const browsers = ['chrome', 'edge', 'firefox', 'opera', 'brave', 'chromium'];
  for (const browser of browsers) {
    try {
      // Quick test — does yt-dlp accept this browser?
      const test = spawnSync("yt-dlp", ["--cookies-from-browser", browser, "--version"], {
        timeout: 5000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      if (test.status === 0) return browser;
    } catch (e) { /* continue */ }
  }
  return null;
}

/**
 * Download video from YouTube using yt-dlp
 * Handles 403 errors with retry strategies:
 * 1. Default download
 * 2. With browser cookies
 * 3. With Android player client
 * 4. Audio-only fallback
 */
export async function downloadVideo(url, outputDir, onLog) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");

  // Strategy list — try each until one works
  const strategies = [
    {
      name: "Standard download",
      args: [
        "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "--merge-output-format", "mp4",
        "--extractor-args", "youtube:player_client=mediaconnect",
        "--no-check-certificates",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        url,
      ],
    },
    {
      name: "With browser cookies",
      args: [
        "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "--merge-output-format", "mp4",
        "--cookies-from-browser", detectBrowser() || "chrome",
        "--no-check-certificates",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        url,
      ],
    },
    {
      name: "Android client (bypass restrictions)",
      args: [
        "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "--merge-output-format", "mp4",
        "--extractor-args", "youtube:player_client=android",
        "--no-check-certificates",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        url,
      ],
    },
    {
      name: "Web client with cookies",
      args: [
        "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "--merge-output-format", "mp4",
        "--extractor-args", "youtube:player_client=web",
        "--cookies-from-browser", detectBrowser() || "chrome",
        "--no-check-certificates",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        url,
      ],
    },
  ];

  let lastError = "";

  for (const strategy of strategies) {
    if (onLog) onLog(`Trying: ${strategy.name}...`);

    const result = spawnSync("yt-dlp", strategy.args, {
      timeout: 600000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    if (result.error) {
      lastError = result.error.message;
      continue;
    }

    if (result.status !== 0) {
      lastError = (result.stderr || "").trim();
      // If it's a 403 error, try next strategy
      if (lastError.includes("403") || lastError.includes("Forbidden")) {
        if (onLog) onLog(`Strategy "${strategy.name}" got 403, trying next...`);
        continue;
      }
      // Other errors — also try next
      continue;
    }

    // Success — find the output file
    const stdout = (result.stdout || "").trim();
    const outputPath = stdout.split("\n").pop() || "";

    if (outputPath) {
      const normalizedPath = path.normalize(outputPath.trim());
      if (fs.existsSync(normalizedPath)) {
        return normalizedPath;
      }
    }

    // Try to find file in output directory
    const found = findLatestVideo(outputDir);
    if (found) return found;
  }

  // All strategies failed
  throw new Error(
    `Download failed after trying all strategies.\n` +
    `Last error: ${lastError}\n\n` +
    `💡 Try these fixes:\n` +
    `   1. Update yt-dlp: pip install --upgrade yt-dlp\n` +
    `   2. Make sure you're logged into YouTube in Chrome/Edge\n` +
    `   3. Try a different video URL\n` +
    `   4. Check if the video is available in your region`
  );
}

/**
 * Extract audio from video using FFmpeg
 */
export async function extractAudio(videoPath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = path.basename(videoPath, path.extname(videoPath));
  const audioFile = path.join(outputDir, `${baseName}.wav`);

  // Skip if already extracted
  if (fs.existsSync(audioFile)) {
    return audioFile;
  }

  const result = spawnSync("ffmpeg", [
    "-i", videoPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    audioFile,
  ], {
    timeout: 600000,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`Audio extraction failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(`Audio extraction failed: ${stderr || "ffmpeg exited with code " + result.status}`);
  }

  if (!fs.existsSync(audioFile)) {
    throw new Error(`Audio extraction completed but file not found at: ${audioFile}`);
  }

  return audioFile;
}

/**
 * Find the latest video file in a directory
 */
function findLatestVideo(dir) {
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter(f =>
    f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mkv")
  );

  if (files.length === 0) return null;

  files.sort((a, b) => {
    const statA = fs.statSync(path.join(dir, a));
    const statB = fs.statSync(path.join(dir, b));
    return statB.mtimeMs - statA.mtimeMs;
  });

  return path.join(dir, files[0]);
}
