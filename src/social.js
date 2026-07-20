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
  const systemPrompt = `You are an elite viral social media content strategist who has grown 50+ accounts to 1M+ followers on TikTok, YouTube Shorts, and Instagram Reels.

You understand:
- Hook psychology: curiosity gaps, pattern interrupts, emotional triggers
- Platform-specific best practices for each platform
- Trending hashtag strategies (mix of broad + niche tags)
- CTA patterns that drive engagement (saves, shares, comments)
- Caption formats that maximize reach

Rules:
- Titles MUST create curiosity or emotional reaction
- Descriptions MUST include a call-to-action
- Hashtags MUST mix trending broad tags (#shorts #viral) with niche-specific tags
- Captions should be punchy overlay text (not the same as the description)
- Use emoji strategically (not excessively)

Return ONLY valid JSON. No markdown formatting, no explanation, no code fences, just the raw JSON object.`;

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

Here are 2 examples of excellent output:

Example 1 (comedy clip):
{"title": "He really said THAT with a straight face 💀", "description": "I can't believe this actually happened 😂 This is the funniest thing I've seen all week! Save this for when you need a laugh 😭\\n\\n🔥 Follow for more hilarious clips!", "hashtags": "#shorts #viral #trending #funny #comedy #humor #lol #memes #fyp #explore #relatable #hilarious #laughing #dailyhumor #mustwatch", "caption": "Nobody expected this ending 💀😂"}

Example 2 (educational clip):
{"title": "This ONE thing changed everything 🤯", "description": "Most people have no idea about this... and it's honestly game-changing 🧠💡\\n\\nSave this for later and share with someone who needs to hear it!\\n\\n📌 Follow for more mind-blowing facts!", "hashtags": "#shorts #viral #trending #education #facts #mindblown #didyouknow #learning #fyp #explore #knowledge #tips #lifehack #motivation #growth", "caption": "Why didn't anyone teach us this?! 🤯"}

Now generate content for the transcript above. Return a JSON object with exactly these 4 fields:
1. "title": Catchy, viral title with 1-2 emoji (max 60 chars). Create curiosity or emotional reaction.
2. "description": Engaging 2-3 sentence description with emoji and a call-to-action. Include line breaks.
3. "hashtags": 15-20 space-separated hashtags. ALWAYS include #shorts #viral #trending. Add genre + niche tags.
4. "caption": Short punchy overlay text with emoji (max 80 chars). Different from the title.

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
