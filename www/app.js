/* DashCam — single-file app logic (no framework needed for the WebView bundle)
   Keeps storage usage low via low-bitrate recording and loop-segment cleanup. */

'use strict'

// ---------------------------------------------------------------------------
// IndexedDB wrapper
// ---------------------------------------------------------------------------
const DB_NAME = 'dashcam-db'
const STORE = 'recordings'
let dbPromise = null
function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}
async function dbPut(rec) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(rec)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
async function dbGetAll() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}
async function dbDelete(id) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const SETTINGS_KEY = 'dashcam-settings'
const QUALITY_PROFILES = {
  low: { width: 640, height: 480, frameRate: 20, bitrate: 400000, label: 'Low · 480p · 400kbps' },
  medium: { width: 848, height: 480, frameRate: 24, bitrate: 800000, label: 'Medium · 480p wide · 800kbps' },
  high: { width: 1280, height: 720, frameRate: 30, bitrate: 1500000, label: 'High · 720p · 1.5Mbps' },
}
const DEFAULT_SETTINGS = {
  quality: 'low',
  segmentSeconds: 180,
  maxSegments: 8,
  audioEnabled: false,
  showGpsOverlay: true,
  showTimestampOverlay: true,
  facingMode: 'environment',
  mirrorFrontCamera: true,
}
function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID()
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
function formatDuration(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
function formatFileSize(b) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function formatDate(ts) {
  const d = new Date(ts)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function formatTime(ts) {
  const d = new Date(ts)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function pickMimeType() {
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=h264',
    'video/webm',
  ]
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t } catch {}
  }
  return ''
}
async function generateThumbnail(blob) {
  return new Promise(resolve => {
    try {
      const url = URL.createObjectURL(blob)
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'metadata'
      video.src = url
      video.onloadeddata = () => { try { video.currentTime = Math.min(1, (video.duration || 2) / 2) } catch {} }
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas')
          const w = 240
          const h = Math.round((video.videoHeight / video.videoWidth) * w) || 135
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) { URL.revokeObjectURL(url); return resolve(null) }
          ctx.drawImage(video, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', 0.6))
          URL.revokeObjectURL(url)
        } catch { URL.revokeObjectURL(url); resolve(null) }
      }
      video.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    } catch { resolve(null) }
  })
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let settings = loadSettings()
let cameraStatus = 'idle' // 'idle' | 'requesting' | 'live' | 'denied' | 'error'
let cameraError = null
let isRecording = false
let recDuration = 0
let totalRecDuration = 0
let hasSavedCurrentSegment = false
let recordings = []
let storage = { usage: 0, quota: 0 }
let selectedRec = null
let pendingDelete = null
let segmentStart = 0
let recordingStart = 0
let segmentTimer = null
let tickTimer = null
let autoStop = false
let latestGps = { lat: null, lng: null, speed: null }
let gpsWatchId = null
let videoUrl = null

let stream = null
let recorder = null
let chunks = []

// DOM
const $ = sel => document.querySelector(sel)
const videoEl = $('#video')
const recIndicator = $('#rec-indicator')
const qualityLabel = $('#quality-label')
const liveChip = $('#live-chip')
const batteryChip = $('#battery-chip')
const batteryText = $('#battery-text')
const gpsChip = $('#gps-chip')
const gpsReadout = $('#gps-readout')
const timeEl = $('#time')
const dateEl = $('#date')
const durationEl = $('#duration')
const durationLabel = $('#duration-label')
const fileCount = $('#file-count')
const storageBar = $('#storage-bar')
const storageText = $('#storage-text')
const recordBtn = document.querySelector('[data-action="record"]')
const recordCircle = $('#record-circle')
const recordInner = $('#record-inner')
const recordLabel = $('#record-label')
const emergencyBtn = document.querySelector('[data-action="emergency"]')
const cameraLabel = $('#camera-label')
const cameraIcon = $('#camera-icon')
const errorBanner = $('#error-banner')
const errorMsg = $('#error-msg')
const galleryModal = $('#gallery-modal')
const settingsModal = $('#settings-modal')
const galleryList = $('#gallery-list')
const galleryPreview = $('#gallery-preview')
const galleryCount = $('#gallery-count')

