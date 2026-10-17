/*
 * media-fix.js
 * MediaRecorder menghasilkan WebM "live": tanpa Duration dan tanpa Cues (indeks seek).
 * Akibatnya galeri HP menampilkan durasi 0 detik, dan pemutar tidak bisa menggeser (seek).
 * Skrip ini menambahkan Duration + Cues ke WebM tanpa mengubah data video/audio
 * (cluster disalin apa adanya lewat Blob.slice).
 */
(function (root) {
  'use strict'

  var MAX_BYTES = 96 * 1024 * 1024 // di atas ini dilewati (hemat memori)

  var ID = {
    EBML: 0x1A45DFA3, SEGMENT: 0x18538067, SEEKHEAD: 0x114D9B74, INFO: 0x1549A966,
    TRACKS: 0x1654AE6B, CLUSTER: 0x1F43B675, CUES: 0x1C53BB6B, TAGS: 0x1254C367,
    CHAPTERS: 0x1043A770, ATTACHMENTS: 0x1941A469, VOID: 0xEC, CRC32: 0xBF,
    TIMECODE_SCALE: 0x2AD7B1, DURATION: 0x4489, CLUSTER_TIMECODE: 0xE7,
    SIMPLEBLOCK: 0xA3, BLOCKGROUP: 0xA0, BLOCK: 0xA1,
    TRACKENTRY: 0xAE, TRACKNUMBER: 0xD7, TRACKTYPE: 0x83,
    CUEPOINT: 0xBB, CUETIME: 0xB3, CUETRACKPOS: 0xB7, CUETRACK: 0xF7, CUECLUSTERPOS: 0xF1,
  }
  var LEVEL1 = {}
  ;[ID.SEEKHEAD, ID.INFO, ID.TRACKS, ID.CLUSTER, ID.CUES, ID.TAGS, ID.CHAPTERS, ID.ATTACHMENTS]
    .forEach(function (k) { LEVEL1[k] = true })

  // ---------- baca EBML ----------
  function vintLen(b) {
    var len = 1, mask = 0x80
    while (!(b & mask)) { len++; mask >>= 1; if (mask === 0) return 0 }
    return len
  }
  function readId(u8, p) {
    if (p >= u8.length) return null
    var len = vintLen(u8[p])
    if (!len || len > 4 || p + len > u8.length) return null
    var id = 0
    for (var i = 0; i < len; i++) id = id * 256 + u8[p + i]
    return { v: id, len: len }
  }
  function readSize(u8, p) {
    if (p >= u8.length) return null
    var len = vintLen(u8[p])
    if (!len || len > 8 || p + len > u8.length) return null
    var mask = 0x80 >> (len - 1)
    var val = u8[p] & (mask - 1)
    var ones = val === mask - 1
    for (var i = 1; i < len; i++) {
      var x = u8[p + i]
      val = val * 256 + x
      if (x !== 0xFF) ones = false
    }
    return { v: ones ? -1 : val, len: len }
  }
  function readHeader(u8, p) {
    var a = readId(u8, p)
    if (!a) return null
    var s = readSize(u8, p + a.len)
    if (!s) return null
    return { id: a.v, idLen: a.len, size: s.v, sizeLen: s.len, start: p, dataStart: p + a.len + s.len }
  }
  function readUint(u8, p, n) {
    var v = 0
    for (var i = 0; i < n; i++) v = v * 256 + u8[p + i]
    return v
  }

  // ---------- tulis EBML ----------
  function encId(id) {
    var out = []
    while (id > 0) { out.unshift(id % 256); id = Math.floor(id / 256) }
    return out
  }
  function encFixed(n, len) { // uint big-endian panjang tetap
    var out = new Array(len)
    for (var i = len - 1; i >= 0; i--) { out[i] = n % 256; n = Math.floor(n / 256) }
    return out
  }
  function encSize(n, len) { // vint panjang tetap
    var out = encFixed(n, len)
    out[0] |= 0x80 >> (len - 1)
    return out
  }
  function f64(v) {
    var b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v)
    return Array.prototype.slice.call(b)
  }
  function concat(chunks) {
    var total = 0, i
    for (i = 0; i < chunks.length; i++) total += chunks[i].length
    var out = new Uint8Array(total), o = 0
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length }
    return out
  }
  function element(id, payload, sizeLen) {
    return concat([Uint8Array.from(encId(id)), Uint8Array.from(encSize(payload.length, sizeLen)), payload])
  }

  // ---------- parse cluster ----------
  function parseCluster(u8, h, limit, videoTrack) {
    var known = h.size >= 0
    var end = known ? Math.min(h.dataStart + h.size, limit) : limit
    var p = h.dataStart, tc = 0
    var blocks = []
    function addBlock(dataStart) {
      var t = readSize(u8, dataStart)
      if (!t || dataStart + t.len + 3 > u8.length) return null
      var rel = ((u8[dataStart + t.len] << 8) | u8[dataStart + t.len + 1]) << 16 >> 16
      var flags = u8[dataStart + t.len + 2]
      return { track: t.v, rel: rel, key: !!(flags & 0x80) }
    }
    while (p < end) {
      var c = readHeader(u8, p)
      if (!c) break
      if (!known && LEVEL1[c.id]) { end = p; break }
      if (c.size < 0) break
      var cEnd = c.dataStart + c.size
      if (cEnd > limit) { p = limit; break }
      if (c.id === ID.CLUSTER_TIMECODE) {
        tc = readUint(u8, c.dataStart, c.size)
      } else if (c.id === ID.SIMPLEBLOCK) {
        var b = addBlock(c.dataStart)
        if (b) blocks.push(b)
      } else if (c.id === ID.BLOCKGROUP) {
        var q = c.dataStart
        while (q < cEnd) {
          var g = readHeader(u8, q)
          if (!g || g.size < 0) break
          if (g.id === ID.BLOCK) {
            var gb = addBlock(g.dataStart)
            if (gb) { gb.key = false; blocks.push(gb) }
          }
          q = g.dataStart + g.size
        }
      }
      p = cEnd
    }
    if (!known) end = Math.min(p, limit)
    return { end: end, timecode: tc, blocks: blocks }
  }

  // ---------- fungsi utama ----------
  /**
   * @param {Blob} blob   hasil MediaRecorder (webm)
   * @param {number} hintMs durasi perkiraan (ms) bila data tidak memuat blok
   * @returns {Promise<{blob:Blob, fixed:boolean, durationMs:number, reason:string}>}
   */
  async function fixWebm(blob, hintMs) {
    var result = { blob: blob, fixed: false, durationMs: hintMs || 0, reason: '' }
    try {
      if (!blob || blob.size < 64) { result.reason = 'kosong'; return result }
      if (blob.size > MAX_BYTES) { result.reason = 'terlalu besar'; return result }
      var u8 = new Uint8Array(await blob.arrayBuffer())

      var eh = readHeader(u8, 0)
      if (!eh || eh.id !== ID.EBML || eh.size < 0) { result.reason = 'bukan webm'; return result }
      var seg = readHeader(u8, eh.dataStart + eh.size)
      if (!seg || seg.id !== ID.SEGMENT) { result.reason = 'segment tidak ditemukan'; return result }
      var segEnd = seg.size < 0 ? u8.length : Math.min(u8.length, seg.dataStart + seg.size)

      // 1) pindai elemen level-1
      var pre = [], clusters = [], hasCues = false
      var q = seg.dataStart
      while (q < segEnd) {
        var h = readHeader(u8, q)
        if (!h) break
        if (h.id === ID.CLUSTER) {
          var c = parseCluster(u8, h, segEnd)
          clusters.push({ start: q, end: c.end, timecode: c.timecode, blocks: c.blocks })
          q = c.end
          continue
        }
        if (h.size < 0) break
        var end = h.dataStart + h.size
        if (end > segEnd) break
        if (h.id === ID.CUES) hasCues = true
        if (!clusters.length) pre.push({ id: h.id, start: q, end: end, h: h })
        q = end
      }
      if (!clusters.length) { result.reason = 'tidak ada cluster'; return result }
      var info = null, tracks = null, i, j
      for (i = 0; i < pre.length; i++) {
        if (pre[i].id === ID.INFO) info = pre[i]
        if (pre[i].id === ID.TRACKS) tracks = pre[i]
      }
      if (!info || !tracks) { result.reason = 'struktur tidak dikenal'; return result }

      // 2) Info: timecode scale + ada/tidaknya Duration
      var scale = 1000000, hasDuration = false, infoKeep = []
      for (q = info.h.dataStart; q < info.end;) {
        var ih = readHeader(u8, q)
        if (!ih || ih.size < 0) break
        var ie = ih.dataStart + ih.size
        if (ih.id === ID.TIMECODE_SCALE) scale = readUint(u8, ih.dataStart, ih.size) || scale
        if (ih.id === ID.DURATION) hasDuration = true
        else infoKeep.push(u8.subarray(q, ie))
        q = ie
      }
      if (hasDuration && hasCues) { result.reason = 'sudah lengkap'; return result }
      if (hasCues) { result.reason = 'Cues sudah ada'; return result } // posisi lama akan salah bila digeser

      // 3) nomor track video
      var videoTrack = 1
      for (q = tracks.h.dataStart; q < tracks.end;) {
        var th = readHeader(u8, q)
        if (!th || th.size < 0) break
        var te = th.dataStart + th.size
        if (th.id === ID.TRACKENTRY) {
          var num = 0, type = 0
          for (var r = th.dataStart; r < te;) {
            var eh2 = readHeader(u8, r)
            if (!eh2 || eh2.size < 0) break
            if (eh2.id === ID.TRACKNUMBER) num = readUint(u8, eh2.dataStart, eh2.size)
            if (eh2.id === ID.TRACKTYPE) type = readUint(u8, eh2.dataStart, eh2.size)
            r = eh2.dataStart + eh2.size
          }
          if (type === 1 && num) { videoTrack = num; break }
        }
        q = te
      }

      // 4) durasi + titik Cues
      var maxAll = 0, vMin = Infinity, vMax = 0, vCount = 0
      var cueKeys = [], cueFirst = [] // keyframe video / blok video pertama tiap cluster
      for (i = 0; i < clusters.length; i++) {
        var cl = clusters[i], seenFirst = false
        for (j = 0; j < cl.blocks.length; j++) {
          var bl = cl.blocks[j]
          var t = cl.timecode + bl.rel
          if (t > maxAll) maxAll = t
          if (bl.track === videoTrack) {
            vCount++
            if (t < vMin) vMin = t
            if (t > vMax) vMax = t
            if (bl.key) cueKeys.push({ t: Math.max(0, t), cluster: i })
            if (!seenFirst) { cueFirst.push({ t: Math.max(0, t), cluster: i }); seenFirst = true }
          }
        }
      }
      // Cues hanya di keyframe (agar seek tidak mendarat di frame yang tak bisa didekode);
      // jika penanda keyframe tidak ada, pakai awal cluster. Jarak antar titik >= 1 detik.
      var minGap = Math.round(1000 * 1000000 / scale), cueCandidates = []
      var cueSrc = cueKeys.length ? cueKeys : cueFirst
      for (i = 0; i < cueSrc.length; i++) {
        if (!cueCandidates.length || cueSrc[i].t - cueCandidates[cueCandidates.length - 1].t >= minGap) cueCandidates.push(cueSrc[i])
      }
      var durationTc
      if (vCount > 1) {
        durationTc = Math.max(maxAll, vMax + (vMax - vMin) / (vCount - 1))
      } else if (vCount === 1 || maxAll > 0) {
        durationTc = maxAll + Math.round(66 * 1000000 / scale)
      } else {
        durationTc = (hintMs || 0) * 1000000 / scale
      }
      var durationMs = durationTc * scale / 1000000
      if (!(durationMs > 0)) { result.reason = 'durasi tidak diketahui'; return result }
      if (!cueCandidates.length) cueCandidates.push({ t: 0, cluster: 0 })
      var withCues = videoTrack < 256

      // 5) susun ulang header
      var newInfo = element(ID.INFO, concat(infoKeep.concat([Uint8Array.from(encId(ID.DURATION).concat([0x88], f64(durationTc)))])), 4)
      var keptPre = [], removedBytes = 0, dropIds = {}
      dropIds[ID.SEEKHEAD] = dropIds[ID.CUES] = dropIds[ID.VOID] = dropIds[ID.CRC32] = true
      var preLen = 0
      for (i = 0; i < pre.length; i++) {
        var pe = pre[i], oldLen = pe.end - pe.start
        if (pe.id === ID.INFO) { keptPre.push(newInfo); preLen += newInfo.length; removedBytes += oldLen }
        else if (dropIds[pe.id]) { removedBytes += oldLen }
        else { keptPre.push(u8.subarray(pe.start, pe.end)); preLen += oldLen }
      }
      var cuesLen = withCues ? 8 + 23 * cueCandidates.length : 0
      var firstClusterStart = clusters[0].start
      var cuesBytes = new Uint8Array(0)
      if (withCues) {
        var pts = []
        for (i = 0; i < cueCandidates.length; i++) {
          var cc = cueCandidates[i]
          var pos = preLen + cuesLen + (clusters[cc.cluster].start - firstClusterStart)
          var trackPos = Uint8Array.from([].concat(
            encId(ID.CUETRACK), [0x81, videoTrack],
            encId(ID.CUECLUSTERPOS), [0x88], encFixed(pos, 8)))
          var point = Uint8Array.from([].concat(
            encId(ID.CUETIME), [0x84], encFixed(Math.min(cc.t, 0xFFFFFFFF), 4),
            encId(ID.CUETRACKPOS), [0x8D], Array.prototype.slice.call(trackPos)))
          pts.push(element(ID.CUEPOINT, point, 1))
        }
        cuesBytes = element(ID.CUES, concat(pts), 4)
      }

      // header EBML + Segment
      var head = u8.slice(0, seg.dataStart)
      if (seg.size >= 0) {
        var contentLen = (u8.length - seg.dataStart) - removedBytes + newInfo.length + cuesBytes.length
        var sz = encSize(contentLen, seg.sizeLen)
        for (i = 0; i < sz.length; i++) head[seg.start + seg.idLen + i] = sz[i]
      }

      var parts = [head].concat(keptPre, [cuesBytes, blob.slice(firstClusterStart)])
      result.blob = new Blob(parts, { type: blob.type || 'video/webm' })
      result.fixed = true
      result.durationMs = durationMs
      result.reason = 'ok'
      return result
    } catch (e) {
      result.reason = 'error: ' + (e && e.message || e)
      return result
    }
  }

  var api = { fixWebm: fixWebm }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  root.MediaFix = api
})(typeof window !== 'undefined' ? window : globalThis)
