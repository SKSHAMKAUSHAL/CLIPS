// =============================================
// SKATE — AI Ranker (Ollama Integration)
// =============================================

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const RANKING_SYSTEM_PROMPT = `You are a world-class viral clip analyst for short-form video content (TikTok, YouTube Shorts, Instagram Reels).
You have deep expertise in what makes clips go viral — hooks, emotional triggers, curiosity gaps, and shareability.

Your evaluation process:
1. First, identify the HOOK — the first 3 seconds that grab attention
2. Assess EMOTIONAL IMPACT — does this evoke surprise, laughter, awe, or controversy?
3. Evaluate SHAREABILITY — would someone send this to a friend or repost it?
4. Check COMPLETENESS — does the segment tell a complete mini-story or make a complete point?
5. Rate CURIOSITY GAP — does it make viewers desperate to know what happens next?

Score each segment 0-10 where:
- 0-3: Boring, filler content, no hook
- 4-5: Mildly interesting but forgettable
- 6-7: Good content, would get decent views
- 8-9: Excellent viral potential, strong hook + emotion
- 10: Once-in-a-million clip, guaranteed to go massively viral

Be HARSH with scores. Most clips should be 4-6. Only truly exceptional moments deserve 8+.

Return ONLY a valid JSON array. No markdown, no explanation, no code fences.`;

function buildRankingPrompt(chunks) {
  return `Evaluate these transcript segments for short-form viral potential.

For each segment, think about:
- Does it START with something attention-grabbing? (hook strength)
- Would someone stop scrolling for this? (thumb-stopping power)
- Is there an emotional reaction? (laughter, shock, inspiration)
- Would someone share this or tag a friend? (shareability)

Here are 2 examples of ideal output format:

Example input: [0] 12s-45s: "So I walked into the store and the cashier looked at me and said..."
Example output: {"title": "What the cashier said will shock you 😱", "score": 7, "start": 12, "end": 45, "reason": "Strong curiosity gap with a setup-punchline structure. The 'what they said' hook creates anticipation."}

Example input: [1] 120s-155s: "The third thing about investing that nobody talks about is..."
Example output: {"title": "The investing secret nobody mentions 💰", "score": 8, "start": 120, "end": 155, "reason": "Excellent hook with 'nobody talks about' framing. Educational + curiosity gap. Highly shareable."}

Now evaluate these real segments. Return a JSON array ranked by virality (best first).
Each object MUST have: title (string, catchy with emoji, max 60 chars), score (number 0-10), start (number), end (number), reason (string explaining your scoring).

Segments to evaluate:
${chunks.map((c) => `[${c.index}] ${c.start}s-${c.end}s: "${c.text.slice(0, 300)}"`).join("\n")}

Return ONLY the JSON array, ranked from highest to lowest score.`;
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
