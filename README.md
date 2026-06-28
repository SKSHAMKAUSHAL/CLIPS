# L2S (Long-to-Short) — AI-Powered YouTube → Viral Shorts (clipper) CLI



> Turn long-form videos into viral-ready vertical shorts, entirely on your local machine. Free, no cloud restrictions.
Saw a bunch of paid tools doing this — why pay when you can run it locally? L2S uses **faster-whisper** for transcription, **Ollama** for AI ranking, and **FFmpeg** for rendering with advanced manual framing control. Everything runs on your machine.

---



## How It Works

```
Input (URL or file)
  → Download (yt-dlp)
  → Transcribe (faster-whisper)
  → Chunk transcript into segments
  → Score heuristically (no AI needed)
  → Rank with local LLM (Ollama)
  → Select best clips
  → Track faces for smart vertical crop
  → Render clips with subtitles burned in
  → Output organized shorts
```

---

## Requirements

| Tool               | Purpose                    | Check                        |
| ------------------ | -------------------------- | ---------------------------- |
| **Bun**            | Runtime & package manager  | `bun --version`              |
| **FFmpeg**         | Video cutting & processing | `ffmpeg -version`            |
| **yt-dlp**         | YouTube downloading        | `yt-dlp --version`           |
| **Ollama**         | Local LLM for AI ranking   | `ollama --version`           |
| **Python 3**       | Whisper & OpenCV scripts   | `python3 --version`          |
| **faster-whisper** | Local transcription        | installed via `setup-python` |
| **OpenCV**         | Face detection             | installed via `setup-python` |

### Recommended Ollama Model

```bash
ollama pull llama3.2:3b
```

---

## Installation

### 1. Clone and install dependencies

```bash
git clone https://github.com/yourusername/skate.git
cd skate
bun install
```

### 2. Set up Python environment (Whisper + OpenCV)

```bash
bun run setup-python
```

This creates a virtual environment at `~/.skate/venv` and installs:

- `faster-whisper` — speech-to-text with word-level timestamps
- `opencv-contrib-python` — face detection via Haar cascades
- `numpy` — numerical processing

### 3. Link the CLI (optional)

```bash
bun link
```

Then you can run `skate` from anywhere.


## Configuration

Config is stored at `~/.skate/config.json` and auto-created on first run.

```json
{
  "model": "llama3.2:3b",
  "clips": 10,
  "minLength": 20,
  "maxLength": 90,
  "subtitleStyle": "minimal",
  "outputDir": "./output",
  "cacheDir": "~/.skate/cache",
  "ollamaUrl": "http://localhost:11434"
}
```

### Options

| Field           | Default                  | Description                                     |
| --------------- | ------------------------ | ----------------------------------------------- |
| `model`         | `llama3.2:3b`            | Ollama model for ranking                        |
| `clips`         | `10`                     | Number of clips to produce                      |
| `minLength`     | `20`                     | Minimum clip length (seconds)                   |
| `maxLength`     | `90`                     | Maximum clip length (seconds)                   |
| `subtitleStyle` | `minimal`                | Subtitle style (`minimal`, `tiktok`, `mrbeast`) |
| `outputDir`     | `./output`               | Output directory                                |
| `cacheDir`      | `~/.skate/cache`         | Cache directory                                 |
| `ollamaUrl`     | `http://localhost:11434` | Ollama API URL                                  |

---

## Output Structure

```
output/
└── <video-name>/
    ├── clips/
    │   ├── clip-01.mp4
    │   ├── clip-02.mp4
    │   └── clip-03.mp4
    ├── captions/
    │   ├── clip-01.srt
    │   └── clip-02.srt
    └── metadata.json
```

---



## Project Structure

```
skate/
├── scripts/
│   ├── face_detect.py         # OpenCV face detection
│   ├── whisper_transcribe.py  # faster-whisper transcription
│   └── requirements.txt       # Python dependencies
├── src/
│   ├── commands/
│   │   ├── clip.ts            # Process local video
│   │   ├── analyze.ts         # Analysis only pipeline
│   │   ├── render.ts          # Render from cached analysis
│   │   ├── watch.ts           # Watch directory mode
│   │   └── doctor.ts          # Dependency checker
│   ├── core/
│   │   ├── pipeline.ts        # Main pipeline orchestrator
│   │   ├── downloader.ts      # yt-dlp integration
│   │   ├── transcriber.ts     # Whisper bridge
│   │   ├── chunker.ts         # Transcript chunking
│   │   ├── scorer.ts          # Heuristic scoring
│   │   ├── ranker.ts          # AI ranking bridge
│   │   ├── tracker.ts         # Face tracking
│   │   ├── renderer.ts        # FFmpeg rendering
│   │   └── subtitles.ts       # SRT/ASS generation
│   ├── ai/
│   │   ├── prompts.ts         # LLM prompt templates
│   │   ├── ollama.ts          # Ollama API client
│   │   └── ranking.ts         # AI ranking logic
│   ├── vision/
│   │   ├── face.ts            # Face detection
│   │   ├── scene.ts           # Scene detection
│   │   └── crop.ts            # Smart crop path
│   ├── ui/
│   │   └── tui.ts             # Terminal spinner UI
│   ├── config.ts              # Configuration loader
│   ├── types.ts               # TypeScript types
│   └── index.tsx              # CLI entry point
├── output/                    # Rendered clips
├── cache/                     # Cached downloads
├── models/                    # Local models
├── temp/                      # Working files
├── package.json
├── tsconfig.json
└── README.md
```

---

## Pipeline Steps

| Step            | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| **Download**    | Pulls video from YouTube via yt-dlp (or uses local file)           |
| **Transcribe**  | Runs faster-whisper for speech-to-text with word-level timestamps  |
| **Chunk**       | Splits transcript into 30–90 second natural segments               |
| **Score**       | Heuristic scoring — speaking rate, emotion, story structure, hooks |
| **Rank**        | Sends top candidates to Ollama for virality scoring                |
| **Select**      | Picks best clips based on combined heuristic + AI scores           |
| **Track Faces** | Detects faces per frame via OpenCV for smart vertical crop         |
| **Render**      | Cuts clips, applies crop, burns in subtitles                       |

---

## npm Scripts

| Script                 | Command                                       |
| ---------------------- | --------------------------------------------- |
| `bun start`            | Run L2S                                     |
| `bun run dev`          | Run with watch mode (auto-restart on changes) |
| `bun run typecheck`    | TypeScript type checking                      |
| `bun run setup-python` | Create venv and install Python deps           |

---

## Caching

L2S caches aggressively at `~/.skate/cache`:

- Downloaded video/audio files
- Transcripts
- Face tracking data
- Analysis results

Re-running is fast — only changed steps are re-executed.

---

## Why Build This?

Every "AI shorts" tool out there charges $20–$50/month or requires API keys that bill per minute. L2S is:

- **100% local** — nothing leaves your machine
- **Free** — no subscriptions, no API costs
- **Private** — your videos never hit a third-party server
- **Customizable** — swap models, tweak prompts, adjust scoring
