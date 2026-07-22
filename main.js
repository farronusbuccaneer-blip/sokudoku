import { Muxer, ArrayBufferTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';

// State Management
let isPlaying = false;
let currentTime = 0;
let lastTime = 0;
let animationFrameId = null;

let bgmBuffer = null;
let voiceBuffer = null;
let bgmName = '';
let voiceName = '';
let bgImage = null;
let bgVideo = null;
let bgMediaName = '';

let audioCtx = null;
let bgmGainNode = null;
let voiceGainNode = null;
let activeBgmSource = null;
let activeVoiceSource = null;

let parsedTags = {
  top1: '',
  top2: '',
  title: '',
  text: '',
  bottom1: '',
  words: [],
  means: []
};

let renderedElements = [];
let scrollControlPoints = [];
let totalDuration = 65; // Phase 1 + Phase 2 (5s)
let phase1Duration = 60;

let exportCancelled = false;
let currentPlatform = 'instagram'; // 'instagram' or 'youtube'

// DOM Elements
const inputTop1 = document.getElementById('inputTop1');
const inputTop2 = document.getElementById('inputTop2');
const inputTitle = document.getElementById('inputTitle');
const inputBottom1 = document.getElementById('inputBottom1');
const speedReadingTextInput = document.getElementById('speedReadingTextInput');
const explanationInput = document.getElementById('explanationInput');

const bgMediaInput = document.getElementById('bgMediaInput');
const bgMediaBtn = document.getElementById('bgMediaBtn');
const bgMediaInfo = document.getElementById('bgMediaInfo');
const bgmAudioInput = document.getElementById('bgmAudioInput');
const bgmAudioBtn = document.getElementById('bgmAudioBtn');
const bgmAudioInfo = document.getElementById('bgmAudioInfo');
const voiceAudioInput = document.getElementById('voiceAudioInput');
const voiceAudioBtn = document.getElementById('voiceAudioBtn');
const voiceAudioInfo = document.getElementById('voiceAudioInfo');
const btnExportInstagram = document.getElementById('btnExportInstagram');
const btnExportYoutube = document.getElementById('btnExportYoutube');
const tabPreviewInstagram = document.getElementById('tabPreviewInstagram');
const tabPreviewYoutube = document.getElementById('tabPreviewYoutube');
const btnAutoTimestamp = document.getElementById('btnAutoTimestamp');
const previewCanvas = document.getElementById('previewCanvas');
const progressWrapper = document.getElementById('progressWrapper');
const progressFill = document.getElementById('progressFill');
const btnPlayPause = document.getElementById('btnPlayPause');
const btnMute = document.getElementById('btnMute');
const timeDisplay = document.getElementById('timeDisplay');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const soundOnIcon = document.getElementById('soundOnIcon');
const soundOffIcon = document.getElementById('soundOffIcon');

const tabNormal = document.getElementById('tabNormal');
const tabTimestamp = document.getElementById('tabTimestamp');
const normalModeSection = document.getElementById('normalModeSection');
const timestampModeSection = document.getElementById('timestampModeSection');
const normalDurationInput = document.getElementById('normalDuration');
const timestampInput = document.getElementById('timestampInput');
const bgmVolumeSlider = document.getElementById('bgmVolume');
const bgmVolumeVal = document.getElementById('bgmVolumeVal');
const bgmVolumeNotice = document.getElementById('bgmVolumeNotice');

// Export Overlay DOM
const exportOverlay = document.getElementById('exportOverlay');
const exportLoadingState = document.getElementById('exportLoadingState');
const exportSuccessState = document.getElementById('exportSuccessState');
const exportStatusText = document.getElementById('exportStatusText');
const exportProgressFill = document.getElementById('exportProgressFill');
const btnCancelExport = document.getElementById('btnCancelExport');
const btnCloseOverlay = document.getElementById('btnCloseOverlay');

// IndexedDB configuration
const DB_NAME = 'SokuDokuBGMStore';
const STORE_NAME = 'bgm_store';
const KEY_NAME = 'active_bgm';

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    db.createObjectStore(STORE_NAME);
  };
  request.onsuccess = (e) => resolve(e.target.result);
  request.onerror = (e) => reject(e.target.error);
});

async function saveBGMToStore(arrayBuffer, name) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const putRequest = store.put({ arrayBuffer, name }, KEY_NAME);
    putRequest.onsuccess = () => resolve();
    putRequest.onerror = (e) => reject(e.target.error);
  });
}

async function loadBGMFromStore() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(KEY_NAME);
    getRequest.onsuccess = (e) => resolve(e.target.result || null);
    getRequest.onerror = (e) => reject(e.target.error);
  });
}

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Decode Audio Data safely
function decodeAudioDataSafe(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(arrayBuffer.slice(0), resolve, (err) => {
      // Chrome/Firefox return error, but on older browsers it might fail without detail
      reject(err || new Error("Failed to decode audio data"));
    });
  });
}

// Initial audio context setup
function initAudioCtx() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  bgmGainNode = audioCtx.createGain();
  voiceGainNode = audioCtx.createGain();
  bgmGainNode.connect(audioCtx.destination);
  voiceGainNode.connect(audioCtx.destination);
  
  // Set initial gain based on volume slider
  bgmGainNode.gain.setValueAtTime(parseFloat(bgmVolumeSlider.value), audioCtx.currentTime);
  voiceGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
}

// Auto adjust volume settings based on voice presence
function adjustVolumeSettings() {
  if (voiceBuffer && bgmBuffer) {
    bgmVolumeSlider.value = "0.7";
    bgmVolumeVal.textContent = "70%";
    bgmVolumeNotice.style.color = "var(--primary-orange)";
    if (bgmGainNode) {
      bgmGainNode.gain.setValueAtTime(0.7, audioCtx.currentTime);
    }
  } else {
    bgmVolumeNotice.style.color = "var(--text-secondary)";
  }
}

