'use strict';


const $ = id => document.getElementById(id);

const canvas = $('game');
const ctx = canvas.getContext('2d');

const CELL = 20;
const COLS = canvas.width / CELL;
const ROWS = canvas.height / CELL;

const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
const randInt = n => Math.floor(Math.random() * n);

// localStorage can throw (private mode, full disk...), so wrap it
const storage = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // not a big deal, we just won't remember it
    }
  }
};



const THEMES = {
  Meadow: { a: '#a8d86e', b: '#9ccf63', bg: ['#2d6a4f', '#1b4332'], acc: '#ffd166', wall: '#6b4f3a' },
  Night:  { a: '#1d2b53', b: '#233366', bg: ['#0b132b', '#05070f'], acc: '#7bdff2', wall: '#5a6aa0' },
  Desert: { a: '#f2d59b', b: '#ecca88', bg: ['#c97b3d', '#7a3e17'], acc: '#fff1c1', wall: '#8a5a2b' },
  Ice:    { a: '#d9f0ff', b: '#cbe8fb', bg: ['#4a90c2', '#1d4e7a'], acc: '#ffffff', wall: '#7fa7c4' },
  Neon:   { a: '#14102b', b: '#1a1438', bg: ['#2b0a4a', '#0a0220'], acc: '#ff2bd6', wall: '#00f0ff', glow: true }
};

const MODES = {
  Classic:       { wrap: false, speed: 1,    desc: 'Walls are deadly' },
  Wrap:          { wrap: true,  speed: 1,    desc: 'Pass through the walls' },
  'Time Attack': { wrap: true,  speed: 0.9,  time: 45, desc: 'Apples add time. Beat the clock' },
  Hardcore:      { wrap: false, speed: 0.75, rocks: true, desc: 'Fast, and rocks appear as you eat' }
};

const isMiddle = v => v >= 11 && v <= 12;

const MAPS = {
  Open: () => false,

  Box: (x, y) =>
    ((x === 4 || x === 19) && y >= 4 && y <= 19 && !isMiddle(y)) ||
    ((y === 4 || y === 19) && x >= 4 && x <= 19 && !isMiddle(x)),

  Cross: (x, y) =>
    (isMiddle(x) && (y < 7 || y > 16)) ||
    (isMiddle(y) && (x < 6 || x > 17)),

  Pillars: (x, y) =>
    (x % 6 === 3 || x % 6 === 4) &&
    (y % 6 === 3 || y % 6 === 4) &&
    !(y >= 11 && y <= 13)
};

// current animation time in ms, updated every frame (the rainbow skin uses it)
let now = 0;

// each skin returns [light, dark] colors for segment number i
const SKINS = {
  Emerald: { colors: i => [hsl(130 + i * 3, 70, 58), hsl(130 + i * 3, 70, 33)] },
  Fire:    { colors: i => [hsl(Math.max(8, 48 - i * 3), 95, 60), hsl(Math.max(0, 28 - i * 2), 90, 38)], glow: '#ff6a00' },
  Ocean:   { colors: i => [hsl(190 + i * 4, 80, 62), hsl(215 + i * 4, 80, 35)] },
  Rainbow: { colors: i => [hsl((i * 30 + now / 6) % 360, 85, 62), hsl((i * 30 + now / 6) % 360, 85, 38)] },
  Candy:   { colors: i => (i % 2 ? ['#ffffff', '#d9d9e8'] : ['#ff7aa8', '#c2185b']) },
  Gold:    { colors: i => [i % 3 ? '#ffe27a' : '#fff6c9', '#b8860b'], glow: '#ffd700' },
  Shadow:  { colors: i => [hsl(265, 35, Math.max(18, 34 - i)), hsl(265, 40, 10)], glow: '#a855f7', eye: '#d8b4fe' }
};

// used to build the menu chips and to validate saved preferences
const OPTION_GROUPS = { mode: MODES, map: MAPS, skin: SKINS, theme: THEMES };

// what the player has picked (saved preferences override the defaults)
const choice = {
  mode: 'Classic',
  map: 'Open',
  skin: 'Emerald',
  theme: 'Meadow',
  ...storage.get('snake-prefs', {})
};

