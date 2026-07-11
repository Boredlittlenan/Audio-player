const DB_NAME = "scheduled-audio-player";
const DB_VERSION = 1;
const TRACK_STORE = "tracks";
const SETTINGS_KEY = "audio-player-settings";
const SETTINGS_SAVE_INTERVAL = 900;

const state = {
  tracks: [],
  currentIndex: -1,
  scheduleMode: "exact",
  scheduleTimer: null,
  scheduleTarget: null,
  scheduleInterval: null,
  audioContext: null,
  analyser: null,
  sourceNode: null,
  visualAnimation: null,
  isSeeking: false,
  db: null,
  pendingSeekTime: 0,
  settingsSaveAt: 0,
  isRestoring: true,
};

const audio = document.querySelector("#audio");
const fileInput = document.querySelector("#fileInput");
const uploadButton = document.querySelector("#uploadButton");
const clearButton = document.querySelector("#clearButton");
const dropZone = document.querySelector("#dropZone");
const trackList = document.querySelector("#trackList");
const emptyLibrary = document.querySelector("#emptyLibrary");
const trackCount = document.querySelector("#trackCount");
const totalDuration = document.querySelector("#totalDuration");
const playerTitle = document.querySelector("#playerTitle");
const trackMeta = document.querySelector("#trackMeta");
const trackInitial = document.querySelector("#trackInitial");
const disc = document.querySelector("#disc");
const playButton = document.querySelector("#playButton");
const playIcon = document.querySelector("#playIcon use");
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const seekRange = document.querySelector("#seekRange");
const currentTime = document.querySelector("#currentTime");
const duration = document.querySelector("#duration");
const volumeRange = document.querySelector("#volumeRange");
const volumeValue = document.querySelector("#volumeValue");
const speedSelect = document.querySelector("#speedSelect");
const clockText = document.querySelector("#clockText");
const exactTimeInput = document.querySelector("#exactTimeInput");
const delayInput = document.querySelector("#delayInput");
const modeTabs = document.querySelectorAll(".mode-tab");
const modeBlocks = document.querySelectorAll(".schedule-mode-block");
const quickButtons = document.querySelectorAll(".quick-times button");
const scheduleButton = document.querySelector("#scheduleButton");
const cancelScheduleButton = document.querySelector("#cancelScheduleButton");
const scheduleStatus = document.querySelector("#scheduleStatus");
const statusTitle = document.querySelector("#statusTitle");
const statusDetail = document.querySelector("#statusDetail");
const visualizer = document.querySelector("#visualizer");
const canvasContext = visualizer.getContext("2d");

setDateTimeMinimum();
restoreSettings();
audio.volume = Number(volumeRange.value);
updateRangeProgress(volumeRange, Number(volumeRange.value));
volumeValue.textContent = `${Math.round(Number(volumeRange.value) * 100)}%`;
updateRangeProgress(seekRange, 0);
tickClock();
startVisualizer();
setInterval(tickClock, 1000);
restoreTracks();

uploadButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (event) => {
  addFiles([...event.target.files]);
  fileInput.value = "";
});

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("drag-over");
  addFiles([...event.dataTransfer.files]);
});

clearButton.addEventListener("click", clearTracks);
playButton.addEventListener("click", togglePlayback);
prevButton.addEventListener("click", playPrevious);
nextButton.addEventListener("click", playNext);

seekRange.addEventListener("input", () => {
  state.isSeeking = true;
  updateRangeProgress(seekRange, Number(seekRange.value) / 1000);
  if (audio.duration) {
    currentTime.textContent = formatTime((Number(seekRange.value) / 1000) * audio.duration);
  }
});

seekRange.addEventListener("change", () => {
  if (audio.duration) {
    audio.currentTime = (Number(seekRange.value) / 1000) * audio.duration;
  }
  state.isSeeking = false;
  saveSettings();
});

volumeRange.addEventListener("input", () => {
  audio.volume = Number(volumeRange.value);
  volumeValue.textContent = `${Math.round(audio.volume * 100)}%`;
  updateRangeProgress(volumeRange, audio.volume);
  saveSettings();
});