// Parse Input Fields (Separated Plain Text + Explanation Markdown)
function parseInputFields() {
  const expText = explanationInput ? explanationInput.value.trim() : '';
  
  const getTag = (tag) => {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = expText.match(regex);
    return match ? match[1].trim() : '';
  };

  let words = [getTag('word1'), getTag('word2'), getTag('word3')].filter(Boolean);
  let means = [getTag('mean1'), getTag('mean2'), getTag('mean3')].filter(Boolean);

  // Fallback: if no XML tags, parse markdown bullet points like "- **word**: mean" or "word: mean"
  if (words.length === 0 && expText) {
    const lines = expText.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (words.length >= 3) break;
      const match = line.match(/^(?:[-*]\s*)?(?:\*\*)?([^*:\-\n]+)(?:\*\*)?\s*[:\-：]\s*(.*)$/);
      if (match) {
        words.push(match[1].trim());
        means.push(match[2].trim());
      }
    }
  }

  parsedTags = {
    top1: inputTop1 ? inputTop1.value.trim() : '',
    top2: inputTop2 ? inputTop2.value.trim() : '',
    title: inputTitle ? inputTitle.value.trim() : '',
    text: speedReadingTextInput ? speedReadingTextInput.value.trim() : '',
    bottom1: inputBottom1 ? inputBottom1.value.trim() : '',
    words,
    means
  };
}

// Parse timestamp text format (0:00 Text)
function parseTimestamps(rawText) {
  const lines = rawText.split('\n');
  const timestamps = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const match = trimmed.match(/^(?:\[)?(\d+):(\d+)(?:\.(\d+))?(?:\])?\s+(.*)$/);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const timeInSecs = mins * 60 + secs + ms / 1000;
      const text = match[4].trim();
      timestamps.push({ time: timeInSecs, text });
    }
  }
  
  timestamps.sort((a, b) => a.time - b.time);
  return timestamps;
}

// Canvas Text Wrapping
function wrapText(ctx, text, maxWidth) {
  const paragraphs = text.split('\n');
  const lines = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    // Tokenize: keep English words together, CJK character-by-character
    const tokens = [];
    const tokenRegex = /([a-zA-Z0-9'-]+|[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]|[\s\S])/g;
    let match;
    while ((match = tokenRegex.exec(paragraph)) !== null) {
      tokens.push(match[0]);
    }

    let currentLine = '';
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (token === ' ') {
        if (currentLine !== '' && !currentLine.endsWith(' ')) {
          currentLine += ' ';
        }
        continue;
      }

      let testLine = currentLine;
      const isCjk = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/.test(token);
      
      if (currentLine !== '' && !currentLine.endsWith(' ') && !isCjk && !/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/.test(currentLine[currentLine.length - 1])) {
        testLine += ' ' + token;
      } else {
        testLine += token;
      }

      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine !== '') {
        lines.push(currentLine);
        currentLine = token;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine !== '') {
      lines.push(currentLine);
    }
  }

  return lines;
}

// Layout Calculation
function calculateLayout() {
  const ctx = previewCanvas.getContext('2d');
  parseInputFields();
  
  renderedElements = [];
  
  const titleFont = "900 64px 'Outfit', 'Noto Sans JP', sans-serif";
  const bodyFont = "700 48px 'Outfit', 'Noto Sans JP', sans-serif";
  
  // Measure Title
  ctx.font = titleFont;
  const titleLines = wrapText(ctx, parsedTags.title || '', 820);
  const titleLineHeight = 84;
  let currentY = 0;
  
  const titleStartLocalY = currentY;
  for (const line of titleLines) {
    renderedElements.push({
      type: 'title',
      text: line,
      localY: currentY + titleLineHeight / 2,
      lineHeight: titleLineHeight
    });
    currentY += titleLineHeight;
  }
  const titleEndLocalY = currentY;
  const titleCenterLocalY = titleLines.length > 0 ? (titleStartLocalY + titleEndLocalY) / 2 : 0;
  
  // Gap between title and body
  currentY += 90;
  
  const isTimestampMode = tabTimestamp.classList.contains('active');
  
  if (isTimestampMode) {
    const timestamps = parseTimestamps(timestampInput.value);
    const textLineHeight = 68;
    const tempPoints = [];
    
    ctx.font = bodyFont;
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const lines = wrapText(ctx, ts.text, 820);
      const paraStartY = currentY;
      
      for (const line of lines) {
        renderedElements.push({
          type: 'text',
          text: line,
          localY: currentY + textLineHeight / 2,
          lineHeight: textLineHeight
        });
        currentY += textLineHeight;
      }
      const paraEndY = currentY;
      const paraCenterY = (paraStartY + paraEndY) / 2;
      
      tempPoints.push({
        time: ts.time,
        offset: paraCenterY - titleCenterLocalY
      });
      
      currentY += 60; // paragraph gap
    }
    
    const totalContentHeight = currentY - 60;
    
    // Determine Phase 1 duration
    if (voiceBuffer) {
      phase1Duration = voiceBuffer.duration;
    } else if (tempPoints.length > 0) {
      phase1Duration = tempPoints[tempPoints.length - 1].time + 5;
    } else {
      phase1Duration = 60;
    }
    
    totalDuration = phase1Duration + 5;
    
    // Compile scroll control points
    scrollControlPoints = [];
    if (tempPoints.length > 0 && tempPoints[0].time > 0) {
      scrollControlPoints.push({ time: 0, offset: 0 });
    }
    
    for (const pt of tempPoints) {
      scrollControlPoints.push(pt);
    }
    
    // Final clear-up offset
    const finalOffset = totalContentHeight - titleCenterLocalY + 576;
    scrollControlPoints.push({
      time: phase1Duration,
      offset: finalOffset
    });
    
  } else {
    // Normal Mode
    ctx.font = bodyFont;
    const textLines = wrapText(ctx, parsedTags.text || '', 820);
    const textLineHeight = 68;
    
    for (const line of textLines) {
      renderedElements.push({
        type: 'text',
        text: line,
        localY: currentY + textLineHeight / 2,
        lineHeight: textLineHeight
      });
      currentY += textLineHeight;
    }
    
    const totalContentHeight = currentY;
    
    phase1Duration = parseFloat(normalDurationInput.value) || 60;
    totalDuration = phase1Duration + 5;
    
    scrollControlPoints = [
      { time: 0, offset: 0 },
      { time: phase1Duration, offset: totalContentHeight - titleCenterLocalY + 576 }
    ];
  }
  
  updateTimeDisplay();
}