// if a saved option no longer exists, fall back to the first one in the group
for (const group in OPTION_GROUPS) {
  if (!OPTION_GROUPS[group][choice[group]]) {
    choice[group] = Object.keys(OPTION_GROUPS[group])[0];
  }
}


// ---------- game state ----------

let state = 'menu';            // 'menu' | 'play' | 'pause' | 'over'
let mode = MODES[choice.mode];

let snake = [];
let prevSnake = [];            // positions one tick ago, for smooth movement
let dir = { x: 1, y: 0 };
let inputQueue = [];           // buffered turns so quick key presses aren't lost
let food = null;
let bonus = null;
let rocks = new Set();

let score = 0;
let applesEaten = 0;
let level = 1;
let best = 0;
let newBest = false;
let tickMs = 150;
let tickTimer = 0;
let timeLeft = 0;

let shake = 0;
let particles = [];
let lastFrame = 0;

const bestKey = () => `snake-best-${choice.mode}-${choice.map}`;
const isBlocked = (x, y) => MAPS[choice.map](x, y) || rocks.has(`${x},${y}`);
const speedForLevel = () => Math.max(55, 150 - (level - 1) * 9) * mode.speed;


// ---------- sound ----------

let audioCtx;
let muted = storage.get('snake-muted', false);

function beep(freq, duration = 0.08, type = 'square', volume = 0.05) {
  if (muted) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
  } catch {
    // audio isn't available, ignore
  }
}

function updateSoundLabel() {
  $('sound').textContent = muted ? 'Sound off' : 'Sound on';
}

function toggleSound() {
  muted = !muted;
  storage.set('snake-muted', muted);
  updateSoundLabel();
}


// ---------- UI ----------

// show one overlay panel and hide the others (pass null to hide them all)
function showPanel(id) {
  ['menu', 'pause', 'over'].forEach(name => {
    $(name).classList.toggle('hidden', name !== id);
  });
}

function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;  // forces a reflow so the animation can restart
  el.classList.add('show');
}

function updateHud() {
  $('score').textContent = score;
  $('level').textContent = level;
  $('best').textContent = best;
  $('xp').firstElementChild.style.width = (applesEaten % 5) * 20 + '%';
  $('timebox').classList.toggle('hidden', !(state !== 'menu' && mode.time));
  $('time').textContent = Math.ceil(timeLeft);
}

function applyTheme() {
  const theme = THEMES[choice.theme];
  const root = document.documentElement.style;
  root.setProperty('--bg1', theme.bg[0]);
  root.setProperty('--bg2', theme.bg[1]);
  root.setProperty('--acc', theme.acc);
}

function buildOptions() {
  for (const group in OPTION_GROUPS) {
    const container = $('opt-' + group);
    container.innerHTML = '';

    for (const name in OPTION_GROUPS[group]) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (choice[group] === name ? ' on' : '');
      chip.dataset.k = group;
      chip.dataset.v = name;

      // little color preview for skins and themes
      let swatch = '';
      if (group === 'skin') {
        const colors = SKINS[name].colors;
        swatch = `<i class="sw" style="background:linear-gradient(90deg,${colors(0)[0]},${colors(5)[0]},${colors(10)[1]})"></i>`;
      }
      if (group === 'theme') {
        const t = THEMES[name];
        swatch = `<i class="sw" style="background:linear-gradient(90deg,${t.a},${t.bg[0]},${t.acc})"></i>`;
      }
      if (group === 'mode') {
        chip.title = MODES[name].desc;
      }

      chip.innerHTML = swatch + name;
      container.append(chip);
    }
  }
}


// ---------- game logic ----------

function resetStats() {
  score = 0;
  applesEaten = 0;
  level = 1;
  timeLeft = 0;
  best = storage.get(bestKey(), 0);
  updateHud();
}

// find a random empty cell; "far" keeps it away from the snake's head
function findFreeCell(far) {
  for (let tries = 0; tries < 600; tries++) {
    const cell = { x: randInt(COLS), y: randInt(ROWS) };

    if (isBlocked(cell.x, cell.y)) continue;
    if (snake.some(part => part.x === cell.x && part.y === cell.y)) continue;
    if (food && food.x === cell.x && food.y === cell.y) continue;
    if (bonus && bonus.x === cell.x && bonus.y === cell.y) continue;

    if (far) {
      const dist = Math.abs(cell.x - snake[0].x) + Math.abs(cell.y - snake[0].y);
      if (dist < 6) continue;
    }
    return cell;
  }
  return null;  // board is basically full
}

