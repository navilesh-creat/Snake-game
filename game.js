'use strict';
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
const BOX = 20, COLS = cv.width / BOX, ROWS = cv.height / BOX;
const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
const rand = n => Math.floor(Math.random() * n);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

// ---------- Content: themes, modes, maps, skins ----------
const THEMES = {
  Meadow: { a: '#a8d86e', b: '#9ccf63', bg: ['#2d6a4f', '#1b4332'], acc: '#ffd166', wall: '#6b4f3a' },
  Night:  { a: '#1d2b53', b: '#233366', bg: ['#0b132b', '#05070f'], acc: '#7bdff2', wall: '#5a6aa0' },
  Desert: { a: '#f2d59b', b: '#ecca88', bg: ['#c97b3d', '#7a3e17'], acc: '#fff1c1', wall: '#8a5a2b' },
  Ice:    { a: '#d9f0ff', b: '#cbe8fb', bg: ['#4a90c2', '#1d4e7a'], acc: '#ffffff', wall: '#7fa7c4' },
  Neon:   { a: '#14102b', b: '#1a1438', bg: ['#2b0a4a', '#0a0220'], acc: '#ff2bd6', wall: '#00f0ff', glow: true }
};
const MODES = {
  Classic:        { wrap: false, speed: 1,   desc: 'Walls are deadly' },
  Wrap:           { wrap: true,  speed: 1,   desc: 'Pass through the walls' },
  'Time Attack':  { wrap: true,  speed: .9,  time: 45, desc: 'Apples add time. Beat the clock' },
  Hardcore:       { wrap: false, speed: .75, rocks: true, desc: 'Fast, and rocks appear as you eat' }
};
const inMid = v => v >= 11 && v <= 12;
const MAPS = {
  Open: () => false,
  Box: (x, y) => ((x == 4 || x == 19) && y >= 4 && y <= 19 && !inMid(y)) ||
                 ((y == 4 || y == 19) && x >= 4 && x <= 19 && !inMid(x)),
  Cross: (x, y) => (inMid(x) && (y < 7 || y > 16)) || (inMid(y) && (x < 6 || x > 17)),
  Pillars: (x, y) => (x % 6 == 3 || x % 6 == 4) && (y % 6 == 3 || y % 6 == 4) && !(y >= 11 && y <= 13)
};
let now = 0;
const SKINS = {
  Emerald: { f: i => [hsl(130 + i * 3, 70, 58), hsl(130 + i * 3, 70, 33)] },
  Fire:    { f: i => [hsl(Math.max(8, 48 - i * 3), 95, 60), hsl(Math.max(0, 28 - i * 2), 90, 38)], glow: '#ff6a00' },
  Ocean:   { f: i => [hsl(190 + i * 4, 80, 62), hsl(215 + i * 4, 80, 35)] },
  Rainbow: { f: i => [hsl((i * 30 + now / 6) % 360, 85, 62), hsl((i * 30 + now / 6) % 360, 85, 38)] },
  Candy:   { f: i => i % 2 ? ['#ffffff', '#d9d9e8'] : ['#ff7aa8', '#c2185b'] },
  Gold:    { f: i => [i % 3 ? '#ffe27a' : '#fff6c9', '#b8860b'], glow: '#ffd700' },
  Shadow:  { f: i => [hsl(265, 35, Math.max(18, 34 - i)), hsl(265, 40, 10)], glow: '#a855f7', eye: '#d8b4fe' }
};
const GROUPS = { mode: MODES, map: MAPS, skin: SKINS, theme: THEMES };

let sel = { mode: 'Classic', map: 'Open', skin: 'Emerald', theme: 'Meadow', ...store.get('snake-prefs', {}) };
for (const k in GROUPS) if (!GROUPS[k][sel[k]]) sel[k] = Object.keys(GROUPS[k])[0];

// ---------- State ----------
let state = 'menu', M = MODES[sel.mode];
let snake = [], prev = [], dir = { x: 1, y: 0 }, queue = [], food = null, bonus = null, rocks = new Set();
let score = 0, apples = 0, level = 1, best = 0, newBest = false, tickMs = 150, acc = 0, timeLeft = 0;
let shake = 0, particles = [], last = 0;