speedSelect.addEventListener("change", () => {
  audio.playbackRate = Number(speedSelect.value);
  saveSettings();
});

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => setScheduleMode(tab.dataset.mode));
});

quickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setScheduleMode("delay");
    delayInput.value = button.dataset.minutes;
    quickButtons.forEach((item) => item.classList.toggle("active", item === button));
    saveSettings();
  });
});

scheduleButton.addEventListener("click", schedulePlayback);
cancelScheduleButton.addEventListener("click", cancelSchedule);
exactTimeInput.addEventListener("change", saveSettings);
delayInput.addEventListener("input", saveSettings);
window.addEventListener("beforeunload", saveSettings);

audio.addEventListener("loadedmetadata", () => {
  duration.textContent = formatTime(audio.duration);
  updateTrackDuration(state.currentIndex, audio.duration);
  applyPendingSeek();
  renderTracks();
  updateTotals();
  saveTrackMetadata(state.currentIndex);
});

audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("play", () => {
  disc.classList.add("playing");
  playIcon.setAttribute("href", "#icon-pause");
  playButton.setAttribute("title", "暂停");
  playButton.setAttribute("aria-label", "暂停");
  prepareAudioGraph();
});

audio.addEventListener("pause", () => {
  disc.classList.remove("playing");
  playIcon.setAttribute("href", "#icon-play");
  playButton.setAttribute("title", "播放");
  playButton.setAttribute("aria-label", "播放");
});

audio.addEventListener("ended", handleEnded);

async function addFiles(files) {
  const audioFiles = files.filter((file) => file.type.startsWith("audio/") || /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(file.name));
  if (!audioFiles.length) return;

  const now = Date.now();
  const newTracks = audioFiles.map((file, index) => ({
    id: createTrackId(),
    file,
    url: URL.createObjectURL(file),
    title: cleanTitle(file.name),
    meta: formatFileSize(file.size),
    duration: 0,
    createdAt: now + index,
  }));

  const wasEmpty = state.tracks.length === 0;
  state.tracks.push(...newTracks);
  await persistTracks(newTracks);
  if (wasEmpty) loadTrack(0, false);
  renderTracks();
  updateTotals();
  saveSettings();
}

function clearTracks() {
  cancelSchedule();
  state.tracks.forEach((track) => URL.revokeObjectURL(track.url));
  state.tracks = [];
  state.currentIndex = -1;
  state.pendingSeekTime = 0;
  clearStoredTracks();
  localStorage.removeItem(SETTINGS_KEY);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  playerTitle.textContent = "等待你的第一首歌";
  trackMeta.textContent = "添加本地音频即可开始";
  trackInitial.textContent = "S";
  currentTime.textContent = "00:00";
  duration.textContent = "00:00";
  seekRange.value = 0;
  updateRangeProgress(seekRange, 0);
  renderTracks();
  updateTotals();
}

function loadTrack(index, autoplay = true, startAt = 0) {
  const track = state.tracks[index];
  if (!track) return;

  state.currentIndex = index;
  state.pendingSeekTime = Math.max(0, Number(startAt) || 0);
  audio.src = track.url;
  audio.playbackRate = Number(speedSelect.value);
  audio.volume = Number(volumeRange.value);
  playerTitle.textContent = track.title;
  trackMeta.textContent = track.meta;
  trackInitial.textContent = getInitial(track.title);
  const displayTime = state.pendingSeekTime && track.duration ? Math.min(state.pendingSeekTime, track.duration) : 0;
  seekRange.value = track.duration ? String((displayTime / track.duration) * 1000) : "0";
  updateRangeProgress(seekRange, track.duration ? displayTime / track.duration : 0);
  currentTime.textContent = formatTime(displayTime);
  duration.textContent = track.duration ? formatTime(track.duration) : "00:00";
  renderTracks();
  saveSettings();

  if (autoplay) {
    playAudio();
  }
}

async function togglePlayback() {
  if (!state.tracks.length) {
    fileInput.click();
    return;
  }

  if (state.currentIndex < 0) {
    loadTrack(0, false);
  }

  if (audio.paused) {
    await playAudio();
  } else {
    audio.pause();
  }
}