function startGame() {
  mode = MODES[choice.mode];
  rocks = new Set();
  particles = [];

  snake = [{ x: 10, y: 12 }, { x: 9, y: 12 }, { x: 8, y: 12 }];
  prevSnake = snake.map(part => ({ ...part }));
  dir = { x: 1, y: 0 };
  inputQueue = [];
  food = null;
  bonus = null;
  newBest = false;
  tickTimer = 0;

  resetStats();
  tickMs = speedForLevel();
  timeLeft = mode.time || 0;
  food = findFreeCell();

  state = 'play';
  showPanel(null);
  updateHud();
  beep(440, 0.1);
}

function pauseGame() {
  if (state !== 'play') return;
  state = 'pause';
  showPanel('pause');
}

function resumeGame() {
  if (state !== 'pause') return;
  state = 'play';
  showPanel(null);
}

function backToMenu() {
  state = 'menu';
  rocks = new Set();
  particles = [];
  resetStats();
  showPanel('menu');
}

function gameOver(timeUp) {
  state = 'over';
  shake = 12;
  beep(140, 0.35, 'sawtooth', 0.08);
  burst(snake[0].x * CELL + 10, snake[0].y * CELL + 10, '#ffffff', 24);

  if (newBest) storage.set(bestKey(), best);

  $('o-title').textContent = timeUp ? 'Time is up' : 'Game over';
  $('o-stats').textContent = `Score ${score}  |  Level ${level}  |  Best ${best}`;
  $('o-new').classList.toggle('hidden', !newBest);

  // short delay so the crash animation can play first
  setTimeout(() => {
    if (state === 'over') showPanel('over');
  }, 700);
}

function eat(isBonus) {
  const head = snake[0];
  score += isBonus ? 50 : 10 * level;
  applesEaten++;

  burst(head.x * CELL + 10, head.y * CELL + 10, isBonus ? '#ffd700' : '#e63946', isBonus ? 22 : 12);
  beep(isBonus ? 880 : 520, 0.1);

  if (isBonus) {
    bonus = null;
  } else {
    food = findFreeCell();

    // small chance of a golden apple showing up
    if (!bonus && Math.random() < 0.18) {
      const cell = findFreeCell();
      if (cell) bonus = { ...cell, life: 6000 };
    }

    // hardcore mode drops a rock every second apple
    if (mode.rocks && applesEaten % 2 === 0) {
      const cell = findFreeCell(true);
      if (cell) rocks.add(`${cell.x},${cell.y}`);
    }
  }

  if (mode.time) timeLeft += isBonus ? 5 : 2;

  // level up every 5 apples
  if (1 + Math.floor(applesEaten / 5) > level) {
    level++;
    tickMs = speedForLevel();
    showToast('Level ' + level);
    beep(1040, 0.2, 'triangle');
  }

  if (score > best) {
    best = score;
    newBest = true;
  }
  updateHud();
}

// move the snake one cell
function tick() {
  prevSnake = snake.map(part => ({ ...part }));

  if (inputQueue.length) dir = inputQueue.shift();

  let headX = snake[0].x + dir.x;
  let headY = snake[0].y + dir.y;

  if (mode.wrap) {
    headX = (headX + COLS) % COLS;
    headY = (headY + ROWS) % ROWS;
  }

  const hitSelf = snake.slice(0, -1).some(part => part.x === headX && part.y === headY);
  const outOfBounds = headX < 0 || headX >= COLS || headY < 0 || headY >= ROWS;

  if (outOfBounds || isBlocked(headX, headY) || hitSelf) {
    gameOver();
    return;
  }

  snake.unshift({ x: headX, y: headY });

  if (food && headX === food.x && headY === food.y) {
    eat(false);
  } else if (bonus && headX === bonus.x && headY === bonus.y) {
    eat(true);
  } else {
    snake.pop();
  }
}


// ---------- controls ----------