const bestKey = () => `snake-best-${sel.mode}-${sel.map}`;
const blocked = (x, y) => MAPS[sel.map](x, y) || rocks.has(x + ',' + y);
const speedFor = () => Math.max(55, 150 - (level - 1) * 9) * M.speed;

// ---------- Sound ----------
let AC, muted = store.get('snake-muted', false);
function beep(f, d = .08, type = 'square', v = .05) {
  if (muted) return;
  try {
    AC = AC || new AudioContext();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = v;
    o.connect(g); g.connect(AC.destination); o.start();
    g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); o.stop(AC.currentTime + d);
  } catch {}
}
function toggleSound() {
  muted = !muted; store.set('snake-muted', muted);
  $('sound').textContent = muted ? 'Sound off' : 'Sound on';
}

// ---------- UI helpers ----------
function show(id) { ['menu', 'pause', 'over'].forEach(p => $(p).classList.toggle('hidden', p !== id)); }
function toast(t) {
  const el = $('toast'); el.textContent = t;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function hud() {
  $('score').textContent = score; $('level').textContent = level; $('best').textContent = best;
  $('xp').firstElementChild.style.width = (apples % 5) * 20 + '%';
  $('timebox').classList.toggle('hidden', !(state !== 'menu' && M.time));
  $('time').textContent = Math.ceil(timeLeft);
}
function applyTheme() {
  const T = THEMES[sel.theme], r = document.documentElement.style;
  r.setProperty('--bg1', T.bg[0]); r.setProperty('--bg2', T.bg[1]); r.setProperty('--acc', T.acc);
}
function buildOptions() {
  for (const k in GROUPS) {
    const box = $('opt-' + k); box.innerHTML = '';
    for (const name in GROUPS[k]) {
      const b = document.createElement('button');
      b.className = 'chip' + (sel[k] === name ? ' on' : '');
      b.dataset.k = k; b.dataset.v = name;
      let sw = '';
      if (k === 'skin') { const f = SKINS[name].f; sw = `<i class="sw" style="background:linear-gradient(90deg,${f(0)[0]},${f(5)[0]},${f(10)[1]})"></i>`; }
      if (k === 'theme') { const T = THEMES[name]; sw = `<i class="sw" style="background:linear-gradient(90deg,${T.a},${T.bg[0]},${T.acc})"></i>`; }
      if (k === 'mode') b.title = MODES[name].desc;
      b.innerHTML = sw + name; box.append(b);
    }
  }
}
function resetStats() { score = 0; apples = 0; level = 1; timeLeft = 0; best = store.get(bestKey(), 0); hud(); }

// ---------- Game flow ----------
function freeCell(far) {
  for (let n = 0; n < 600; n++) {
    const c = { x: rand(COLS), y: rand(ROWS) };
    if (blocked(c.x, c.y) || snake.some(s => s.x === c.x && s.y === c.y)) continue;
    if ((food && food.x === c.x && food.y === c.y) || (bonus && bonus.x === c.x && bonus.y === c.y)) continue;
    if (far && Math.abs(c.x - snake[0].x) + Math.abs(c.y - snake[0].y) < 6) continue;
    return c;
  }
  return null;
}
function startGame() {
  M = MODES[sel.mode]; rocks = new Set(); particles = [];
  snake = [{ x: 10, y: 12 }, { x: 9, y: 12 }, { x: 8, y: 12 }];
  prev = snake.map(s => ({ ...s }));
  dir = { x: 1, y: 0 }; queue = []; food = null; bonus = null; newBest = false; acc = 0;
  resetStats(); level = 1; tickMs = speedFor(); timeLeft = M.time || 0;
  food = freeCell(); state = 'play'; show(null); hud(); beep(440, .1);
}
function pause() { if (state === 'play') { state = 'pause'; show('pause'); } }
function resume() { if (state === 'pause') { state = 'play'; show(null); } }
function toMenu() { state = 'menu'; rocks = new Set(); particles = []; resetStats(); show('menu'); }
function die(timeUp) {
  state = 'over'; shake = 12; beep(140, .35, 'sawtooth', .08);
  burst(snake[0].x * BOX + 10, snake[0].y * BOX + 10, '#ffffff', 24);
  if (newBest) store.set(bestKey(), best);
  $('o-title').textContent = timeUp ? 'Time is up' : 'Game over';
  $('o-stats').textContent = `Score ${score}  |  Level ${level}  |  Best ${best}`;
  $('o-new').classList.toggle('hidden', !newBest);
  setTimeout(() => { if (state === 'over') show('over'); }, 700);
}
function eat(isBonus) {
  score += isBonus ? 50 : 10 * level; apples++;
  burst(snake[0].x * BOX + 10, snake[0].y * BOX + 10, isBonus ? '#ffd700' : '#e63946', isBonus ? 22 : 12);
  beep(isBonus ? 880 : 520, .1);
  if (isBonus) bonus = null;
  else {
    food = freeCell();
    if (!bonus && Math.random() < .18) { const c = freeCell(); if (c) bonus = { ...c, life: 6000 }; }
    if (M.rocks && apples % 2 === 0) { const c = freeCell(true); if (c) rocks.add(c.x + ',' + c.y); }
  }
  if (M.time) timeLeft += isBonus ? 5 : 2;
  if (1 + Math.floor(apples / 5) > level) { level++; tickMs = speedFor(); toast('Level ' + level); beep(1040, .2, 'triangle'); }
  if (score > best) { best = score; newBest = true; }
  hud();
}
function update() {
  prev = snake.map(s => ({ ...s }));
  if (queue.length) dir = queue.shift();
  let hx = snake[0].x + dir.x, hy = snake[0].y + dir.y;
  if (M.wrap) { hx = (hx + COLS) % COLS; hy = (hy + ROWS) % ROWS; }
  const hitSelf = snake.slice(0, -1).some(s => s.x === hx && s.y === hy);
  if (hx < 0 || hx >= COLS || hy < 0 || hy >= ROWS || blocked(hx, hy) || hitSelf) return die();
  snake.unshift({ x: hx, y: hy });
  if (food && hx === food.x && hy === food.y) eat(false);
  else if (bonus && hx === bonus.x && hy === bonus.y) eat(true);
  else snake.pop();
}

// ---------- Input ----------
const DIRS = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
function steer(x, y) {
  if (state !== 'play') return;
  const l = queue.length ? queue[queue.length - 1] : dir;
  if ((l.x === x && l.y === y) || (l.x === -x && l.y === -y)) return;
  if (queue.length < 2) queue.push({ x, y });
}
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k in DIRS) { e.preventDefault(); steer(...DIRS[k]); }
  else if (k === 'p' || k === 'escape') { state === 'play' ? pause() : resume(); }
  else if (k === 'enter' || k === ' ') {
    e.preventDefault();
    if (state === 'menu' || state === 'over') startGame(); else resume();
  }
  else if (k === 'm') toggleSound();
});
let t0;
cv.addEventListener('touchstart', e => { t0 = e.touches[0]; }, { passive: true });
cv.addEventListener('touchend', e => {
  if (!t0) return;
  const t = e.changedTouches[0], dx = t.clientX - t0.clientX, dy = t.clientY - t0.clientY;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
  Math.abs(dx) > Math.abs(dy) ? steer(Math.sign(dx), 0) : steer(0, Math.sign(dy));
});
document.addEventListener('click', e => {
  const c = e.target.closest('.chip'), b = e.target.closest('[data-act]');
  if (c) {
    sel[c.dataset.k] = c.dataset.v; store.set('snake-prefs', sel);
    if (c.dataset.k === 'theme') applyTheme();
    resetStats(); buildOptions(); beep(660, .04);
  }
  if (b) ({ play: startGame, resume, menu: toMenu, sound: toggleSound })[b.dataset.act]();
  if (e.target.blur) e.target.blur();
});
addEventListener('blur', pause);