async function playAudio() {
  try {
    await prepareAudioGraph();
    await audio.play();
    setStatusNeutral();
  } catch (error) {
    setStatusWarning("需要手动播放", "浏览器拦截了自动播放，请点播放按钮。");
  }
}

function playPrevious() {
  if (!state.tracks.length) return;
  const index = (state.currentIndex - 1 + state.tracks.length) % state.tracks.length;
  loadTrack(index, true);
}

function playNext() {
  if (!state.tracks.length) return;
  const index = (state.currentIndex + 1) % state.tracks.length;
  loadTrack(index, true);
}

function handleEnded() {
  if (state.currentIndex >= 0 && state.currentIndex < state.tracks.length - 1) {
    loadTrack(state.currentIndex + 1, true);
    return;
  }

  audio.pause();
  audio.currentTime = 0;
  seekRange.value = "0";
  updateRangeProgress(seekRange, 0);
  currentTime.textContent = "00:00";
  saveSettings();
  disc.classList.remove("playing");
  playIcon.setAttribute("href", "#icon-play");
  playButton.setAttribute("title", "播放");
  playButton.setAttribute("aria-label", "播放");
}

function updateProgress() {
  if (!audio.duration || state.isSeeking) return;
  const progress = (audio.currentTime / audio.duration) * 1000;
  seekRange.value = String(progress);
  updateRangeProgress(seekRange, progress / 1000);
  currentTime.textContent = formatTime(audio.currentTime);
  duration.textContent = formatTime(audio.duration);
  saveSettingsThrottled();
}

function renderTracks() {
  trackList.innerHTML = "";
  emptyLibrary.hidden = state.tracks.length > 0;
  clearButton.disabled = state.tracks.length === 0;
  prevButton.disabled = state.tracks.length < 2;
  nextButton.disabled = state.tracks.length < 2;

  state.tracks.forEach((track, index) => {
    const item = document.createElement("li");
    item.className = `track-item${index === state.currentIndex ? " active" : ""}`;
    item.tabIndex = 0;
    item.innerHTML = `
      <span class="track-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="track-text">
        <span class="track-title">${escapeHtml(track.title)}</span>
        <span class="track-subtitle">${escapeHtml(track.meta)}</span>
      </span>
      <span class="track-time">${track.duration ? formatTime(track.duration) : "--:--"}</span>
      <button class="track-remove" type="button" title="移除 ${escapeHtml(track.title)}" aria-label="移除 ${escapeHtml(track.title)}">
        <svg><use href="#icon-trash"></use></svg>
      </button>
    `;
    item.addEventListener("click", () => loadTrack(index, true));
    item.addEventListener("keydown", (event) => {
      if (event.target === item && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        loadTrack(index, true);
      }
    });
    item.querySelector(".track-remove").addEventListener("click", (event) => {
      event.stopPropagation();
      removeTrack(index);
    });
    trackList.appendChild(item);
  });

  trackCount.textContent = String(state.tracks.length);
}

async function removeTrack(index) {
  const track = state.tracks[index];
  if (!track) return;

  const wasPlaying = !audio.paused;
  const wasCurrent = index === state.currentIndex;
  URL.revokeObjectURL(track.url);
  state.tracks.splice(index, 1);
  await deleteStoredTrack(track.id);

  if (!state.tracks.length) {
    clearTracks();
    return;
  }

  if (index < state.currentIndex) {
    state.currentIndex -= 1;
  } else if (wasCurrent) {
    const nextIndex = Math.min(index, state.tracks.length - 1);
    loadTrack(nextIndex, wasPlaying);
  }

  renderTracks();
  updateTotals();
  if (state.scheduleTarget) updateScheduleCountdown();
  saveSettings();
}

function updateTrackDuration(index, seconds) {
  if (state.tracks[index] && Number.isFinite(seconds)) {
    state.tracks[index].duration = seconds;
  }
}

function updateTotals() {
  const seconds = state.tracks.reduce((total, track) => total + (track.duration || 0), 0);
  totalDuration.textContent = formatTime(seconds);
  trackCount.textContent = String(state.tracks.length);
}