// ---------------------------------------------------------------------------
// Settings UI
// ---------------------------------------------------------------------------
function applySettingsToUI() {
  document.querySelectorAll('.radio-card').forEach(card => {
    const q = card.dataset.quality
    if (q === settings.quality) {
      card.classList.add('selected')
      card.querySelector('input').checked = true
    } else {
      card.classList.remove('selected')
      card.querySelector('input').checked = false
    }
  })
  $('#segment-slider').value = settings.segmentSeconds
  $('#segment-value').textContent = settings.segmentSeconds + 's'
  $('#maxseg-slider').value = settings.maxSegments
  $('#maxseg-value').textContent = settings.maxSegments
  $('#audio-toggle').checked = settings.audioEnabled
  $('#gps-toggle').checked = settings.showGpsOverlay
  $('#time-toggle').checked = settings.showTimestampOverlay
  $('#mirror-toggle').checked = settings.mirrorFrontCamera
  qualityLabel.textContent = QUALITY_PROFILES[settings.quality].label
  if (settings.showGpsOverlay) {
    gpsReadout.classList.remove('hidden')
  } else {
    gpsReadout.classList.add('hidden')
  }
  // mirror transform
  const isMirror = settings.mirrorFrontCamera && settings.facingMode === 'user'
  videoEl.style.transform = isMirror ? 'scaleX(-1)' : ''
}
document.querySelectorAll('.radio-card').forEach(card => {
  card.addEventListener('click', () => {
    settings.quality = card.dataset.quality
    saveSettings(settings)
    applySettingsToUI()
    if (cameraStatus === 'live') restartCameraAndRecorder()
  })
})
$('#segment-slider').addEventListener('input', e => {
  settings.segmentSeconds = parseInt(e.target.value)
  $('#segment-value').textContent = settings.segmentSeconds + 's'
  saveSettings(settings)
})
$('#maxseg-slider').addEventListener('input', e => {
  settings.maxSegments = parseInt(e.target.value)
  $('#maxseg-value').textContent = settings.maxSegments
  saveSettings(settings)
})
$('#audio-toggle').addEventListener('change', e => {
  settings.audioEnabled = e.target.checked
  saveSettings(settings)
  if (cameraStatus === 'live') restartCameraAndRecorder()
})
$('#gps-toggle').addEventListener('change', e => {
  settings.showGpsOverlay = e.target.checked
  saveSettings(settings)
  applySettingsToUI()
  if (settings.showGpsOverlay) { startGps() } else { stopGps() }
})
$('#time-toggle').addEventListener('change', e => {
  settings.showTimestampOverlay = e.target.checked
  saveSettings(settings)
  if (settings.showTimestampOverlay) {
    timeEl.style.display = ''; dateEl.style.display = ''
  } else {
    timeEl.style.display = 'none'; dateEl.style.display = 'none'
  }
})
$('#mirror-toggle').addEventListener('change', e => {
  settings.mirrorFrontCamera = e.target.checked
  saveSettings(settings)
  applySettingsToUI()
})

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop())
    stream = null
  }
  if (videoEl) videoEl.srcObject = null
}
async function startCamera() {
  if (cameraStatus === 'requesting') return
  setCameraStatus('requesting')
  cameraError = null
  hideError()
  try {
    stopCamera()
    const profile = QUALITY_PROFILES[settings.quality]
    const constraints = {
      audio: settings.audioEnabled,
      video: {
        width: { ideal: profile.width },
        height: { ideal: profile.height },
        frameRate: { ideal: profile.frameRate, max: profile.frameRate },
        facingMode: { ideal: settings.facingMode },
      },
    }
    stream = await navigator.mediaDevices.getUserMedia(constraints)
    videoEl.srcObject = stream
    videoEl.muted = !settings.audioEnabled
    await videoEl.play().catch(() => {})
    setCameraStatus('live')
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      setCameraStatus('denied')
      showError('Akses kamera ditolak. Izinkan kamera di pengaturan Android.')
    } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
      setCameraStatus('error')
      showError('Kamera tidak ditemukan atau konfigurasi tidak didukung.')
    } else {
      setCameraStatus('error')
      showError(e.message || 'Gagal mengakses kamera')
    }
  }
}
function setCameraStatus(status) {
  cameraStatus = status
  liveChip.classList.remove('chip-error', 'chip-green', 'chip-amber')
  if (status === 'live') {
    liveChip.classList.add('chip-green')
    liveChip.innerHTML = '<span class="chip-dot"></span>LIVE'
    cameraLabel.textContent = 'Kamera'
    cameraIcon.innerHTML = '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>'
    recordBtn.disabled = false
    emergencyBtn.disabled = !isRecording
  } else {
    liveChip.classList.add('chip-error')
    liveChip.textContent = status.toUpperCase()
    cameraLabel.textContent = 'Nyalakan'
    cameraIcon.innerHTML = '<path d="M21 6h-3.17L16 4h-6v2h5.12l1 1.83L17.83 9H21v10H5V9H3v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM9 14c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm0-4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>'
    recordBtn.disabled = status !== 'live'
    emergencyBtn.disabled = true
  }
}
function showError(msg) {
  cameraError = msg
  errorMsg.textContent = msg
  errorBanner.classList.remove('hidden')
}
function hideError() {
  errorBanner.classList.add('hidden')
}
async function restartCameraAndRecorder() {
  const wasRecording = isRecording
  if (wasRecording) stopRecorder()
  stopCamera()
  setCameraStatus('idle')
  await new Promise(r => setTimeout(r, 200))
  await startCamera()
  if (wasRecording) {
    setTimeout(() => startRecorder(), 400)
  }
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------
async function startRecorder() {
  if (!stream || recorder) return
  try {
    chunks = []
    const profile = QUALITY_PROFILES[settings.quality]
    const mimeType = pickMimeType()
    const options = {
      videoBitsPerSecond: profile.bitrate,
      audioBitsPerSecond: settings.audioEnabled ? 64000 : 0,
    }
    if (mimeType) options.mimeType = mimeType
    recorder = new MediaRecorder(stream, options)
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
      chunks = []
      const start = segmentStart
      const duration = (Date.now() - start) / 1000
      const wasAuto = autoStop
      if (blob.size < 5000 || (!wasAuto && duration < 1)) return
      const thumb = await generateThumbnail(blob)
      const rec = {
        id: uuid(),
        blob,
        thumbnail: thumb,
        size: blob.size,
        duration,
        createdAt: start,
        latitude: latestGps.lat,
        longitude: latestGps.lng,
        speed: latestGps.speed,
        saved: hasSavedCurrentSegment,
      }
      try {
        await dbPut(rec)
        await enforceMaxSegments()
        await refreshRecordings()
        await refreshStorage()
      } catch (e) { console.error('Gagal simpan', e) }
    }
    recorder.start(1000)
    segmentStart = Date.now()
    if (recordingStart === 0) recordingStart = Date.now()
    isRecording = true
    recDuration = 0
    hasSavedCurrentSegment = false
    updateRecordButton()
    recIndicator.classList.remove('hidden')
    emergencyBtn.disabled = false

    segmentTimer = setInterval(() => {
      if (!recorder) return
      autoStop = true
      try { recorder.stop() } catch {}
      recorder = null
      if (segmentTimer) { clearInterval(segmentTimer); segmentTimer = null }
      setTimeout(() => {
        autoStop = false
        if (stream && cameraStatus === 'live') startRecorder()
      }, 300)
    }, settings.segmentSeconds * 1000)
  } catch (e) {
    showError('Gagal memulai rekaman: ' + e.message)
  }
}
function stopRecorder() {
  if (segmentTimer) { clearInterval(segmentTimer); segmentTimer = null }
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop() } catch {}
  }
  recorder = null
  isRecording = false
  recordingStart = 0
  recDuration = 0
  totalRecDuration = 0
  updateRecordButton()
  recIndicator.classList.add('hidden')
  emergencyBtn.disabled = true
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
}
function updateRecordButton() {
  if (isRecording) {
    recordBtn.classList.add('recording')
    recordInner.style.height = '20px'
    recordInner.style.width = '20px'
    recordInner.style.borderRadius = '4px'
    recordLabel.textContent = 'STOP'
  } else {
    recordBtn.classList.remove('recording')
    recordInner.style.height = '32px'
    recordInner.style.width = '32px'
    recordInner.style.borderRadius = '50%'
    recordLabel.textContent = 'REC'
  }
}