// ---------- Drawing ----------
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function burst(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, s = .05 + Math.random() * .15;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 500, col });
  }
}
function drawBoard(T) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    ctx.fillStyle = (r + c) % 2 ? T.b : T.a; ctx.fillRect(c * BOX, r * BOX, BOX, BOX);
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!blocked(c, r)) continue;
    ctx.shadowColor = T.glow ? T.wall : 'transparent'; ctx.shadowBlur = T.glow ? 10 : 0;
    ctx.fillStyle = T.wall; ctx.beginPath(); ctx.roundRect(c * BOX + 1, r * BOX + 1, BOX - 2, BOX - 2, 5); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(c * BOX + 4, r * BOX + 4, BOX - 8, 3);
  }
}
function drawFood() {
  const cx = food.x * BOX + 10, cy = food.y * BOX + 10, r = 7 + Math.sin(now / 200) * 1.5;
  ctx.fillStyle = 'rgba(0,0,0,.18)'; circle(cx + 1, cy + 2, r);
  ctx.fillStyle = '#e63946'; circle(cx, cy, r);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; circle(cx - 3, cy - 3, 2);
  ctx.fillStyle = '#4a7c2a'; ctx.fillRect(cx - 1, cy - r - 3, 2, 4);
}
function drawBonus() {
  const cx = bonus.x * BOX + 10, cy = bonus.y * BOX + 10, r = 6 + Math.sin(now / 120) * 1.5;
  ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14; ctx.fillStyle = '#ffd700'; circle(cx, cy, r);
  ctx.shadowBlur = 0; ctx.fillStyle = '#fff6c9'; circle(cx - 2, cy - 2, 2);
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.beginPath();
  ctx.arc(cx, cy, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * bonus.life / 6000); ctx.stroke();
}
function drawSnake(pts, d) {
  const S = SKINS[sel.skin];
  const seg = (x, y, i) => {
    const [c1, c2] = S.f(i), r = Math.max(5, BOX / 2 - i * .12);
    ctx.shadowColor = S.glow || 'transparent'; ctx.shadowBlur = S.glow ? 8 : 0;
    const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, r);
    g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; circle(x, y, r);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,.12)'; circle(x, y, r * .45);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; circle(x - r * .28, y - r * .28, r * .2);
  };
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i], q = pts[i + 1];
    if (q && Math.hypot(p.x - q.x, p.y - q.y) < BOX * 1.5) seg((p.x + q.x) / 2, (p.y + q.y) / 2, i);
    seg(p.x, p.y, i);
  }
  const h = pts[0], px = -d.y, py = d.x;
  for (const side of [-1, 1]) {
    const ex = h.x + d.x * 4 + px * 4 * side, ey = h.y + d.y * 4 + py * 4 * side;
    ctx.fillStyle = S.eye || '#fff'; circle(ex, ey, 3);
    ctx.fillStyle = '#000'; circle(ex + d.x, ey + d.y, 1.5);
  }
}
const lerpWrap = (a, b, t) => Math.abs(b - a) > 1 ? b : a + (b - a) * t;

