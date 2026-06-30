// =============================================
// SKATE — Demo Pipeline (when dependencies missing)
// =============================================

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function runDemoPipeline(source, genre, broadcast) {
  broadcast({ type: 'log', level: 'info', msg: `[DEMO] Simulating pipeline for: ${source}` });
  broadcast({ type: 'log', level: 'info', msg: `[DEMO] Genre: ${genre || 'auto-detect'}` });

  // Step 1: Download
  broadcast({ type: 'step', step: 'download', status: 'active' });
  await wait(1500);
  broadcast({ type: 'log', level: 'info', msg: '[DEMO] ⬇️  Downloading video with yt-dlp...' });
  await wait(2000);
  broadcast({ type: 'log', level: 'success', msg: '[DEMO] ✅ Downloaded: video_abc123.mp4 (124 MB)' });
  broadcast({ type: 'step', step: 'download', status: 'done' });

  // Step 2: Transcribe
  broadcast({ type: 'step', step: 'transcribe', status: 'active' });
  await wait(800);
  broadcast({ type: 'log', level: 'info', msg: '[DEMO] 🎵 Extracting audio...' });
  await wait(1200);
  broadcast({ type: 'log', level: 'info', msg: '[DEMO] 🎤 Running Whisper transcription...' });
  await wait(3000);
  broadcast({ type: 'log', level: 'success', msg: '[DEMO] ✅ Transcribed 1,847 words — Language: ENGLISH' });
  broadcast({ type: 'language', language: 'english' });
  broadcast({ type: 'step', step: 'transcribe', status: 'done' });

  // Step 3: Analyze
  broadcast({ type: 'step', step: 'analyze', status: 'active' });
  await wait(800);
  broadcast({ type: 'log', level: 'info', msg: '[DEMO] 📊 Chunking transcript and scoring segments...' });
  await wait(2000);
  broadcast({ type: 'log', level: 'success', msg: '[DEMO] ✅ Found 18 candidate segments (top score: 87/100)' });
  broadcast({ type: 'step', step: 'analyze', status: 'done' });

  // Step 4: AI Rank
  broadcast({ type: 'step', step: 'rank', status: 'active' });
  await wait(500);
  broadcast({ type: 'log', level: 'info', msg: `[DEMO] 🧠 Querying Ollama for ${genre || 'auto'} virality ranking...` });
  await wait(3500);
  broadcast({ type: 'log', level: 'success', msg: '[DEMO] ✅ AI selected top 4 viral clips!' });
  broadcast({ type: 'step', step: 'rank', status: 'done' });

  // Step 5: Social content
  broadcast({ type: 'log', level: 'info', msg: '[DEMO] ✍️  Generating social media content...' });
  await wait(2000);
  broadcast({ type: 'log', level: 'success', msg: '[DEMO] ✅ Social content ready for 4 clips' });

  // Send mock clips with full metadata
  const mockClips = [
    {
      index: 0,
      start: 12,
      end: 48,
      duration: 36,
      text: "You won't believe what happened when I tried this for the first time. Everyone told me it was impossible, but I had to prove them wrong. And the results? Absolutely mind-blowing.",
      score: 9.5,
      title: '🤯 "They Said It Was Impossible"',
      description: 'Watch what happens when you ignore the doubters and go all in! 💪 This will change how you think about challenges. Follow for more mind-blowing content! 🔥',
      hashtags: '#shorts #viral #trending #impossible #motivation #fyp #explore #reels #mindblown #nevergiveup',
      caption: 'They said it was impossible... 🤯🔥',
      language: 'english',
      heuristic: { total: 87, speakingRate: 70, emotionalLanguage: 80, engagementHooks: 90, storyStructure: 85, sentimentShift: 65 },
    },
    {
      index: 1,
      start: 105,
      end: 148,
      duration: 43,
      text: "Here's the thing that most people don't understand about success. It's not about talent, it's not about luck. The secret is showing up every single day, even when you don't feel like it.",
      score: 8.8,
      title: '💡 The Real Secret to Success',
      description: 'This is the truth nobody talks about! 💎 Most people give up right before the breakthrough. Don\'t be most people! Save this for when you need motivation 🙌',
      hashtags: '#shorts #viral #success #motivation #hustle #grind #trending #mindset #entrepreneur #inspire',
      caption: 'The secret nobody tells you about success 💡',
      language: 'english',
      heuristic: { total: 82, speakingRate: 75, emotionalLanguage: 70, engagementHooks: 95, storyStructure: 80, sentimentShift: 50 },
    },
    {
      index: 2,
      start: 250,
      end: 305,
      duration: 55,
      text: "But suddenly everything changed. One day I woke up and realized that the approach everyone was using was completely wrong. What if we flipped the entire model on its head? That's when the breakthrough happened.",
      score: 8.2,
      title: '😱 The Moment Everything Changed',
      description: 'This plot twist changed EVERYTHING! 🔄 Sometimes the answer is doing the exact opposite of what everyone else does. Follow for more game-changing insights! ✨',
      hashtags: '#shorts #viral #plottwist #gamechanger #trending #innovation #mindset #breakthrough #fyp #explore',
      caption: 'Then everything changed in an instant... 😱',
      language: 'english',
      heuristic: { total: 78, speakingRate: 65, emotionalLanguage: 75, engagementHooks: 80, storyStructure: 90, sentimentShift: 70 },
    },
    {
      index: 3,
      start: 380,
      end: 425,
      duration: 45,
      text: "Did you know that 90% of people who try this method give up in the first week? But the ones who stick with it? They see results that are absolutely incredible. Let me show you exactly how.",
      score: 7.9,
      title: '📊 90% Fail — Here\'s Why You Won\'t',
      description: 'Only 10% make it through — are you one of them? 💪 This simple method has changed thousands of lives. Watch till the end for the full breakdown! 📈',
      hashtags: '#shorts #viral #lifehack #tips #trending #howto #tutorial #results #transformation #fyp',
      caption: '90% fail at this — be the 10% 💪📊',
      language: 'english',
      heuristic: { total: 75, speakingRate: 80, emotionalLanguage: 65, engagementHooks: 85, storyStructure: 70, sentimentShift: 45 },
    },
  ];

  broadcast({
    type: 'clips_ready',
    clips: mockClips,
    videoPath: 'demo-video.mp4',
    language: 'english',
  });
}
