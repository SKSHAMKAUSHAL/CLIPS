// =============================================
// SKATE — Subtitle Generator (SRT + ASS)
// =============================================

const MAX_LINE_LENGTH = 42;
const MAX_DISPLAY_DURATION = 3.5;

/**
 * Generate SRT subtitle file content
 */
export function generateSRT(words, _style = "minimal", offset = 0) {
  const groups = groupWordsIntoCaptions(words, offset);
  return groups.map((group, i) => formatSRTBlock(i + 1, group)).join("\n\n");
}

/**
 * Generate ASS subtitle file content
 */
export function generateASS(words, _style = "minimal", offset = 0) {
  const groups = groupWordsIntoCaptions(words, offset);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,90,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,8,6,2,40,40,650,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];
  for (const group of groups) {
    if (!group.words || group.words.length === 0) continue;
    
    for (let i = 0; i < group.words.length; i++) {
      const activeWord = group.words[i];
      const start = formatASSTime(activeWord.start);
      // Extend the end time to the start of the next word if it exists, otherwise to the group end
      const nextWord = group.words[i + 1];
      const end = formatASSTime(nextWord ? nextWord.start : group.end);
      
      let lineText = "";
      for (let j = 0; j < group.words.length; j++) {
        const w = group.words[j].word.trim();
        if (j === i) {
          // Yellow color (&H00FFFF& in BGR) and slightly scaled up
          lineText += `{\\c&H00FFFF&\\fscx115\\fscy115}${w}{\\c&HFFFFFF&\\fscx100\\fscy100} `;
        } else {
          lineText += `${w} `;
        }
      }
      
      events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${lineText.trim()}`);
    }
  }

  return header + events.join("\n");
}

function groupWordsIntoCaptions(words, offset = 0) {
  if (!words || words.length === 0) return [];

  const groups = [];
  let currentStart = Math.max(0, words[0].start - offset);
  let currentEnd = Math.max(0, words[0].end - offset);
  let currentWords = [];
  let currentLength = 0;

  for (const word of words) {
    const wordText = (word.word || "").trim();
    if (!wordText) continue;

    const wordStart = Math.max(0, word.start - offset);
    const wordEnd = Math.max(0, word.end - offset);

    const newLength = currentLength + wordText.length + (currentLength > 0 ? 1 : 0);
    const displayDuration = wordEnd - currentStart;

    if ((newLength > MAX_LINE_LENGTH || displayDuration > MAX_DISPLAY_DURATION) && currentLength > 0) {
      groups.push({ start: currentStart, end: currentEnd, words: currentWords });
      currentStart = wordStart;
      currentEnd = wordEnd;
      currentWords = [{ ...word, start: wordStart, end: wordEnd }];
      currentLength = wordText.length;
    } else {
      currentWords.push({ ...word, start: wordStart, end: wordEnd });
      currentEnd = wordEnd;
      currentLength = newLength;
    }
  }

  if (currentWords.length > 0) {
    groups.push({ start: currentStart, end: currentEnd, words: currentWords });
  }
  return groups;
}

function formatSRTBlock(index, group) {
  const text = group.words.map(w => w.word.trim()).join(" ");
  return `${index}\n${formatTime(group.start)} --> ${formatTime(group.end)}\n${text}`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function formatASSTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs, 2)}`;
}

function pad(num, length = 2) {
  return String(num).padStart(length, "0");
}
