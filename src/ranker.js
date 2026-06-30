// =============================================
// SKATE — AI Ranker (Ollama Integration)
// =============================================

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const RANKING_SYSTEM_PROMPT = `You are a viral clip analyst for short-form video content.
Your job is to evaluate transcript segments and rank them by virality potential.

Score each segment on these criteria:
- Hook strength: Does it grab attention immediately? (0-10)
- Virality potential: Will people share this? (0-10)
- Curiosity gap: Does it make you want to keep watching? (0-10)
- Emotional impact: Does it make you feel something? (0-10)
- Shareability: Would someone send this to a friend? (0-10)

Return ONLY a valid JSON array. No markdown, no explanation.`;

function buildRankingPrompt(chunks) {
  return `Evaluate these transcript segments and return a JSON array ranked by virality potential.

Each object must have: title (string), score (number 0-10), start (number), end (number), reason (string).

Segments:
${chunks.map((c) => `[${c.index}] ${c.start}s-${c.end}s: "${c.text.slice(0, 200)}"`).join("\n")}

Return ONLY the JSON array.`;
}

/**
 * Query Ollama API
 */
async function queryOllama(prompt, ollamaUrl, model, systemPrompt) {
  const body = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: 0.3,
      num_predict: -1,
    },
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.response || "";
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/**
 * Rank scored chunks using AI (with heuristic fallback)
 */
export async function rankChunks(scoredChunks, topN, ollamaUrl, model, userPrompt = "") {
  const sorted = [...scoredChunks].sort((a, b) => b.heuristic.total - a.heuristic.total);
  const candidates = sorted.slice(0, Math.min(topN + 2, sorted.length));

  try {
    const promptChunks = candidates.map((c) => ({
      index: c.index,
      start: c.chunk.start,
      end: c.chunk.end,
      text: c.chunk.text,
    }));

    const prompt = buildRankingPrompt(promptChunks);
    
    let systemPrompt = RANKING_SYSTEM_PROMPT;
    if (userPrompt) {
      systemPrompt += `\n\nCRITICAL: The user specifically requested clips matching this description: "${userPrompt}". Heavily prioritize segments that match this request.`;
    }

    const hash = crypto.createHash("md5").update(prompt + systemPrompt).digest("hex");
    const cacheDir = path.join(os.homedir(), ".skate", "cache", "llm");
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `${hash}.json`);

    let response;
    if (fs.existsSync(cacheFile)) {
      response = fs.readFileSync(cacheFile, "utf-8");
    } else {
      response = await queryOllama(prompt, ollamaUrl, model, systemPrompt);
      fs.writeFileSync(cacheFile, response);
    }

    const results = parseRankingResponse(response, candidates);
    if (results.length > 0) return results;
  } catch (e) {
    // AI failed, fall through to heuristic
  }

  // Heuristic fallback
  return candidates.map((c) => ({
    title: c.chunk.text.slice(0, 80) + (c.chunk.text.length > 80 ? "..." : ""),
    score: Math.round((c.heuristic.total / 100) * 10),
    start: c.chunk.start,
    end: c.chunk.end,
    reason: `Heuristic score: ${c.heuristic.total}/100`,
  }));
}

/**
 * Select the best non-overlapping clips
 */
export function selectClips(ranked, scoredChunks, maxClips, minLength, maxLength) {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const selected = [];
  const usedRanges = [];

  for (const rank of sorted) {
    if (selected.length >= maxClips) break;

    const duration = rank.end - rank.start;
    if (duration < minLength || duration > maxLength) continue;

    const overlaps = usedRanges.some((r) => rank.start < r.end && rank.end > r.start);
    if (overlaps) continue;

    const chunk = scoredChunks.find(
      (c) => Math.abs(c.chunk.start - rank.start) < 1 && Math.abs(c.chunk.end - rank.end) < 1
    );

    if (chunk) {
      chunk.aiScore = rank.score;
      chunk.combinedScore = Math.round((chunk.heuristic.total + rank.score * 10) / 2);
      selected.push(chunk);
      usedRanges.push({ start: rank.start, end: rank.end });
    }
  }

  return selected;
}

function parseRankingResponse(response, originalChunks) {
  const cleaned = response
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r) => ({
      ...r,
      start: r.start ?? 0,
      end: r.end ?? 0,
      score: Math.max(0, Math.min(10, r.score || 0)),
    }));
  } catch {
    // Fallback: try regex parsing
    const results = [];
    const lines = response.split("\n");

    for (const line of lines) {
      const scoreMatch = line.match(/score[:\s]+(\d+(?:\.\d+)?)/i);
      const titleMatch = line.match(/title[:\s]+"([^"]+)"/i) || line.match(/\d+\.\s+([^(]+)/);

      if (scoreMatch) {
        results.push({
          title: titleMatch?.[1]?.trim() || `Clip ${results.length + 1}`,
          score: parseFloat(scoreMatch[1]),
          start: 0,
          end: 0,
          reason: "",
        });
      }
    }

    return results;
  }
}