const KEY_DIRECTIONS = {
  arrowup: [0, -1],    w: [0, -1],
  arrowdown: [0, 1],   s: [0, 1],
  arrowleft: [-1, 0],  a: [-1, 0],
  arrowright: [1, 0],  d: [1, 0]
};

function steer(x, y) {
  if (state !== 'play') return;

  // compare with the last queued turn, not the current direction
  const last = inputQueue.length ? inputQueue[inputQueue.length - 1] : dir;
  const sameWay = last.x === x && last.y === y;
  const reverse = last.x === -x && last.y === -y;
  if (sameWay || reverse) return;

  if (inputQueue.length < 2) inputQueue.push({ x, y });
}

addEventListener('keydown', e => {
  const key = e.key.toLowerCase();

  if (key in KEY_DIRECTIONS) {
    e.preventDefault();
    steer(...KEY_DIRECTIONS[key]);
  } else if (key === 'p' || key === 'escape') {
    if (state === 'play') pauseGame();
    else resumeGame();
  } else if (key === 'enter' || key === ' ') {
    e.preventDefault();
    if (state === 'menu' || state === 'over') startGame();
    else resumeGame();
  } else if (key === 'm') {
    toggleSound();
  }
});

// swipe controls
let touchStart = null;

canvas.addEventListener('touchstart', e => {
  touchStart = e.touches[0];
}, { passive: true });

canvas.addEventListener('touchend', e => {
  if (!touchStart) return;

  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStart.clientX;
  const dy = touch.clientY - touchStart.clientY;

  // ignore taps and tiny movements
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;

  if (Math.abs(dx) > Math.abs(dy)) steer(Math.sign(dx), 0);
  else steer(0, Math.sign(dy));
});

const BUTTON_ACTIONS = {
  play: startGame,
  resume: resumeGame,
  menu: backToMenu,
  sound: toggleSound
};

document.addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  const button = e.target.closest('[data-act]');

  if (chip) {
    choice[chip.dataset.k] = chip.dataset.v;
    storage.set('snake-prefs', choice);
    if (chip.dataset.k === 'theme') applyTheme();
    resetStats();
    buildOptions();
    beep(660, 0.04);
  }

  if (button) {
    const action = BUTTON_ACTIONS[button.dataset.act];
    if (action) action();
  }

  // drop focus so Space/Enter don't re-trigger the last button
  if (e.target.blur) e.target.blur();
});

// pause automatically when the player switches tabs or windows
addEventListener('blur', pauseGame);


// ---------- drawing ----------

function fillCircle(x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.05 + Math.random() * 0.15;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 500,
      color
    });
  }
}

function drawBoard(theme) {
  // checkerboard floor
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      ctx.fillStyle = (row + col) % 2 ? theme.b : theme.a;
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }
  }

  // walls and rocks on top
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!isBlocked(col, row)) continue;

      ctx.shadowColor = theme.glow ? theme.wall : 'transparent';
      ctx.shadowBlur = theme.glow ? 10 : 0;
      ctx.fillStyle = theme.wall;
      ctx.beginPath();
      ctx.roundRect(col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2, 5);
      ctx.fill();

      // small highlight on top
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.2)';
      ctx.fillRect(col * CELL + 4, row * CELL + 4, CELL - 8, 3);
    }
  }
}

function drawFood() {
  const cx = food.x * CELL + 10;
  const cy = food.y * CELL + 10;
  const radius = 7 + Math.sin(now / 200) * 1.5;  // gentle pulse

  ctx.fillStyle = 'rgba(0,0,0,.18)';             // shadow
  fillCircle(cx + 1, cy + 2, radius);

  ctx.fillStyle = '#e63946';                     // apple
  fillCircle(cx, cy, radius);

  ctx.fillStyle = 'rgba(255,255,255,.5)';        // shine
  fillCircle(cx - 3, cy - 3, 2);

  ctx.fillStyle = '#4a7c2a';                     // stem
  ctx.fillRect(cx - 1, cy - radius - 3, 2, 4);
}

function drawBonus() {
  const cx = bonus.x * CELL + 10;
  const cy = bonus.y * CELL + 10;
  const radius = 6 + Math.sin(now / 120) * 1.5;

  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffd700';
  fillCircle(cx, cy, radius);

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff6c9';
  fillCircle(cx - 2, cy - 2, 2);

  // ring that shrinks as the golden apple runs out of time
  const remaining = bonus.life / 6000;
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining);
  ctx.stroke();
}