// Auto-generate timestamps from voice buffer duration and text paragraphs
function autoGenerateTimestampsFromVoice() {
  if (!voiceBuffer) return;
  
  parseInputFields();
  if (!parsedTags.text) return;
  
  const lines = parsedTags.text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
    
  if (lines.length === 0) return;
  
  const duration = voiceBuffer.duration;
  const interval = duration / lines.length;
  
  const timestampLines = [];
  for (let i = 0; i < lines.length; i++) {
    const timeSec = i * interval;
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60);
    const ms = Math.floor((timeSec % 1) * 100);
    
    // Format: M:SS.xx (compatible with parser)
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    timestampLines.push(`${timeStr} ${lines[i]}`);
  }
  
  timestampInput.value = timestampLines.join('\n');
  
  // Switch to Timestamp Mode tab automatically
  tabTimestamp.classList.add('active');
  tabNormal.classList.remove('active');
  normalModeSection.style.display = 'none';
  timestampModeSection.style.display = 'block';
  
  calculateLayout();
  drawCanvas(currentTime);
}

// Interpolate Scroll Offset
function getScrollOffset(t) {
  if (scrollControlPoints.length === 0) return 0;
  
  if (t <= scrollControlPoints[0].time) {
    return scrollControlPoints[0].offset;
  }
  
  const lastPoint = scrollControlPoints[scrollControlPoints.length - 1];
  if (t >= lastPoint.time) {
    return lastPoint.offset;
  }
  
  for (let i = 0; i < scrollControlPoints.length - 1; i++) {
    const p1 = scrollControlPoints[i];
    const p2 = scrollControlPoints[i + 1];
    if (t >= p1.time && t <= p2.time) {
      const ratio = (t - p1.time) / (p2.time - p1.time);
      return p1.offset + ratio * (p2.offset - p1.offset);
    }
  }
  return 0;
}

// Seek video helper for WebCodecs frame export (with safety timeout to avoid hanging)
function seekVideoToTime(video, targetTime) {
  return new Promise((resolve) => {
    if (!video || !video.duration || Math.abs(video.currentTime - targetTime) < 0.02) {
      resolve();
      return;
    }
    
    // Set a safety timeout of 100ms. If seeked event is too slow, resolve anyway.
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 100);
    
    const onSeeked = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = targetTime;
  });
}