async function restoreTracks() {
  try {
    const records = await getStoredTracks();
    if (!records.length) {
      renderTracks();
      updateTotals();
      return;
    }

    state.tracks.forEach((track) => URL.revokeObjectURL(track.url));
    state.tracks = records
      .sort((first, second) => first.createdAt - second.createdAt)
      .map((record) => ({
        id: record.id,
        file: record.file,
        url: URL.createObjectURL(record.file),
        title: record.title,
        meta: record.meta,
        duration: record.duration || 0,
        createdAt: record.createdAt,
      }));

    const settings = readSettings();
    const savedTrackIndex = state.tracks.findIndex((track) => track.id === settings.currentTrackId);
    const fallbackIndex = Number.isInteger(settings.currentIndex) ? settings.currentIndex : 0;
    const index = clamp(savedTrackIndex >= 0 ? savedTrackIndex : fallbackIndex, 0, state.tracks.length - 1);
    const startAt = settings.currentTrackId === state.tracks[index]?.id ? settings.currentTime : 0;

    loadTrack(index, false, startAt);
    renderTracks();
    updateTotals();
  } catch (error) {
    setStatusWarning("无法恢复歌单", "浏览器本地存储不可用，请重新添加音频。");
  } finally {
    state.isRestoring = false;
  }
}

async function persistTracks(tracks) {
  try {
    await Promise.all(tracks.map((track) => putStoredTrack(track)));
  } catch (error) {
    setStatusWarning("保存失败", "浏览器本地空间不足或存储被禁用。");
  }
}

async function saveTrackMetadata(index) {
  const track = state.tracks[index];
  if (!track) return;

  try {
    await putStoredTrack(track);
  } catch (error) {
    setStatusWarning("保存失败", "曲目信息未能写入本地存储。");
  }
}

