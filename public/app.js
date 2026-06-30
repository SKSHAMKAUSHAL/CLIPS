// ═══════════════════════════════════════════
// SKATE v2 — Frontend Logic
// ═══════════════════════════════════════════

// ─── DOM Elements ────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  // Hero / Input
  heroSection: $('#hero-section'),
  form: $('#process-form'),
  sourceInput: $('#source-input'),
  genreSelect: $('#genre-select'),
  generateBtn: $('#generate-btn'),
  stopBtn: $('#stop-btn'),
  inputHint: $('#input-hint'),
  // Video Info
  videoInfoCard: $('#video-info-card'),
  videoThumb: $('#video-thumb'),
  videoTitle: $('#video-title'),
  videoChannel: $('#video-channel'),
  videoDuration: $('#video-duration'),
  videoViews: $('#video-views'),
  videoInfoClose: $('#video-info-close'),
  // Pipeline
  pipelineSection: $('#pipeline-section'),
  pipelineTimer: $('#pipeline-timer'),
  terminal: $('#terminal'),
  clearTerminal: $('#clear-terminal'),
  // Review
  reviewSection: $('#review-section'),
  reviewGrid: $('#review-grid'),
  reviewLanguage: $('#review-language'),
  selectAllBtn: $('#select-all-btn'),
  renderSelectedBtn: $('#render-selected-btn'),
  selectedCount: $('#selected-count'),
  // Results
  resultsSection: $('#results-section'),
  resultsList: $('#results-list'),
  downloadAllBtn: $('#download-all-btn'),
  newVideoBtn: $('#new-video-btn'),
  // Status
  statusSection: $('#status-section'),
  statusGrid: $('#status-grid'),
  recheckBtn: $('#recheck-deps'),
  statusHint: $('#status-hint'),
  // Header
  connectionDot: $('#connection-dot'),
  connectionText: $('#connection-text'),
  // Toast
  toastContainer: $('#toast-container'),
  // Editor Modal
  editorModal: $('#editor-modal'),
  editorCloseBtn: $('#editor-close'),
  editorCancelBtn: $('#editor-cancel'),
  editorSaveBtn: $('#editor-save'),
  editorVideo: $('#editor-video'),
  editorCanvasContainer: $('#editor-canvas-container'),
  editorStart: $('#editor-start'),
  editorEnd: $('#editor-end'),
  editorZoom: $('#editor-zoom'),
  editorExposure: $('#editor-exposure'),
  editorContrast: $('#editor-contrast'),
  editorSaturation: $('#editor-saturation'),
  editorSharpen: $('#editor-sharpen'),
  editorValLength: $('#editor-val-length'),
  editorValZoom: $('#editor-val-zoom'),
  editorValExposure: $('#editor-val-exposure'),
  editorValContrast: $('#editor-val-contrast'),
  editorValSaturation: $('#editor-val-saturation'),
  editorValSharpen: $('#editor-val-sharpen'),
  // Advanced Options
  advToggle: $('#adv-toggle'),
  advPanel: $('#adv-panel'),
  advDescription: $('#adv-description'),
  timestampRows: $('#timestamp-rows'),
  btnAddTs: $('#btn-add-ts'),
};

// ─── State ───────────────────────────────────
let selectedClips = new Set();
let allClips = [];
let renderedFiles = [];
let pipelineTimerInterval = null;
let pipelineStartTime = null;
let detectedLanguage = 'unknown';
let videoInfoTimeout = null;

// ─── WebSocket ───────────────────────────────
let socket = null;
let reconnectTimeout = null;