// Background Media drawing (Image or Looping Video)
function drawBackgroundMedia(ctx, time = currentTime, isExporting = false) {
  const media = bgVideo || bgImage;
  if (!media) {
    const grad = ctx.createLinearGradient(0, 0, 0, 1920);
    grad.addColorStop(0, '#0a0d1a');
    grad.addColorStop(0.5, '#161f36');
    grad.addColorStop(1, '#080a14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1920);
    return;
  }

  let w = 0, h = 0;
  if (bgVideo) {
    w = bgVideo.videoWidth;
    h = bgVideo.videoHeight;
    // Only seek automatically during real-time preview (not during frame-by-frame export)
    if (!isExporting && bgVideo.duration && isFinite(bgVideo.duration) && bgVideo.duration > 0) {
      const targetTime = time % bgVideo.duration;
      // Seek video if not already close
      if (Math.abs(bgVideo.currentTime - targetTime) > 0.05) {
        bgVideo.currentTime = targetTime;
      }
    }
  } else if (bgImage) {
    w = bgImage.width;
    h = bgImage.height;
  }

  if (!w || !h) return;

  const canvasAspect = 1080 / 1920;
  const mediaAspect = w / h;

  let drawW, drawH, drawX, drawY;
  if (mediaAspect > canvasAspect) {
    drawH = 1920;
    drawW = w * (1920 / h);
    drawX = (1080 - drawW) / 2;
    drawY = 0;
  } else {
    drawW = 1080;
    drawH = h * (1080 / w);
    drawX = 0;
    drawY = (1920 - drawH) / 2;
  }

  ctx.drawImage(media, drawX, drawY, drawW, drawH);
}

// Main Draw Canvas Function
function drawCanvas(time, platform = currentPlatform, isExporting = false) {
  const ctx = previewCanvas.getContext('2d');
  
  // Background
  drawBackgroundMedia(ctx, time, isExporting);
  
  const isPhase1 = time < phase1Duration;
  
  // Overlays
  // Upper (0 - 384px) - Deep Orange
  ctx.fillStyle = 'rgba(215, 78, 11, 0.85)';
  ctx.fillRect(0, 0, 1080, 384);
  
  // Middle (384px - 1536px) - Translucent white
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(0, 384, 1080, 1152);
  
  // Lower (1536px - 1920px) - Deep Orange
  ctx.fillStyle = 'rgba(215, 78, 11, 0.85)';
  ctx.fillRect(0, 1536, 1080, 384);
  
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  if (isPhase1) {
    // Upper Content
    if (parsedTags.top1) {
      ctx.font = "900 88px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 18;
      ctx.lineJoin = 'round';
      ctx.strokeText(parsedTags.top1, 540, 145);
      ctx.fillText(parsedTags.top1, 540, 145);
    }
    
    if (parsedTags.top2) {
      ctx.font = "700 60px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 14;
      ctx.lineJoin = 'round';
      ctx.strokeText(parsedTags.top2, 540, 260);
      ctx.fillText(parsedTags.top2, 540, 260);
    }
    
    // Draw Lower Fixed Content
    if (platform === 'instagram') {
      // Instagram Phase 1: Row 1 "復習用に保存" centered at x = 500, y = 1670 + arrow ↗
      const text = parsedTags.bottom1 || '復習用に保存';
      ctx.font = "900 68px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 16;
      ctx.lineJoin = 'round';
      
      ctx.textAlign = 'center';
      ctx.strokeText(text, 500, 1670);
      ctx.fillText(text, 500, 1670);
      
      // Draw arrow ↗ centered at x = 820, y = 1670
      ctx.font = "900 80px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.strokeText('↗', 820, 1670);
      ctx.fillText('↗', 820, 1670);
    } else {
      // YouTube Phase 1: Row 1 "高評価・チャンネル登録お願いします！" centered at x = 540, y = 1670
      const text = "高評価・チャンネル登録お願いします！";
      ctx.font = "900 52px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 14;
      ctx.lineJoin = 'round';
      ctx.textAlign = 'center';
      ctx.strokeText(text, 540, 1670);
      ctx.fillText(text, 540, 1670);
    }

    // Both platforms Phase 1: Row 2 "（レベル以上の単語は最後に解説）" centered underneath in gold
    ctx.font = "900 48px 'Outfit', 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#FFD54F'; // Emphasized gold/yellow
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.strokeText("（レベル以上の単語は最後に解説）", 540, 1795);
    ctx.fillText("（レベル以上の単語は最後に解説）", 540, 1795);

    // Always restore alignment to center for subsequent drawings
    ctx.textAlign = 'center';
    
    // Middle Scrolling Content
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 384, 1080, 1152);
    ctx.clip();
    
    const scrollOffset = getScrollOffset(time);
    const initialCenterY = 960;
    
    for (const el of renderedElements) {
      const y = initialCenterY - scrollOffset + el.localY;
      
      if (y > 300 && y < 1620) {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineJoin = 'round';
        
        if (el.type === 'title') {
          ctx.font = "900 64px 'Outfit', 'Noto Sans JP', sans-serif";
          ctx.lineWidth = 14;
          ctx.strokeText(el.text, 540, y);
          ctx.fillText(el.text, 540, y);
        } else {
          ctx.font = "700 48px 'Outfit', 'Noto Sans JP', sans-serif";
          ctx.lineWidth = 12;
          ctx.strokeText(el.text, 540, y);
          ctx.fillText(el.text, 540, y);
        }
      }
    }
    
    ctx.restore();
  } else {
    // Phase 2: Word Explanations
    
    // Upper Title (moved up to y = 145)
    ctx.font = "900 72px 'Outfit', 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 16;
    ctx.lineJoin = 'round';
    ctx.strokeText("今日の高レベルな単語", 540, 145);
    ctx.fillText("今日の高レベルな単語", 540, 145);

    // Upper Subtitle CTA (added underneath at y = 260) (increased size to 48px to improve visibility)
    ctx.font = "900 48px 'Outfit', 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#FFD54F'; // gold/yellow
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.strokeText("ゆっくり読みたい方はプロフからnoteへ！", 540, 260);
    ctx.fillText("ゆっくり読みたい方はプロフからnoteへ！", 540, 260);
    
    // Draw Lower Fixed Content for Phase 2
    if (platform === 'instagram') {
      // Instagram Phase 2: "復習用に保存" + ↗ (increased size, vertically centered)
      const text = parsedTags.bottom1 || '復習用に保存';
      ctx.font = "900 68px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 16;
      ctx.lineJoin = 'round';
      
      // Draw text centered at x = 500, y = 1728
      ctx.textAlign = 'center';
      ctx.strokeText(text, 500, 1728);
      ctx.fillText(text, 500, 1728);
      
      // Draw arrow ↗ centered at x = 820, y = 1728
      ctx.font = "900 80px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.strokeText('↗', 820, 1728);
      ctx.fillText('↗', 820, 1728);
    } else {
      // YouTube Phase 2: "全部読めたかコメント欄で教えてください👇" split into two lines
      ctx.font = "900 56px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 14;
      ctx.lineJoin = 'round';
      ctx.textAlign = 'center';
      
      const line1 = "全部読めたか";
      const line2 = "コメント欄で教えてください👇";
      
      ctx.strokeText(line1, 540, 1693);
      ctx.fillText(line1, 540, 1693);
      
      ctx.strokeText(line2, 540, 1763);
      ctx.fillText(line2, 540, 1763);
    }
    // Always restore alignment to center for the rest of drawing
    ctx.textAlign = 'center';
    
    // Middle List (drawn with semi-transparent rounded rectangle backgrounds)
    const yPositions = [620, 960, 1300];
    for (let i = 0; i < 3; i++) {
      const word = parsedTags.words[i] || '';
      const mean = parsedTags.means[i] || '';
      
      if (word || mean) {
        // Draw rounded rectangle container: solid white with transparency (increased opacity to 60%)
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.roundRect(540 - 920 / 2, yPositions[i] - 200 / 2, 920, 200, 24);
        ctx.fill();
        ctx.stroke();
      }
      
      if (word) {
        ctx.font = "900 68px 'Outfit', 'Noto Sans JP', sans-serif";
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 14;
        ctx.lineJoin = 'round';
        ctx.strokeText(word, 540, yPositions[i] - 40);
        ctx.fillText(word, 540, yPositions[i] - 40);
      }
      
      if (mean) {
        ctx.font = "700 48px 'Outfit', 'Noto Sans JP', sans-serif";
        ctx.fillStyle = '#ffb74d';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 12;
        ctx.lineJoin = 'round';
        ctx.strokeText(mean, 540, yPositions[i] + 40);
        ctx.fillText(mean, 540, yPositions[i] + 40);
      }
    }
  }
}

