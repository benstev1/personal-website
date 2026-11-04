// Live demo for the Min-Crop Stabilizer section.
//
// The camera motion here is a *generated* path (shake, optionally with a pan
// or a bump), so the real tool's phase-correlation tracking step is skipped.
// Everything after that mirrors the project's design doc: per-axis split of
// the cumulative path into jitter vs. intentional motion with a deadband,
// then one fixed crop sized to the largest jitter that actually occurred.
(function () {
  'use strict';

  const root = document.getElementById('mcDemo');
  if (!root) return;

  // ─── Constants ──────────────────────────────────────────────────────
  const W = 640;
  const H = 360;
  const FPS = 30;
  const FRAMES = 240;

  const INTENT_FRAMES = 5; // frames past the threshold before motion counts as a pan
  const RECENTER = 0.02;   // per-frame ease back to center while inside the threshold
  const PAN_EASE = 0.1;    // per-frame rate the correction eases to zero during a pan

  const ORIGIN = { x: 380, y: 130 }; // where the un-shaken camera looks in the world image
  const WORLD_W = 1500;
  const WORLD_H = 620;

  const LABEL_JITTER = 0;
  const LABEL_BUMP = 1;
  const LABEL_INTENT = 2;
  const LABEL_NAMES = ['jitter', 'bump', 'intentional'];
  const LABEL_COLORS = ['#70A0AF', '#E0A850', '#64D296'];

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Elements ───────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const inCanvas = $('mcInput');
  const outCanvas = $('mcOutput');
  const chartCanvas = $('mcChart');
  const inCtx = inCanvas.getContext('2d');
  const outCtx = outCanvas.getContext('2d');
  const chartCtx = chartCanvas.getContext('2d');
  const thresholdInput = $('mcThreshold');
  const thresholdOut = $('mcThresholdOut');
  const playBtn = $('mcPlay');
  const scrub = $('mcScrub');
  const timeOut = $('mcTime');
  const stat = {
    threshold: $('mcStatThreshold'),
    crop: $('mcStatCrop'),
    output: $('mcStatOutput'),
    kept: $('mcStatKept'),
    frames: $('mcStatFrames'),
  };

  // ─── Synthetic world ────────────────────────────────────────────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A big image of a night landscape with plenty of high-contrast detail, so
  // the shake and the correction are easy to see.
  function buildWorld() {
    const c = document.createElement('canvas');
    c.width = WORLD_W;
    c.height = WORLD_H;
    const g = c.getContext('2d');
    const rng = mulberry32(7);
    const horizon = 380;

    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#1d1030');
    sky.addColorStop(0.6, '#4d3a68');
    sky.addColorStop(1, '#b9806c');
    g.fillStyle = sky;
    g.fillRect(0, 0, WORLD_W, horizon);

    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(244,232,193,${0.25 + rng() * 0.6})`;
      const s = rng() < 0.12 ? 2 : 1;
      g.fillRect(rng() * WORLD_W, rng() * (horizon - 120), s, s);
    }

    g.fillStyle = '#F4E8C1';
    g.beginPath();
    g.arc(720, 262, 64, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(244,232,193,0.18)';
    g.beginPath();
    g.arc(720, 262, 96, 0, Math.PI * 2);
    g.fill();

    function ridge(base, amp, freq, phase, color) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, horizon);
      for (let x = 0; x <= WORLD_W; x += 10) {
        const y = base
          - amp * Math.abs(Math.sin(x * freq + phase))
          - amp * 0.4 * Math.sin(x * freq * 2.7 + phase * 1.9);
        g.lineTo(x, y);
      }
      g.lineTo(WORLD_W, horizon);
      g.closePath();
      g.fill();
    }
    ridge(horizon - 10, 70, 0.0042, 0.6, '#5b4a7e');
    ridge(horizon - 4, 44, 0.0071, 2.1, '#3f2d57');

    // Ground
    g.fillStyle = '#26162d';
    g.fillRect(0, horizon, WORLD_W, WORLD_H - horizon);
    g.strokeStyle = 'rgba(112,105,147,0.55)';
    g.lineWidth = 1;
    for (let x = -400; x <= WORLD_W + 400; x += 70) {
      g.beginPath();
      g.moveTo(WORLD_W / 2 + (x - WORLD_W / 2) * 0.18, horizon);
      g.lineTo(x * 1.6 - WORLD_W * 0.3, WORLD_H);
      g.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const y = horizon + Math.pow(i / 8, 1.8) * (WORLD_H - horizon);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(WORLD_W, y);
      g.stroke();
    }

    // Trees
    for (let i = 0; i < 46; i++) {
      const x = rng() * WORLD_W;
      const h = 26 + rng() * 40;
      const y = horizon + 2 + rng() * 6;
      g.fillStyle = rng() < 0.5 ? '#1a0f20' : '#2a1a35';
      g.beginPath();
      g.moveTo(x, y - h);
      g.lineTo(x - h * 0.28, y);
      g.lineTo(x + h * 0.28, y);
      g.closePath();
      g.fill();
    }

    // Poles with tick marks: sharp vertical references that make any
    // sideways wobble obvious.
    for (let x = 60; x < WORLD_W; x += 150) {
      g.fillStyle = '#A0C1B9';
      g.fillRect(x, horizon - 78, 5, 116);
      g.fillStyle = '#F4E8C1';
      g.fillRect(x - 9, horizon - 80, 23, 5);
      g.fillStyle = '#331E38';
      for (let k = 0; k < 5; k++) g.fillRect(x, horizon - 62 + k * 20, 5, 3);
    }

    // A frame-of-reference ruler along the bottom of the visible area
    g.fillStyle = 'rgba(244,232,193,0.55)';
    for (let x = 0; x < WORLD_W; x += 20) {
      g.fillRect(x, 470, 1, x % 100 === 0 ? 14 : 7);
    }
    return c;
  }

  const world = buildWorld();

  // ─── Camera paths ───────────────────────────────────────────────────
  function shakeSeries(seed, amp) {
    const rng = mulberry32(seed);
    const comps = [];
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const a = 0.5 + rng();
      total += a;
      comps.push({ a, f: 0.7 + rng() * 3.3, ph: rng() * Math.PI * 2 });
    }
    const out = new Float32Array(FRAMES);
    for (let t = 0; t < FRAMES; t++) {
      let v = 0;
      for (const c of comps) v += c.a * Math.sin((2 * Math.PI * c.f * t) / FPS + c.ph);
      out[t] = amp * (v / total) + amp * 0.1 * (rng() * 2 - 1);
    }
    return out;
  }

  function smoothstep(x) {
    const c = Math.min(Math.max(x, 0), 1);
    return c * c * (3 - 2 * c);
  }

  const SCENARIOS = {
    shake: {
      blurb: 'Handheld shake only',
      extra: () => [0, 0],
    },
    pan: {
      blurb: 'Shake plus a deliberate pan and tilt',
      extra: t => {
        const s = smoothstep((t - 70) / 85);
        return [230 * s, -26 * s];
      },
    },
    bump: {
      blurb: 'Shake plus two sharp bumps',
      extra: t => {
        const a = Math.exp(-Math.pow((t - 100) / 2.2, 2));
        const b = Math.exp(-Math.pow((t - 185) / 2.2, 2));
        return [34 * a, -22 * b];
      },
    },
  };

  const shakeX = shakeSeries(11, 6.5);
  const shakeY = shakeSeries(23, 3.5);

  function buildPath(kind) {
    const x = new Float32Array(FRAMES);
    const y = new Float32Array(FRAMES);
    for (let t = 0; t < FRAMES; t++) {
      const [ex, ey] = SCENARIOS[kind].extra(t);
      x[t] = shakeX[t] + ex;
      y[t] = shakeY[t] + ey;
    }
    return { x, y };
  }

  // ─── Jitter / intent split (one axis) ───────────────────────────────
  // P is the cumulative camera path. I is the intended path; J = P - I is
  // the jitter, i.e. the shift applied to each frame to undo it. |J| <= T
  // always holds by construction.
  function splitAxis(P, T) {
    const n = P.length;
    const I = new Float32Array(n);
    const J = new Float32Array(n);
    const label = new Uint8Array(n);
    I[0] = P[0];

    let panDir = 0;
    let panSpeed = 0;
    let slowFrames = 0;

    for (let t = 1; t < n; t++) {
      const Iprev = I[t - 1];
      const Jprev = J[t - 1];

      if (panDir !== 0) {
        // A pan continues while recent motion keeps going in its direction.
        let sum = 0;
        let count = 0;
        for (let s = Math.max(1, t - 3); s <= t; s++) {
          sum += P[s] - P[s - 1];
          count++;
        }
        if ((sum / count) * panDir > 0.3 * panSpeed) slowFrames = 0;
        else slowFrames++;

        if (slowFrames < 2) {
          J[t] = Jprev * (1 - PAN_EASE);
          I[t] = P[t] - J[t];
          label[t] = LABEL_INTENT;
          continue;
        }
        panDir = 0;
      }

      const e = P[t] - Iprev;
      if (Math.abs(e) <= T) {
        I[t] = Iprev + RECENTER * e;
        J[t] = P[t] - I[t];
        label[t] = LABEL_JITTER;
        continue;
      }

      // Past the threshold. Offline, so look ahead: does it stay past the
      // threshold, on the same side, for INTENT_FRAMES frames?
      const dir = Math.sign(e);
      let sustained = t + INTENT_FRAMES <= n;
      for (let s = t; sustained && s < t + INTENT_FRAMES; s++) {
        if ((P[s] - Iprev) * dir <= T) sustained = false;
      }

      if (sustained) {
        panDir = dir;
        panSpeed = Math.max(Math.abs(P[t + INTENT_FRAMES - 1] - P[t - 1]) / INTENT_FRAMES, 0.05);
        slowFrames = 0;
        J[t] = Jprev * (1 - PAN_EASE);
        I[t] = P[t] - J[t];
        label[t] = LABEL_INTENT;
      } else {
        // Bump: only the part beyond the threshold shows through.
        I[t] = Iprev;
        J[t] = Math.max(-T, Math.min(T, e));
        label[t] = LABEL_BUMP;
      }
    }
    return { I, J, label };
  }

  // ─── Whole-clip result ──────────────────────────────────────────────
  const state = {
    scenario: 'shake',
    axis: 'x',
    thresholdPct: 2,
    frame: 0,
    playing: !reduceMotion,
    path: null,
    result: null,
  };

  function evenFloor(v) {
    return Math.floor(v / 2) * 2;
  }

  function recompute() {
    const path = buildPath(state.scenario);
    const p = state.thresholdPct / 100;
    const Tx = p * W;
    const Ty = p * H;
    const x = splitAxis(path.x, Tx);
    const y = splitAxis(path.y, Ty);

    let Mx = 0;
    let My = 0;
    const labels = new Uint8Array(FRAMES);
    const counts = [0, 0, 0];
    for (let t = 0; t < FRAMES; t++) {
      Mx = Math.max(Mx, Math.abs(x.J[t]));
      My = Math.max(My, Math.abs(y.J[t]));
      labels[t] = Math.max(x.label[t], y.label[t]);
      counts[labels[t]]++;
    }

    const cropW = Math.max(evenFloor(W - 2 * Mx), 2);
    const cropH = Math.max(evenFloor(H - 2 * My), 2);
    const thrW = evenFloor(W - 2 * Tx);
    const thrH = evenFloor(H - 2 * Ty);

    state.path = path;
    state.result = { x, y, Tx, Ty, Mx, My, cropW, cropH, thrW, thrH, labels, counts };
  }

  // ─── Drawing ────────────────────────────────────────────────────────
  function drawInput(t) {
    const r = state.result;
    const px = state.path.x[t];
    const py = state.path.y[t];
    inCtx.drawImage(world, ORIGIN.x + px, ORIGIN.y + py, W, H, 0, 0, W, H);

    // What a crop sized to the full threshold would remove
    inCtx.save();
    inCtx.strokeStyle = 'rgba(224,168,80,0.85)';
    inCtx.lineWidth = 2;
    inCtx.setLineDash([8, 6]);
    inCtx.strokeRect(r.Tx, r.Ty, W - 2 * r.Tx, H - 2 * r.Ty);
    inCtx.restore();

    // The crop actually used
    const dx = (W - r.cropW) / 2;
    const dy = (H - r.cropH) / 2;
    inCtx.save();
    inCtx.strokeStyle = '#64D296';
    inCtx.lineWidth = 2;
    inCtx.strokeRect(dx, dy, r.cropW, r.cropH);
    inCtx.restore();
  }

  function drawOutput(t) {
    const r = state.result;
    const ox = state.path.x[t] - r.x.J[t];
    const oy = state.path.y[t] - r.y.J[t];
    const dx = (W - r.cropW) / 2;
    const dy = (H - r.cropH) / 2;

    outCtx.fillStyle = '#170d1b';
    outCtx.fillRect(0, 0, W, H);
    outCtx.drawImage(world, ORIGIN.x + ox + dx, ORIGIN.y + oy + dy, r.cropW, r.cropH, dx, dy, r.cropW, r.cropH);

    outCtx.save();
    outCtx.strokeStyle = '#64D296';
    outCtx.lineWidth = 2;
    outCtx.strokeRect(dx, dy, r.cropW, r.cropH);
    outCtx.restore();

    // Per-frame label chip
    const label = r.labels[t];
    const text = LABEL_NAMES[label];
    outCtx.save();
    outCtx.font = '600 13px ui-monospace, Consolas, Menlo, monospace';
    const tw = outCtx.measureText(text).width;
    outCtx.fillStyle = 'rgba(23,13,27,0.8)';
    outCtx.fillRect(dx + 10, dy + 10, tw + 24, 24);
    outCtx.fillStyle = LABEL_COLORS[label];
    outCtx.beginPath();
    outCtx.arc(dx + 21, dy + 22, 4, 0, Math.PI * 2);
    outCtx.fill();
    outCtx.fillStyle = '#F4E8C1';
    outCtx.textBaseline = 'middle';
    outCtx.fillText(text, dx + 31, dy + 23);
    outCtx.restore();
  }

  let chartSize = { w: 0, h: 0, dpr: 1 };
  function sizeChart() {
    const rect = chartCanvas.getBoundingClientRect();
    if (!rect.width) return false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (chartCanvas.width !== w || chartCanvas.height !== h) {
      chartCanvas.width = w;
      chartCanvas.height = h;
    }
    chartSize = { w: rect.width, h: rect.height, dpr };
    return true;
  }

  function drawChart(t) {
    if (!sizeChart()) return;
    const { w, h, dpr } = chartSize;
    const g = chartCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const r = state.result;
    const axis = r[state.axis];
    const P = state.path[state.axis];
    const T = state.axis === 'x' ? r.Tx : r.Ty;
    const M = state.axis === 'x' ? r.Mx : r.My;

    const padL = 44;
    const padR = 10;
    const padT = 10;
    const stripH = 8;
    const padB = 22 + stripH;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < FRAMES; i++) {
      lo = Math.min(lo, P[i], axis.I[i] - T);
      hi = Math.max(hi, P[i], axis.I[i] + T);
    }
    const span = hi - lo || 1;
    lo -= span * 0.06;
    hi += span * 0.06;

    const X = i => padL + (i / (FRAMES - 1)) * plotW;
    const Y = v => padT + (1 - (v - lo) / (hi - lo)) * plotH;

    // Grid + axis labels
    g.font = '10px ui-monospace, Consolas, Menlo, monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.lineWidth = 1;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = lo + ((hi - lo) * i) / ticks;
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = 'rgba(244,232,193,0.07)';
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(w - padR, y);
      g.stroke();
      g.fillStyle = 'rgba(244,232,193,0.4)';
      g.fillText(`${v.toFixed(0)}px`, padL - 6, y);
    }
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let s = 0; s <= FRAMES / FPS; s += 2) {
      g.fillStyle = 'rgba(244,232,193,0.4)';
      g.fillText(`${s}s`, X(Math.min(s * FPS, FRAMES - 1)), h - padB + stripH + 6);
    }

    // Threshold band around the intended path
    g.beginPath();
    for (let i = 0; i < FRAMES; i++) g.lineTo(X(i), Y(axis.I[i] + T));
    for (let i = FRAMES - 1; i >= 0; i--) g.lineTo(X(i), Y(axis.I[i] - T));
    g.closePath();
    g.fillStyle = 'rgba(112,105,147,0.2)';
    g.fill();

    // Raw camera path
    g.beginPath();
    for (let i = 0; i < FRAMES; i++) g.lineTo(X(i), Y(P[i]));
    g.strokeStyle = 'rgba(244,232,193,0.45)';
    g.lineWidth = 1.25;
    g.stroke();

    // Stabilized output path (P - J)
    g.beginPath();
    for (let i = 0; i < FRAMES; i++) g.lineTo(X(i), Y(P[i] - axis.J[i]));
    g.strokeStyle = '#70A0AF';
    g.lineWidth = 2.25;
    g.stroke();

    // Per-frame label strip
    const stripY = h - padB + 2;
    for (let i = 0; i < FRAMES; i++) {
      const lab = r.labels[i];
      g.fillStyle = lab === LABEL_JITTER ? 'rgba(112,160,175,0.28)' : LABEL_COLORS[lab];
      g.fillRect(X(i) - plotW / FRAMES / 2, stripY, plotW / FRAMES + 0.5, stripH);
    }

    // Playhead
    const hx = Math.round(X(t)) + 0.5;
    g.strokeStyle = 'rgba(244,232,193,0.8)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(hx, padT);
    g.lineTo(hx, stripY + stripH);
    g.stroke();
    g.fillStyle = '#F4E8C1';
    g.beginPath();
    g.arc(hx, Y(P[t]), 3.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#70A0AF';
    g.beginPath();
    g.arc(hx, Y(P[t] - axis.J[t]), 3.5, 0, Math.PI * 2);
    g.fill();

    // Readout of this axis's limits
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(244,232,193,0.55)';
    g.fillText(`threshold ±${T.toFixed(1)}px · max jitter ${M.toFixed(1)}px`, w - padR - 4, padT + 4);
  }

  function fmtPct(v) {
    return `${v.toFixed(1)}%`;
  }

  function updateStats() {
    const r = state.result;
    const effMx = (W - r.cropW) / 2;
    const effMy = (H - r.cropH) / 2;
    const kept = (r.cropW * r.cropH) / (W * H);
    const keptThr = (r.thrW * r.thrH) / (W * H);

    thresholdOut.textContent = fmtPct(state.thresholdPct);
    stat.threshold.textContent =
      `${fmtPct(state.thresholdPct)} · ${r.Tx.toFixed(1)} × ${r.Ty.toFixed(1)} px`;
    stat.crop.textContent =
      `${effMx.toFixed(0)} × ${effMy.toFixed(0)} px per side · ${fmtPct((effMx / W) * 100)} × ${fmtPct((effMy / H) * 100)}`;
    stat.output.textContent = `${r.cropW} × ${r.cropH}`;
    stat.kept.textContent =
      `${(kept * 100).toFixed(1)}% (a threshold-sized crop keeps ${(keptThr * 100).toFixed(1)}%)`;
    stat.frames.textContent =
      `${r.counts[LABEL_JITTER]} jitter · ${r.counts[LABEL_BUMP]} bump · ${r.counts[LABEL_INTENT]} intentional`;
  }

  function render() {
    const t = state.frame;
    drawInput(t);
    drawOutput(t);
    drawChart(t);
    scrub.value = String(t);
    timeOut.textContent = `${(t / FPS).toFixed(1)}s / ${(FRAMES / FPS).toFixed(1)}s`;
  }

  function refresh() {
    recompute();
    updateStats();
    render();
  }

  // ─── Playback ───────────────────────────────────────────────────────
  let raf = 0;
  let lastTs = 0;
  let acc = 0;
  let visible = false;

  function tick(ts) {
    raf = 0;
    if (!visible || !state.playing) return;
    if (!lastTs) lastTs = ts;
    acc += ts - lastTs;
    lastTs = ts;
    const step = 1000 / FPS;
    if (acc >= step) {
      const n = Math.floor(acc / step);
      acc -= n * step;
      state.frame = (state.frame + n) % FRAMES;
      render();
    }
    raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (raf || !visible || !state.playing) return;
    lastTs = 0;
    acc = 0;
    raf = requestAnimationFrame(tick);
  }

  function setPlaying(on) {
    state.playing = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(on));
    if (on) startLoop();
  }

  // ─── Wiring ─────────────────────────────────────────────────────────
  function bindSegmented(selector, attr, onChange) {
    const buttons = Array.from(root.querySelectorAll(selector));
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        onChange(btn.getAttribute(attr));
      });
    });
  }

  bindSegmented('[data-scenario]', 'data-scenario', value => {
    state.scenario = value;
    refresh();
  });

  bindSegmented('[data-axis]', 'data-axis', value => {
    state.axis = value;
    render();
  });

  thresholdInput.addEventListener('input', () => {
    state.thresholdPct = parseFloat(thresholdInput.value);
    refresh();
  });

  playBtn.addEventListener('click', () => setPlaying(!state.playing));

  scrub.addEventListener('input', () => {
    setPlaying(false);
    state.frame = parseInt(scrub.value, 10);
    render();
  });

  chartCanvas.addEventListener('pointerdown', e => {
    const rect = chartCanvas.getBoundingClientRect();
    const seek = ev => {
      const padL = 44;
      const padR = 10;
      const x = ev.clientX - rect.left;
      const frac = (x - padL) / (rect.width - padL - padR);
      state.frame = Math.max(0, Math.min(FRAMES - 1, Math.round(frac * (FRAMES - 1))));
      render();
    };
    setPlaying(false);
    seek(e);
    const move = ev => seek(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  window.addEventListener('resize', () => render());

  // Only run the animation while the demo is on screen
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) startLoop();
  }, { threshold: 0.1 }).observe(root);

  setPlaying(state.playing);
  refresh();
})();
