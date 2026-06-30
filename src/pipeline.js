// =============================================
// SKATE — Real Pipeline (Full End-to-End)
// =============================================

import { downloadVideo, extractAudio } from './downloader.js';
import { transcribeAudio } from './transcriber.js';
import { chunkTranscript } from './chunker.js';
import { scoreChunk } from './scorer.js';
import { rankChunks, selectClips } from './ranker.js';
import { generateSocialContent } from './social.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Pipeline configuration — reads from env or uses sensible defaults
const getConfig = () => ({
  model: process.env.MODEL || 'llama3.2:3b',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  clips: parseInt(process.env.CLIPS || '5', 10),
  minLength: 15,
  maxLength: 60,
  subtitleStyle: 'tiktok',
  cacheDir: path.join(os.homedir(), '.skate', 'cache'),
});

// Global pipeline state
let currentPipeline = null;

/**
 * Cancel the currently running pipeline
 */
export function stopPipeline() {
  if (currentPipeline) {
    currentPipeline.stopped = true;
  }
}

/**
 * Get the current pipeline state (for rendering after review)
 */
export function getPipelineState() {
  return currentPipeline;
}

/**
 * Extract transcript text that falls within a given time range.
 * Returns a chunk-like object { start, end, text, words }.
 */
function extractTranscriptForRange(transcript, start, end) {
  const allWords = transcript.segments.flatMap(s => s.words || []);
  const matchingWords = allWords.filter(w => w.start >= start && w.end <= end);

  if (matchingWords.length > 0) {
    return {
      start,
      end,
      text: matchingWords.map(w => w.word).join(' '),
      words: matchingWords,
    };
  }

  // Fallback: use segment-level text
  const matchingSegments = transcript.segments.filter(
    s => s.start < end && s.end > start
  );
  const text = matchingSegments.map(s => s.text).join(' ').trim();
  return { start, end, text: text || `Clip ${start}s-${end}s`, words: [] };
}

/**
 * Query Ollama to find chunks matching a user description.
 * Returns array of chunk indices sorted by relevance.
 */