// Time display formatting (mm:ss)
function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateTimeDisplay() {
  timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(totalDuration)}`;
  progressFill.style.width = `${(currentTime / totalDuration) * 100}%`;
}

// Real-time Animation Frame Loop
function animationLoop(timestamp) {
  if (!isPlaying) return;
  
  if (!lastTime) lastTime = timestamp;
  const elapsed = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  
  currentTime += elapsed;
  
  if (currentTime >= totalDuration) {
    currentTime = totalDuration;
    pause();
    currentTime = 0; // reset
  }
  
  drawCanvas(currentTime);
  updateTimeDisplay();
  
  animationFrameId = requestAnimationFrame(animationLoop);
}

// Play preview
async function play() {
  initAudioCtx();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  
  isPlaying = true;
  lastTime = 0;
  
  playIcon.style.display = 'none';
  pauseIcon.style.display = 'block';
  
  if (bgVideo) {
    bgVideo.play().catch(e => console.warn("Background video play warning:", e));
  }
  
  // Start playing audio in sync
  startRealTimeAudio(currentTime);
  
  animationFrameId = requestAnimationFrame(animationLoop);
}

// Pause preview
function pause() {
  isPlaying = false;
  playIcon.style.display = 'block';
  pauseIcon.style.display = 'none';
  
  if (bgVideo) {
    bgVideo.pause();
  }
  
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  stopRealTimeAudio();
}

// Audio Source Node managers
function startRealTimeAudio(offset) {
  stopRealTimeAudio();
  
  if (!audioCtx) return;
  
  // 1. Play BGM if buffer exists
  if (bgmBuffer) {
    activeBgmSource = audioCtx.createBufferSource();
    activeBgmSource.buffer = bgmBuffer;
    activeBgmSource.loop = true;
    activeBgmSource.connect(bgmGainNode);
    
    // Safely offset inside looping BGM
    const bgmOffset = offset % bgmBuffer.duration;
    activeBgmSource.start(0, bgmOffset);
  }
  
  // 2. Play Voice if buffer exists and offset is less than duration
  if (voiceBuffer && offset < voiceBuffer.duration) {
    activeVoiceSource = audioCtx.createBufferSource();
    activeVoiceSource.buffer = voiceBuffer;
    activeVoiceSource.connect(voiceGainNode);
    activeVoiceSource.start(0, offset);
  }
}

function stopRealTimeAudio() {
  if (activeBgmSource) {
    try { activeBgmSource.stop(); } catch(e) {}
    activeBgmSource = null;
  }
  if (activeVoiceSource) {
    try { activeVoiceSource.stop(); } catch(e) {}
    activeVoiceSource = null;
  }
}

// Seek Timeline
function seekTo(time) {
  currentTime = Math.max(0, Math.min(time, totalDuration));
  drawCanvas(currentTime);
  updateTimeDisplay();
  
  if (isPlaying) {
    // Restart audio from new seek position
    startRealTimeAudio(currentTime);
  }
}

// Offline Mixed Audio Renderer
async function renderOfflineAudio() {
  if (!bgmBuffer && !voiceBuffer) return null;
  
  // Use OfflineAudioContext for offline rendering
  const offlineCtx = new OfflineAudioContext(
    2, // 2 channels
    Math.round(44100 * totalDuration),
    44100
  );
  
  // BGM Node
  if (bgmBuffer) {
    const bgmSource = offlineCtx.createBufferSource();
    bgmSource.buffer = bgmBuffer;
    bgmSource.loop = true;
    
    const bgmGain = offlineCtx.createGain();
    bgmGain.gain.setValueAtTime(parseFloat(bgmVolumeSlider.value), 0);
    
    bgmSource.connect(bgmGain);
    bgmGain.connect(offlineCtx.destination);
    
    bgmSource.start(0);
    bgmSource.stop(totalDuration);
  }
  
  // Voice Node
  if (voiceBuffer) {
    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    
    const voiceGain = offlineCtx.createGain();
    voiceGain.gain.setValueAtTime(1.0, 0);
    
    voiceSource.connect(voiceGain);
    voiceGain.connect(offlineCtx.destination);
    
    voiceSource.start(0);
    voiceSource.stop(totalDuration);
  }
  
  return await offlineCtx.startRendering();
}

// Real-time Export Fallback using MediaRecorder (for browsers/in-app browsers without WebCodecs support)
async function exportVideoRealTime(platform) {
  exportCancelled = false;
  btnExportInstagram.disabled = true;
  btnExportYoutube.disabled = true;
  exportOverlay.classList.add('active');
  exportLoadingState.style.display = 'flex';
  exportSuccessState.style.display = 'none';
  exportStatusText.textContent = "リアルタイム録画でエクスポート中...";
  exportProgressFill.style.width = "0%";

  try {
    initAudioCtx();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const fps = 30;
    const canvasStream = previewCanvas.captureStream ? previewCanvas.captureStream(fps) : previewCanvas.mozCaptureStream(fps);
    const mixedStream = new MediaStream();
    
    // Add video track
    mixedStream.addTrack(canvasStream.getVideoTracks()[0]);

    // Capture Audio if present
    let mediaRecorder = null;
    let audioDestNode = null;
    
    const hasAudio = bgmBuffer || voiceBuffer;
    if (hasAudio) {
      audioDestNode = audioCtx.createMediaStreamDestination();
      bgmGainNode.connect(audioDestNode);
      voiceGainNode.connect(audioDestNode);
      mixedStream.addTrack(audioDestNode.stream.getAudioTracks()[0]);
    }

    // Set MIME types and fallbacks (Varying by mobile devices/Safari/Chrome)
    let options = { mimeType: 'video/mp4; codecs="avc1.424028, mp4a.40.2"' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/mp4' };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm; codecs=vp9' };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm' };
    }

    mediaRecorder = new MediaRecorder(mixedStream, options);
    const chunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (audioDestNode) {
        bgmGainNode.disconnect(audioDestNode);
        voiceGainNode.disconnect(audioDestNode);
      }

      if (exportCancelled) {
        btnExportInstagram.disabled = false;
        btnExportYoutube.disabled = false;
        return;
      }

      const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      const suffix = platform === 'instagram' ? 'insta' : 'youtube';
      const extension = mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
      a.download = `${parsedTags.title || 'video'}_${suffix}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      exportLoadingState.style.display = 'none';
      exportSuccessState.style.display = 'flex';
      
      btnExportInstagram.disabled = false;
      btnExportYoutube.disabled = false;
    };

    // Start Recording and Playback
    mediaRecorder.start();
    
    currentTime = 0;
    startRealTimeAudio(0);
    
    const startTime = performance.now();
    
    const recordLoop = () => {
      if (exportCancelled) {
        mediaRecorder.stop();
        stopRealTimeAudio();
        return;
      }

      const elapsed = (performance.now() - startTime) / 1000;
      currentTime = Math.min(elapsed, totalDuration);
      
      // Update UI
      exportProgressFill.style.width = `${Math.round((currentTime / totalDuration) * 100)}%`;
      exportStatusText.textContent = `録画中... ${Math.round(currentTime)}秒 / ${Math.round(totalDuration)}秒`;

      drawCanvas(currentTime, platform);

      if (currentTime >= totalDuration) {
        mediaRecorder.stop();
        stopRealTimeAudio();
      } else {
        requestAnimationFrame(recordLoop);
      }
    };

    requestAnimationFrame(recordLoop);

  } catch (err) {
    console.error("Real-time export failed:", err);
    alert(`エクスポートに失敗しました: ${err.message}`);
    exportOverlay.classList.remove('active');
    btnExportInstagram.disabled = false;
    btnExportYoutube.disabled = false;
  }
}