function connectWebSocket() {
  socket = new WebSocket(`ws://${window.location.host}/ws`);

  socket.onopen = () => {
    els.connectionDot.className = 'status-dot connected';
    els.connectionText.textContent = 'Connected';
  };

  socket.onclose = () => {
    els.connectionDot.className = 'status-dot disconnected';
    els.connectionText.textContent = 'Disconnected';
    // Auto-reconnect after 3s
    clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = () => {
    els.connectionDot.className = 'status-dot disconnected';
    els.connectionText.textContent = 'Error';
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  };
}

connectWebSocket();

// ─── Message Handler ─────────────────────────
function handleMessage(data) {
  switch (data.type) {
    case 'log':
      appendLog(data.msg, data.level || 'info');
      break;

    case 'step':
      updateStep(data.step, data.status);
      break;

    case 'language':
      detectedLanguage = data.language || 'unknown';
      break;

    case 'clips_ready':
      allClips = data.clips || [];
      detectedLanguage = data.language || detectedLanguage;
      showReviewSection(allClips);
      break;

    case 'render_done':
      renderedFiles = data.files || [];
      showResultsSection(renderedFiles);
      break;

    case 'done':
      stopTimer();
      setProcessingState(false);
      break;

    case 'stopped':
      stopTimer();
      setProcessingState(false);
      appendLog('Pipeline stopped.', 'warning');
      showToast('Pipeline cancelled', 'info');
      break;

    case 'error':
      appendLog(`Error: ${data.msg}`, 'error');
      setProcessingState(false);
      stopTimer();
      if (data.step) updateStep(data.step, 'error');
      showToast('Pipeline error occurred', 'error');
      break;
  }
}

// ─── Terminal Logging ────────────────────────
function appendLog(msg, level = 'info') {
  const line = document.createElement('div');
  line.className = `terminal-line terminal-${level}`;
  line.textContent = msg;
  els.terminal.appendChild(line);
  els.terminal.scrollTop = els.terminal.scrollHeight;
}

els.clearTerminal.addEventListener('click', () => {
  els.terminal.innerHTML = '<div class="terminal-line terminal-muted">Terminal cleared.</div>';
});

// ─── Pipeline Steps ──────────────────────────
function updateStep(stepId, status) {
  const stepEl = $(`.step[data-step="${stepId}"]`);
  if (!stepEl) return;

  stepEl.classList.remove('active', 'done', 'error');
  stepEl.classList.add(status);

  const statusText = stepEl.querySelector('.step-status');
  const labels = { active: 'PROCESSING', done: 'COMPLETED', error: 'FAILED' };
  statusText.textContent = labels[status] || 'WAITING';
}

function resetSteps() {
  $$('.step').forEach(el => {
    el.classList.remove('active', 'done', 'error');
    el.querySelector('.step-status').textContent = 'WAITING';
  });
}

// ─── Timer ───────────────────────────────────
function startTimer() {
  pipelineStartTime = Date.now();
  els.pipelineTimer.textContent = '00:00';
  clearInterval(pipelineTimerInterval);
  pipelineTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - pipelineStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    els.pipelineTimer.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(pipelineTimerInterval);
}

// ─── Processing State ────────────────────────
function setProcessingState(isProcessing) {
  if (isProcessing) {
    els.generateBtn.classList.add('hidden');
    els.stopBtn.classList.add('visible');
    els.sourceInput.disabled = true;
    els.genreSelect.disabled = true;
  } else {
    els.generateBtn.classList.remove('hidden');
    els.stopBtn.classList.remove('visible');
    els.sourceInput.disabled = false;
    els.genreSelect.disabled = false;
  }
}

// ─── Video Info Fetch ────────────────────────
els.sourceInput.addEventListener('input', () => {
  clearTimeout(videoInfoTimeout);
  const url = els.sourceInput.value.trim();

  if (!url || !isYouTubeUrl(url)) {
    els.videoInfoCard.classList.remove('visible');
    return;
  }

  videoInfoTimeout = setTimeout(() => fetchVideoInfo(url), 800);
});

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/.test(url);
}