// pts are pixel positions, d is the direction the head is facing
function drawSnake(pts, d) {
  const skin = SKINS[choice.skin];

  function drawSegment(x, y, i) {
    const [light, dark] = skin.colors(i);
    const radius = Math.max(5, CELL / 2 - i * 0.12);  // tapers toward the tail

    ctx.shadowColor = skin.glow || 'transparent';
    ctx.shadowBlur = skin.glow ? 8 : 0;

    const gradient = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, radius);
    gradient.addColorStop(0, light);
    gradient.addColorStop(1, dark);
    ctx.fillStyle = gradient;
    fillCircle(x, y, radius);

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    fillCircle(x, y, radius * 0.45);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    fillCircle(x - radius * 0.28, y - radius * 0.28, radius * 0.2);
  }

  // draw tail first so the head ends up on top
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    const next = pts[i + 1];

    // extra segment between neighbours to fill gaps (skipped when wrapping around the edge)
    if (next && Math.hypot(p.x - next.x, p.y - next.y) < CELL * 1.5) {
      drawSegment((p.x + next.x) / 2, (p.y + next.y) / 2, i);
    }
    drawSegment(p.x, p.y, i);
  }

  // eyes
  const head = pts[0];
  const perpX = -d.y;
  const perpY = d.x;

  for (const side of [-1, 1]) {
    const ex = head.x + d.x * 4 + perpX * 4 * side;
    const ey = head.y + d.y * 4 + perpY * 4 * side;

    ctx.fillStyle = skin.eye || '#fff';
    fillCircle(ex, ey, 3);
    ctx.fillStyle = '#000';
    fillCircle(ex + d.x, ey + d.y, 1.5);
  }
}

// blend between two grid positions, but don't slide across the board when wrapping
function lerp(from, to, t) {
  if (Math.abs(to - from) > 1) return to;
  return from + (to - from) * t;
}

function draw() {
  const theme = THEMES[choice.theme];

  ctx.save();

  // screen shake after dying
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake = Math.max(0, shake - 0.6);
  }

  drawBoard(theme);

  if (state === 'menu') {
    // decorative snake swimming around behind the menu
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const t = now / 900 - i * 0.16;
      pts.push({
        x: 240 + 160 * Math.sin(t),
        y: 240 + 120 * Math.sin(t * 1.7 + 1)
      });
    }
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    const len = Math.hypot(dx, dy) || 1;
    drawSnake(pts, { x: dx / len, y: dy / len });

  } else if (snake.length) {
    const t = Math.min(tickTimer / tickMs, 1);  // progress to the next tick

    if (food) drawFood();
    if (bonus) drawBonus();

    const pts = snake.map((part, i) => {
      const from = prevSnake[i] || prevSnake[prevSnake.length - 1];
      return {
        x: lerp(from.x, part.x, t) * CELL + 10,
        y: lerp(from.y, part.y, t) * CELL + 10
      };
    });
    drawSnake(pts, dir);
  }

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / 500);
    ctx.fillStyle = p.color;
    fillCircle(p.x, p.y, 3);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}


// ---------- main loop ----------

function loop(time) {
  // cap dt so the game doesn't jump after switching tabs
  const dt = Math.min(50, time - (lastFrame || time));
  lastFrame = time;
  now = time;

  if (state === 'play') {
    tickTimer += dt;

    // golden apple disappears when its timer runs out
    if (bonus) {
      bonus.life -= dt;
      if (bonus.life <= 0) bonus = null;
    }

    if (mode.time) {
      timeLeft -= dt / 1000;
      $('time').textContent = Math.max(0, Math.ceil(timeLeft));
      if (timeLeft <= 0) {
        timeLeft = 0;
        gameOver(true);
      }
    }

    if (state === 'play' && tickTimer >= tickMs) {
      tickTimer -= tickMs;
      tick();
    }
  }

  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);

  draw();
  requestAnimationFrame(loop);
}


// ---------- start ----------

applyTheme();
buildOptions();
resetStats();
updateSoundLabel();
requestAnimationFrame(loop);
