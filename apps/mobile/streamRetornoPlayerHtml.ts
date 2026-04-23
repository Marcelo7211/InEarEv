/**
 * Retorno de palco no WebView: WebSocket INE1 + Web Audio.
 * Usa fila assíncrona, jitter buffer adaptativo, medidor master profissional
 * e visualização espectral sem depender de APIs nativas fora do Expo/WebView.
 */
export type StreamRetornoLatency = 'pro' | 'low' | 'stable' | 'wifi24'

export type StreamRetornoTelemetryOpts = {
  /** Ex.: http://192.168.0.5:3847 — sem barra final */
  apiBase: string
  token: string
}

export function buildStreamRetornoPlayerHtml(
  wsUrl: string,
  latency: StreamRetornoLatency = 'low',
  telemetry?: StreamRetornoTelemetryOpts | null,
): string {
  const injectedWs = JSON.stringify(wsUrl)
  const injectedLatency = JSON.stringify(latency)
  const injectedTelemetry = JSON.stringify(telemetry ?? null)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{
    --bg:#05070b;
    --panel:#10141c;
    --panel-2:#171d28;
    --line:#293244;
    --txt:#e6edf3;
    --muted:#95a1b5;
    --accent:#58a6ff;
    --green:#2ea043;
    --amber:#d29922;
    --red:#f85149;
  }
  html,body{
    height:100%;
    overflow-y:auto;
    -webkit-overflow-scrolling:touch;
    overscroll-behavior-y:contain;
    touch-action:pan-y;
  }
  *{box-sizing:border-box}
  body{
    margin:0;
    background:
      radial-gradient(circle at top left, rgba(88,166,255,.12), transparent 28%),
      radial-gradient(circle at top right, rgba(248,81,73,.08), transparent 24%),
      linear-gradient(180deg,#06080d 0%,#0b1118 100%);
    color:var(--txt);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    padding:14px 14px 28px;
  }
  .console{
    border:1px solid #202938;
    border-radius:20px;
    padding:14px;
    min-height:max-content;
    background:linear-gradient(180deg,#121722 0%,#0d121a 100%);
    box-shadow:0 14px 34px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.04);
  }
  .topline{
    display:flex;
    justify-content:space-between;
    gap:10px;
    align-items:center;
    margin-bottom:12px;
  }
  .brand{
    font-size:11px;
    letter-spacing:.18em;
    text-transform:uppercase;
    color:#7d8590;
  }
  .badge{
    display:inline-flex;
    align-items:center;
    gap:6px;
    padding:6px 10px;
    border-radius:999px;
    border:1px solid #28405f;
    background:#0d1b33;
    color:#79c0ff;
    font-size:11px;
    font-weight:700;
  }
  .transport{
    display:grid;
    grid-template-columns:1.2fr .8fr;
    gap:12px;
    margin-bottom:12px;
  }
  .transport .stack,.panel{
    border:1px solid var(--line);
    border-radius:16px;
    padding:12px;
    background:linear-gradient(180deg,var(--panel-2) 0%,var(--panel) 100%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
  }
  #go{
    display:block;
    width:100%;
    border:none;
    border-radius:14px;
    padding:18px 16px;
    font-size:17px;
    font-weight:800;
    color:#fff;
    background:linear-gradient(180deg,#31b35b 0%,#238636 100%);
    box-shadow:0 8px 18px rgba(35,134,54,.35), inset 0 1px 0 rgba(255,255,255,.18);
  }
  .muted{color:var(--muted)}
  .small{font-size:11px;line-height:1.45}
  .row{
    display:flex;
    gap:10px;
    flex-wrap:wrap;
    align-items:center;
  }
  .rack{
    display:grid;
    grid-template-columns:1fr 1fr 1fr;
    gap:10px;
  }
  .knob{
    border:1px solid #2a3445;
    border-radius:14px;
    padding:10px;
    background:linear-gradient(180deg,#1b2230 0%,#111723 100%);
  }
  .knob label{
    display:block;
    font-size:11px;
    font-weight:700;
    color:#c9d1d9;
    margin-bottom:8px;
    letter-spacing:.04em;
    text-transform:uppercase;
  }
  input[type=range]{
    width:100%;
    accent-color:#58a6ff;
  }
  select{
    width:100%;
    border-radius:10px;
    border:1px solid #31405a;
    background:#0d1420;
    color:#e6edf3;
    padding:8px 10px;
  }
  .meter-grid{
    display:grid;
    grid-template-columns:minmax(210px,260px) 1fr;
    gap:12px;
    margin-bottom:12px;
  }
  .meter-head{
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:8px;
  }
  .section-title{
    font-size:12px;
    letter-spacing:.12em;
    text-transform:uppercase;
    color:#9fb4d1;
    font-weight:800;
  }
  .meter-wrap,.scope-wrap{
    border:1px solid var(--line);
    border-radius:16px;
    padding:12px;
    background:linear-gradient(180deg,#141a25 0%,#0c1017 100%);
  }
  canvas{
    display:block;
    width:100%;
    border-radius:12px;
    background:linear-gradient(180deg,#040608 0%,#0a0e14 100%);
    border:1px solid #1d2533;
  }
  #masterMeter{height:260px}
  #spectrum{height:150px}
  #stats{
    margin-top:10px;
    font-size:11px;
    color:#98a6bc;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    line-height:1.5;
  }
  @media (max-width: 760px){
    .transport,.meter-grid,.rack{grid-template-columns:1fr}
  }
</style>
</head>
<body>
<div class="console">
  <div class="topline">
    <div class="brand">inEar Monitor Console</div>
    <div class="badge">Master Monitor Bus</div>
  </div>
  <div class="transport">
    <div class="stack">
      <button id="go" type="button">Iniciar retorno</button>
      <p id="st" class="small" style="margin:10px 0 0">Toque uma vez para ativar o áudio no iOS/Android.</p>
      <p id="m" class="small muted" style="margin:8px 0 0"></p>
      <div id="latencyBar" class="small muted" style="margin-top:8px"></div>
    </div>
    <div class="panel">
      <div class="section-title" style="margin-bottom:8px">FX Rack</div>
      <div class="rack">
        <div class="knob">
          <label for="holdSel">Peak Hold</label>
          <select id="holdSel">
            <option value="300">300 ms</option>
            <option value="700" selected>700 ms</option>
            <option value="1200">1200 ms</option>
            <option value="2000">2000 ms</option>
          </select>
        </div>
        <div class="knob">
          <label for="hpf">HPF</label>
          <input id="hpf" type="range" min="20" max="180" step="1" value="42" />
          <div id="hpfVal" class="small muted">42 Hz</div>
        </div>
        <div class="knob">
          <label for="lpf">LPF</label>
          <input id="lpf" type="range" min="8000" max="18000" step="50" value="12800" />
          <div id="lpfVal" class="small muted">12.8 kHz</div>
        </div>
      </div>
      <div class="row small muted" style="margin-top:10px">
        <span id="limiterState">Limiter: ON</span>
        <span id="helloMeta">Buffer do servidor: --</span>
      </div>
    </div>
  </div>
  <div class="meter-grid">
    <div class="meter-wrap">
      <div class="meter-head">
        <div class="section-title">Master VU</div>
        <div class="small muted">LEDs, dB e peak hold</div>
      </div>
      <canvas id="masterMeter" width="250" height="260"></canvas>
    </div>
    <div class="scope-wrap">
      <div class="meter-head">
        <div class="section-title">Spectrum</div>
        <div class="small muted">Pos-EQ / Pos-limiter</div>
      </div>
      <canvas id="spectrum" width="640" height="150"></canvas>
      <div id="stats"></div>
    </div>
  </div>
</div>
<script>
(function () {
  var WS_URL = ${injectedWs};
  var LATENCY = ${injectedLatency};
  var SR_IN = 48000;
  var PROFILE =
    LATENCY === 'pro'
      ? {
          name: '5-pro',
          transport: 'pro',
          margin: 0.012,
          maxAhead: 0.04,
          maxRawFrames: 5,
          latencyHint: 0.012,
          adaptiveMax: 0.024,
          dropGrow: 0.00125,
          underrunGrow: 0.002,
          lowpassHz: 18200,
          highpassHz: 34,
          burstFast: 5,
          burstSafe: 3,
          telemetryMs: 1000
        }
      : LATENCY === 'wifi24'
      ? {
          name: '2.4',
          transport: 'wifi24',
          margin: 0.052,
          maxAhead: 0.16,
          maxRawFrames: 18,
          latencyHint: 0.04,
          adaptiveMax: 0.12,
          dropGrow: 0.004,
          underrunGrow: 0.006,
          lowpassHz: 14800,
          highpassHz: 40,
          burstFast: 4,
          burstSafe: 2,
          telemetryMs: 1500
        }
      : LATENCY === 'stable'
        ? {
            name: 'stable',
            transport: 'stable',
            margin: 0.036,
            maxAhead: 0.11,
            maxRawFrames: 14,
            latencyHint: 0.035,
            adaptiveMax: 0.05,
            dropGrow: 0.002,
            underrunGrow: 0.004,
            lowpassHz: 15000,
            highpassHz: 40,
            burstFast: 4,
            burstSafe: 2,
            telemetryMs: 2000
          }
        : {
            name: '5',
            transport: 'low',
            margin: 0.022,
            maxAhead: 0.09,
            maxRawFrames: 10,
            latencyHint: 0.022,
            adaptiveMax: 0.04,
            dropGrow: 0.002,
            underrunGrow: 0.003,
            lowpassHz: 17200,
            highpassHz: 36,
            burstFast: 5,
            burstSafe: 2,
            telemetryMs: 2000
          };
  var st = document.getElementById('st');
  var m = document.getElementById('m');
  var go = document.getElementById('go');
  var latencyBar = document.getElementById('latencyBar');
  var stats = document.getElementById('stats');
  var holdSel = document.getElementById('holdSel');
  var hpf = document.getElementById('hpf');
  var lpf = document.getElementById('lpf');
  var hpfVal = document.getElementById('hpfVal');
  var lpfVal = document.getElementById('lpfVal');
  var helloMeta = document.getElementById('helloMeta');
  var meterCanvas = document.getElementById('masterMeter');
  var spectrumCanvas = document.getElementById('spectrum');
  var meterCtx2d = meterCanvas.getContext('2d');
  var spectrumCtx2d = spectrumCanvas.getContext('2d');
  var rawQueue = [];
  var drops = 0;
  var underruns = 0;
  var ctx = null;
  var masterGainNode = null;
  var dcBlock = null;
  var tameFilter = null;
  var limiter = null;
  var analyserMaster = null;
  var analyserL = null;
  var analyserR = null;
  var splitter = null;
  var pendingMaster = 1;
  var outSr = 48000;
  var nextPlayTime = 0;
  var sock = null;
  var rafId = 0;
  var pumpTimer = 0;
  var adaptiveExtraMargin = 0;
  var lastRmsL = 0.0001;
  var lastRmsR = 0.0001;
  var peakHoldL = -80;
  var peakHoldR = -80;
  var peakHoldAtL = 0;
  var peakHoldAtR = 0;
  var lastSpectrum = null;
  var helloInfo = { blockSamples: 0, latencyProfile: LATENCY };
  var lastPacketSeq = -1;
  var sequenceGaps = 0;
  var lastMeasuredRttMs = 0;
  var lastEstimatedE2eMs = 0;
  var estimatedE2ePeakMs = 0;
  var slaOver1s = 0;
  var slowSampleStreak = 0;
  var playStartErrors = 0;
  var lastPlayError = '';
  var lastCtxState = '';
  var TELEMETRY = ${injectedTelemetry};
  var teleTimer = null;
  var reconnectAttempt = 0;
  var reconnectTimer = null;
  var meterTimeDataL = null;
  var meterTimeDataR = null;
  var spectrumData = null;
  var WIRE_FLAG_MULAW = 1;
  var MULAW_BIAS = 0x84;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function dbFromLinear(v) {
    return Math.max(-80, Math.min(6, 20 * Math.log10(Math.max(0.0001, v))));
  }

  function mulawToLinearSample(byte) {
    var mu = (~byte) & 0xff;
    var sign = mu & 0x80;
    var exponent = (mu >> 4) & 0x07;
    var mantissa = mu & 0x0f;
    var sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
    sample -= MULAW_BIAS;
    return sign ? -sample : sample;
  }

  function holdMs() {
    var n = Number(holdSel && holdSel.value);
    return isNaN(n) ? 700 : n;
  }

  window.__inearSetMaster = function (v) {
    var g = Number(v);
    if (isNaN(g)) g = 1;
    g = Math.max(0, Math.min(4, g));
    pendingMaster = g;
    if (masterGainNode) masterGainNode.gain.value = g;
  };
  function marginSec() {
    return PROFILE.margin + adaptiveExtraMargin;
  }
  function decodeIne1(u8) {
    if (u8.byteLength < 32) return null;
    if (u8[0] !== 0x49 || u8[1] !== 0x4e || u8[2] !== 0x45 || u8[3] !== 0x31) return null;
    var seq =
      ((u8[8] << 24) >>> 0) |
      (u8[9] << 16) |
      (u8[10] << 8) |
      u8[11];
    var flags = (u8[6] << 8) | u8[7];
    var spc = (u8[20] << 8) | u8[21];
    var pb = (u8[22] << 8) | u8[23];
    var usesMulaw = (flags & WIRE_FLAG_MULAW) !== 0;
    if (u8.byteLength < 32 + pb) return null;
    if ((!usesMulaw && pb !== spc * 4) || (usesMulaw && pb !== spc * 2)) return null;
    var tsHi =
      ((u8[12] << 24) >>> 0) |
      (u8[13] << 16) |
      (u8[14] << 8) |
      u8[15];
    var tsLo =
      ((u8[16] << 24) >>> 0) |
      (u8[17] << 16) |
      (u8[18] << 8) |
      u8[19];
    var pcm = new Int16Array(spc * 2);
    var j;
    if (usesMulaw) {
      for (j = 0; j < pcm.length; j++) pcm[j] = mulawToLinearSample(u8[32 + j]);
    } else {
      var dv = new DataView(u8.buffer, u8.byteOffset + 32, pb);
      for (j = 0; j < pcm.length; j++) pcm[j] = dv.getInt16(j * 2, true);
    }
    return {
      pcm: pcm,
      sequence: seq,
      frames: spc,
      serverTimestampNsApprox: tsHi * 4294967296 + tsLo,
      codec: usesMulaw ? 'mulaw_u8' : 'pcm_s16'
    };
  }
  function concatInt16(a, b) {
    var o = new Int16Array(a.length + b.length);
    o.set(a);
    o.set(b, a.length);
    return o;
  }
  function updateEnvelopeFromPcm(pcm) {
    var n = pcm.length / 2;
    if (n < 1) return;
    var sl = 0;
    var sr = 0;
    var i, l, r;
    for (i = 0; i < n; i++) {
      l = pcm[i * 2] / 32768;
      r = pcm[i * 2 + 1] / 32768;
      sl += l * l;
      sr += r * r;
    }
    lastRmsL = Math.sqrt(sl / n);
    lastRmsR = Math.sqrt(sr / n);
  }

  function registerPacketSequence(seq) {
    if (typeof seq !== 'number') return;
    if (lastPacketSeq >= 0 && seq !== ((lastPacketSeq + 1) >>> 0)) {
      sequenceGaps++;
      adaptiveExtraMargin = Math.min(PROFILE.adaptiveMax, adaptiveExtraMargin + PROFILE.dropGrow);
    }
    lastPacketSeq = seq >>> 0;
  }

  function recoverPlaybackClock() {
    if (!ctx) return;
    nextPlayTime = ctx.currentTime + marginSec();
  }

  function setStatusText(msg) {
    try {
      if (st) st.textContent = msg;
    } catch (_) {}
  }

  function estimateE2eLatencyMs(aheadMs) {
    var serverBlockMs = helloInfo.blockSamples
      ? (helloInfo.blockSamples / SR_IN) * 1000
      : 0;
    var estimate = Math.max(
      0,
      aheadMs + adaptiveExtraMargin * 1000 + serverBlockMs + lastMeasuredRttMs * 0.5
    );
    lastEstimatedE2eMs = estimate;
    if (estimate > estimatedE2ePeakMs) estimatedE2ePeakMs = estimate;
    if (estimate > 1000) {
      slowSampleStreak++;
      slaOver1s++;
      if (slowSampleStreak >= 2) {
        recoverPlaybackClock();
        adaptiveExtraMargin = Math.max(0, adaptiveExtraMargin - 0.006);
      }
    } else {
      slowSampleStreak = 0;
    }
    return estimate;
  }

  function ensurePump(delayMs) {
    if (!ctx || pumpTimer) return;
    pumpTimer = setTimeout(function () {
      pumpTimer = 0;
      processQueueChunk();
      if (rawQueue.length > 0) {
        ensurePump(rawQueue.length > Math.max(2, PROFILE.maxRawFrames - 1) ? 0 : 5);
      }
    }, Math.max(0, delayMs || 0));
  }

  /** PCM 48 kHz s16 → AudioBuffer a 48 kHz: o motor do Web Audio faz o resampling ao dispositivo. */
  function scheduleBufferFromPcmS16(pcm) {
    var frames = pcm.length / 2;
    if (frames < 1 || !ctx) return;
    var buf = ctx.createBuffer(2, frames, SR_IN);
    var Ld = buf.getChannelData(0);
    var Rd = buf.getChannelData(1);
    var i;
    for (i = 0; i < frames; i++) {
      Ld[i] = (pcm[i * 2] / 32768) * 0.97;
      Rd[i] = (pcm[i * 2 + 1] / 32768) * 0.97;
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    if (masterGainNode) src.connect(masterGainNode);
    else src.connect(ctx.destination);
    var t = ctx.currentTime;
    var margin = marginSec();
    if (nextPlayTime < t + margin) {
      nextPlayTime = t + margin;
    }
    if (nextPlayTime < t) {
      nextPlayTime = t + margin * 0.5;
    }
    if (nextPlayTime - t > PROFILE.maxAhead) {
      nextPlayTime = t + margin;
    }
    try {
      src.start(nextPlayTime);
    } catch (e) {
      playStartErrors++;
      lastPlayError = String(e && e.message ? e.message : e);
      setStatusText('Áudio: falha ao iniciar buffer (' + playStartErrors + ') — ' + lastPlayError);
      recoverPlaybackClock();
      return;
    }
    nextPlayTime += buf.duration;
  }

  function processQueueChunk() {
    if (!ctx || rawQueue.length === 0) return;
    var t = ctx.currentTime;
    var ahead = nextPlayTime - t;
    var maxBurst = ahead < marginSec() * 0.6 ? PROFILE.burstFast : ahead < marginSec() ? PROFILE.burstSafe : 1;
    var merged = null;
    var n = 0;
    while (rawQueue.length > 0 && n < maxBurst) {
      var ab = rawQueue.shift();
      var u8 = new Uint8Array(ab);
      var packet = decodeIne1(u8);
      if (!packet) {
        n++;
        continue;
      }
      registerPacketSequence(packet.sequence);
      updateEnvelopeFromPcm(packet.pcm);
      merged = merged ? concatInt16(merged, packet.pcm) : packet.pcm;
      n++;
    }
    if (merged && merged.length >= 2) {
      scheduleBufferFromPcmS16(merged);
      adaptiveExtraMargin = Math.max(0, adaptiveExtraMargin - 0.0025);
    } else if (nextPlayTime - ctx.currentTime < 0.01) {
      underruns++;
      adaptiveExtraMargin = Math.min(PROFILE.adaptiveMax, adaptiveExtraMargin + PROFILE.underrunGrow);
      recoverPlaybackClock();
    }
  }

  function drawLedMeter(x, label, rmsDb, holdDb) {
    if (!meterCtx2d) return;
    var top = 20;
    var bottom = 230;
    var width = 48;
    var left = x;
    var height = bottom - top;
    var segCount = 24;
    meterCtx2d.fillStyle = '#0a0f15';
    meterCtx2d.fillRect(left - 4, top - 6, width + 8, height + 26);
    for (var i = 0; i < segCount; i++) {
      var y = bottom - ((i + 1) / segCount) * height;
      var segH = height / segCount - 2;
      var segDb = -60 + (i / (segCount - 1)) * 66;
      var on = rmsDb >= segDb;
      meterCtx2d.fillStyle =
        segDb >= -6 ? (on ? '#f85149' : '#351317')
        : segDb >= -18 ? (on ? '#d29922' : '#33270b')
        : (on ? '#2ea043' : '#102316');
      meterCtx2d.fillRect(left, y, width, segH);
    }
    var holdY = bottom - clamp((holdDb + 60) / 66, 0, 1) * height;
    meterCtx2d.fillStyle = '#ffffff';
    meterCtx2d.fillRect(left - 2, holdY - 1, width + 4, 2);
    meterCtx2d.fillStyle = '#8b949e';
    meterCtx2d.font = '11px sans-serif';
    meterCtx2d.textAlign = 'center';
    meterCtx2d.fillText(label, left + width / 2, 248);
    meterCtx2d.fillStyle = '#c9d1d9';
    meterCtx2d.fillText(rmsDb.toFixed(1) + ' dB', left + width / 2, 12);
  }

  function drawMeterScale() {
    if (!meterCtx2d) return;
    meterCtx2d.clearRect(0, 0, meterCanvas.width, meterCanvas.height);
    meterCtx2d.fillStyle = '#05070b';
    meterCtx2d.fillRect(0, 0, meterCanvas.width, meterCanvas.height);
    meterCtx2d.strokeStyle = '#1b2330';
    meterCtx2d.lineWidth = 1;
    var marks = [6, 0, -6, -12, -18, -24, -36, -48, -60];
    for (var i = 0; i < marks.length; i++) {
      var db = marks[i];
      var y = 230 - clamp((db + 60) / 66, 0, 1) * 210;
      meterCtx2d.beginPath();
      meterCtx2d.moveTo(124, y);
      meterCtx2d.lineTo(250, y);
      meterCtx2d.stroke();
      meterCtx2d.fillStyle = '#6e7681';
      meterCtx2d.font = '10px sans-serif';
      meterCtx2d.textAlign = 'right';
      meterCtx2d.fillText(String(db), 118, y + 3);
    }
  }

  function drawSpectrum() {
    if (!spectrumCtx2d || !analyserMaster || !spectrumData) return;
    analyserMaster.getByteFrequencyData(spectrumData);
    spectrumCtx2d.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    spectrumCtx2d.fillStyle = '#05070b';
    spectrumCtx2d.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    var w = spectrumCanvas.width;
    var h = spectrumCanvas.height;
    var bars = 48;
    var binStep = Math.max(1, Math.floor(spectrumData.length / bars));
    for (var i = 0; i < bars; i++) {
      var acc = 0;
      for (var j = 0; j < binStep; j++) acc += spectrumData[i * binStep + j] || 0;
      var v = acc / binStep / 255;
      var bh = Math.max(2, v * (h - 20));
      var x = i * (w / bars) + 2;
      var bw = Math.max(3, w / bars - 4);
      var grd = spectrumCtx2d.createLinearGradient(0, h - bh, 0, h);
      grd.addColorStop(0, '#79c0ff');
      grd.addColorStop(0.55, '#2f81f7');
      grd.addColorStop(1, '#11263f');
      spectrumCtx2d.fillStyle = grd;
      spectrumCtx2d.fillRect(x, h - bh - 4, bw, bh);
    }
    spectrumCtx2d.strokeStyle = '#20304a';
    spectrumCtx2d.beginPath();
    spectrumCtx2d.moveTo(0, h - 18);
    spectrumCtx2d.lineTo(w, h - 18);
    spectrumCtx2d.stroke();
  }

  function tick() {
    if (ctx) {
      if (ctx.state !== lastCtxState) {
        lastCtxState = ctx.state;
        if (ctx.state === 'suspended') {
          setStatusText('Áudio: suspenso (toque/clique para retomar)');
        }
      }
      if (analyserL && analyserR && meterTimeDataL && meterTimeDataR) {
        analyserL.getFloatTimeDomainData(meterTimeDataL);
        analyserR.getFloatTimeDomainData(meterTimeDataR);
        var sl = 0;
        var sr = 0;
        for (var i = 0; i < meterTimeDataL.length; i++) {
          sl += meterTimeDataL[i] * meterTimeDataL[i];
          sr += meterTimeDataR[i] * meterTimeDataR[i];
        }
        var dbL = dbFromLinear(Math.sqrt(sl / meterTimeDataL.length));
        var dbR = dbFromLinear(Math.sqrt(sr / meterTimeDataR.length));
        var nowMs = Date.now();
        if (dbL >= peakHoldL || nowMs - peakHoldAtL > holdMs()) {
          peakHoldL = dbL;
          peakHoldAtL = nowMs;
        }
        if (dbR >= peakHoldR || nowMs - peakHoldAtR > holdMs()) {
          peakHoldR = dbR;
          peakHoldAtR = nowMs;
          peakHoldAtR = nowMs;
        }
        drawMeterScale();
        drawLedMeter(136, 'L', dbL, peakHoldL);
        drawLedMeter(192, 'R', dbR, peakHoldR);
        drawSpectrum();
      }
      var t = ctx.currentTime;
      var ahead = nextPlayTime - t;
      var aheadMs = ahead > 0 ? ahead * 1000 : 0;
      var e2eMs = estimateE2eLatencyMs(aheadMs);
      stats.textContent =
        'drops=' +
        drops +
        ' | gaps=' +
        sequenceGaps +
        ' | underruns=' +
        underruns +
        ' | ahead=' +
        (aheadMs > 0 ? aheadMs.toFixed(0) : '0') +
      ' ms | perfil=' +
        PROFILE.name +
        ' (' +
        LATENCY +
        ')' +
        ' | e2e~' +
        e2eMs.toFixed(0) +
        ' ms' +
        ' | SLA<1s=' +
        (e2eMs < 1000 ? 'OK' : 'VIOLADO') +
        ' | margem alvo=' +
        Math.round(marginSec() * 1000) +
        ' ms | buffer adapt=' +
        Math.round(adaptiveExtraMargin * 1000) +
        ' ms | RTT~' +
        Math.round(lastMeasuredRttMs) +
        ' ms | server=' +
        (helloInfo.blockSamples ? helloInfo.blockSamples : '--') +
        ' smp' +
        ' | buf=' +
        String(SR_IN) +
        ' Hz · dispositivo=' +
        String(outSr) +
        ' Hz';
    }
    rafId = requestAnimationFrame(tick);
  }

  function enqueueRaw(ab) {
    if (rawQueue.length >= PROFILE.maxRawFrames) {
      rawQueue.shift();
      if (PROFILE.transport === 'wifi24' && rawQueue.length > Math.max(6, PROFILE.maxRawFrames - 4)) {
        rawQueue.splice(0, Math.max(0, rawQueue.length - 5));
      }
      if (PROFILE.transport === 'pro' && rawQueue.length > 2) {
        rawQueue.splice(0, Math.max(0, rawQueue.length - 2));
      }
      drops++;
      adaptiveExtraMargin = Math.min(PROFILE.adaptiveMax, adaptiveExtraMargin + PROFILE.dropGrow);
      recoverPlaybackClock();
    }
    rawQueue.push(ab);
  }

  function sendTelemetryOnce() {
    if (!TELEMETRY || !TELEMETRY.apiBase || !TELEMETRY.token) return;
    var base = String(TELEMETRY.apiBase).replace(/[/]+$/, '');
    var t0 = Date.now();
    fetch(base + '/api/health')
      .then(function () {
        var rtt = Date.now() - t0;
        lastMeasuredRttMs = rtt;
        return fetch(base + '/api/telemetry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + TELEMETRY.token,
          },
          body: JSON.stringify({
            rttMs: rtt,
            sequenceGaps: sequenceGaps,
            underruns: underruns,
            drops: drops,
            queueDepth: rawQueue.length,
            aheadMs: Math.max(0, (nextPlayTime - (ctx ? ctx.currentTime : 0)) * 1000),
            estimatedE2eMs: lastEstimatedE2eMs,
            estimatedE2ePeakMs: estimatedE2ePeakMs,
            adaptiveMarginMs: Math.round(adaptiveExtraMargin * 1000),
            slaOver1s: slaOver1s,
            latencyProfile: LATENCY,
          }),
        });
      })
      .catch(function () {});
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    if (!ctx) return;
    var delay = Math.min(10000, Math.round(400 * Math.pow(1.7, reconnectAttempt)));
    reconnectAttempt++;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connectWs();
    }, delay);
  }

  function connectWs() {
    if (sock) {
      try {
        sock.onclose = null;
        sock.close();
      } catch (_e) {}
      sock = null;
    }
    sock = new WebSocket(WS_URL);
    sock.binaryType = 'arraybuffer';
    sock.onmessage = function (ev) {
      if (typeof ev.data === 'string') {
        try {
          var j = JSON.parse(ev.data);
          if (j && j.t === 'hello') {
            helloInfo.blockSamples = Number(j.blockSamples) || 0;
            helloInfo.latencyProfile = j.latencyProfile || LATENCY;
            helloMeta.textContent =
              'Buffer do servidor: ' +
              (helloInfo.blockSamples || '--') +
              ' samples · perfil ws: ' +
              helloInfo.latencyProfile +
              ' · codec: ' +
              (j.wireCodec || 'pcm_s16');
          }
        } catch (_e) {}
        return;
      }
      var ab = ev.data;
      if (ab instanceof ArrayBuffer) {
        enqueueRaw(ab.slice(0));
        ensurePump(rawQueue.length > Math.max(2, PROFILE.maxRawFrames - 1) ? 0 : 2);
      }
    };
    sock.onerror = function () {
      m.textContent = 'Erro de rede no WebSocket.';
      slowSampleStreak = Math.max(slowSampleStreak, 1);
    };
    sock.onclose = function () {
      m.textContent = 'Ligação fechada — a voltar a ligar…';
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      if (teleTimer) {
        clearInterval(teleTimer);
        teleTimer = null;
      }
      lastPacketSeq = -1;
      if (ctx) scheduleReconnect();
    };
    sock.onopen = function () {
      reconnectAttempt = 0;
      m.textContent = 'Ligado — PCM 48 kHz → ' + String(outSr) + ' Hz.';
      nextPlayTime = 0;
      rafId = requestAnimationFrame(tick);
      if (teleTimer) clearInterval(teleTimer);
      teleTimer = setInterval(sendTelemetryOnce, PROFILE.telemetryMs);
      sendTelemetryOnce();
    };
  }
  go.onclick = function () {
    go.disabled = true;
    st.textContent = 'A iniciar…';
    latencyBar.textContent =
      'Modo latência: ' +
      LATENCY +
      ' (perfil ' +
      PROFILE.name +
      ', margem ~' +
      String(Math.round(marginSec() * 1000)) +
      ' ms, ajustada dinamicamente quando houver jitter; meta operacional: abaixo de 1000 ms).';
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SR_IN,
        latencyHint: PROFILE.latencyHint,
      });
    } catch (e1) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    var tryResume = function () {
      try {
        if (!ctx) return;
        if (ctx.state === 'running') return;
        ctx.resume().catch(function (_) {});
      } catch (_) {}
    };
    document.addEventListener('touchstart', tryResume, { passive: true });
    document.addEventListener('mousedown', tryResume, { passive: true });
    document.addEventListener('keydown', tryResume, { passive: true });
    outSr = ctx.sampleRate;
    masterGainNode = ctx.createGain();
    masterGainNode.gain.value = pendingMaster;
    dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass';
    dcBlock.frequency.value = PROFILE.highpassHz;
    dcBlock.Q.value = 0.67;
    tameFilter = ctx.createBiquadFilter();
    tameFilter.type = 'lowpass';
    tameFilter.frequency.value = PROFILE.lowpassHz;
    tameFilter.Q.value = 0.62;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 10;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.09;
    analyserMaster = ctx.createAnalyser();
    analyserMaster.fftSize = 512;
    analyserL = ctx.createAnalyser();
    analyserR = ctx.createAnalyser();
    analyserL.fftSize = 512;
    analyserR.fftSize = 512;
    splitter = ctx.createChannelSplitter(2);
    meterTimeDataL = new Float32Array(analyserL.fftSize);
    meterTimeDataR = new Float32Array(analyserR.fftSize);
    spectrumData = new Uint8Array(analyserMaster.frequencyBinCount);
    masterGainNode.connect(dcBlock);
    dcBlock.connect(tameFilter);
    tameFilter.connect(limiter);
    limiter.connect(ctx.destination);
    limiter.connect(analyserMaster);
    limiter.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    hpf.value = String(PROFILE.highpassHz);
    lpf.value = String(PROFILE.lowpassHz);
    hpfVal.textContent = String(Number(hpf.value).toFixed(0)) + ' Hz';
    lpfVal.textContent = (Number(lpf.value) / 1000).toFixed(1) + ' kHz';
    hpf.oninput = function () {
      var v = Number(hpf.value) || 42;
      dcBlock.frequency.value = v;
      hpfVal.textContent = String(v.toFixed(0)) + ' Hz';
    };
    lpf.oninput = function () {
      var v = Number(lpf.value) || 15600;
      tameFilter.frequency.value = v;
      lpfVal.textContent = (v / 1000).toFixed(1) + ' kHz';
    };
    ctx.resume().then(function () {
      outSr = ctx.sampleRate;
      connectWs();
      st.textContent = 'Retorno ativo. Auriculares reduzem eco e vazamento.';
    }).catch(function (e) {
      st.textContent = 'Áudio: ' + (e && e.message ? e.message : e);
      go.disabled = false;
    });
  };
})();
</script></body></html>`
}