async function fetchVideoInfo(url) {
  try {
    const res = await fetch('/api/video-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) return;
    const info = await res.json();

    els.videoThumb.src = info.thumbnail || '';
    els.videoTitle.textContent = info.title || 'Unknown';
    els.videoChannel.textContent = info.channel || '';
    els.videoDuration.textContent = formatDuration(info.duration || 0);
    els.videoViews.textContent = info.viewCount ? `${formatNumber(info.viewCount)} views` : '';
    els.videoInfoCard.classList.add('visible');
  } catch (e) {
    // Silently fail — video info is optional
  }
}

els.videoInfoClose.addEventListener('click', () => {
  els.videoInfoCard.classList.remove('visible');
});

// ─── Form Submit (Generate) ──────────────────
els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const source = els.sourceInput.value.trim();
  const genre = els.genreSelect.value;

  if (!source) return;

  // Collect advanced options
  const description = els.advDescription.value.trim();
  const timestamps = getTimestamps();
  const clipMode = document.querySelector('input[name="clip-mode"]:checked')?.value || 'add';

  // Reset UI
  setProcessingState(true);
  resetSteps();
  els.terminal.innerHTML = '';
  els.reviewSection.classList.remove('visible');
  els.resultsSection.classList.remove('visible');
  els.pipelineSection.classList.add('visible');
  selectedClips.clear();
  allClips = [];
  renderedFiles = [];

  startTimer();

  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, genre, description, timestamps, clipMode }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to start pipeline');
    }
  } catch (err) {
    appendLog(`Failed to start: ${err.message}`, 'error');
    setProcessingState(false);
    stopTimer();
    showToast(err.message, 'error');
  }
});

// ─── Stop Pipeline ───────────────────────────
els.stopBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/stop', { method: 'POST' });
  } catch (e) {
    appendLog('Failed to stop pipeline', 'error');
  }
});