function draw() {
  const T = THEMES[sel.theme];
  ctx.save();
  if (shake > 0) { ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake); shake = Math.max(0, shake - .6); }
  drawBoard(T);
  if (state === 'menu') {
    const pts = [];
    for (let i = 0; i < 14; i++) { const t = now / 900 - i * .16; pts.push({ x: 240 + 160 * Math.sin(t), y: 240 + 120 * Math.sin(t * 1.7 + 1) }); }
    const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y, len = Math.hypot(dx, dy) || 1;
    drawSnake(pts, { x: dx / len, y: dy / len });
  } else if (snake.length) {
    const tt = Math.min(acc / tickMs, 1);
    if (food) drawFood();
    if (bonus) drawBonus();
    const pts = snake.map((s, i) => {
      const f = prev[i] || prev[prev.length - 1];
      return { x: lerpWrap(f.x, s.x, tt) * BOX + 10, y: lerpWrap(f.y, s.y, tt) * BOX + 10 };
    });
    drawSnake(pts, dir);
  }
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / 500); ctx.fillStyle = p.col; circle(p.x, p.y, 3); }
  ctx.globalAlpha = 1; ctx.restore();
}

// ---------- Main loop ----------
function loop(t) {
  const dt = Math.min(50, t - (last || t)); last = t; now = t;
  if (state === 'play') {
    acc += dt;
    if (bonus && (bonus.life -= dt) <= 0) bonus = null;
    if (M.time) { timeLeft -= dt / 1000; $('time').textContent = Math.max(0, Math.ceil(timeLeft)); if (timeLeft <= 0) { timeLeft = 0; die(true); } }
    if (state === 'play' && acc >= tickMs) { acc -= tickMs; update(); }
  }
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  draw();
  requestAnimationFrame(loop);
}

applyTheme(); buildOptions(); resetStats();
$('sound').textContent = muted ? 'Sound off' : 'Sound on';
requestAnimationFrame(loop);
