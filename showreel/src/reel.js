// ============================================================
//  디자인하는AI — 15s Motion Showreel
//  Deterministic, time-driven renderer: Canvas2D scene graph
//  -> WebGL2 float accumulation (motion blur) -> post FX.
// ============================================================
const W = 1920, H = 1080, FPS = 60, DUR = 15, BPM = 128;
const B = 60 / BPM, BAR = 4 * B;           // 0.46875s beat, 1.875s bar (8 bars = 15s)
const C = {
  ink: '#07070A', paper: '#F2EFE8', volt: '#C6FF3D', blue: '#3B5BFF', pink: '#FF4FA3',
  violet: '#120D22', gray: '#8A8A96', panel: '#111118', line: '#26262F'
};

// ---------- math / easing ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const P = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  outExpo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
  inExpo: t => t <= 0 ? 0 : Math.pow(2, 10 * t - 10),
  inOutExpo: t => t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inOutCubic: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  outQuart: t => 1 - Math.pow(1 - t, 4),
  outBack: t => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const spring = (t, f = 3, d = 7) => t <= 0 ? 0 : 1 - Math.exp(-d * t) * Math.cos(2 * Math.PI * f * t);
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const noise1 = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(a, b, t) { const A = hex2rgb(a), Bc = hex2rgb(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, Bc[i], t))).join(',')})`; }
function rgba(h, a) { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; }

// ---------- canvases ----------
const sc = document.createElement('canvas'); sc.width = W; sc.height = H;
const ctx = sc.getContext('2d');
const lay = document.createElement('canvas'); lay.width = W; lay.height = H;
const lctx = lay.getContext('2d');

// ---------- 2D helpers ----------
const F = (w, s, f = 'Pret') => `${w} ${s}px ${f === 'Pret' ? 'Pret' : f + ', Pret'}`;
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); }
function bg(c, col) { c.fillStyle = col; c.fillRect(-200, -200, W + 400, H + 400); }
function txt(c, s, x, y, f, col, align = 'left', base = 'alphabetic', ls = 0) {
  c.save(); c.font = f; c.fillStyle = col; c.textAlign = align; c.textBaseline = base; c.letterSpacing = ls + 'px'; c.fillText(s, x, y); c.restore();
}
function measure(c, s, f, ls = 0) { c.save(); c.font = f; c.letterSpacing = ls + 'px'; const w = c.measureText(s).width; c.restore(); return w; }
// masked line reveal (rises from under a clip line)
function maskText(c, s, x, y, f, col, p, size, { align = 'left', ls = 0, dir = 1, out = 0 } = {}) {
  if (p <= 0) return;
  const e = E.outExpo(clamp(p)), eo = E.inExpo(clamp(out));
  c.save(); c.font = f; c.letterSpacing = ls + 'px'; c.textAlign = align;
  const w = c.measureText(s).width; const x0 = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
  c.beginPath(); c.rect(x0 - 30, y - size * 1.08, w + 60, size * 1.42); c.clip();
  c.fillStyle = col; c.textBaseline = 'alphabetic';
  c.fillText(s, x, y + (1 - e) * size * 1.3 * dir - eo * size * 1.3 * dir); c.restore();
}
// per-character staggered rise
function charsRise(c, s, x, y, f, col, lt, t0, stg, dur, size, ls = 0) {
  c.save(); c.font = f; c.letterSpacing = ls + 'px'; c.textBaseline = 'alphabetic'; c.fillStyle = col;
  const chars = [...s]; let acc = '';
  const total = c.measureText(s).width;
  c.beginPath(); c.rect(x - 20, y - size * 1.1, total + 40, size * 1.45); c.clip();
  chars.forEach((ch, i) => {
    const px = x + c.measureText(acc).width; acc += ch;
    const p = clamp((lt - t0 - i * stg) / dur); if (p <= 0) return;
    const e = E.outExpo(p);
    c.save(); c.translate(px, y + (1 - e) * size * 1.25); c.rotate((1 - e) * 0.25); c.fillText(ch, 0, 0); c.restore();
  });
  c.restore();
}
function cursorArrow(c, x, y, s = 1, fill = '#fff', stroke = '#07070A') {
  c.save(); c.translate(x, y); c.scale(s, s);
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 34); c.lineTo(9, 26); c.lineTo(15, 40); c.lineTo(21, 37); c.lineTo(15, 24); c.lineTo(26, 24); c.closePath();
  c.fillStyle = fill; c.fill(); c.lineWidth = 2.5; c.strokeStyle = stroke; c.lineJoin = 'round'; c.stroke(); c.restore();
}
function sparkle(c, x, y, r, rot, col) {
  c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = col; c.beginPath();
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); const b = a + Math.PI / 4; c.lineTo(Math.cos(b) * r * 0.22, Math.sin(b) * r * 0.22); }
  c.closePath(); c.fill(); c.restore();
}
function label(c, s, x, y, col, p, align = 'left') { maskText(c, s, x, y, F(700, 22, 'SG'), col, p, 24, { ls: 5, align }); }
function withCam(c, z, fn, cx = W / 2, cy = H / 2) { c.save(); c.translate(cx, cy); c.scale(z, z); c.translate(-cx, -cy); fn(); c.restore(); }
function bez(p0, p1, p2, p3, t) { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; }
function drawBez(c, p0, p1, p2, p3, e) { c.beginPath(); for (let i = 0; i <= 48; i++) { const q = bez(p0, p1, p2, p3, (i / 48) * e); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); } c.stroke(); }

// ============================================================
//  SCENE 0 — BOOT  (0 → 1 bar)
// ============================================================
function s0(c, lt) {
  bg(c, C.ink);
  const ga = P(lt, 0, 0.5) * 0.13;
  c.fillStyle = `rgba(242,239,232,${ga})`;
  for (let x = 24; x < W; x += 48) for (let y = 12; y < H; y += 48) c.fillRect(x - 1.5, y - 1.5, 3, 3);

  const str = '> AI야, 디자인해줘';
  const chars = [...str];
  const f = F(700, 76, 'JB');
  const n = clamp(Math.floor((lt - 0.08) / 0.056) + 1, 0, chars.length);
  const shown = chars.slice(0, n).join('');
  const full = measure(c, str, f);
  const x0 = W / 2 - full / 2, cy = H / 2;
  const pc = E.inExpo(P(lt, 0.84, 1.1));
  if (pc < 0.985) {
    c.save(); c.translate(W / 2, cy); c.scale(1 - pc, 1 - pc * 0.86); c.translate(-W / 2, -cy);
    c.font = f; c.textBaseline = 'middle';
    c.fillStyle = mix(C.volt, C.volt, 0); c.fillText('>', x0, cy);
    c.fillStyle = mix(C.paper, C.volt, pc); c.fillText(shown.slice(1), x0 + c.measureText('>').width, cy);
    const cw = c.measureText(shown).width;
    const typing = lt < 0.08 + chars.length * 0.056;
    if (typing || Math.floor(lt * 5) % 2 === 0) { c.fillStyle = C.volt; c.fillRect(x0 + cw + 10, cy - 44, 40, 86); }
    c.restore();
  }
  // dot + construction
  if (lt > 1.06) {
    const k = P(lt, 1.06, 1.6);
    const pl = E.outExpo(P(lt, 1.1, 1.55));
    c.save();
    c.strokeStyle = rgba(C.volt, 0.85); c.lineWidth = 2;
    c.beginPath(); c.moveTo(W / 2 - pl * W, cy); c.lineTo(W / 2 + pl * W, cy); c.moveTo(W / 2, cy - pl * H); c.lineTo(W / 2, cy + pl * H); c.stroke();
    // ruler ticks
    c.lineWidth = 1.5;
    for (let i = -40; i <= 40; i++) {
      const x = W / 2 + i * 24; if (Math.abs(x - W / 2) > pl * W * 0.98 || i === 0) continue;
      const L = i % 5 === 0 ? 16 : 7; c.beginPath(); c.moveTo(x, cy - L); c.lineTo(x, cy + L); c.stroke();
    }
    for (let i = -24; i <= 24; i++) {
      const y = cy + i * 24; if (Math.abs(y - cy) > pl * H * 0.98 || i === 0) continue;
      const L = i % 5 === 0 ? 16 : 7; c.beginPath(); c.moveTo(W / 2 - L, y); c.lineTo(W / 2 + L, y); c.stroke();
    }
    // rings
    for (let i = 0; i < 3; i++) {
      const s = 1.1 + i * 0.07, pr = P(lt, s, s + 0.65); if (pr <= 0) continue;
      c.strokeStyle = rgba(C.volt, 0.8 * (1 - pr)); c.lineWidth = 2;
      c.beginPath(); c.arc(W / 2, cy, E.outExpo(pr) * (220 + i * 200), 0, 7); c.stroke();
    }
    // dashed rotating construction circle
    c.setLineDash([10, 12]); c.lineDashOffset = -lt * 120; c.strokeStyle = rgba(C.paper, 0.6 * P(lt, 1.15, 1.3));
    c.beginPath(); c.arc(W / 2, cy, 120 * E.outBack(P(lt, 1.12, 1.4)), 0, 7); c.stroke(); c.setLineDash([]);
    // coords
    if (lt > 1.2) {
      txt(c, 'x 960', W / 2 + 26, cy - 24, F(500, 20, 'SG'), rgba(C.volt, P(lt, 1.2, 1.3)));
      txt(c, 'y 540', W / 2 + 26, cy + 40, F(500, 20, 'SG'), rgba(C.volt, P(lt, 1.24, 1.34)));
    }
    c.fillStyle = C.volt; c.beginPath(); c.arc(W / 2, cy, 12 + 6 * Math.sin(k * 20) * (1 - k), 0, 7); c.fill();
    c.restore();
  }
  // volt flood
  const pf = E.inExpo(P(lt, 1.45, BAR));
  if (pf > 0) { c.fillStyle = C.volt; c.beginPath(); c.arc(W / 2, cy, pf * 1150, 0, 7); c.fill(); }
}

// ============================================================
//  SCENE 1 — TITLE SLAM  (bar 1)
// ============================================================
function marquee(c, s, y, f, col, speed, lt, size) {
  c.save(); c.font = f; c.textBaseline = 'middle'; c.fillStyle = col;
  const w = c.measureText(s).width; let x = ((lt * speed) % w + w) % w - w;
  for (; x < W + 200; x += w) c.fillText(s, x, y);
  c.restore();
}
function outlineEcho(c, s, f, x, y, col, bt, n = 4, spread = 0.12) {
  c.save(); c.font = f; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 1; i <= n; i++) {
    const sc2 = 1 + i * spread * E.outExpo(clamp(bt / 0.45));
    c.save(); c.translate(x, y); c.scale(sc2, sc2); c.strokeStyle = rgba(col, Math.max(0, (0.55 - i * 0.11) * (1 - bt / B))); c.lineWidth = 3 / sc2;
    c.strokeText(s, 0, 0); c.restore();
  }
  c.restore();
}
function s1(c, lt) {
  const k = clamp(Math.floor(lt / B), 0, 3), bt = lt - k * B;
  const cy = H / 2 + 10;
  if (k === 0) {
    bg(c, C.volt);
    marquee(c, '디자인 · DESIGN · 디자인 · DESIGN · ', 150, F(900, 120), rgba(C.ink, 0.07), -900, lt, 120);
    marquee(c, '디자인 · DESIGN · 디자인 · DESIGN · ', 930, F(900, 120), rgba(C.ink, 0.07), 900, lt, 120);
    const f = F(900, 400);
    outlineEcho(c, '디자인', f, W / 2, cy, C.ink, bt);
    const s = 1 + 0.55 * (1 - E.outExpo(clamp(bt / 0.22)));
    c.save(); c.translate(W / 2, cy); c.scale(s, s); txt(c, '디자인', 0, 0, f, C.ink, 'center', 'middle', -8); c.restore();
  } else if (k === 1) {
    bg(c, C.ink);
    marquee(c, 'HOW AI DESIGNS — 하는 — HOW AI DESIGNS — 하는 — ', 150, F(800, 90, 'Unb'), rgba(C.paper, 0.06), 1100, lt, 90);
    // previous word whipping out
    if (bt < 0.16) { const e = E.inCubic(bt / 0.16); txt(c, '디자인', W / 2 - e * 1500, cy, F(900, 400), rgba(C.volt, 1 - e), 'center', 'middle', -8); }
    const e = E.outExpo(clamp(bt / 0.24));
    c.save(); c.translate(W / 2 + (1 - e) * 1300, cy); c.transform(1, 0, -0.35 * (1 - e), 1, 0, 0);
    txt(c, '하는', 0, 0, F(900, 400), C.paper, 'center', 'middle', -8); c.restore();
    // underline swipe
    const ul = E.outExpo(P(bt, 0.1, 0.4));
    c.fillStyle = C.volt; c.fillRect(W / 2 - 380, cy + 210, 760 * ul, 18);
  } else if (k === 2) {
    bg(c, C.blue);
    const f = F(900, 560, 'Unb');
    c.save(); c.font = f; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 1; i <= 5; i++) {
      c.save(); c.translate(W / 2, cy + 20); c.rotate(Math.sin(lt * 3 + i) * 0.02 * i); const s = 1 + i * 0.16 * E.outExpo(clamp(bt / 0.4)); c.scale(s, s);
      c.strokeStyle = rgba('#FFFFFF', 0.3 - i * 0.05); c.lineWidth = 2.5 / s; c.strokeText('AI', 0, 0); c.restore();
    }
    c.restore();
    const sp = spring(bt, 2.6, 8);
    c.save(); c.translate(W / 2, cy + 20); c.rotate((1 - sp) * -0.25); c.scale(0.55 + 0.45 * sp, 0.55 + 0.45 * sp);
    txt(c, 'AI', 0, 0, f, '#FFFFFF', 'center', 'middle', -10); c.restore();
    const sps = [[520, 260, 0.05], [1420, 230, 0.1], [1500, 820, 0.14], [440, 800, 0.08]];
    sps.forEach(([x, y, d]) => { const p = clamp((bt - d) / 0.35); if (p > 0) sparkle(c, x, y, 46 * E.outBack(p) * (1 - P(bt, 0.36, B) * 0.6), p * 3, C.volt); });
  } else {
    bg(c, C.ink);
    const f1 = F(900, 210), f2 = F(900, 196, 'Unb');
    const w1 = measure(c, '디자인하는', f1, -6), w2 = measure(c, 'AI', f2, -4), gap = 22;
    const tw = w1 + gap + w2, x0 = W / 2 - tw / 2, by = cy + 30;
    const N = 7, top = by - 190, hh = 250;
    const out = E.inExpo(P(bt, B - 0.16, B));
    for (let i = 0; i < N; i++) {
      const p = clamp((bt - i * 0.022) / 0.32); if (p <= 0) continue;
      const dir = i % 2 ? 1 : -1;
      const off = (1 - E.outExpo(p)) * 1500 * dir + out * 2200 * -dir;
      c.save(); c.beginPath(); c.rect(0, top + i * hh / N, W, hh / N + 0.5); c.clip(); c.translate(off, 0);
      txt(c, '디자인하는', x0, by, f1, C.paper, 'left', 'alphabetic', -6);
      txt(c, 'AI', x0 + w1 + gap, by - 4, f2, C.volt, 'left', 'alphabetic', -4);
      c.restore();
    }
    maskText(c, 'AI × DESIGN  —  YOUTUBE CHANNEL', W / 2, by + 90, F(500, 30, 'SG'), rgba(C.paper, 0.75), P(bt, 0.12, 0.45), 32, { align: 'center', ls: 9, out: P(bt, B - 0.12, B) });
    // marquee band
    const bp = E.outExpo(P(bt, 0.05, 0.3)) * (1 - out);
    c.save(); c.fillStyle = C.volt; c.fillRect(0, 930, W * bp, 64); c.beginPath(); c.rect(0, 930, W * bp, 64); c.clip();
    marquee(c, 'FIGMA   /   MOTION GRAPHICS   /   VIBE CODING   /   CHARACTER   /   AI DESIGN   /   ', 963, F(700, 30, 'SG'), C.ink, -500, lt, 30);
    c.restore();
  }
  // transition: paper bars
  const tp = P(lt, BAR - 0.2, BAR);
  if (tp > 0) {
    for (let i = 0; i < 12; i++) {
      const p = E.inCubic(clamp((tp - i * 0.03) / 0.64)); const bw = W / 12;
      c.fillStyle = C.paper; if (i % 2) c.fillRect(i * bw, H - p * H, bw + 1, p * H); else c.fillRect(i * bw, 0, bw + 1, p * H);
    }
  }
}

// ============================================================
//  SCENE 2 — FIGMA / DESIGN TOKENS  (bar 2, light)
// ============================================================
const TOKENS = [
  { n: 'color/primary', v: '#3B5BFF', t: 'c', col: C.blue },
  { n: 'color/accent', v: '#C6FF3D', t: 'c', col: C.volt },
  { n: 'color/ink', v: '#07070A', t: 'c', col: C.ink },
  { n: 'space/8', v: '8px', t: 's', w: 8 },
  { n: 'space/16', v: '16px', t: 's', w: 16 },
  { n: 'space/32', v: '32px', t: 's', w: 32 },
  { n: 'radius/md', v: '16', t: 'r', r: 8 },
  { n: 'radius/full', v: '999', t: 'r', r: 18 },
  { n: 'color/pink', v: '#FF4FA3', t: 'c', col: C.pink },
  { n: 'font/display', v: 'Black 96', t: 'f' },
  { n: 'font/label', v: 'Bold 40', t: 'f' },
  { n: 'shadow/lg', v: '0 24 48', t: 'sh' },
];
const LINKED = [0, 7, 10, 4];
function chip(c, tk, x, y, w, h, hl) {
  c.save();
  c.shadowColor = 'rgba(20,20,40,0.10)'; c.shadowBlur = 24; c.shadowOffsetY = 8;
  rr(c, x, y, w, h, 14); c.fillStyle = '#FFFFFF'; c.fill(); c.shadowColor = 'transparent';
  c.lineWidth = hl ? 2.5 : 1; c.strokeStyle = hl ? C.blue : '#DDD9CF'; c.stroke();
  const ix = x + 14, iy = y + 14, is = h - 28;
  if (tk.t === 'c') { rr(c, ix, iy, is, is, 10); c.fillStyle = tk.col; c.fill(); if (tk.col === C.paper) { c.strokeStyle = '#ccc'; c.stroke(); } }
  else if (tk.t === 's') { c.fillStyle = rgba(C.blue, 0.15); c.fillRect(ix, iy, is, is); c.fillStyle = C.blue; c.fillRect(ix + is / 2 - tk.w / 2 * 0.9, iy, tk.w * 0.9, is); }
  else if (tk.t === 'r') { c.strokeStyle = C.ink; c.lineWidth = 3; c.beginPath(); c.moveTo(ix + 4, iy + is); c.lineTo(ix + 4, iy + tk.r + 4); c.arcTo(ix + 4, iy + 4, ix + is, iy + 4, tk.r); c.lineTo(ix + is, iy + 4); c.stroke(); }
  else if (tk.t === 'f') { txt(c, 'Aa', ix + is / 2, iy + is / 2 + 2, F(900, 26), C.ink, 'center', 'middle'); }
  else { c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 10; c.shadowOffsetY = 5; rr(c, ix + 6, iy + 4, is - 12, is - 14, 6); c.fillStyle = '#fff'; c.fill(); }
  c.shadowColor = 'transparent';
  txt(c, tk.n, x + h, y + 31, F(700, 17, 'JB'), C.ink);
  txt(c, tk.v, x + h, y + 54, F(400, 16, 'JB'), '#6B6B76');
  c.restore();
}
function s2(c, lt) {
  bg(c, C.paper);
  // canvas grid
  c.save(); c.strokeStyle = 'rgba(7,7,10,0.055)'; c.lineWidth = 1;
  for (let x = 0; x <= W; x += 64) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); c.stroke(); }
  for (let y = 0; y <= H; y += 64) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); }
  c.restore();

  const zoomOut = E.inExpo(P(lt, 1.6, BAR));
  withCam(c, 1.04 - 0.04 * E.outCubic(P(lt, 0, 0.9)), () => {
    // left copy
    label(c, '01 — DESIGN SYSTEM', 130, 300, C.blue, P(lt, 0.04, 0.4));
    maskText(c, 'Figma 변수,', 130, 420, F(800, 104), C.ink, P(lt, 0.08, 0.5), 104, { ls: -3 });
    maskText(c, 'AI가 자동으로.', 130, 535, F(800, 104), C.ink, P(lt, 0.15, 0.6), 104, { ls: -3 });
    maskText(c, '디자인 토큰 → 변수 구조 → 시스템까지', 132, 612, F(500, 32), '#4A4A55', P(lt, 0.3, 0.7), 32);
    const meta = '12 tokens · 4 collections · 1 component';
    const nm = clamp(Math.floor((lt - 0.5) / 0.018), 0, meta.length);
    txt(c, meta.slice(0, nm), 132, 676, F(400, 20, 'JB'), C.blue);

    // frame label + frame
    const fp = E.outExpo(P(lt, 0.02, 0.4));
    txt(c, 'Frame — Tokens', 1000, 150, F(700, 16, 'JB'), rgba(C.blue, fp));
    c.save(); c.strokeStyle = rgba(C.blue, 0.6 * fp); c.setLineDash([6, 6]); c.lineWidth = 1.5; c.strokeRect(992, 166, 836 * fp, 368); c.restore();

    // chips
    const cw = 256, ch = 72, gx = 18, gy = 16, ox = 1006, oy = 178;
    const linkP = P(lt, 0.86, 1.15);
    TOKENS.forEach((tk, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const p = clamp((lt - 0.06 - i * 0.035) / 0.32); if (p <= 0) return;
      const s = E.outBack(p);
      const x = ox + col * (cw + gx), y = oy + row * (ch + gy);
      c.save(); c.globalAlpha = P(p, 0, 0.35); c.translate(x + cw / 2, y + ch / 2); c.scale(s, s); c.translate(-x - cw / 2, -y - ch / 2);
      chip(c, tk, x, y, cw, ch, LINKED.includes(i) && linkP > 0.3);
      c.restore();
    });

    // component
    const bx = 1420, by = 830, bw = 380, bh = 112;
    // connectors
    LINKED.forEach((ti, j) => {
      const col = ti % 3, row = Math.floor(ti / 3);
      const sx = ox + col * (cw + gx) + cw / 2, sy = oy + row * (ch + gy) + ch;
      const e = E.inOutCubic(clamp((lt - 0.86 - j * 0.05) / 0.32)); if (e <= 0) return;
      const tx = bx - 120 + j * 80, ty = by - bh / 2;
      c.save(); c.strokeStyle = C.blue; c.lineWidth = 2.5;
      drawBez(c, [sx, sy], [sx, sy + 140], [tx, ty - 140], [tx, ty], e);
      c.fillStyle = C.blue; c.beginPath(); c.arc(sx, sy, 5, 0, 7); c.fill();
      if (e > 0.98) { c.beginPath(); c.arc(tx, ty, 5, 0, 7); c.fill(); }
      c.restore();
    });

    const ap = P(lt, 0.92, 1.2);
    if (ap > 0) {
      const click = Math.exp(-Math.max(0, lt - 1.5) * 18) * (lt > 1.5 ? 1 : 0);
      const sz = E.outBack(ap) * (1 - 0.05 * click);
      const rad = lerp(0, bh / 2, E.outCubic(P(lt, 1.0, 1.3)));
      const fillA = P(lt, 1.02, 1.22);
      const z = 1 + zoomOut * 26;
      const cx = lerp(bx, W / 2, zoomOut), cy = lerp(by, H / 2, zoomOut);
      c.save(); c.translate(cx, cy); c.scale(sz * z, sz * z);
      rr(c, -bw / 2, -bh / 2, bw, bh, rad);
      c.fillStyle = zoomOut > 0 ? mix(C.blue, C.ink, clamp(zoomOut * 1.6)) : rgba(C.blue, fillA); c.fill();
      if (fillA < 1) { c.setLineDash([8, 6]); c.strokeStyle = C.blue; c.lineWidth = 2; c.stroke(); c.setLineDash([]); }
      c.restore();
      if (zoomOut < 0.15) {
        c.save(); c.translate(bx, by); c.scale(sz, sz);
        maskText(c, '구독하기', 0, 14, F(700, 40), '#fff', P(lt, 1.12, 1.4), 40, { align: 'center' });
        // selection
        const sp = P(lt, 1.08, 1.25);
        if (sp > 0) {
          c.globalAlpha = sp; c.strokeStyle = C.blue; c.lineWidth = 2;
          c.strokeRect(-bw / 2 - 10, -bh / 2 - 10, bw + 20, bh + 20);
          [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].forEach(([u, v]) => {
            c.fillStyle = '#fff'; const hx = u * (bw / 2 + 10), hy = v * (bh / 2 + 10);
            c.fillRect(hx - 6, hy - 6, 12, 12); c.strokeRect(hx - 6, hy - 6, 12, 12);
          });
          rr(c, -62, bh / 2 + 26, 124, 32, 8); c.fillStyle = C.blue; c.fill();
          txt(c, '380 × 112', 0, bh / 2 + 48, F(700, 16, 'JB'), '#fff', 'center');
        }
        c.restore();
      }
      // cursor
      const cp = E.inOutCubic(P(lt, 1.08, 1.45));
      if (cp > 0 && zoomOut < 0.1) {
        const x = lerp(1880, bx + 70, cp), y = lerp(1060, by + 10, cp);
        if (lt > 1.5) { const rp = P(lt, 1.5, 1.8); c.strokeStyle = rgba('#FFFFFF', 0.9 * (1 - rp)); c.lineWidth = 3; c.beginPath(); c.arc(x, y, 10 + rp * 70, 0, 7); c.stroke(); }
        cursorArrow(c, x, y, 1.3 * (1 - 0.12 * click), C.ink, '#fff');
      }
    }
  });
}

// ============================================================
//  SCENE 3 — MOTION  (bar 3, dark)
// ============================================================
const NPTS = 120;
function polyPts(verts, n) {
  const segs = []; let L = 0;
  for (let i = 0; i < verts.length; i++) { const a = verts[i], b = verts[(i + 1) % verts.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push([a, b, l]); L += l; }
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = k / n * L;
    for (const [a, b, l] of segs) { if (d <= l) { const t = d / l; out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); break; } d -= l; }
  }
  return out;
}
function shapePts(i, R) {
  if (i === 0) return Array.from({ length: NPTS }, (_, k) => { const a = -Math.PI / 2 + k / NPTS * Math.PI * 2; return [Math.cos(a) * R, Math.sin(a) * R]; });
  if (i === 1) { const v = [0, 1, 2].map(j => { const a = -Math.PI / 2 + j * Math.PI * 2 / 3; return [Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15 + R * 0.12]; }); return polyPts(v, NPTS); }
  if (i === 2) { const v = []; for (let j = 0; j < 10; j++) { const a = -Math.PI / 2 + j * Math.PI / 5; const r = j % 2 ? R * 0.5 : R * 1.12; v.push([Math.cos(a) * r, Math.sin(a) * r]); } return polyPts(v, NPTS); }
  const s = R * 0.88; return polyPts([[0, -s], [s, -s], [s, s], [-s, s], [-s, -s]], NPTS);
}
const SH_R = 100;
const SHAPES = [0, 1, 2, 3].map(i => shapePts(i, SH_R));
const GROUND = 870;
function motionState(lt) {
  let idx = 0, m = 0;
  for (let k = 1; k < 4; k++) { const p = E.inOutCubic(P(lt, k * B - 0.12, k * B + 0.12)); if (p > 0) { idx = k - 1; m = p; } }
  const pts = SHAPES[idx].map((p, j) => [lerp(p[0], SHAPES[Math.min(3, idx + 1)][j][0], m), lerp(p[1], SHAPES[Math.min(3, idx + 1)][j][1], m)]);
  let rot = 0; for (let k = 1; k < 4; k++) rot += E.outBack(P(lt, k * B - 0.05, k * B + 0.3)) * (Math.PI / 2);
  const ul = clamp(lt, 0, BAR - 0.001); const u = (ul % B) / B;
  const hgt = 4 * u * (1 - u) * 190 * (lt < 3 * B ? 1 : 1 - E.outCubic(P(lt, 3 * B, 3 * B + 0.2)));
  const vel = (1 - 2 * u);
  const squash = Math.exp(-u * 22) * 0.32 + Math.exp(-(1 - u) * 30) * 0.12;
  const sy = 1 - squash + Math.abs(vel) * 0.1 * (hgt > 2 ? 1 : 0), sx = 1 / sy;
  const x = lerp(300, 960, E.inOutCubic(clamp(lt / (3 * B + 0.2))));
  return { pts, rot, x, y: GROUND - SH_R * sy - hgt, sx, sy, hgt };
}
function heightAt(t) { const u = ((clamp(t, 0, BAR) % B) / B); return 4 * u * (1 - u) * (t < 3 * B ? 1 : 1 - E.outCubic(P(t, 3 * B, 3 * B + 0.2))); }
function drawShape(c, st, fill, stroke, lw) {
  c.save(); c.translate(st.x, st.y + SH_R * st.sy); c.scale(st.sx, st.sy); c.translate(0, -SH_R); c.rotate(st.rot);
  c.beginPath(); st.pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw / Math.max(st.sx, st.sy); c.lineJoin = 'round'; c.stroke(); }
  c.restore();
}
function s3(c, lt) {
  bg(c, C.ink);
  const exit = E.inExpo(P(lt, 1.58, BAR));
  withCam(c, 1 + 0.03 * P(lt, 0, BAR), () => {
    label(c, '02 — MOTION GRAPHICS', 130, 170, C.volt, P(lt, 0.02, 0.4));
    maskText(c, 'AI로 만드는', 130, 280, F(800, 96), C.paper, P(lt, 0.06, 0.5), 96, { ls: -2 });
    maskText(c, '2D 모션그래픽', 130, 390, F(800, 96), C.paper, P(lt, 0.13, 0.55), 96, { ls: -2 });

    // ground
    const gp = E.outExpo(P(lt, 0.0, 0.5));
    c.strokeStyle = rgba(C.paper, 0.25); c.lineWidth = 2; c.beginPath(); c.moveTo(150, GROUND); c.lineTo(150 + 960 * gp, GROUND); c.stroke();
    for (let i = 0; i <= 24; i++) { const x = 150 + i * 40; if (x > 150 + 960 * gp) break; c.beginPath(); c.moveTo(x, GROUND); c.lineTo(x, GROUND + (i % 4 ? 8 : 18)); c.stroke(); }

    const st = motionState(lt);
    // shadow
    c.fillStyle = rgba('#000000', 0.0);
    c.save(); c.fillStyle = rgba(C.volt, 0.12 * (1 - st.hgt / 300)); c.beginPath(); c.ellipse(st.x, GROUND + 6, 110 * (1 - st.hgt / 500), 14, 0, 0, 7); c.fill(); c.restore();
    // onion skin
    if (exit < 0.05) for (let i = 6; i >= 1; i--) { const sti = motionState(Math.max(0, lt - i * 0.045)); drawShape(c, sti, null, rgba(C.paper, 0.32 * (1 - i / 7)), 2); }
    if (exit <= 0) drawShape(c, st, C.volt, null, 0);

    // graph editor
    const pp = E.outExpo(P(lt, 0.05, 0.45));
    const px = 1160 + (1 - pp) * 300, py = 230, pw = 660, ph = 540;
    c.save(); c.globalAlpha = pp;
    rr(c, px, py, pw, ph, 20); c.fillStyle = C.panel; c.fill(); c.strokeStyle = C.line; c.lineWidth = 1.5; c.stroke();
    txt(c, 'Graph Editor', px + 30, py + 46, F(700, 20, 'SG'), rgba(C.paper, 0.9));
    txt(c, 'position.y  ·  ease', px + pw - 30, py + 46, F(400, 16, 'JB'), C.volt, 'right');
    c.strokeStyle = C.line; c.beginPath(); c.moveTo(px, py + 70); c.lineTo(px + pw, py + 70); c.stroke();
    const gx0 = px + 40, gx1 = px + pw - 40, gy0 = py + 110, gy1 = py + ph - 50;
    c.strokeStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i <= 8; i++) { const x = lerp(gx0, gx1, i / 8); c.beginPath(); c.moveTo(x, gy0); c.lineTo(x, gy1); c.stroke(); }
    for (let i = 0; i <= 4; i++) { const y = lerp(gy0, gy1, i / 4); c.beginPath(); c.moveTo(gx0, y); c.lineTo(gx1, y); c.stroke(); }
    const mapX = t => lerp(gx0, gx1, t / BAR), mapY = v => lerp(gy1, gy0, v);
    c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath();
    for (let i = 0; i <= 200; i++) { const t = i / 200 * BAR; i ? c.lineTo(mapX(t), mapY(heightAt(t))) : c.moveTo(mapX(t), mapY(heightAt(t))); } c.stroke();
    c.strokeStyle = C.volt; c.beginPath();
    const lim = clamp(lt, 0, BAR);
    for (let i = 0; i <= 200; i++) { const t = i / 200 * lim; i ? c.lineTo(mapX(t), mapY(heightAt(t))) : c.moveTo(mapX(t), mapY(heightAt(t))); } c.stroke();
    for (let k = 0; k <= 4; k++) {
      const t = k * B; if (t > lt + 0.02) continue;
      const x = mapX(t), y = mapY(0);
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = C.paper; c.fillRect(-7, -7, 14, 14); c.restore();
      if (k < 4) { const x2 = mapX(t + B / 2), y2 = mapY(1); c.strokeStyle = rgba(C.pink, 0.9); c.lineWidth = 1.5; c.beginPath(); c.moveTo(x2 - 50, y2); c.lineTo(x2 + 50, y2); c.stroke(); c.fillStyle = C.pink; [x2 - 50, x2 + 50].forEach(hx => { c.beginPath(); c.arc(hx, y2, 5, 0, 7); c.fill(); }); }
    }
    const phx = mapX(lim); c.strokeStyle = C.pink; c.lineWidth = 2; c.beginPath(); c.moveTo(phx, gy0 - 20); c.lineTo(phx, gy1 + 10); c.stroke();
    rr(c, phx - 34, gy0 - 44, 68, 26, 6); c.fillStyle = C.pink; c.fill();
    txt(c, (lt * 24 | 0) + 'f', phx, gy0 - 25, F(700, 15, 'JB'), '#fff', 'center');
    c.restore();
    if (exit > 0) {
      const z = 1 + exit * 14;
      c.save(); c.translate(lerp(st.x, W / 2, exit), lerp(st.y, H / 2, exit)); c.scale(z, z); c.rotate(st.rot);
      c.beginPath(); st.pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
      c.fillStyle = mix(C.volt, C.blue, clamp(exit * 1.5)); c.fill(); c.restore();
    }
  });
}

// ============================================================
//  SCENE 4 — VIBE CODING  (bar 4, blue)
// ============================================================
const KW = '#FF7AC2', STR = '#C6FF3D', TAG = '#9DB4FF', PL = '#E8EAF6', CM = '#6B7096';
const CODE = [
  [['import ', KW], ['{ auth, db } ', PL], ['from ', KW], ["'./ai'", STR]],
  [],
  [['export default function ', KW], ['App', TAG], ['() {', PL]],
  [['  const ', KW], ['user = auth.', PL], ['useSession', TAG], ['()', PL]],
  [['  return ', KW], ['(', PL]],
  [['    <Page ', TAG], ['title=', PL], ['"디자인하는AI"', STR], ['>', TAG]],
  [['      <LoginForm ', TAG], ['onSubmit={auth.signIn} ', PL], ['/>', TAG]],
  [['      <Feed ', TAG], ['posts={db.posts.latest()} ', PL], ['/>', TAG]],
  [['    </Page>', TAG]],
  [['  )', PL]],
  [['}', PL]],
  [],
  [['deploy', TAG], ['(', PL], ["'designing-ai.app'", STR], [')  ', PL], ['// ✓ live', CM]],
];
const CODE_LEN = CODE.reduce((a, l) => a + l.reduce((b, s) => b + [...s[0]].length, 0) + 1, 0);
function s4(c, lt) {
  bg(c, C.blue);
  // subtle diagonal stripes
  c.save(); c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 2;
  for (let i = -20; i < 40; i++) { const x = i * 80 + (lt * 60) % 80; c.beginPath(); c.moveTo(x, 0); c.lineTo(x - 600, H); c.stroke(); } c.restore();
  label(c, '03 — VIBE CODING', 120, 118, rgba('#FFFFFF', 0.85), P(lt, 0.02, 0.4));
  maskText(c, '바이브 코딩으로 웹서비스까지', 120, 196, F(800, 70), '#FFFFFF', P(lt, 0.05, 0.5), 70, { ls: -2 });

  // editor
  const ep = E.outExpo(P(lt, 0.0, 0.4));
  const ex = 120, ey = 250 + (1 - ep) * 80, ew = 870, eh = 690;
  c.save(); c.globalAlpha = ep;
  c.shadowColor = 'rgba(0,0,30,0.45)'; c.shadowBlur = 60; c.shadowOffsetY = 24;
  rr(c, ex, ey, ew, eh, 22); c.fillStyle = '#0B0D1F'; c.fill(); c.shadowColor = 'transparent';
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(ex + 32 + i * 26, ey + 32, 8, 0, 7); c.fill(); });
  rr(c, ex + 120, ey + 14, 130, 36, 8); c.fillStyle = '#171A33'; c.fill();
  txt(c, 'app.tsx', ex + 185, ey + 38, F(400, 17, 'JB'), rgba(PL, 0.85), 'center');
  const typed = clamp((lt - 0.12) * 330, 0, CODE_LEN);
  let cnt = 0, cx = ex + 90, cyy = ey + 108, caret = null;
  c.font = F(400, 25, 'JB');
  CODE.forEach((line, li) => {
    const y = ey + 108 + li * 42;
    if (cnt <= typed) txt(c, String(li + 1).padStart(2, ' '), ex + 30, y, F(400, 20, 'JB'), rgba(CM, 0.8));
    let x = ex + 80;
    for (const [s, col] of line) {
      const ch = [...s]; const k = clamp(Math.floor(typed - cnt), 0, ch.length);
      if (k > 0) { const part = ch.slice(0, k).join(''); txt(c, part, x, y, F(400, 25, 'JB'), col); x += measure(c, part, F(400, 25, 'JB')); }
      if (typed >= cnt && typed < cnt + ch.length) caret = [x, y];
      cnt += ch.length;
    }
    if (typed >= cnt && typed < cnt + 1) caret = [x, y];
    cnt += 1;
  });
  if (!caret && typed >= CODE_LEN) caret = null;
  if (caret && (lt < 1.2 || Math.floor(lt * 6) % 2 === 0)) { c.fillStyle = C.volt; c.fillRect(caret[0] + 2, caret[1] - 24, 12, 30); }
  c.restore();

  // browser
  const q = typed / CODE_LEN;
  const bp = E.outExpo(P(lt, 0.08, 0.5));
  const bx = 1030, by = 250 + (1 - bp) * 80, bw = 780, bh = 690;
  c.save(); c.globalAlpha = bp;
  c.shadowColor = 'rgba(0,0,30,0.45)'; c.shadowBlur = 60; c.shadowOffsetY = 24;
  rr(c, bx, by, bw, bh, 22); c.fillStyle = '#FFFFFF'; c.fill(); c.shadowColor = 'transparent';
  c.save(); rr(c, bx, by, bw, bh, 22); c.clip();
  c.fillStyle = '#EEF0F7'; c.fillRect(bx, by, bw, 64);
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(bx + 32 + i * 26, by + 32, 8, 0, 7); c.fill(); });
  rr(c, bx + 130, by + 15, 520, 34, 17); c.fillStyle = '#FFFFFF'; c.fill();
  txt(c, 'designing-ai.app', bx + 390, by + 39, F(400, 17, 'JB'), '#4A4F6B', 'center');
  // load bar
  c.fillStyle = C.blue; c.fillRect(bx, by + 62, bw * clamp(q * 1.05), 3);
  const pop = (th, fn) => { const p = clamp((q - th) / 0.12); if (p <= 0) return; c.save(); c.globalAlpha = p * bp; c.translate(0, (1 - E.outCubic(p)) * 30); fn(); c.restore(); };
  const ox = bx + 40, oy = by + 64;
  pop(0.12, () => {
    c.fillStyle = C.ink; c.beginPath(); c.arc(ox + 22, oy + 48, 20, 0, 7); c.fill();
    txt(c, 'AI', ox + 22, oy + 54, F(900, 15, 'Unb'), C.volt, 'center');
    txt(c, '디자인하는AI', ox + 54, oy + 56, F(800, 24), C.ink);
    [0, 1, 2].forEach(i => { rr(c, bx + bw - 300 + i * 90, oy + 42, 66, 12, 6); c.fillStyle = '#D9DCE8'; c.fill(); });
  });
  pop(0.3, () => {
    txt(c, '오늘의 AI 디자인', ox, oy + 150, F(800, 44), C.ink);
    rr(c, ox, oy + 172, 420, 14, 7); c.fillStyle = '#E3E6F0'; c.fill();
    rr(c, ox, oy + 196, 300, 14, 7); c.fill();
  });
  pop(0.48, () => {
    rr(c, ox, oy + 240, 340, 330, 18); c.fillStyle = '#F4F5FA'; c.fill();
    txt(c, '로그인', ox + 26, oy + 290, F(700, 28), C.ink);
    rr(c, ox + 26, oy + 312, 288, 56, 12); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#D5D8E5'; c.lineWidth = 1.5; c.stroke();
    const em = 'hello@designing.ai'; const ne = clamp(Math.floor((lt - 1.0) / 0.02), 0, em.length);
    txt(c, ne ? em.slice(0, ne) : '이메일', ox + 44, oy + 348, ne ? F(400, 18, 'JB') : F(500, 19), ne ? C.ink : '#9A9EB2');
    rr(c, ox + 26, oy + 380, 288, 56, 12); c.fillStyle = '#fff'; c.fill(); c.stroke();
    const npw = clamp(Math.floor((lt - 1.25) / 0.03), 0, 8);
    txt(c, npw ? '•'.repeat(npw) : '비밀번호', ox + 44, oy + 416, F(500, npw ? 26 : 19), npw ? C.ink : '#9A9EB2');
    const click = lt > 1.5 ? Math.exp(-(lt - 1.5) * 16) : 0;
    c.save(); c.translate(ox + 170, oy + 488); c.scale(1 - click * 0.06, 1 - click * 0.06);
    rr(c, -144, -30, 288, 60, 30); c.fillStyle = C.blue; c.fill();
    txt(c, '로그인', 0, 9, F(700, 22), '#fff', 'center'); c.restore();
  });
  pop(0.66, () => {
    const grads = [[C.blue, C.pink], [C.volt, C.blue], [C.pink, C.volt]];
    for (let i = 0; i < 3; i++) {
      const p = clamp((q - 0.66 - i * 0.06) / 0.12); if (p <= 0) continue;
      const x = ox + 380, y = oy + 240 + i * 112 + (1 - E.outCubic(p)) * 40;
      c.save(); c.globalAlpha = p;
      rr(c, x, y, 320, 96, 16); c.fillStyle = '#F4F5FA'; c.fill();
      const g = c.createLinearGradient(x, y, x + 96, y + 96); g.addColorStop(0, grads[i][0]); g.addColorStop(1, grads[i][1]);
      rr(c, x + 10, y + 10, 76, 76, 12); c.fillStyle = g; c.fill();
      rr(c, x + 104, y + 26, 180, 14, 7); c.fillStyle = '#CDD1E0'; c.fill();
      rr(c, x + 104, y + 52, 120, 12, 6); c.fillStyle = '#E3E6F0'; c.fill();
      c.restore();
    }
  });
  // toast
  const tp = E.outBack(P(lt, 1.56, 1.78));
  if (tp > 0) {
    c.save(); c.translate(bx + bw / 2, by + bh - 70); c.scale(tp, tp);
    rr(c, -190, -32, 380, 64, 32); c.fillStyle = C.ink; c.fill();
    c.fillStyle = C.volt; c.beginPath(); c.arc(-150, 0, 16, 0, 7); c.fill();
    c.strokeStyle = C.ink; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(-158, 0); c.lineTo(-152, 7); c.lineTo(-141, -6); c.stroke();
    txt(c, '배포 완료 · LIVE', -120, 8, F(700, 22), '#fff');
    c.restore();
  }
  c.restore(); c.restore();
  // cursor
  const cp = E.inOutCubic(P(lt, 1.05, 1.42));
  if (cp > 0) {
    const tx = ox + 190, ty = oy + 492;
    const x = lerp(1500, tx, cp), y = lerp(1100, ty, cp);
    if (lt > 1.5) { const rp = P(lt, 1.5, 1.8); c.strokeStyle = rgba(C.blue, 0.8 * (1 - rp)); c.lineWidth = 3; c.beginPath(); c.arc(x, y, 10 + rp * 80, 0, 7); c.stroke(); }
    cursorArrow(c, x, y, 1.3, '#fff', C.ink);
  }
}

// ============================================================
//  SCENE 5 — CHARACTER BRANDING  (bar 5, violet)
// ============================================================
const BOT = { x: 1250, y: 480, s: 0.95 };
function drawBot(c, { sil = false, blink = 0, look = 0 } = {}) {
  const V = sil ? '#fff' : C.volt;
  c.lineCap = 'round'; c.strokeStyle = V; c.lineWidth = 18;
  c.beginPath(); c.moveTo(0, -190); c.lineTo(0, -246); c.stroke();
  c.fillStyle = sil ? '#fff' : C.pink; c.beginPath(); c.arc(0, -268, 28, 0, 7); c.fill();
  c.fillStyle = sil ? '#fff' : '#9FD61E'; rr(c, -266, -64, 46, 128, 20); c.fill(); rr(c, 220, -64, 46, 128, 20); c.fill();
  c.fillStyle = V; rr(c, -232, -196, 464, 384, 150); c.fill();
  if (sil) { c.globalCompositeOperation = 'destination-out'; }
  c.fillStyle = '#160F2C'; rr(c, -178, -128, 356, 236, 96); c.fill();
  c.globalCompositeOperation = 'source-over';
  const eh = 80 * (1 - 0.92 * blink);
  c.fillStyle = '#fff';
  rr(c, -98 + look * 16, -24 - eh / 2, 50, eh, 25); c.fill(); rr(c, 48 + look * 16, -24 - eh / 2, 50, eh, 25); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 12; c.beginPath(); c.arc(look * 10, 30, 34, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
  if (!sil) { c.fillStyle = rgba(C.pink, 0.85); c.beginPath(); c.ellipse(-120, 44, 22, 13, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(120, 44, 22, 13, 0, 0, 7); c.fill(); }
}
let PARTS = null;
function initParticles() {
  const off = document.createElement('canvas'); off.width = W; off.height = H; const o = off.getContext('2d');
  o.translate(BOT.x, BOT.y); o.scale(BOT.s, BOT.s); drawBot(o, { sil: true });
  const d = o.getImageData(0, 0, W, H).data; const pts = [];
  for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 7) if (d[(y * W + x) * 4 + 3] > 128) pts.push([x, y]);
  const r = rng(42); for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  const N = Math.min(1800, pts.length);
  const cols = [C.volt, C.pink, '#FFFFFF', C.blue, C.volt];
  PARTS = pts.slice(0, N).map(p => {
    const a = r() * Math.PI * 2, rad = 500 + r() * 900;
    return { tx: p[0], ty: p[1], sx: BOT.x + Math.cos(a) * rad, sy: BOT.y + Math.sin(a) * rad * 0.7, d: r() * 0.3, sz: 2.5 + r() * 3, col: cols[Math.floor(r() * cols.length)], sw: (r() - 0.5) * 2, ph: r() * 6 };
  });
}
function s5(c, lt) {
  bg(c, C.violet);
  const g = c.createRadialGradient(BOT.x, BOT.y, 0, BOT.x, BOT.y, 760);
  g.addColorStop(0, rgba(C.pink, 0.28 * P(lt, 0.2, 0.9))); g.addColorStop(1, rgba(C.pink, 0)); c.fillStyle = g; c.fillRect(0, 0, W, H);
  // ambient field
  c.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 60; i++) { const x = (hash(i) * W + lt * 30 * (0.5 + hash(i + 9))) % W, y = hash(i + 3) * H; c.fillRect(x, y, 2, 2); }

  const solid = E.outCubic(P(lt, 0.76, 0.92));
  if (solid < 1) {
    for (const p of PARTS) {
      const e = E.inOutCubic(clamp((lt - p.d) / 0.62));
      let x = lerp(p.sx, p.tx, e), y = lerp(p.sy, p.ty, e);
      const sw = Math.pow(1 - e, 2) * (2.6 + p.sw);
      const dx = x - BOT.x, dy = y - BOT.y, cs = Math.cos(sw), sn = Math.sin(sw);
      x = BOT.x + dx * cs - dy * sn; y = BOT.y + dx * sn + dy * cs;
      const burst = P(lt, 0.76, 1.2);
      if (burst > 0) { const ang = Math.atan2(p.ty - BOT.y, p.tx - BOT.x); x += Math.cos(ang) * burst * 220 * (0.5 + p.sw); y += Math.sin(ang) * burst * 220 * (0.5 + p.sw); }
      c.globalAlpha = (0.45 + 0.55 * clamp(e * 3)) * (1 - solid * 0.85) * (1 - P(lt, 0.9, 1.25));
      c.fillStyle = p.col; const s = p.sz * (1 + (1 - e) * 1.5); c.fillRect(x - s / 2, y - s / 2, s, s);
    }
    c.globalAlpha = 1;
  }
  if (solid > 0) {
    const pop = E.outBack(P(lt, 0.76, 1.05));
    const bob = Math.sin((lt - 0.9) * 7) * 8 * P(lt, 0.9, 1.1);
    const blink = Math.max(0, 1 - Math.abs(lt - 1.36) / 0.06);
    const look = E.inOutCubic(P(lt, 1.0, 1.15)) - 2 * E.inOutCubic(P(lt, 1.5, 1.65));
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(BOT.x, BOT.y + 250, 200 - bob * 2, 22, 0, 0, 7); c.fill();
    c.save(); c.globalAlpha = solid; c.translate(BOT.x, BOT.y + bob); const s = BOT.s * (0.88 + 0.12 * pop); c.scale(s, s);
    drawBot(c, { blink, look: clamp(look, -1, 1) }); c.restore();
  }
  // callouts
  const calls = [
    { ax: BOT.x + 232 * BOT.s, ay: BOT.y - 120, lx: 1600, ly: 300, k: 'SHAPE', v: 'squircle · r150', t: 0.94 },
    { ax: BOT.x + 75 * BOT.s, ay: BOT.y - 20, lx: 1640, ly: 520, k: 'EXPRESSION', v: '12 variants', t: 1.02 },
    { ax: BOT.x, ay: BOT.y - 268 * BOT.s, lx: 1560, ly: 150, k: 'COLOR', v: '#C6FF3D / #FF4FA3', t: 1.1 },
  ];
  calls.forEach(cl => {
    const p = E.outExpo(P(lt, cl.t, cl.t + 0.35)); if (p <= 0) return;
    c.save(); c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.5;
    const ex = cl.lx - 20, ey = cl.ly;
    const L1 = Math.hypot(ex - cl.ax, ey - cl.ay), L2 = 180, tot = L1 + L2, d = p * tot;
    c.beginPath(); c.moveTo(cl.ax, cl.ay);
    if (d < L1) c.lineTo(lerp(cl.ax, ex, d / L1), lerp(cl.ay, ey, d / L1)); else { c.lineTo(ex, ey); c.lineTo(ex + (d - L1), ey); }
    c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(cl.ax, cl.ay, 6, 0, 7); c.fill();
    c.strokeStyle = '#fff'; c.beginPath(); c.arc(cl.ax, cl.ay, 6 + 10 * p, 0, 7); c.globalAlpha = 1 - p; c.stroke(); c.globalAlpha = 1;
    maskText(c, cl.k, cl.lx, cl.ly - 14, F(700, 16, 'SG'), C.pink, P(lt, cl.t + 0.12, cl.t + 0.4), 16, { ls: 4 });
    maskText(c, cl.v, cl.lx, cl.ly + 28, F(400, 21, 'JB'), '#fff', P(lt, cl.t + 0.16, cl.t + 0.45), 21);
    c.restore();
  });
  // palette
  const pal = [C.volt, C.pink, C.blue, C.paper, '#160F2C'];
  pal.forEach((col, i) => {
    const p = clamp((lt - 3 * B - i * 0.04) / 0.3); if (p <= 0) return;
    const x = BOT.x - 2 * 84 + i * 84, y = 870;
    c.save(); c.translate(x, y); c.scale(E.outBack(p), E.outBack(p));
    c.fillStyle = col; c.beginPath(); c.arc(0, 0, 30, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2; c.stroke(); c.restore();
  });
  label(c, '04 — CHARACTER BRANDING', 130, 690, C.pink, P(lt, 0.05, 0.45));
  maskText(c, 'Firefly로 만드는', 130, 795, F(800, 88), '#FFFFFF', P(lt, 0.1, 0.55), 88, { ls: -2 });
  maskText(c, '캐릭터 브랜딩', 130, 895, F(800, 88), '#FFFFFF', P(lt, 0.17, 0.62), 88, { ls: -2 });
  // diagonal slash exit
  const xp = E.inCubic(P(lt, BAR - 0.2, BAR));
  if (xp > 0) {
    const L = lerp(-400, W + 420, xp);
    c.fillStyle = C.ink; c.beginPath(); c.moveTo(-2000, 0); c.lineTo(L + 220, 0); c.lineTo(L - 220, H); c.lineTo(-2000, H); c.fill();
    c.strokeStyle = C.volt; c.lineWidth = 10; c.beginPath(); c.moveTo(L + 240, -10); c.lineTo(L - 200, H + 10); c.stroke();
  }
}

// ============================================================
//  SCENE 6 — NUMBERS  (bar 6)
// ============================================================
function odometer(c, str, cx, cy, f, size, col, lt, t0) {
  c.save(); c.font = f; c.textBaseline = 'middle'; c.textAlign = 'center';
  const dw = c.measureText('0').width * 1.02, cw = c.measureText(',').width * 1.1;
  const chars = [...str]; const tw = chars.reduce((a, ch) => a + (ch === ',' ? cw : dw), 0);
  let x = cx - tw / 2; let di = 0;
  chars.forEach(ch => {
    const w = ch === ',' ? cw : dw;
    if (ch === ',') { c.fillStyle = col; c.fillText(',', x + w / 2, cy); }
    else {
      const v = +ch, j = di++;
      const p = E.outCubic(clamp((lt - t0) / (0.45 + j * 0.07)));
      const pos = p * (v + 10 * (2 + j));
      const base = Math.floor(pos), fr = pos - base;
      c.save(); c.beginPath(); c.rect(x - 4, cy - size * 0.62, w + 8, size * 1.24); c.clip();
      c.fillStyle = col;
      c.fillText(String(base % 10), x + w / 2, cy - fr * size * 1.1);
      c.fillText(String((base + 1) % 10), x + w / 2, cy + (1 - fr) * size * 1.1);
      c.restore();
    }
    x += w;
  });
  c.restore();
}
function s6(c, lt) {
  const k = clamp(Math.floor(lt / B), 0, 3), bt = lt - k * B;
  if (k < 2) {
    bg(c, C.ink);
    c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
    for (let i = 0; i < 12; i++) { c.beginPath(); c.moveTo(i * 160 + 80, 0); c.lineTo(i * 160 + 80, H); c.stroke(); }
    maskText(c, 'SUBSCRIBERS', W / 2, 330, F(700, 28, 'SG'), C.paper, P(lt, 0.0, 0.3), 28, { align: 'center', ls: 14 });
    const s = 1 + 0.15 * (1 - E.outExpo(clamp(lt / 0.3)));
    c.save(); c.translate(W / 2, 540); c.scale(s, s); odometer(c, '99,100', 0, 0, F(900, 250, 'Unb'), 250, C.volt, lt, 0); c.restore();
    const ul = E.outExpo(P(lt, B, B + 0.3));
    c.fillStyle = C.volt; c.fillRect(W / 2 - 560, 712, 1120 * ul, 10);
    maskText(c, '구독자 9.9만  ·  2026.10 기준', W / 2, 790, F(500, 30), rgba(C.paper, 0.7), P(lt, 0.25, 0.6), 30, { align: 'center' });
  } else if (k === 2) {
    bg(c, C.blue);
    marquee(c, 'VIEWS  VIEWS  VIEWS  VIEWS  ', 140, F(900, 130, 'Unb'), 'rgba(255,255,255,0.08)', -1400, lt, 130);
    marquee(c, 'VIEWS  VIEWS  VIEWS  VIEWS  ', 950, F(900, 130, 'Unb'), 'rgba(255,255,255,0.08)', 1400, lt, 130);
    const sp = spring(bt, 2.4, 9);
    c.save(); c.translate(W / 2, 520); c.scale(0.5 + 0.5 * sp, 0.5 + 0.5 * sp); c.rotate((1 - sp) * 0.15);
    txt(c, '6.6M+', 0, 0, F(900, 300, 'Unb'), '#fff', 'center', 'middle', -8); c.restore();
    maskText(c, '누적 조회수 666만+', W / 2, 760, F(700, 40), '#fff', P(bt, 0.08, 0.35), 40, { align: 'center' });
  } else {
    bg(c, C.ink);
    const e1 = E.outExpo(clamp(bt / 0.28)), e2 = E.outExpo(clamp((bt - 0.04) / 0.28));
    c.save(); c.translate(0, -(1 - e1) * H);
    c.fillStyle = C.paper; c.fillRect(0, -10, W / 2, H + 20);
    txt(c, '61', W / 4, 500, F(900, 300, 'Unb'), C.ink, 'center', 'middle', -10);
    txt(c, 'VIDEOS · 업로드 영상', W / 4, 740, F(700, 34), C.ink, 'center', 'alphabetic', 2);
    c.restore();
    c.save(); c.translate(0, (1 - e2) * H);
    c.fillStyle = C.volt; c.fillRect(W / 2, -10, W / 2, H + 20);
    txt(c, '2023', W * 0.75, 500, F(900, 230, 'Unb'), C.ink, 'center', 'middle', -8);
    txt(c, 'SINCE · 채널 개설', W * 0.75, 740, F(700, 34), C.ink, 'center', 'alphabetic', 2);
    c.restore();
  }
}

// ============================================================
//  SCENE 7 — LOCKUP / END  (bar 7)
// ============================================================
const DUST = Array.from({ length: 140 }, (_, i) => ({ x: hash(i * 3.1) * W, y: hash(i * 7.7) * H, s: 1 + hash(i * 1.3) * 2.5, v: 10 + hash(i * 5.5) * 40 }));
function logoMark(c, x, y, S, lt) {
  const tr = P(lt, 0.0, 0.32), fp = P(lt, 0.22, 0.5);
  c.save(); c.translate(x, y);
  const r = S * 0.27, per = 4 * S - (8 - 2 * Math.PI) * r;
  if (fp < 1) { c.save(); rr(c, -S / 2, -S / 2, S, S, r); c.setLineDash([per, per]); c.lineDashOffset = per * (1 - E.inOutCubic(tr)); c.strokeStyle = C.volt; c.lineWidth = 5; c.stroke(); c.restore(); }
  const s = E.outBack(fp);
  if (fp > 0) { c.save(); c.scale(s, s); rr(c, -S / 2, -S / 2, S, S, r); c.fillStyle = C.volt; c.fill(); c.restore(); }
  const ap = E.outBack(P(lt, 0.36, 0.62));
  if (ap > 0) {
    c.save(); c.beginPath(); c.roundRect(-S / 2, -S / 2, S, S, r); c.clip();
    cursorArrow(c, -S * 0.2 + (1 - ap) * -60, -S * 0.22 + (1 - ap) * 60, S / 62, C.ink, C.ink);
    c.restore();
  }
  const sp = spring(P(lt, 0.48, 1.2) * 0.72, 2.2, 7);
  if (lt > 0.48) sparkle(c, S * 0.2, -S * 0.18, S * 0.2 * sp, (1 - sp) * 2 + lt * 0.6, C.ink);
  c.restore();
}
function s7(c, lt) {
  bg(c, C.ink);
  const g = c.createRadialGradient(W / 2, 470, 0, W / 2, 470, 900); g.addColorStop(0, '#1A1A26'); g.addColorStop(1, C.ink); c.fillStyle = g; c.fillRect(0, 0, W, H);
  DUST.forEach(d => { c.fillStyle = rgba(C.paper, 0.18); c.fillRect(d.x, (d.y - lt * d.v + H) % H, d.s, d.s); });
  withCam(c, 1 + 0.035 * E.outCubic(P(lt, 0, BAR)), () => {
    const f1 = F(900, 132), f2 = F(900, 124, 'Unb');
    const w1 = measure(c, '디자인하는', f1, -4), w2 = measure(c, 'AI', f2, -2);
    const S = 176, gap = 52, tw = S + gap + w1 + 20 + w2;
    const x0 = W / 2 - tw / 2, cy = 480;
    // logo slides from center to left position
    const slide = E.inOutExpo(P(lt, 0.3, 0.7));
    const lx = lerp(W / 2, x0 + S / 2, slide);
    // wordmark on layer (for light sweep)
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, W, H);
    const wx = x0 + S + gap, base = cy + 48;
    charsRise(lctx, '디자인하는', wx, base, f1, C.paper, lt, 0.46, 0.04, 0.5, 132, -4);
    charsRise(lctx, 'AI', wx + w1 + 20, base - 2, f2, C.volt, lt, 0.68, 0.05, 0.5, 124, -2);
    const sw = P(lt, 1.0, 1.5);
    if (sw > 0 && sw < 1) {
      lctx.save(); lctx.globalCompositeOperation = 'source-atop';
      const sx = lerp(wx - 300, wx + w1 + w2 + 300, E.inOutCubic(sw));
      const lg = lctx.createLinearGradient(sx - 160, 0, sx + 160, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      lctx.fillStyle = lg; lctx.fillRect(0, 0, W, H); lctx.restore();
    }
    c.drawImage(lay, 0, 0);
    logoMark(c, lx, cy, S, lt);
    // divider + tagline
    const dl = E.outExpo(P(lt, 0.78, 1.2));
    c.fillStyle = rgba(C.paper, 0.25); c.fillRect(W / 2 - 400 * dl, 610, 800 * dl, 2);
    maskText(c, 'AI × DESIGN  ·  모션그래픽  ·  피그마  ·  바이브 코딩', W / 2, 680, F(500, 32), rgba(C.paper, 0.75), P(lt, 0.85, 1.25), 32, { align: 'center', ls: 1 });
    maskText(c, 'SHOWREEL 2026  —  MOTION DESIGN BY CLAUDE', W / 2, 940, F(500, 20, 'SG'), rgba(C.paper, 0.5), P(lt, 1.05, 1.4), 20, { align: 'center', ls: 8 });
  });
  const fo = P(lt, BAR - 0.2, BAR);
  if (fo > 0) { c.fillStyle = `rgba(0,0,0,${E.inCubic(fo)})`; c.fillRect(0, 0, W, H); }
}

// ============================================================
//  HUD
// ============================================================
const SECT = ['BOOT', 'INTRO', 'DESIGN SYSTEM', 'MOTION', 'VIBE CODING', 'CHARACTER', 'NUMBERS', 'OUTRO'];
function hudLight(t) { // true when background is light → dark HUD
  const bar = Math.floor(t / BAR), lt = t - bar * BAR, k = Math.floor(lt / B);
  if (bar === 1) return k === 0; if (bar === 2) return true; if (bar === 6) return k === 3;
  return false;
}
function hud(c, t, ft) {
  const a = P(t, 0.15, 0.5) * (1 - P(t, 7 * BAR + 0.2, 7 * BAR + 0.6));
  if (a <= 0) return;
  const col = hudLight(t) ? C.ink : C.paper;
  c.save(); c.globalAlpha = a; c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2;
  const m = 44, L = 28;
  [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, u, v]) => { c.beginPath(); c.moveTo(x + u * L, y); c.lineTo(x, y); c.lineTo(x, y + v * L); c.stroke(); });
  const fr = Math.round(ft * FPS), ss = Math.floor(fr / FPS), ff = fr % FPS;
  txt(c, '디자인하는AI — SHOWREEL 2026', m + 44, m + 22, F(600, 18), col);
  txt(c, `TC 00:00:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`, W - m - 44, m + 22, F(400, 18, 'JB'), col, 'right');
  const bar = clamp(Math.floor(t / BAR), 0, 7);
  txt(c, `${String(bar).padStart(2, '0')} / 07  ${SECT[bar]}`, m + 44, H - m - 30, F(700, 16, 'SG'), col, 'left', 'alphabetic', 3);
  txt(c, '1920×1080 · 60FPS · 128BPM', W - m - 44, H - m - 30, F(400, 16, 'JB'), col, 'right');
  // progress
  const y = H - m - 8, x0 = m + 44, x1 = W - m - 44;
  c.globalAlpha = a * 0.25; c.fillRect(x0, y, x1 - x0, 2);
  c.globalAlpha = a; c.fillRect(x0, y, (x1 - x0) * (ft / DUR), 2);
  for (let i = 0; i <= 8; i++) { const x = lerp(x0, x1, i / 8); c.fillRect(x - 1, y - 5, 2, 12); }
  // beat dot
  const bp = Math.exp(-((t % B)) * 10);
  c.beginPath(); c.arc(W / 2, m + 16, 5 + bp * 3, 0, 7); c.fillStyle = bar >= 1 ? (hudLight(t) ? C.ink : C.volt) : col; c.globalAlpha = a * (0.4 + 0.6 * bp); c.fill();
  c.restore();
}

// ============================================================
//  DIRECTOR — scene routing, transitions, shake
// ============================================================
const SCENES = [s0, s1, s2, s3, s4, s5, s6, s7];
const SHAKES = [[BAR, 26], [BAR + B, 14], [BAR + 2 * B, 20], [BAR + 3 * B, 10], [6 * BAR, 14], [6 * BAR + 2 * B, 18], [6 * BAR + 3 * B, 12], [7 * BAR, 8]];
function shake(t) {
  let x = 0, y = 0;
  for (const [t0, a] of SHAKES) { const d = t - t0; if (d < 0 || d > 0.5) continue; const k = a * Math.exp(-d * 10); x += k * noise1(d * 38 + t0 * 10); y += k * noise1(d * 38 + t0 * 10 + 50); }
  return [x, y];
}
function drawScene(t, ft) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const [sx, sy] = shake(t);
  ctx.save(); ctx.translate(sx, sy);
  const bar = clamp(Math.floor(t / BAR), 0, 7), lt = t - bar * BAR;
  const T45 = 5 * BAR, PW = 0.17;
  if (t > T45 - PW && t < T45 + PW) {
    const e = E.inOutCubic(P(t, T45 - PW, T45 + PW));
    ctx.save(); ctx.translate(-W * e, 0); s4(ctx, Math.min(t - 4 * BAR, BAR)); ctx.restore();
    ctx.save(); ctx.translate(W * (1 - e), 0); ctx.beginPath(); ctx.rect(0, -200, W, H + 400); ctx.clip(); s5(ctx, Math.max(0, t - T45)); ctx.restore();
  } else {
    SCENES[bar](ctx, lt);
  }
  ctx.restore();
  hud(ctx, t, ft);
}

// ============================================================
//  WebGL: accumulation + post
// ============================================================
const out = document.getElementById('out');
const gl = out.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
const VS = `#version 300 es
in vec2 p; out vec2 vUv; void main(){ vUv=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }`;
const FS_ACC = `#version 300 es
precision highp float; uniform sampler2D uTex; uniform float uW; in vec2 vUv; out vec4 o;
void main(){ vec3 c=texture(uTex,vUv).rgb; c=pow(c,vec3(2.2)); o=vec4(c*uW,1.); }`;
const FS_POST = `#version 300 es
precision highp float; uniform sampler2D uTex; uniform vec2 uRes; uniform float uTime,uCA,uGlitch,uFlash,uGrain;
in vec2 vUv; out vec4 o;
float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
vec3 tx(vec2 uv){ return pow(max(texture(uTex,uv).rgb,0.),vec3(1./2.2)); }
void main(){
  vec2 uv=vUv;
  float fr=floor(uTime*30.);
  if(uGlitch>0.001){
    float rows=mix(14.,46.,h(vec2(fr,1.7)));
    float row=floor(uv.y*rows);
    float r=h(vec2(row,fr));
    if(r<uGlitch*0.55) uv.x+=(h(vec2(row,fr+3.1))-0.5)*0.18*uGlitch;
  }
  vec2 d=uv-0.5;
  vec2 off=d*2.0*vec2(uCA/uRes.x,uCA/uRes.y) + vec2(uGlitch*14./uRes.x,0.);
  vec3 c=vec3(tx(uv+off).r, tx(uv).g, tx(uv-off).b);
  float v=smoothstep(1.05,0.3,length(d*vec2(1.0,0.85)));
  c*=mix(0.78,1.0,v);
  float n=h(uv*uRes+fract(uTime*7.13)*91.7)-0.5;
  c+=n*uGrain;
  c=mix(c,vec3(1.),clamp(uFlash,0.,1.));
  o=vec4(c,1.);
}`;
function prog(fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); return p;
}
const pAcc = prog(FS_ACC), pPost = prog(FS_POST);
const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
function mkTex(internal, fmt, type) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, internal, W, H, 0, fmt, type, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
const srcTex = mkTex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
const accTex = hasFloat ? mkTex(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT) : mkTex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accTex, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

// FX envelopes
const pulses = (t, list, decay) => list.reduce((a, [t0, amp]) => { const d = t - t0; return d >= 0 ? a + amp * Math.exp(-d * decay) : a; }, 0);
function fx(t) {
  const ca = 1.6 + pulses(t, [[BAR, 14], [BAR + B, 8], [BAR + 2 * B, 12], [BAR + 3 * B, 6], [2 * BAR, 6], [3 * BAR, 6], [4 * BAR, 6], [6 * BAR, 10], [6 * BAR + 2 * B, 12], [6 * BAR + 3 * B, 8], [7 * BAR, 10]], 9);
  let gli = pulses(t, [[BAR, 0.35], [BAR + 2 * B, 0.25], [6 * BAR + 2 * B, 0.3]], 14);
  const T45 = 5 * BAR; gli += Math.max(0, 1 - Math.abs(t - T45) / 0.14) * 0.9;
  gli += Math.max(0, 1 - Math.abs(t - 6 * BAR) / 0.08) * 0.4;
  let flash = pulses(t, [[BAR, 0.35], [7 * BAR, 0.95]], 9);
  flash += E.inExpo(P(t, 7 * BAR - 0.1, 7 * BAR)) * 0.9 * (t < 7 * BAR ? 1 : 0);
  return { ca, gli: Math.min(1, gli), flash: Math.min(1, flash) };
}

const SUB = 5, SHUTTER = 0.6;
window.renderFrame = function (i, quality = 0.94) {
  const t = i / FPS;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(pAcc); gl.uniform1i(gl.getUniformLocation(pAcc, 'uTex'), 0); gl.uniform1f(gl.getUniformLocation(pAcc, 'uW'), 1 / SUB);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (let s = 0; s < SUB; s++) {
    const ts = clamp(t + ((s + 0.5) / SUB - 0.5) * SHUTTER / FPS, 0, DUR - 1e-4);
    drawScene(ts, t);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sc);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
  gl.useProgram(pPost);
  const f = fx(t);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex);
  gl.uniform1i(gl.getUniformLocation(pPost, 'uTex'), 0);
  gl.uniform2f(gl.getUniformLocation(pPost, 'uRes'), W, H);
  gl.uniform1f(gl.getUniformLocation(pPost, 'uTime'), t);
  gl.uniform1f(gl.getUniformLocation(pPost, 'uCA'), f.ca);
  gl.uniform1f(gl.getUniformLocation(pPost, 'uGlitch'), f.gli);
  gl.uniform1f(gl.getUniformLocation(pPost, 'uFlash'), f.flash);
  gl.uniform1f(gl.getUniformLocation(pPost, 'uGrain'), 0.045);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return out.toDataURL('image/jpeg', quality);
};
window.ready = (async () => {
  const loads = ['900 40px Pret', '800 40px Pret', '700 40px Pret', '600 40px Pret', '500 40px Pret', '900 40px Unb', '800 40px Unb', '500 40px SG', '700 40px SG', '400 40px JB', '700 40px JB'];
  await Promise.all(loads.map(l => document.fonts.load(l, 'Aa가힣01')));
  await document.fonts.ready;
  initParticles();
  return { hasFloat, parts: PARTS.length };
})();