// ─── Review Section ──────────────────────────
function showReviewSection(clips) {
  els.reviewSection.classList.add('visible');
  els.reviewGrid.innerHTML = '';
  selectedClips.clear();

  // Language badge
  if (detectedLanguage && detectedLanguage !== 'unknown') {
    els.reviewLanguage.innerHTML = `<span class="language-badge">🌐 ${detectedLanguage}</span>`;
  }

  // Auto-select all clips
  clips.forEach((_, i) => selectedClips.add(i));

  clips.forEach((clip, i) => {
    const card = document.createElement('div');
    card.className = 'clip-card selected';
    card.innerHTML = `
      <div class="clip-card-header">
        <div class="clip-card-badges">
          <span class="badge badge-score">★ ${clip.score || 0}</span>
          <span class="badge badge-duration">${clip.duration || 0}s</span>
          ${clip.language && clip.language !== 'unknown' ? `<span class="badge badge-lang">${clip.language}</span>` : ''}
          ${clip.source === 'description' ? '<span class="badge badge-source-desc">📝 Description</span>' : ''}
          ${clip.source === 'timestamp' ? '<span class="badge badge-source-ts">⏱️ Manual</span>' : ''}
          ${clip.source === 'ai' ? '<span class="badge badge-source">🤖 AI</span>' : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn-edit-clip" data-index="${i}">✏️ Edit</button>
          <div class="clip-check">
            <svg class="clip-check-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      </div>
      <div class="clip-card-title">${escapeHtml(clip.title || 'Untitled')}</div>
      <div class="clip-card-text">${escapeHtml(clip.text || '')}</div>
      <div class="clip-card-score-bar">
        <div class="clip-card-score-fill" style="width: ${Math.min(100, (clip.score || 0) * 10)}%"></div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-edit-clip')) return;
      toggleClipSelection(card, i);
    });
    
    card.querySelector('.btn-edit-clip').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(i);
    });

    els.reviewGrid.appendChild(card);
  });

  updateSelectedCount();
  // Scroll to review section
  els.reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleClipSelection(card, index) {
  if (selectedClips.has(index)) {
    selectedClips.delete(index);
    card.classList.remove('selected');
  } else {
    selectedClips.add(index);
    card.classList.add('selected');
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  els.selectedCount.textContent = selectedClips.size;
  els.renderSelectedBtn.disabled = selectedClips.size === 0;
}

// Select All
els.selectAllBtn.addEventListener('click', () => {
  const cards = els.reviewGrid.querySelectorAll('.clip-card');
  const allSelected = selectedClips.size === allClips.length;

  if (allSelected) {
    // Deselect all
    selectedClips.clear();
    cards.forEach(c => c.classList.remove('selected'));
    els.selectAllBtn.textContent = 'Select All';
  } else {
    // Select all
    allClips.forEach((_, i) => selectedClips.add(i));
    cards.forEach(c => c.classList.add('selected'));
    els.selectAllBtn.textContent = 'Deselect All';
  }
  updateSelectedCount();
});

// ─── Render Selected ─────────────────────────
els.renderSelectedBtn.addEventListener('click', async () => {
  if (selectedClips.size === 0) return;

  els.renderSelectedBtn.disabled = true;
  appendLog(`Rendering ${selectedClips.size} clips...`, 'info');

    try {
      const selectedIndicesArr = Array.from(selectedClips);
      const selectedClipsData = selectedIndicesArr.map(i => allClips[i]);

      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedIndices: selectedIndicesArr, selectedClipsData }),
      });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Render failed');
  } catch (err) {
    appendLog(`Render failed: ${err.message}`, 'error');
    els.renderSelectedBtn.disabled = false;
    showToast('Render failed', 'error');
  }
});

// ─── Results Section ─────────────────────────
function showResultsSection(files) {
  els.resultsSection.classList.add('visible');
  els.resultsList.innerHTML = '';

  if (files.length === 0) {
    // Show results from review data (demo mode or no actual files)
    const selected = Array.from(selectedClips).map(i => allClips[i]).filter(Boolean);
    selected.forEach((clip, i) => {
      els.resultsList.appendChild(createResultCard(clip, null, i));
    });
  } else {
    // Show results with actual rendered videos
    const selected = Array.from(selectedClips).map(i => allClips[i]).filter(Boolean);
    files.forEach((fileUrl, i) => {
      const clip = selected[i] || allClips[i] || {};
      els.resultsList.appendChild(createResultCard(clip, fileUrl, i));
    });
  }

  showToast(`${Math.max(files.length, selectedClips.size)} clips ready!`, 'success');
  els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function createResultCard(clip, videoUrl, index) {
  const card = document.createElement('div');
  card.className = 'result-card';

  const videoHtml = videoUrl
    ? `<video src="${videoUrl}?t=${Date.now()}" controls playsinline preload="metadata"></video>`
    : `<div class="result-video-placeholder">
        <div>
          <div style="font-size:2rem;margin-bottom:8px">🎬</div>
          <div>Clip ${index + 1}</div>
          <div style="font-size:0.7rem;margin-top:4px;color:var(--text-muted)">${clip.duration || 0}s • ${clip.start || 0}s–${clip.end || 0}s</div>
        </div>
       </div>`;

  card.innerHTML = `
    <div class="result-video-wrap">
      ${videoHtml}
    </div>
    <div class="result-social">
      <div class="result-social-header">
        <div class="result-title">${escapeHtml(clip.title || `Clip ${index + 1}`)}</div>
        <div class="result-badges">
          <span class="badge badge-score">★ ${clip.score || 0}</span>
          <span class="badge badge-duration">${clip.duration || 0}s</span>
          ${clip.language && clip.language !== 'unknown' ? `<span class="badge badge-lang">${clip.language}</span>` : ''}
          ${clip.source === 'description' ? '<span class="badge badge-source-desc">📝 Description</span>' : ''}
          ${clip.source === 'timestamp' ? '<span class="badge badge-source-ts">⏱️ Manual</span>' : ''}
          ${clip.source === 'ai' ? '<span class="badge badge-source">🤖 AI</span>' : ''}
        </div>
      </div>

      <div class="social-block">
        <div class="social-block-label">
          <span>📝 Caption</span>
          <button class="copy-btn" data-copy="${escapeAttr(clip.caption || '')}">Copy</button>
        </div>
        <div class="social-block-content">${escapeHtml(clip.caption || 'No caption generated')}</div>
      </div>

      <div class="social-block">
        <div class="social-block-label">
          <span>📄 Description</span>
          <button class="copy-btn" data-copy="${escapeAttr(clip.description || '')}">Copy</button>
        </div>
        <div class="social-block-content">${escapeHtml(clip.description || 'No description generated')}</div>
      </div>

      <div class="social-block">
        <div class="social-block-label">
          <span># Hashtags</span>
          <button class="copy-btn" data-copy="${escapeAttr(clip.hashtags || '')}">Copy</button>
        </div>
        <div class="social-block-hashtags">${escapeHtml(clip.hashtags || 'No hashtags generated')}</div>
      </div>

      <div class="result-actions">
        ${videoUrl
          ? `<a href="${videoUrl}" download="skate-clip-${index + 1}.mp4" class="btn-download">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0l2.5-2.5M8 10L5.5 7.5M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Download MP4
            </a>`
          : `<span style="font-size:0.78rem;color:var(--text-muted)">Install FFmpeg + yt-dlp for real clips</span>`
        }
      </div>
    </div>
  `;

  // Attach copy handlers
  card.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-copy');
      copyToClipboard(text, btn);
    });
  });

  return card;
}

// ─── Download All ────────────────────────────
els.downloadAllBtn.addEventListener('click', () => {
  if (renderedFiles.length === 0) {
    showToast('No rendered files to download', 'error');
    return;
  }

  renderedFiles.forEach((url, i) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `skate-clip-${i + 1}.mp4`;
    a.click();
  });

  showToast(`Downloading ${renderedFiles.length} clips`, 'success');
});

// ─── New Video ───────────────────────────────
els.newVideoBtn.addEventListener('click', () => {
  els.sourceInput.value = '';
  els.videoInfoCard.classList.remove('visible');
  els.pipelineSection.classList.remove('visible');
  els.reviewSection.classList.remove('visible');
  els.resultsSection.classList.remove('visible');
  els.terminal.innerHTML = '<div class="terminal-line terminal-muted">Ready for a new video...</div>';
  resetSteps();
  selectedClips.clear();
  allClips = [];
  renderedFiles = [];
  stopTimer();
  els.heroSection.scrollIntoView({ behavior: 'smooth' });
  els.sourceInput.focus();
});

// ─── System Status ───────────────────────────
async function checkStatus() {
  els.statusGrid.innerHTML = '<div class="status-card loading"><span class="status-card-label">Checking dependencies...</span></div>';

  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    els.statusGrid.innerHTML = '';
    let allOk = true;

    const names = { ffmpeg: 'FFmpeg', ytdlp: 'yt-dlp', ollama: 'Ollama' };

    Object.entries(data).forEach(([key, info]) => {
      if (!info.installed) allOk = false;

      const card = document.createElement('div');
      card.className = 'status-card';

      const iconSvg = info.installed
        ? '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';

      card.innerHTML = `
        <div class="status-card-icon ${info.installed ? 'ok' : 'missing'}">${iconSvg}</div>
        <div class="status-card-info">
          <span class="status-card-label">${names[key] || key}</span>
          <span class="status-card-version">${info.version}</span>
        </div>
      `;
      els.statusGrid.appendChild(card);
    });

    els.statusHint.textContent = allOk
      ? '✅ All dependencies installed — full pipeline ready!'
      : '⚠️ Some dependencies missing — demo mode will be used. Install missing tools for real processing.';

  } catch (err) {
    els.statusGrid.innerHTML = '<div class="status-card loading" style="color:var(--accent-red)"><span class="status-card-label">Could not reach server</span></div>';
  }
}

els.recheckBtn.addEventListener('click', checkStatus);
checkStatus();

// ─── Utility Functions ───────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return String(num);
}

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent;
    button.textContent = 'Copied!';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    button.textContent = 'Copied!';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('copied');
    }, 1500);
  });
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;

  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Logo click → reset ──────────────────────
$('#logo').addEventListener('click', () => {
  els.newVideoBtn.click();
});

// --- Editor Modal Logic ----------------------
let editingClipIndex = -1;
let currentClipData = null;

function openEditor(index) {
  editingClipIndex = index;
  currentClipData = allClips[index];
  
  const start = currentClipData.editStart ?? currentClipData.start ?? 0;
  const end = currentClipData.editEnd ?? currentClipData.end ?? 0;
  
  currentClipData.zoom = currentClipData.zoom ?? 1.0;
  currentClipData.panX = currentClipData.panX ?? 0;
  currentClipData.panY = currentClipData.panY ?? 0;
  currentClipData.brightness = currentClipData.brightness ?? 0.0;
  currentClipData.contrast = currentClipData.contrast ?? 1.0;
  currentClipData.exposure = currentClipData.exposure ?? 0.0;
  currentClipData.saturation = currentClipData.saturation ?? 1.0;
  currentClipData.sharpen = currentClipData.sharpen ?? 0.0;

  els.editorStart.min = 0;
  els.editorStart.max = currentClipData.end + 10;
  els.editorStart.value = start;
  
  els.editorEnd.min = 0;
  els.editorEnd.max = currentClipData.end + 10;
  els.editorEnd.value = end;

  els.editorZoom.value = currentClipData.zoom;
  els.editorContrast.value = currentClipData.contrast;
  els.editorExposure.value = currentClipData.exposure;
  els.editorSaturation.value = currentClipData.saturation;
  els.editorSharpen.value = currentClipData.sharpen;

  els.editorVideo.src = '/api/raw_video';
  els.editorVideo.currentTime = start;
  els.editorVideo.play().catch(() => {});

  updateEditorLabels();
  
  els.editorVideo.addEventListener('loadedmetadata', updateEditorLabels, { once: true });

  els.editorModal.classList.add("visible");
}

function closeEditor() {
  els.editorModal.classList.remove("visible");
  els.editorVideo.pause();
  els.editorVideo.removeAttribute('src');
  editingClipIndex = -1;
  currentClipData = null;
}

function updateEditorLabels() {
  if (!currentClipData) return;

  const start = parseFloat(els.editorStart.value);
  const end = parseFloat(els.editorEnd.value);
  let len = end - start;
  if (len < 0) len = 0;
  els.editorValLength.textContent = `${len.toFixed(1)}s`;

  const zoom = parseFloat(els.editorZoom.value);
  els.editorValZoom.textContent = `${zoom.toFixed(1)}x`;

  const bright = 0.0;
  const contrast = parseFloat(els.editorContrast.value);
  const exposure = parseFloat(els.editorExposure.value);
  const saturation = parseFloat(els.editorSaturation.value);
  const sharpen = parseFloat(els.editorSharpen.value);
  
  els.editorValContrast.textContent = contrast.toFixed(2);
  els.editorValExposure.textContent = exposure.toFixed(2);
  els.editorValSaturation.textContent = saturation.toFixed(2);
  els.editorValSharpen.textContent = sharpen.toFixed(2);

  const cssBright = 1 + bright + exposure;
  els.editorVideo.style.filter = `brightness(${cssBright}) contrast(${contrast}) saturate(${saturation})`;

  const panX = currentClipData.panX ?? 0;
  const panY = currentClipData.panY ?? 0;
  els.editorVideo.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`;
}

// Drag logic for Canvas Video
let isDraggingCanvas = false;
let startDragX = 0;
let startDragY = 0;
let initialPanX = 0;
let initialPanY = 0;

els.editorCanvasContainer.addEventListener('mousedown', (e) => {
  isDraggingCanvas = true;
  startDragX = e.clientX;
  startDragY = e.clientY;
  initialPanX = currentClipData.panX ?? 0;
  initialPanY = currentClipData.panY ?? 0;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isDraggingCanvas || !currentClipData) return;
  const deltaX = e.clientX - startDragX;
  const deltaY = e.clientY - startDragY;
  
  currentClipData.panX = initialPanX + deltaX;
  currentClipData.panY = initialPanY + deltaY;
  updateEditorLabels();
});

window.addEventListener('mouseup', () => {
  isDraggingCanvas = false;
});

// Responsive Trimming (Scrubbing)
els.editorStart.addEventListener('input', () => {
  const start = parseFloat(els.editorStart.value);
  if (els.editorVideo.readyState >= 1) {
    els.editorVideo.currentTime = start;
  }
  updateEditorLabels();
});

// Editor Event Listeners
[els.editorEnd, els.editorZoom, els.editorExposure, els.editorContrast, els.editorSaturation, els.editorSharpen].forEach(el => {
  if(el) el.addEventListener("input", updateEditorLabels);
});

els.editorCloseBtn.addEventListener("click", closeEditor);
els.editorCancelBtn.addEventListener("click", closeEditor);

els.editorSaveBtn.addEventListener("click", () => {
  if (editingClipIndex >= 0 && currentClipData) {
    const start = parseFloat(els.editorStart.value);
    const end = parseFloat(els.editorEnd.value);
    if (start >= end) {
      showToast("Start time must be before end time", "error");
      return;
    }

    allClips[editingClipIndex].editStart = start;
    allClips[editingClipIndex].editEnd = end;
    allClips[editingClipIndex].duration = Math.round(end - start);
    allClips[editingClipIndex].zoom = parseFloat(els.editorZoom.value);
    allClips[editingClipIndex].panX = currentClipData.panX;
    allClips[editingClipIndex].panY = currentClipData.panY;
    
    const containerHeight = els.editorCanvasContainer.clientHeight || 320;
    allClips[editingClipIndex].normPanX = currentClipData.panX / containerHeight;
    allClips[editingClipIndex].normPanY = currentClipData.panY / containerHeight;
    
    allClips[editingClipIndex].brightness = 0.0;
    allClips[editingClipIndex].contrast = parseFloat(els.editorContrast.value);
    allClips[editingClipIndex].exposure = parseFloat(els.editorExposure.value);
    allClips[editingClipIndex].saturation = parseFloat(els.editorSaturation.value);
    allClips[editingClipIndex].sharpen = parseFloat(els.editorSharpen.value);
    
    const cards = els.reviewGrid.querySelectorAll(".clip-card");
    if (cards[editingClipIndex]) {
      const durBadge = cards[editingClipIndex].querySelector(".badge-duration");
      if (durBadge) durBadge.textContent = `${allClips[editingClipIndex].duration}s`;
    }
    
    showToast("Clip settings saved!", "success");
    closeEditor();
  }
});

// ─── Advanced Options ────────────────────────

// Toggle panel
els.advToggle.addEventListener('click', () => {
  els.advToggle.classList.toggle('open');
  els.advPanel.classList.toggle('open');
});

// Parse time string "mm:ss" or "h:mm:ss" to seconds
function parseTimeStr(str) {
  if (!str || !str.trim()) return NaN;
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return NaN;
}

// Get all valid timestamps as [{start, end}]
function getTimestamps() {
  const rows = els.timestampRows.querySelectorAll('.timestamp-row');
  const result = [];
  rows.forEach(row => {
    const startStr = row.querySelector('.ts-start')?.value;
    const endStr = row.querySelector('.ts-end')?.value;
    const start = parseTimeStr(startStr);
    const end = parseTimeStr(endStr);
    if (!isNaN(start) && !isNaN(end) && end > start) {
      result.push({ start, end });
    }
  });
  return result;
}

// Add timestamp row
let tsCounter = 1;
els.btnAddTs.addEventListener('click', () => {
  const row = document.createElement('div');
  row.className = 'timestamp-row';
  row.setAttribute('data-ts-index', tsCounter++);
  row.innerHTML = `
    <input type="text" class="ts-start" placeholder="0:00" />
    <span class="timestamp-sep">→</span>
    <input type="text" class="ts-end" placeholder="0:30" />
    <button type="button" class="btn-remove-ts" title="Remove">×</button>
  `;
  els.timestampRows.appendChild(row);
  bindRemoveBtn(row.querySelector('.btn-remove-ts'));
});

// Remove timestamp row
function bindRemoveBtn(btn) {
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const row = btn.closest('.timestamp-row');
    if (row) {
      row.style.animation = 'none';
      row.style.opacity = '0';
      row.style.transform = 'translateX(-10px)';
      row.style.transition = 'all 0.2s ease';
      setTimeout(() => row.remove(), 200);
    }
  });
}

// Bind existing remove buttons
els.timestampRows.querySelectorAll('.btn-remove-ts').forEach(bindRemoveBtn);

