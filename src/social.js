// =============================================
// SKATE — Social Media Content Generator (Ollama)
// =============================================

/**
 * Query Ollama for content generation
 */
async function queryOllama(prompt, systemPrompt, ollamaUrl, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        system: systemPrompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 600 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.response || '';
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/**
 * Parse JSON from LLM response (handles markdown code fences)
 */
function parseJsonResponse(response) {
  // Strip markdown code fences
  let cleaned = response
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  return JSON.parse(cleaned);
}

/**
 * Generate viral social media content for a clip
 * @param {string} clipText - Transcript text of the clip
 * @param {string} genre - Content genre (funny, educational, etc.)
 * @param {string} language - Detected language of the video
 * @param {string} ollamaUrl - Ollama API URL
 * @param {string} model - Ollama model name
 * @returns {Object} { title, description, hashtags, caption }
 */
export async function generateSocialContent(clipText, genre, language, ollamaUrl, model) {
  const systemPrompt = `You are a viral social media content strategist who specializes in short-form video (Instagram Reels, YouTube Shorts, TikTok).
You create engaging, click-worthy content that maximizes views and shares.
You understand trending hashtags, hook writing, and what makes content go viral.
Return ONLY valid JSON. No markdown formatting, no explanation, just the raw JSON object.`;

  const genreContext = genre && genre !== 'auto'
    ? `The content genre is "${genre}". Use genre-specific hashtags and language.`
    : 'Determine the best genre from the content.';

  const langContext = language && language !== 'unknown'
    ? `The original language is ${language}. If it's not English, include both ${language} and English hashtags.`
    : '';

  const prompt = `Create viral social media content for this video clip.

${genreContext}
${langContext}

Transcript: "${clipText.slice(0, 600)}"

Generate a JSON object with these fields:
1. "title": A catchy, viral title with emoji (max 60 chars). Make it curiosity-driven.
2. "description": An engaging description for Instagram/YouTube Shorts (2-3 sentences). Include a call-to-action like "Follow for more!" or "Save this for later!". Use emoji.
3. "hashtags": 15-20 relevant trending hashtags as a single string, space-separated. Always include #shorts #viral #trending. Add genre-specific and niche hashtags.
4. "caption": A short punchy one-liner for the reel overlay (max 80 chars, with emoji).

Return ONLY: {"title": "...", "description": "...", "hashtags": "...", "caption": "..."}`;

  try {
    const response = await queryOllama(prompt, systemPrompt, ollamaUrl, model);
    const parsed = parseJsonResponse(response);

    return {
      title: (parsed.title || 'Untitled Clip').slice(0, 80),
      description: parsed.description || '',
      hashtags: parsed.hashtags || '#shorts #viral #trending',
      caption: (parsed.caption || '').slice(0, 120),
    };
  } catch (e) {
    // Fallback content if AI fails
    const fallbackGenre = genre && genre !== 'auto' ? genre : 'amazing';
    return {
      title: `🔥 ${clipText.slice(0, 50)}...`,
      description: `This ${fallbackGenre} clip will blow your mind! 🤯 Follow for more content like this! 🙌`,
      hashtags: `#shorts #viral #trending #fyp #explore #reels #${fallbackGenre} #content #mustsee #amazing`,
      caption: `${clipText.slice(0, 70)}... 🔥`,
    };
  }
}