async function matchChunksByDescription(description, scoredChunks, ollamaUrl, model) {
  const candidates = scoredChunks.slice(0, 30); // limit to avoid token overflow

  const prompt = `The user wants clips about: "${description}"

Here are transcript segments from a video. Return a JSON array of the segment indices that BEST match the user's description, ranked from most relevant to least. Return at most 10 matches.

Segments:
${candidates.map(c => `[${c.index}] ${c.chunk.start}s-${c.chunk.end}s: "${c.chunk.text.slice(0, 200)}"`).join('\n')}

Return ONLY a JSON array of index numbers, e.g. [3, 7, 1]. No explanation.`;

  const systemPrompt = `You are a video clip search assistant. Given a user's description of what clips they want, you analyze transcript segments and return the indices of segments that best match their request. Return ONLY a JSON array of integers.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        system: systemPrompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 500 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

    const data = await res.json();
    const responseText = (data.response || '').trim();

    // Parse JSON array from response
    const jsonMatch = responseText.match(/\[[\d\s,]+\]/);
    if (jsonMatch) {
      const indices = JSON.parse(jsonMatch[0]);
      return indices.filter(i => typeof i === 'number' && i >= 0 && i < scoredChunks.length);
    }
    return [];
  } catch (e) {
    return []; // Will fall back to keyword matching
  }
}

/**
 * Keyword-based fallback for description matching.
 * Searches chunk text for words from the description.
 */
function matchChunksByKeywords(description, scoredChunks) {
  const keywords = description
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2); // skip short words like "the", "is", etc.

  if (keywords.length === 0) return [];

  const scored = scoredChunks.map(c => {
    const text = c.chunk.text.toLowerCase();
    let matchCount = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) matchCount++;
    }
    return { ...c, keywordScore: matchCount / keywords.length };
  });

  return scored
    .filter(c => c.keywordScore > 0)
    .sort((a, b) => b.keywordScore - a.keywordScore)
    .slice(0, 10)
    .map(c => c.index);
}

/**
 * Deduplicate clips that overlap in time.
 * If two clips overlap by > 50%, keep the one with higher score or priority.
 */
function deduplicateClips(clips) {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const result = [];

  for (const clip of sorted) {
    const overlapping = result.find(existing => {
      const overlapStart = Math.max(existing.start, clip.start);
      const overlapEnd = Math.min(existing.end, clip.end);
      const overlapDuration = Math.max(0, overlapEnd - overlapStart);
      const clipDuration = clip.end - clip.start;
      return overlapDuration > clipDuration * 0.5;
    });

    if (!overlapping) {
      result.push(clip);
    }
  }

  return result;
}

/**
 * Run the full processing pipeline
 * @param {string} source - YouTube URL or local file path
 * @param {string} genre - Content genre for AI ranking
 * @param {Function} broadcast - WebSocket broadcast function
 * @param {string} rootDir - Project root directory
 * @param {Object} options - Advanced options { description, timestamps, clipMode }
 */
export async function runPipeline(source, genre, broadcast, rootDir, options = {}) {
  const config = getConfig();
  const pipeline = { stopped: false, videoPath: null, selected: null, clipsWithMeta: null, transcript: null };
  currentPipeline = pipeline;

  const { description, timestamps, clipMode } = options;
  const hasDescription = description && description.trim().length > 0;
  const hasTimestamps = timestamps && timestamps.length > 0;
  const onlyManual = clipMode === 'only' && (hasDescription || hasTimestamps);

  const tempDir = path.join(rootDir, 'temp');
  const outputBaseDir = path.join(rootDir, 'output');

  const checkStopped = (stepName) => {
    if (pipeline.stopped) {
      broadcast({ type: 'log', level: 'warning', msg: `Pipeline cancelled during: ${stepName}` });
      throw new Error('PIPELINE_CANCELLED');
    }
  };

  try {
    // ─── Step 1: Download Video ───────────────────────
    broadcast({ type: 'step', step: 'download', status: 'active' });
    broadcast({ type: 'log', level: 'info', msg: `⬇️  Downloading video from: ${source}` });

    const isUrl = source.startsWith('http://') || source.startsWith('https://');
    let videoPath;

    if (isUrl) {
      const videoDir = path.join(tempDir, 'video');
      const logDownload = (msg) => broadcast({ type: 'log', level: 'info', msg: `   ${msg}` });
      videoPath = await downloadVideo(source, videoDir, logDownload);
      broadcast({ type: 'log', level: 'success', msg: `✅ Downloaded: ${path.basename(videoPath)}` });
    } else {
      // Local file
      if (!fs.existsSync(source)) {
        throw new Error(`File not found: ${source}`);
      }
      videoPath = path.resolve(source);
      broadcast({ type: 'log', level: 'success', msg: `✅ Using local file: ${path.basename(videoPath)}` });
    }

    pipeline.videoPath = videoPath;
    broadcast({ type: 'step', step: 'download', status: 'done' });
    checkStopped('download');

    // ─── Step 2: Extract Audio ────────────────────────
    broadcast({ type: 'step', step: 'transcribe', status: 'active' });
    broadcast({ type: 'log', level: 'info', msg: '🎵 Extracting audio for transcription...' });

    const audioDir = path.join(tempDir, 'audio');
    const audioPath = await extractAudio(videoPath, audioDir);
    broadcast({ type: 'log', level: 'success', msg: '✅ Audio extracted successfully' });
    checkStopped('audio-extraction');

    // ─── Step 3: Transcribe with Whisper ──────────────
    broadcast({ type: 'log', level: 'info', msg: '🎤 Running Whisper transcription (this may take a few minutes)...' });

    const transcript = await transcribeAudio(audioPath, config.cacheDir, 'tiny.en', (progressMsg) => {
      broadcast({ type: 'log', level: 'info', msg: `    ${progressMsg}` });
    });
    pipeline.transcript = transcript;

    const wordCount = transcript.segments.reduce((sum, s) => sum + (s.words ? s.words.length : s.text.split(/\s+/).length), 0);
    const langDisplay = (transcript.language || 'unknown').toUpperCase();

    broadcast({ type: 'log', level: 'success', msg: `✅ Transcribed ${wordCount} words — Language: ${langDisplay}` });
    broadcast({ type: 'language', language: transcript.language || 'unknown' });
    broadcast({ type: 'step', step: 'transcribe', status: 'done' });
    checkStopped('transcription');

    // ─── Step 4: Chunk & Heuristic Score ──────────────
    broadcast({ type: 'step', step: 'analyze', status: 'active' });
    broadcast({ type: 'log', level: 'info', msg: '📊 Chunking transcript into clip-sized segments...' });

    const chunks = chunkTranscript(transcript);

    if (chunks.length === 0 && !hasTimestamps) {
      throw new Error('No valid chunks found. The video might be too short or have no speech.');
    }

    const scoredChunks = chunks.map((chunk, index) => ({
      index,
      chunk,
      heuristic: scoreChunk(chunk),
    }));

    if (scoredChunks.length > 0) {
      const topScore = [...scoredChunks].sort((a, b) => b.heuristic.total - a.heuristic.total)[0];
      broadcast({ type: 'log', level: 'success', msg: `✅ Found ${chunks.length} candidate segments (top heuristic score: ${topScore.heuristic.total}/100)` });
    }
    broadcast({ type: 'step', step: 'analyze', status: 'done' });
    checkStopped('analysis');

    // ─── Step 4b: Process Timestamp Clips ─────────────
    const timestampClips = [];
    if (hasTimestamps) {
      broadcast({ type: 'log', level: 'info', msg: `⏱️  Creating ${timestamps.length} manual timestamp clip(s)...` });

      for (const ts of timestamps) {
        const chunk = extractTranscriptForRange(transcript, ts.start, ts.end);
        timestampClips.push({
          index: -1,
          chunk,
          heuristic: { total: 80 }, // Give manual clips a solid baseline
          source: 'timestamp',
        });
        broadcast({ type: 'log', level: 'info', msg: `   ⏱️ Timestamp clip: ${ts.start}s → ${ts.end}s (${Math.round(ts.end - ts.start)}s)` });
      }
    }

    // ─── Step 4c: Process Description Clips ───────────
    const descriptionClips = [];
    if (hasDescription && scoredChunks.length > 0) {
      broadcast({ type: 'log', level: 'info', msg: `📝 Searching for clips matching: "${description}"` });

      // Try AI matching first
      let matchedIndices = await matchChunksByDescription(
        description, scoredChunks, config.ollamaUrl, config.model
      );

      if (matchedIndices.length > 0) {
        broadcast({ type: 'log', level: 'success', msg: `✅ AI found ${matchedIndices.length} matching segments` });
      } else {
        // Fallback to keyword matching
        broadcast({ type: 'log', level: 'info', msg: '   AI match returned no results, trying keyword search...' });
        matchedIndices = matchChunksByKeywords(description, scoredChunks);
        if (matchedIndices.length > 0) {
          broadcast({ type: 'log', level: 'success', msg: `✅ Keyword search found ${matchedIndices.length} matching segments` });
        } else {
          broadcast({ type: 'log', level: 'warning', msg: '⚠️ No segments matched the description' });
        }
      }

      for (const idx of matchedIndices) {
        const sc = scoredChunks[idx];
        if (sc) {
          descriptionClips.push({
            ...sc,
            source: 'description',
          });
        }
      }
    }

    checkStopped('description-matching');

    // ─── Step 5: AI Ranking with Ollama ───────────────
    let aiClips = [];

    if (!onlyManual) {
      broadcast({ type: 'step', step: 'rank', status: 'active' });
      broadcast({ type: 'log', level: 'info', msg: `🧠 Querying Ollama (${config.model}) for ${genre || 'auto'} virality ranking...` });

      const genrePrompt = genre && genre !== 'auto'
        ? `Focus heavily on ${genre} content. Only select clips that match the "${genre}" genre.`
        : '';

      const ranked = await rankChunks(
        scoredChunks,
        config.clips + 3,
        config.ollamaUrl,
        config.model,
        genrePrompt
      );

      const selected = selectClips(ranked, scoredChunks, config.clips, config.minLength, config.maxLength);

      if (selected.length === 0) {
        // Fallback: use top heuristic clips
        broadcast({ type: 'log', level: 'warning', msg: '⚠️  AI ranking returned no clips, using heuristic fallback...' });
        const fallback = [...scoredChunks]
          .sort((a, b) => b.heuristic.total - a.heuristic.total)
          .slice(0, config.clips);
        aiClips = fallback.map(c => ({ ...c, source: 'ai' }));
      } else {
        aiClips = selected.map(c => ({ ...c, source: 'ai' }));
      }

      broadcast({ type: 'log', level: 'success', msg: `✅ AI selected top ${aiClips.length} viral clips!` });
      broadcast({ type: 'step', step: 'rank', status: 'done' });
    } else {
      // Skip AI ranking in "only" mode
      broadcast({ type: 'step', step: 'rank', status: 'done' });
      broadcast({ type: 'log', level: 'info', msg: '⏭️ Skipping AI ranking (manual/description-only mode)' });
    }

    checkStopped('ranking');

    // ─── Step 5b: Combine & Deduplicate ──────────────
    let allSelected = [];

    if (onlyManual) {
      // Only manual clips
      allSelected = [...timestampClips, ...descriptionClips];
      broadcast({ type: 'log', level: 'info', msg: `📋 Using ${allSelected.length} manual/description clip(s) only` });
    } else {
      // Combine: timestamp + description + AI, then deduplicate
      allSelected = [...timestampClips, ...descriptionClips, ...aiClips];
      if (timestampClips.length > 0 || descriptionClips.length > 0) {
        const before = allSelected.length;
        // Build dedup-friendly format
        const forDedup = allSelected.map(c => ({
          ...c,
          start: c.chunk.start,
          end: c.chunk.end,
        }));
        const deduped = deduplicateClips(forDedup);
        allSelected = deduped;
        if (before !== deduped.length) {
          broadcast({ type: 'log', level: 'info', msg: `   Deduplicated: ${before} → ${deduped.length} clips (removed overlaps)` });
        }
      }
    }

    if (allSelected.length === 0) {
      broadcast({ type: 'log', level: 'warning', msg: '⚠️ No clips to process. Try different timestamps or description.' });
      // Ultimate fallback — top heuristic clips
      allSelected = [...scoredChunks]
        .sort((a, b) => b.heuristic.total - a.heuristic.total)
        .slice(0, config.clips)
        .map(c => ({ ...c, source: 'ai' }));
    }

    pipeline.selected = allSelected;
    broadcast({ type: 'log', level: 'success', msg: `✅ Total clips for review: ${allSelected.length}` });

    // ─── Step 6: Generate Social Media Content ────────
    broadcast({ type: 'log', level: 'info', msg: '✍️  Generating social media content for each clip...' });

    const clipsWithMeta = [];
    for (let i = 0; i < allSelected.length; i++) {
      const clip = allSelected[i];
      checkStopped('social-content');

      broadcast({ type: 'log', level: 'info', msg: `   Generating content for clip ${i + 1}/${allSelected.length}...` });

      let social;
      try {
        social = await generateSocialContent(
          clip.chunk.text,
          genre,
          transcript.language,
          config.ollamaUrl,
          config.model
        );
      } catch (e) {
        // Fallback if Ollama fails for this clip
        social = {
          title: (clip.chunk.text || '').slice(0, 60) + '...',
          description: `Check out this ${genre || 'amazing'} clip! 🔥 Don't forget to follow for more!`,
          hashtags: '#shorts #viral #trending #fyp #explore #reels',
          caption: (clip.chunk.text || '').slice(0, 100),
        };
      }

      clipsWithMeta.push({
        index: i,
        start: clip.chunk.start,
        end: clip.chunk.end,
        duration: Math.round(clip.chunk.end - clip.chunk.start),
        text: clip.chunk.text,
        words: clip.chunk.words || [],
        score: clip.aiScore || clip.combinedScore || Math.round((clip.heuristic?.total || 50) / 10),
        heuristic: clip.heuristic || { total: 50 },
        title: social.title,
        description: social.description,
        hashtags: social.hashtags,
        caption: social.caption,
        language: transcript.language || 'unknown',
        source: clip.source || 'ai',
      });
    }

    pipeline.clipsWithMeta = clipsWithMeta;
    broadcast({ type: 'log', level: 'success', msg: `✅ Social content ready for ${clipsWithMeta.length} clips` });

    // ─── Send Clips to Frontend for Review ────────────
    broadcast({
      type: 'clips_ready',
      clips: clipsWithMeta,
      videoPath: videoPath,
      language: transcript.language || 'unknown',
    });

  } catch (err) {
    if (err.message === 'PIPELINE_CANCELLED') {
      broadcast({ type: 'stopped' });
    } else {
      throw err;
    }
  }
}