// Duration tick
setInterval(() => {
  if (isRecording) {
    recDuration = (Date.now() - segmentStart) / 1000
    if (recordingStart > 0) totalRecDuration = (Date.now() - recordingStart) / 1000
    durationEl.textContent = formatDuration(totalRecDuration || recDuration)
    durationLabel.textContent = `MEREKAM · segmen ${formatDuration(recDuration)}`
  } else {
    durationEl.textContent = formatDuration(0)
    durationLabel.textContent = 'STANDBY'
  }
}, 250)

// ---------------------------------------------------------------------------
// Loop recording enforcement
// ---------------------------------------------------------------------------
async function enforceMaxSegments() {
  const list = await dbGetAll()
  const unsaved = list.filter(r => !r.saved).sort((a, b) => a.createdAt - b.createdAt)
  const overflow = unsaved.slice(0, Math.max(0, unsaved.length - settings.maxSegments))
  for (const rec of overflow) await dbDelete(rec.id)
  if (overflow.length > 0) {
    await refreshRecordings()
    await refreshStorage()
  }
}

// ---------------------------------------------------------------------------
// Recordings list & gallery
// ---------------------------------------------------------------------------
async function refreshRecordings() {
  const list = await dbGetAll()
  list.sort((a, b) => b.createdAt - a.createdAt)
  recordings = list
  renderGallery()
  updateGalleryBadge()
}
function updateGalleryBadge() {
  let badge = document.querySelector('.gallery-badge')
  if (recordings.length === 0) {
    if (badge) badge.remove()
    return
  }
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'gallery-badge'
    document.querySelector('[data-action="gallery"] .control-icon').appendChild(badge)
  }
  badge.textContent = recordings.length > 99 ? '99+' : recordings.length
}
function renderGallery() {
  galleryCount.textContent = recordings.length
  if (recordings.length === 0) {
    galleryList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        <p>Belum ada rekaman. Mulai merekam dengan menekan tombol merah.</p>
      </div>`
    galleryPreview.innerHTML = '<div class="empty-state"><p>Pilih rekaman untuk pratinjau.</p></div>'
    return
  }
  galleryList.innerHTML = recordings.map(r => `
    <div class="gallery-item ${selectedRec && selectedRec.id === r.id ? 'selected' : ''}" data-id="${r.id}">
      ${r.thumbnail ? `<img class="gallery-thumb" src="${r.thumbnail}" alt="thumb" />` : `<div class="gallery-thumb" style="display:flex;align-items:center;justify-content:center;font-size:9px;color:rgba(255,255,255,0.3)">no preview</div>`}
      <div class="gallery-meta">
        <div class="gallery-date">${formatDate(r.createdAt)} ${r.saved ? '<span class="saved-star">★</span>' : ''}</div>
        <div class="gallery-info">
          <span>⏱ ${formatDuration(r.duration)}</span>
          <span>${formatFileSize(r.size)}</span>
          ${r.latitude != null ? `<span>📍 ${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}</span>` : ''}
          ${r.speed != null ? `<span>🚗 ${Math.round(r.speed * 3.6)} km/h</span>` : ''}
        </div>
      </div>
    </div>
  `).join('')
  galleryList.querySelectorAll('.gallery-item').forEach(el => {
    el.addEventListener('click', () => {
      const rec = recordings.find(r => r.id === el.dataset.id)
      selectRecording(rec)
    })
  })
}
function selectRecording(rec) {
  selectedRec = rec
  renderGallery()
  if (videoUrl) URL.revokeObjectURL(videoUrl)
  videoUrl = URL.createObjectURL(rec.blob)
  galleryPreview.innerHTML = `
    <video src="${videoUrl}" controls playsinline></video>
    <div class="preview-info">
      <div class="preview-info-item"><div class="label">Dibuat</div><div class="value">${formatDate(rec.createdAt)}</div></div>
      <div class="preview-info-item"><div class="label">Durasi</div><div class="value">${formatDuration(rec.duration)}</div></div>
      <div class="preview-info-item"><div class="label">Ukuran</div><div class="value">${formatFileSize(rec.size)}</div></div>
      <div class="preview-info-item"><div class="label">Status</div><div class="value">${rec.saved ? 'Disimpan (aman)' : 'Loop (akan ditimpa)'}</div></div>
      ${rec.latitude != null ? `<div class="preview-info-item"><div class="label">Latitude</div><div class="value">${rec.latitude.toFixed(5)}</div></div>` : ''}
      ${rec.longitude != null ? `<div class="preview-info-item"><div class="label">Longitude</div><div class="value">${rec.longitude.toFixed(5)}</div></div>` : ''}
      ${rec.speed != null ? `<div class="preview-info-item"><div class="label">Kecepatan</div><div class="value">${Math.round(rec.speed * 3.6)} km/h</div></div>` : ''}
    </div>
    <div class="preview-actions">
      <button class="btn-primary" data-action="download">Unduh</button>
      <button class="btn-secondary" data-action="save">${rec.saved ? 'Batal simpan' : 'Tandai tersimpan'}</button>
      <button class="btn-danger" data-action="delete">Hapus</button>
    </div>
  `
  galleryPreview.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action
      if (action === 'download') downloadRec(selectedRec)
      else if (action === 'save') toggleSave(selectedRec)
      else if (action === 'delete') deleteRec(selectedRec)
    })
  })
}
async function downloadRec(rec) {
  const url = URL.createObjectURL(rec.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `dashcam_${new Date(rec.createdAt).toISOString().replace(/[:.]/g, '-')}.webm`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function toggleSave(rec) {
  rec.saved = !rec.saved
  await dbPut(rec)
  await refreshRecordings()
  selectRecording(rec)
}
async function deleteRec(rec) {
  if (!confirm('Hapus rekaman ini permanen?')) return
  await dbDelete(rec.id)
  selectedRec = null
  if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null }
  await refreshRecordings()
  galleryPreview.innerHTML = '<div class="empty-state"><p>Pilih rekaman untuk pratinjau.</p></div>'
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
async function refreshStorage() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate()
      storage = { usage: est.usage || 0, quota: est.quota || 0 }
    } catch {}
  }
  const pct = storage.quota ? Math.min(100, Math.round(storage.usage / storage.quota * 100)) : 0
  storageBar.style.width = pct + '%'
  storageText.textContent = formatFileSize(storage.usage) + (storage.quota ? ` / ${formatFileSize(storage.quota)}` : '')
  fileCount.textContent = `${recordings.length} file`
}

// ---------------------------------------------------------------------------
// GPS
// ---------------------------------------------------------------------------
function startGps() {
  if (!('geolocation' in navigator)) return
  if (gpsWatchId !== null) return
  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      latestGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed }
      gpsChip.classList.remove('chip-amber')
      gpsChip.classList.add('chip-green')
      gpsChip.innerHTML = '<span class="chip-dot"></span>GPS'
      if (settings.showGpsOverlay) renderGps()
    },
    err => {
      gpsChip.classList.remove('chip-green')
      gpsChip.classList.add('chip-amber')
      gpsChip.innerHTML = 'NO GPS'
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  )
}
function stopGps() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId)
    gpsWatchId = null
  }
}
function renderGps() {
  if (!settings.showGpsOverlay) {
    gpsReadout.classList.add('hidden')
    return
  }
  gpsReadout.classList.remove('hidden')
  let html = ''
  if (latestGps.lat != null) html += `<div class="gps-block">LAT<br/>${latestGps.lat.toFixed(5)}</div>`
  if (latestGps.lng != null) html += `<div class="gps-block">LON<br/>${latestGps.lng.toFixed(5)}</div>`
  if (latestGps.speed != null) html += `<div class="gps-block gps-block-speed">SPD<br/>${Math.round(latestGps.speed * 3.6)} km/h</div>`
  gpsReadout.innerHTML = html
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------
async function initBattery() {
  if (!navigator.getBattery) return
  try {
    const bat = await navigator.getBattery()
    const update = () => {
      batteryChip.classList.remove('hidden')
      batteryText.textContent = bat.charging ? 'Charging' : `${Math.round(bat.level * 100)}%`
    }
    update()
    bat.addEventListener('levelchange', update)
    bat.addEventListener('chargingchange', update)
  } catch {}
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now()
  if (settings.showTimestampOverlay) {
    timeEl.textContent = formatTime(now)
    dateEl.textContent = formatDate(now).slice(0, 10)
  }
}, 1000)

// ---------------------------------------------------------------------------
// Control bar dispatch
// ---------------------------------------------------------------------------
document.querySelectorAll('#control-bar .control-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action
    if (action === 'gallery') openGallery()
    else if (action === 'camera') {
      if (cameraStatus === 'live') {
        if (isRecording) stopRecorder()
        stopCamera()
        setCameraStatus('idle')
      } else startCamera()
    }
    else if (action === 'record') {
      if (isRecording) stopRecorder()
      else {
        if (cameraStatus !== 'live') startCamera()
        startRecorder()
      }
    }
    else if (action === 'emergency') emergencySave()
    else if (action === 'switch') switchCamera()
    else if (action === 'settings') openSettings()
  })
})
document.querySelectorAll('[data-action]').forEach(el => {
  if (el.id === 'control-bar' || el.closest('#control-bar')) return
  el.addEventListener('click', () => {
    const action = el.dataset.action
    if (action === 'retry') startCamera()
    else if (action === 'close-gallery') closeGallery()
    else if (action === 'close-settings') closeSettings()
  })
})

function emergencySave() {
  hasSavedCurrentSegment = true
  if (isRecording && recorder && recorder.state !== 'inactive') {
    autoStop = true
    try { recorder.stop() } catch {}
    recorder = null
    if (segmentTimer) { clearInterval(segmentTimer); segmentTimer = null }
    setTimeout(() => {
      autoStop = false
      hasSavedCurrentSegment = false
      if (stream && cameraStatus === 'live') startRecorder()
    }, 400)
  }
}
function switchCamera() {
  settings.facingMode = settings.facingMode === 'environment' ? 'user' : 'environment'
  saveSettings(settings)
  applySettingsToUI()
  restartCameraAndRecorder()
}

function openGallery() {
  galleryModal.classList.remove('hidden')
  refreshRecordings()
}
function closeGallery() {
  galleryModal.classList.add('hidden')
  if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null }
  selectedRec = null
}
function openSettings() {
  settingsModal.classList.remove('hidden')
  applySettingsToUI()
}
function closeSettings() {
  settingsModal.classList.add('hidden')
}

// Click outside modal to close
galleryModal.addEventListener('click', e => { if (e.target === galleryModal) closeGallery() })
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings() })

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
applySettingsToUI()
initBattery()
if (settings.showGpsOverlay) startGps()
refreshRecordings()
refreshStorage()
startCamera()