async function getStoredTracks() {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRACK_STORE, "readonly");
    const store = transaction.objectStore(TRACK_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function putStoredTrack(track) {
  const db = await getDatabase();
  const record = {
    id: track.id,
    title: track.title,
    meta: track.meta,
    duration: track.duration || 0,
    createdAt: track.createdAt,
    file: track.file,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRACK_STORE, "readwrite");
    const store = transaction.objectStore(TRACK_STORE);
    store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function deleteStoredTrack(id) {
  try {
    const db = await getDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(TRACK_STORE, "readwrite");
      transaction.objectStore(TRACK_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    setStatusWarning("移除失败", "这首音频未能从浏览器存储中移除。");
  }
}

async function clearStoredTracks() {
  try {
    const db = await getDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(TRACK_STORE, "readwrite");
      const store = transaction.objectStore(TRACK_STORE);
      store.clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    setStatusWarning("清理失败", "浏览器本地歌单没有完全清除。");
  }
}

function getDatabase() {
  if (state.db) return Promise.resolve(state.db);
  if (!window.indexedDB) return Promise.reject(new Error("IndexedDB unavailable"));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        db.createObjectStore(TRACK_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      state.db = request.result;
      resolve(state.db);
    };
    request.onerror = () => reject(request.error);
  });
}

function restoreSettings() {
  const settings = readSettings();

  if (Number.isFinite(settings.volume)) {
    volumeRange.value = String(clamp(settings.volume, 0, 1));
  }

  if ([...speedSelect.options].some((option) => option.value === String(settings.speed))) {
    speedSelect.value = String(settings.speed);
  }

  if (settings.scheduleMode === "exact" || settings.scheduleMode === "delay") {
    setScheduleMode(settings.scheduleMode);
  }

  if (settings.delayMinutes) {
    delayInput.value = String(settings.delayMinutes);
  }

  if (settings.exactTime) {
    exactTimeInput.value = settings.exactTime;
  }
}

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveSettingsThrottled() {
  const now = Date.now();
  if (now - state.settingsSaveAt < SETTINGS_SAVE_INTERVAL) return;
  state.settingsSaveAt = now;
  saveSettings();
}

function saveSettings() {
  if (state.isRestoring) return;

  const track = state.tracks[state.currentIndex];
  const settings = {
    currentIndex: state.currentIndex,
    currentTrackId: track?.id || null,
    currentTime: state.pendingSeekTime || (Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
    volume: Number(volumeRange.value),
    speed: Number(speedSelect.value),
    scheduleMode: state.scheduleMode,
    delayMinutes: Number(delayInput.value) || 15,
    exactTime: exactTimeInput.value,
  };

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    setStatusWarning("保存失败", "浏览器本地状态存储被禁用。");
  }
}

function applyPendingSeek() {
  if (!state.pendingSeekTime || !audio.duration) return;
  const time = Math.min(state.pendingSeekTime, Math.max(0, audio.duration - 0.25));
  audio.currentTime = time;
  seekRange.value = String((time / audio.duration) * 1000);
  updateRangeProgress(seekRange, time / audio.duration);
  currentTime.textContent = formatTime(time);
  state.pendingSeekTime = 0;
}

function schedulePlayback() {
  if (!state.tracks.length) {
    setStatusWarning("缺少音频", "先添加一首音频。");
    return;
  }

  if (state.currentIndex < 0) {
    loadTrack(0, false);
  }

  const target = getScheduleTarget();
  if (!target) return;

  cancelSchedule(false);
  state.scheduleTarget = target;
  const delay = target.getTime() - Date.now();
  state.scheduleTimer = window.setTimeout(async () => {
    clearScheduleHandles();
    statusTitle.textContent = "正在播放";
    statusDetail.textContent = state.tracks[state.currentIndex]?.title || "已触发定时播放";
    scheduleStatus.classList.add("active");
    cancelScheduleButton.disabled = true;
    await playAudio();
  }, delay);

  primePlayback();
  state.scheduleInterval = window.setInterval(updateScheduleCountdown, 1000);
  cancelScheduleButton.disabled = false;
  scheduleStatus.classList.add("active");
  scheduleStatus.classList.remove("warning");
  updateScheduleCountdown();
}

function getScheduleTarget() {
  if (state.scheduleMode === "exact") {
    const value = exactTimeInput.value;
    const target = value ? new Date(value) : null;
    if (!target || Number.isNaN(target.getTime())) {
      setStatusWarning("时间无效", "请选择播放时间。");
      return null;
    }
    if (target.getTime() <= Date.now()) {
      setStatusWarning("时间已过", "请选择未来的时间。");
      return null;
    }
    return target;
  }

  const minutes = Number(delayInput.value);
  if (!Number.isFinite(minutes) || minutes < 1) {
    setStatusWarning("倒计时无效", "请输入 1 分钟以上的时间。");
    return null;
  }
  return new Date(Date.now() + minutes * 60 * 1000);
}

function cancelSchedule(resetStatus = true) {
  clearScheduleHandles();
  state.scheduleTarget = null;
  cancelScheduleButton.disabled = true;
  scheduleStatus.classList.remove("active", "warning");
  if (resetStatus) {
    statusTitle.textContent = "暂未设置";
    statusDetail.textContent = "创建后，这里会显示剩余时间。";
  }
}

function clearScheduleHandles() {
  if (state.scheduleTimer) {
    window.clearTimeout(state.scheduleTimer);
  }
  if (state.scheduleInterval) {
    window.clearInterval(state.scheduleInterval);
  }
  state.scheduleTimer = null;
  state.scheduleInterval = null;
}

function updateScheduleCountdown() {
  if (!state.scheduleTarget) return;
  const remaining = Math.max(0, state.scheduleTarget.getTime() - Date.now());
  const trackName = state.tracks[state.currentIndex]?.title || "当前曲目";
  statusTitle.textContent = `将在 ${formatCountdown(remaining)} 后播放`;
  statusDetail.textContent = `${formatDateTime(state.scheduleTarget)} · ${trackName}`;
}

async function primePlayback() {
  if (!audio.src || !audio.paused) return;
  const current = audio.currentTime || 0;
  const muted = audio.muted;

  try {
    await prepareAudioGraph();
    audio.muted = true;
    await audio.play();
    audio.pause();
    audio.currentTime = current;
  } catch (error) {
    // Browser autoplay rules vary; the visible status handles the fallback.
  } finally {
    audio.muted = muted;
  }
}

function setScheduleMode(mode) {
  state.scheduleMode = mode;
  modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  modeBlocks.forEach((block) => block.classList.toggle("hidden", block.dataset.panel !== mode));
  if (mode !== "delay") {
    quickButtons.forEach((button) => button.classList.remove("active"));
  }
  saveSettings();
}

function setStatusWarning(title, detail) {
  scheduleStatus.classList.add("warning");
  scheduleStatus.classList.remove("active");
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function setStatusNeutral() {
  if (state.scheduleTarget) return;
  scheduleStatus.classList.remove("warning");
  statusTitle.textContent = "暂未设置";
  statusDetail.textContent = "创建后，这里会显示剩余时间。";
}

async function prepareAudioGraph() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  if (!state.audioContext) {
    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }

  if (!state.analyser) {
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
  }

  if (!state.sourceNode) {
    state.sourceNode = state.audioContext.createMediaElementSource(audio);
    state.sourceNode.connect(state.analyser);
    state.analyser.connect(state.audioContext.destination);
  }
}

function startVisualizer() {
  const buffer = new Uint8Array(128);
  let idlePhase = 0;

  const draw = () => {
    const width = visualizer.width;
    const height = visualizer.height;
    canvasContext.clearRect(0, 0, width, height);

    const gradient = canvasContext.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(255, 157, 122, 0.86)");
    gradient.addColorStop(0.48, "rgba(150, 135, 244, 0.8)");
    gradient.addColorStop(1, "rgba(217, 255, 99, 0.84)");

    if (state.analyser && !audio.paused) {
      state.analyser.getByteFrequencyData(buffer);
    } else {
      idlePhase += 0.025;
      for (let index = 0; index < buffer.length; index += 1) {
        buffer[index] = 26 + Math.sin(idlePhase + index * 0.23) * 16 + Math.cos(idlePhase * 0.7 + index * 0.11) * 12;
      }
    }

    drawBars(buffer, width, height, gradient);
    drawWave(buffer, width, height);
    state.visualAnimation = requestAnimationFrame(draw);
  };

  draw();
}

function drawBars(buffer, width, height, fillStyle) {
  const bars = 54;
  const gap = 6;
  const barWidth = (width - gap * (bars - 1)) / bars;
  const baseY = height - 28;

  canvasContext.save();
  canvasContext.globalAlpha = 0.7;
  canvasContext.fillStyle = fillStyle;

  for (let index = 0; index < bars; index += 1) {
    const value = buffer[Math.floor((index / bars) * buffer.length)] / 255;
    const barHeight = Math.max(12, value * height * 0.52);
    const x = index * (barWidth + gap);
    const y = baseY - barHeight;
    canvasContext.beginPath();
    canvasContext.roundRect(x, y, Math.max(3, barWidth), barHeight, 8);
    canvasContext.fill();
  }

  canvasContext.restore();
}

function drawWave(buffer, width, height) {
  canvasContext.save();
  canvasContext.globalAlpha = 0.38;
  canvasContext.lineWidth = 3;
  canvasContext.strokeStyle = "rgba(217, 255, 99, 0.52)";
  canvasContext.beginPath();

  for (let index = 0; index < buffer.length; index += 1) {
    const x = (index / (buffer.length - 1)) * width;
    const normalized = buffer[index] / 255;
    const y = height * 0.42 + Math.sin(index * 0.2) * 8 - normalized * 72;
    if (index === 0) {
      canvasContext.moveTo(x, y);
    } else {
      canvasContext.lineTo(x, y);
    }
  }

  canvasContext.stroke();
  canvasContext.restore();
}

function tickClock() {
  const now = new Date();
  clockText.textContent = now.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setDateTimeMinimum() {
  const now = new Date(Date.now() + 60 * 1000);
  exactTimeInput.min = toLocalInputValue(now);
  exactTimeInput.value = toLocalInputValue(new Date(Date.now() + 15 * 60 * 1000));
}

function cleanTitle(name) {
  return name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim() || "未命名音频";
}

function getInitial(title) {
  return (title.trim()[0] || "A").toUpperCase();
}

function formatFileSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatCountdown(milliseconds) {
  const total = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}小时 ${minutes}分 ${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分 ${seconds}秒`;
  }
  return `${seconds}秒`;
}

function formatDateTime(date) {
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalInputValue(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function createTrackId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `track-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateRangeProgress(element, ratio) {
  element.style.setProperty("--range-progress", `${clamp(Number(ratio) || 0, 0, 1) * 100}%`);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}
