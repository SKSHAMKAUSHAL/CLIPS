// =============================================
// SKATE — FFmpeg Renderer (Cross-Platform)
// =============================================

import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import { generateSRT, generateASS } from "./subtitles.js";

const IS_WINDOWS = process.platform === "win32";

/**
 * Render selected clips with subtitles
 */
export async function renderClips(sourceFile, selected, subtitleStyle, outputDir, onLog) {
  const clipsDir = path.join(outputDir, "clips");
  const captionsDir = path.join(outputDir, "captions");
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(captionsDir, { recursive: true });

  for (let i = 0; i < selected.length; i++) {
    const chunk = selected[i];
    const clipNum = String(i + 1).padStart(2, "0");

    if (onLog) onLog(`Rendering clip ${clipNum}/${String(selected.length).padStart(2, "0")}...`);

    const clipPath = path.join(clipsDir, `clip-${clipNum}.mp4`);
    const srtPath = path.join(captionsDir, `clip-${clipNum}.srt`);
    const assPath = path.join(captionsDir, `clip-${clipNum}.ass`);

    const chunkStart = chunk.chunk.start;

    // Generate subtitle files
    fs.writeFileSync(srtPath, generateSRT(chunk.chunk.words || [], subtitleStyle, chunkStart));
    fs.writeFileSync(assPath, generateASS(chunk.chunk.words || [], subtitleStyle, chunkStart));

    // Determine actual start/end based on custom editor settings if present
    const actualStart = Number(chunk.custom?.editStart ?? chunk.chunk.start);
    const actualEnd = Number(chunk.custom?.editEnd ?? chunk.chunk.end);

    // Cut and render clip
    await cutClip(sourceFile, clipPath, actualStart, actualEnd, assPath, chunk.custom);
  }
}

/**
 * Cut a single clip with FFmpeg
 */
async function cutClip(sourceFile, outputPath, start, end, assPath, customData = {}) {
  const duration = Math.max(0.1, end - start);
  const tempRaw = outputPath.replace(".mp4", "-raw.mp4");

  // Helper to ensure values are valid numbers
  const getNum = (val, def) => {
    const n = Number(val);
    return isNaN(n) ? def : n;
  };

  // Editor parameters
  const zoom = Math.max(getNum(customData.zoom, 1.0), 0.001); // Prevent division by zero
  const normPanX = getNum(customData.normPanX, 0.0);
  const normPanY = getNum(customData.normPanY, 0.0);
  const bright = getNum(customData.brightness, 0.0);
  const contrast = getNum(customData.contrast, 1.0);
  const exposure = getNum(customData.exposure, 0.0);
  const saturation = getNum(customData.saturation, 1.0);
  const sharpen = getNum(customData.sharpen, 0.0);

  // 1. Zoom calculation (Base 9:16 vertical target size)
  // Use min() to prevent crop dimensions from exceeding input dimensions
  const cropW = `min(iw, ih*(9/16)/${zoom})`;
  const cropH = `min(ih, ih/${zoom})`;

  // 2. Pan calculation
  // A movement of normPanX in the frontend equals normPanX * (ih/zoom) in the source video.
  // Because the video moves RIGHT in the frontend, the camera/crop box moves LEFT in the source.
  const xExp = `(iw-${cropW})/2 - (${normPanX}*ih/${zoom})`;
  const yExp = `(ih-${cropH})/2 - (${normPanY}*ih/${zoom})`;
  
  // 3. Filters
  const totalBright = bright + exposure;
  const sharpenFilter = sharpen > 0 ? `,unsharp=5:5:${sharpen}` : '';

  const filterParts = [
    `crop='${cropW}':'${cropH}':'${xExp}':'${yExp}'`,
    `scale=1080:1920`,
    `eq=brightness=${totalBright}:contrast=${contrast}:saturation=${saturation}${sharpenFilter}`
  ];

  const filter = filterParts.join(",");

  await runFFmpegAsync([
    "-ss", String(start),
    "-i", sourceFile,
    "-t", String(duration),
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-y",
    tempRaw,
  ]);

  if (!fs.existsSync(tempRaw)) {
    throw new Error(`Render failed for segment ${start}s-${end}s: Output file not created`);
  }

  // Step 2: Burn subtitles (if ASS file exists)
  if (assPath && fs.existsSync(assPath) && fs.existsSync(tempRaw)) {
    // On Windows, escape backslashes and colons in the ASS path for FFmpeg filter
    let subFilter;
    if (IS_WINDOWS) {
      const escapedPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      subFilter = `ass='${escapedPath}'`;
    } else {
      subFilter = `ass=${assPath}`;
    }

    try {
      await runFFmpegAsync([
        "-i", tempRaw,
        "-vf", subFilter,
        "-c:a", "copy",
        "-y",
        outputPath,
      ]);
      // Clean up temp file
      try { fs.unlinkSync(tempRaw); } catch (e) {}
    } catch (e) {
      // If subtitle burn fails, just use the raw file
      fs.renameSync(tempRaw, outputPath);
    }
  } else if (fs.existsSync(tempRaw)) {
    fs.renameSync(tempRaw, outputPath);
  }
}

function runFFmpegAsync(args) {
  return new Promise((resolve, reject) => {
    import("child_process").then(({ spawn }) => {
      const child = spawn("ffmpeg", args, { windowsHide: true });
      let stderrData = "";
      child.stderr.on("data", (data) => stderrData += data.toString());
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(`FFmpeg exited with ${code}: ${stderrData.slice(-500)}`));
        resolve();
      });
      child.on("error", (err) => reject(err));
    });
  });
}