// Video Export logic (WebCodecs + Muxer)
async function exportVideo(platform = currentPlatform) {
  const hasAudio = bgmBuffer || voiceBuffer;
  const canEncodeAudio = typeof AudioEncoder !== 'undefined';
  
  // Fall back to MediaRecorder if WebCodecs video is missing OR if we have audio but cannot encode it (e.g. mobile Safari)
  if (typeof VideoEncoder === 'undefined' || (hasAudio && !canEncodeAudio)) {
    console.log("Using MediaRecorder fallback for export.");
    exportVideoRealTime(platform);
    return;
  }

  // Setup UI state
  exportCancelled = false;
  btnExportInstagram.disabled = true;
  btnExportYoutube.disabled = true;
  exportOverlay.classList.add('active');
  exportLoadingState.style.display = 'flex';
  exportSuccessState.style.display = 'none';
  exportStatusText.textContent = "音声トラックをミキシングしています...";
  exportProgressFill.style.width = "0%";

  try {
    // 1. Render Mixed Audio to single Buffer
    const mixedAudioBuffer = await renderOfflineAudio();
    if (exportCancelled) return;

    // 2. Configure video encoding settings
    // Default: H.264 Baseline Profile (widely supported on mobile/PCs)
    let videoCodecString = 'avc1.42001f';
    let videoConfig = {
      codec: videoCodecString,
      width: 1080,
      height: 1920,
      bitrate: 3000000, // 3 Mbps
      framerate: 30
    };

    let videoSupported = await VideoEncoder.isConfigSupported(videoConfig);
    if (!videoSupported.supported) {
      // Fallback to H.264 Main Profile
      videoConfig.codec = 'avc1.4d002a';
      videoSupported = await VideoEncoder.isConfigSupported(videoConfig);
    }

    if (!videoSupported.supported) {
      throw new Error("H.264 Video encoding is not supported on this device.");
    }

    // 3. Configure audio encoding settings if audio exists and is supported
    const hasAudio = !!mixedAudioBuffer;
    const canEncodeAudio = typeof AudioEncoder !== 'undefined';
    let audioConfig = null;

    if (hasAudio && canEncodeAudio) {
      audioConfig = {
        codec: 'mp4a.40.2', // AAC-LC
        numberOfChannels: 2,
        sampleRate: 44100,
        bitrate: 128000
      };
      
      const audioSupported = await AudioEncoder.isConfigSupported(audioConfig);
      if (!audioSupported.supported) {
        audioConfig = null; // drop audio encoding fallback
        console.warn("AAC Audio encoding is configured but not supported on this browser.");
      }
    }

    // 4. Initialize Mp4Muxer Muxer
    const muxerOptions = {
      target: new ArrayBufferTarget(),
      video: {
        codec: videoConfig.codec.split('.')[0] === 'avc1' ? 'avc' : 'vp9',
        width: 1080,
        height: 1920
      },
      fastStart: 'in-memory'
    };

    if (audioConfig) {
      muxerOptions.audio = {
        codec: 'aac',
        numberOfChannels: 2,
        sampleRate: 44100
      };
    }

    const muxer = new Muxer(muxerOptions);

    // 5. Initialize Encoders
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error("VideoEncoder Error:", e);
        throw e;
      }
    });
    videoEncoder.configure(videoConfig);

    let audioEncoder = null;
    if (audioConfig) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => {
          console.error("AudioEncoder Error:", e);
          throw e;
        }
      });
      audioEncoder.configure(audioConfig);
    }

    // 6. Encode Audio Chunks (if present)
    if (mixedAudioBuffer && audioEncoder) {
      exportStatusText.textContent = "音声トラックをエンコードしています...";
      
      const left = mixedAudioBuffer.getChannelData(0);
      const right = mixedAudioBuffer.getChannelData(1);
      const totalFrames = mixedAudioBuffer.length;
      const chunkSize = 1024; // AAC Frame Size
      let offset = 0;

      while (offset < totalFrames && !exportCancelled) {
        const framesToEncode = Math.min(chunkSize, totalFrames - offset);
        const chunkBuffer = new Float32Array(framesToEncode * 2);
        
        // Copy channel data (planar format L...R...)
        chunkBuffer.set(left.subarray(offset, offset + framesToEncode), 0);
        chunkBuffer.set(right.subarray(offset, offset + framesToEncode), framesToEncode);
        
        const timestampUs = Math.round(offset * 1000000 / 44100);
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: 44100,
          numberOfFrames: framesToEncode,
          numberOfChannels: 2,
          timestamp: timestampUs,
          data: chunkBuffer
        });

        audioEncoder.encode(audioData);
        audioData.close();
        
        offset += framesToEncode;
        
        // Yield to prevent tab freeze during audio compression
        if (offset % (chunkSize * 20) === 0) {
          await sleep(0);
        }
      }
      
      if (exportCancelled) return;
      await audioEncoder.flush();
    }

    // 7. Encode Video Frames (Frame-by-frame rendering loop)
    const fps = 30;
    const totalFrames = Math.ceil(totalDuration * fps);
    
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (exportCancelled) return;

      const frameTime = frameIndex / fps;
      exportStatusText.textContent = `ビデオフレームをレンダリング中... (${frameIndex + 1}/${totalFrames})`;
      exportProgressFill.style.width = `${Math.round((frameIndex / totalFrames) * 100)}%`;

      if (bgVideo && bgVideo.duration > 0) {
        const bgTime = frameTime % bgVideo.duration;
        // Seek on every frame to ensure a perfectly smooth 30 fps background video
        await seekVideoToTime(bgVideo, bgTime);
      }

      // Render the frame onto previewCanvas for the target platform (mark isExporting = true)
      drawCanvas(frameTime, platform, true);

      // Create VideoFrame
      const timestampUs = Math.round(frameTime * 1000000);
      const frame = new VideoFrame(previewCanvas, { timestamp: timestampUs });

      // Encode VideoFrame
      videoEncoder.encode(frame);
      frame.close(); // Crucial to prevent GPU memory leaks

      // Yield control to main thread every 30 frames (1 second of video) to keep UI responsive without micro-sleep overhead
      if (frameIndex % 30 === 0) {
        await sleep(1);
      } 
    }

    if (exportCancelled) return;
    
    exportStatusText.textContent = "データを書き出しています...";
    await videoEncoder.flush();
    muxer.finalize();

    // 8. Trigger Download
    const { buffer } = muxer.target;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const suffix = platform === 'instagram' ? 'insta' : 'youtube';
    a.download = `${parsedTags.title || 'video'}_${suffix}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Update UI to success
    exportLoadingState.style.display = 'none';
    exportSuccessState.style.display = 'flex';

  } catch (error) {
    console.error("Export failed:", error);
    alert(`エクスポート中にエラーが発生しました: ${error.message}`);
    exportOverlay.classList.remove('active');
  } finally {
    btnExportInstagram.disabled = false;
    btnExportYoutube.disabled = false;
  }
}

// Handle tab switching
function switchTab(activeTab, inactiveTab, showSection, hideSection) {
  activeTab.classList.add('active');
  inactiveTab.classList.remove('active');
  showSection.style.display = 'block';
  hideSection.style.display = 'none';
  calculateLayout();
  currentTime = 0;
  drawCanvas(0);
}

// Initialization function
async function initApp() {
  // Parse elements and calculate initial layout
  calculateLayout();
  drawCanvas(0);

  // Load BGM from IndexedDB if it exists
  try {
    const bgmData = await loadBGMFromStore();
    if (bgmData) {
      bgmName = bgmData.name;
      bgmAudioInfo.textContent = `保存データからロード: ${bgmName}`;
      bgmAudioBtn.classList.add('has-file');
      
      // Decode audio buffer in a temporary AudioContext
      const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
      bgmBuffer = await decodeAudioDataSafe(tempCtx, bgmData.arrayBuffer);
      tempCtx.close();
      
      calculateLayout();
      drawCanvas(0);
    }
  } catch (err) {
    console.warn("Failed to load stored BGM:", err);
  }
}

// Robust DOMContentLoaded handler for ES Modules / Vite
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Input change listeners
const textInputElems = [inputTop1, inputTop2, inputTitle, inputBottom1, speedReadingTextInput, explanationInput];
textInputElems.forEach(input => {
  if (input) {
    input.addEventListener('input', () => {
      calculateLayout();
      drawCanvas(currentTime);
    });
  }
});

normalDurationInput.addEventListener('input', () => {
  calculateLayout();
  drawCanvas(currentTime);
});

timestampInput.addEventListener('input', () => {
  calculateLayout();
  drawCanvas(currentTime);
});

// Tabs
tabNormal.addEventListener('click', () => {
  switchTab(tabNormal, tabTimestamp, normalModeSection, timestampModeSection);
});

tabTimestamp.addEventListener('click', () => {
  switchTab(tabTimestamp, tabNormal, timestampModeSection, normalModeSection);
});

// File inputs (Media Background: Image or Video)
bgMediaInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    bgMediaName = file.name;
    bgMediaInfo.textContent = `読み込み中: ${bgMediaName}...`;
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(bgMediaName);
    
    if (isVideo) {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.preload = "auto";
      
      video.onloadedmetadata = () => {
        bgVideo = video;
        bgImage = null;
        bgMediaInfo.textContent = `選択中 (動画): ${bgMediaName}`;
        bgMediaBtn.classList.add('has-file');
        drawCanvas(currentTime);
      };
      
      video.onerror = (err) => {
        console.error("Video load error:", err, video.error);
        const detail = video.error ? `${video.error.message} (Code: ${video.error.code})` : '非対応コーデックまたは破損ファイルです';
        alert(`動画ファイルの読み込みに失敗しました。\n詳細: ${detail}\n※ブラウザが再生可能なH.264 MP4ファイルを推奨します。`);
        bgMediaInfo.textContent = `エラー: ${bgMediaName}`;
        bgMediaBtn.classList.remove('has-file');
      };

      video.load();
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          bgImage = img;
          bgVideo = null;
          bgMediaInfo.textContent = `選択中 (画像): ${bgMediaName}`;
          bgMediaBtn.classList.add('has-file');
          drawCanvas(currentTime);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  }
});

bgmAudioInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    initAudioCtx();
    bgmName = file.name;
    bgmAudioInfo.textContent = `デコード中: ${bgmName}...`;
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      bgmBuffer = await decodeAudioDataSafe(audioCtx, arrayBuffer);
      
      // Store BGM in IndexedDB for persistence
      await saveBGMToStore(arrayBuffer, bgmName);
      
      bgmAudioInfo.textContent = `選択中: ${bgmName}`;
      bgmAudioBtn.classList.add('has-file');
      
      adjustVolumeSettings();
      calculateLayout();
      drawCanvas(currentTime);
    } catch (err) {
      console.error(err);
      alert("BGMファイルのデコードに失敗しました。有効なオーディオファイルを選択してください。");
      bgmAudioInfo.textContent = `エラー: ${bgmName}`;
      bgmAudioBtn.classList.remove('has-file');
      bgmBuffer = null;
    }
  }
});

voiceAudioInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    initAudioCtx();
    voiceName = file.name;
    voiceAudioInfo.textContent = `デコード中: ${voiceName}...`;
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      voiceBuffer = await decodeAudioDataSafe(audioCtx, arrayBuffer);
      
      voiceAudioInfo.textContent = `選択中: ${voiceName}`;
      voiceAudioBtn.classList.add('has-file');
      
      // Show auto-timestamp button
      btnAutoTimestamp.style.display = 'block';
      
      // Auto-generate timestamps from voice duration and text paragraphs
      autoGenerateTimestampsFromVoice();
      
      adjustVolumeSettings();
      calculateLayout();
      drawCanvas(currentTime);
    } catch (err) {
      console.error(err);
      alert("音読音声ファイルのデコードに失敗しました。有効なオーディオファイルを選択してください。");
      voiceAudioInfo.textContent = `エラー: ${voiceName}`;
      voiceAudioBtn.classList.remove('has-file');
      voiceBuffer = null;
      btnAutoTimestamp.style.display = 'none';
    }
  }
});

btnAutoTimestamp.addEventListener('click', () => {
  autoGenerateTimestampsFromVoice();
});

// Real-time Controls
btnPlayPause.addEventListener('click', () => {
  if (isPlaying) {
    pause();
  } else {
    play();
  }
});

// Slider Volume control
bgmVolumeSlider.addEventListener('input', (e) => {
  const vol = parseFloat(e.target.value);
  bgmVolumeVal.textContent = `${Math.round(vol * 100)}%`;
  
  if (bgmGainNode) {
    bgmGainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
  }
});

// Progress Bar Click Seek
progressWrapper.addEventListener('click', (e) => {
  const rect = progressWrapper.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = clickX / rect.width;
  seekTo(ratio * totalDuration);
});

// Export buttons
btnExportInstagram.addEventListener('click', () => {
  pause();
  exportVideo('instagram');
});

btnExportYoutube.addEventListener('click', () => {
  pause();
  exportVideo('youtube');
});

// Platform Preview Tab Toggles
tabPreviewInstagram.addEventListener('click', () => {
  tabPreviewInstagram.classList.add('active');
  tabPreviewYoutube.classList.remove('active');
  currentPlatform = 'instagram';
  drawCanvas(currentTime);
});

tabPreviewYoutube.addEventListener('click', () => {
  tabPreviewYoutube.classList.add('active');
  tabPreviewInstagram.classList.remove('active');
  currentPlatform = 'youtube';
  drawCanvas(currentTime);
});

btnCancelExport.addEventListener('click', () => {
  exportCancelled = true;
  exportOverlay.classList.remove('active');
  btnExportInstagram.disabled = false;
  btnExportYoutube.disabled = false;
});

btnCloseOverlay.addEventListener('click', () => {
  exportOverlay.classList.remove('active');
});

// Mute button logic
btnMute.addEventListener('click', () => {
  if (!audioCtx) return;
  
  const isCurrentlyMuted = audioCtx.state === 'suspended';
  if (isCurrentlyMuted) {
    audioCtx.resume();
    soundOnIcon.style.display = 'block';
    soundOffIcon.style.display = 'none';
  } else {
    audioCtx.suspend();
    soundOnIcon.style.display = 'none';
    soundOffIcon.style.display = 'block';
  }
});
