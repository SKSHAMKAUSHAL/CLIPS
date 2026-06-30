// =============================================
// SKATE — Transcriber (Whisper Bridge)
// =============================================

import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_WINDOWS = process.platform === "win32";
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");

/**
 * Find the Python executable
 */
function findPython() {
  // Try venv first
  const venvPython = IS_WINDOWS
    ? path.join(os.homedir(), ".skate", "venv", "Scripts", "python.exe")
    : path.join(os.homedir(), ".skate", "venv", "bin", "python3");

  if (fs.existsSync(venvPython)) return venvPython;

  // Fall back to system Python
  return IS_WINDOWS ? "python" : "python3";
}

/**
 * Transcribe audio using Groq Whisper API or fallback to local faster-whisper
 */
export async function transcribeAudio(audioPath, cacheDir, modelSize = "base", onProgress) {
  fs.mkdirSync(cacheDir, { recursive: true });

  // Check cache
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const cacheFile = path.join(cacheDir, `${baseName}.transcript.json`);

  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  }

  // Use Groq if available
  if (process.env.GROQ_API_KEY) {
    if (typeof onProgress === 'function') onProgress("Using lightning-fast Groq Whisper API...");
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-large-v3",
        response_format: "verbose_json",
      });
      
      const transcript = {
        language: transcription.language || "unknown",
        duration: transcription.duration || 0,
        segments: (transcription.segments || []).map(seg => ({
          start: seg.start,
          end: seg.end,
          text: seg.text,
          words: [] // Groq verbose_json currently doesn't return words for Whisper, fallback to empty array
        }))
      };
      
      fs.writeFileSync(cacheFile, JSON.stringify(transcript, null, 2));
      return transcript;
    } catch (e) {
      if (typeof onProgress === 'function') onProgress(`Groq API failed: ${e.message}. Falling back to local...`);
    }
  }

  const python = findPython();
  const script = path.join(SCRIPTS_DIR, "whisper_transcribe.py");

  if (!fs.existsSync(script)) {
    throw new Error(`Whisper script not found at: ${script}`);
  }

  // Use async spawn to avoid blocking Node.js event loop
  const raw = await new Promise((resolve, reject) => {
    import("child_process").then(({ spawn }) => {
      const child = spawn(python, [script, audioPath, modelSize], {
        windowsHide: true,
      });

      let stdoutData = "";
      let stderrData = "";

      child.stdout.on("data", (data) => {
        stdoutData += data.toString();
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        stderrData += text;
        
        // Try to parse real-time progress from stderr
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.includes("Transcribed:") && typeof onProgress === 'function') {
            onProgress(line.trim());
          }
        }
      });

      child.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`Transcription failed: ${stderrData.trim() || stdoutData.trim() || "Exit code " + code}`));
        }
        try {
          resolve(JSON.parse(stdoutData.trim()));
        } catch (e) {
          reject(new Error(`Transcription failed: Could not parse output as JSON`));
        }
      });

      child.on("error", (err) => {
        reject(new Error(`Transcription failed: Could not run Python — ${err.message}`));
      });
    });
  });

  if (raw.error) {
    throw new Error(`Transcription error: ${raw.error}`);
  }

  const segments = (raw.segments || []).map((seg) => ({
    start: seg.start ?? 0,
    end: seg.end ?? 0,
    text: (seg.text || "").trim(),
    words: (seg.words || []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
  }));

  const transcript = {
    segments,
    language: raw.language || "unknown",
    duration: raw.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0),
  };

  // Cache result
  fs.writeFileSync(cacheFile, JSON.stringify(transcript, null, 2));
  return transcript;
}
