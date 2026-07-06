# L2S (Long-to-Short) — AI-Powered YouTube → Viral Shorts

> Turn long-form videos into viral-ready vertical shorts, entirely on your local machine. Free, no cloud restrictions.
Saw a bunch of paid tools doing this — why pay when you can run it locally? L2S uses **faster-whisper** for transcription, **Ollama** for AI ranking, and **FFmpeg** for rendering with advanced manual framing control. Everything runs on your machine.





L2S is a local web application that turns long-form videos into viral-ready vertical shorts. 
It runs a Node.js Express server and provides a web UI to process videos locally on your machine, eliminating the need for expensive cloud subscriptions.


## Features

- **Download**: Pulls videos from YouTube using `yt-dlp` (or processes local video files).
- **Transcribe**: Uses the lightning-fast Groq Whisper API (or a local `faster-whisper` Python fallback) to transcribe audio with precise word-level timestamps.
- **Chunk & Score**: Automatically chunks the transcript into 20–90 second natural segments and scores them heuristically based on speaking rate, hooks, and engagement markers.
- **AI Ranking**: Sends top clip candidates to a local LLM via `Ollama` to evaluate and score their virality.
- **Render**: Customizes the video with smart vertical cropping and renders the final MP4 clips with burned-in subtitles using `FFmpeg`.

## How It Works

## Prerequisites

Before running the project, make sure you have the following installed on your system:

- **Node.js** (v18+)
- **FFmpeg** (Must be installed and added to your system PATH)
- **yt-dlp** (Must be installed and added to your system PATH)
- **Ollama** (For local AI ranking. Recommended model: `llama3.2:3b`)
- *(Optional)* **Python 3** (Only required if you plan to use local `faster-whisper` for transcription instead of the Groq API)

## Installation & Setup

1. **Clone the repository and navigate to the directory:**
   ```bash
   git clone https://github.com/yourusername/skate.git
   cd skate
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Set up Environment Variables:**
   Create or edit the `.env` file in the root directory and add your Groq API key for faster transcriptions:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   ```

4. **Start the local server:**
   ```bash
   npm run dev
   ```
   *This will start the Node.js Express server on port 3000.*

5. **Open the Web UI:**
   Navigate to `http://localhost:3000` in your web browser.

## How to Use

1. **Input**: Enter a YouTube URL or select a local video file in the web interface.
2. **Process**: The application will automatically download the video, transcribe the audio, and chunk it into potential clips.
3. **Review**: Review the AI-ranked clips and choose the ones you want to finalize.
4. **Edit**: Adjust the framing (pan/zoom) and choose your preferred subtitle style.
5. **Render**: Click render to generate your final vertical shorts. Your rendered clips and subtitle files will be saved in the `output/` directory.



## Project Structure

- `src/server.js`: The main Express backend server.
- `src/downloader.js`: Handles video downloading using yt-dlp.
- `src/transcriber.js`: Interfaces with the Groq API or local Whisper script.
- `src/ranker.js`: Interfaces with Ollama to intelligently rank clips.
- `src/renderer.js`: Uses FFmpeg to apply crops and burn subtitles into the video.
- `public/`: Contains the frontend web interface (`index.html`, `style.css`, `app.js`).
- `output/`: Where your final rendered clips and captions are saved.
