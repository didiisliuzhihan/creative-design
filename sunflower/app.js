(() => {
  'use strict';

  const canvas = document.getElementById('garden');
  const ctx = canvas.getContext('2d', { alpha: false });
  const experience = document.getElementById('experience');
  const umbrellaHit = document.getElementById('umbrellaHit');
  const flowerHit = document.getElementById('flowerHit');
  const cloudHit = document.getElementById('cloudHit');
  const swingHit = document.getElementById('swingHit');
  const soundToggle = document.getElementById('soundToggle');
  const hint = document.getElementById('hint');
  const dialog = document.getElementById('noteDialog');
  const form = document.getElementById('noteForm');
  const input = document.getElementById('noteInput');
  const count = document.getElementById('charCount');
  const toast = document.getElementById('toast');
  const dayLabel = document.getElementById('dayLabel');
  const dayDots = [...document.querySelectorAll('.days i')];
  const STORE = 'sunflower-seventh-day:v2';
  const NOTES = 'sunflower-rain-notes:v1';
  const SOUND = 'sunflower-sound-muted:v1';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const localDayNumber = (date = new Date()) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  const localDayKey = (date = new Date()) => [date.getFullYear(), `${date.getMonth() + 1}`.padStart(2, '0'), `${date.getDate()}`.padStart(2, '0')].join('-');

  function freshCycle(today, todayN) {
    return {
      lastVisit: today,
      lastDayNumber: todayN,
      completedRainDays: 0,
      lastWatered: null,
      sunDate: null,
      cycleStart: today
    };
  }

  function getCycle() {
    const today = localDayKey();
    const todayN = localDayNumber();
    let data;
    try { data = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { data = null; }

    if (!data || !data.cycleStart || !Number.isFinite(Number(data.completedRainDays))) {
      data = freshCycle(today, todayN);
    } else if (data.sunDate && data.sunDate !== today) {
      data = freshCycle(today, todayN);
    } else {
      data.completedRainDays = Math.max(0, Math.min(6, Number(data.completedRainDays)));
      if (!data.sunDate && data.completedRainDays === 6 && data.lastWatered && data.lastWatered !== today) {
        data.sunDate = today;
      }
      data.lastVisit = today;
      data.lastDayNumber = todayN;
    }

    if (!data.cycleStart) data.cycleStart = today;

    localStorage.setItem(STORE, JSON.stringify(data));
    const requested = Number(new URLSearchParams(location.search).get('day'));
    const naturalDay = data.sunDate === today ? 7 : Math.min(6, data.completedRainDays + 1);
    const day = requested >= 1 && requested <= 7 ? requested : naturalDay;
    return { day, sunny: day === 7, cycleKey: data.cycleStart, state: data };
  }

  const cycle = getCycle();

  function markWateredToday() {
    if (cycle.sunny || cycle.state.sunDate) return false;
    const today = localDayKey();
    if (cycle.state.lastWatered === today || cycle.state.completedRainDays >= 6) return false;
    cycle.state.completedRainDays += 1;
    cycle.state.lastWatered = today;
    cycle.state.lastVisit = today;
    cycle.state.lastDayNumber = localDayNumber();
    localStorage.setItem(STORE, JSON.stringify(cycle.state));
    return true;
  }
  experience.classList.toggle('sunny', cycle.sunny);
  dayLabel.textContent = `${cycle.day}`.padStart(2, '0');
  dayLabel.parentElement.setAttribute('aria-label', `Day ${cycle.day} of 7`);
  dayDots.forEach((dot, i) => {
    dot.classList.toggle('past', i < cycle.day - 1);
    dot.classList.toggle('now', i === cycle.day - 1);
  });
  if (cycle.sunny) {
    umbrellaHit.disabled = true;
    umbrellaHit.tabIndex = -1;
    umbrellaHit.setAttribute('aria-hidden', 'true');
    flowerHit.disabled = true;
    flowerHit.tabIndex = -1;
    hint.textContent = 'Tap the cloud';
  }

  let noteStore;
  try { noteStore = JSON.parse(localStorage.getItem(NOTES) || 'null'); } catch { noteStore = null; }
  if (Array.isArray(noteStore)) noteStore = { cycleKey: cycle.cycleKey, items: noteStore };
  if (!noteStore || noteStore.cycleKey !== cycle.cycleKey || !Array.isArray(noteStore.items)) {
    noteStore = { cycleKey: cycle.cycleKey, items: [] };
    localStorage.setItem(NOTES, JSON.stringify(noteStore));
  }
  let notes = noteStore.items;
  // Portfolio demo: the rainy and sunny scenes run side by side and share storage.
  // A line written on the rainy side shows up here right away, and the cloud reveals it first.
  let freshNote = '';
  addEventListener('storage', event => {
    if (event.key !== NOTES || !event.newValue) return;
    try {
      const next = JSON.parse(event.newValue);
      if (next && Array.isArray(next.items) && next.cycleKey === cycle.cycleKey) {
        notes = next.items;
        if (notes.length) freshNote = notes[notes.length - 1];
      }
    } catch {}
  });

  let width = 0;
  let height = 0;
  let dpr = 1;
  let groundY = 0;
  let lastTime = performance.now();
  let rain = [];
  let starBursts = [];
  let fallingLetters = [];
  let ripples = [];
  let motes = [];
  let toastTimer;
  const sceneStartedAt = performance.now();
  let umbrellaOpen = false;
  let umbrellaProgress = 0;
  let sunnyStage = 0;
  let swingDrop = 0;
  let pendantDrop = 0;
  let swingAngle = 0;
  let swingVelocity = 0;
  let swingDragging = false;
  let dragStartX = 0;
  let dragStartAngle = 0;
  let dragLastAngle = 0;
  let dragLastAt = 0;
  let cloudGesture = null;
  let cloudSkipClick = false;
  let cloudMemory = '';
  let eraseMarks = [];
  const cloudLayer = document.createElement('canvas');
  const cloudCtx = cloudLayer.getContext('2d');
  const textureLayer = document.createElement('canvas');
  const textureCtx = textureLayer.getContext('2d');
  let grainPattern = null;
  let cloudGrainPattern = null;
  let soundStarted = false;
  // Every new visit starts with sound enabled. Playback begins on the first
  // user gesture because mobile browsers block unprompted audible autoplay.
  let soundMuted = false;
  let nextStarSoundAt = performance.now() + 4200;
  const fadeTokens = new WeakMap();

  const audio = {
    rainMusic: new Audio('./audio/rain-bgm.mp3'),
    sunMusic: new Audio('./audio/sun-bgm.mp3'),
    rainLoop: new Audio('./audio/rain-loop.mp3'),
    umbrellaOpen: new Audio('./audio/umbrella-open.mp3'),
    umbrellaClose: new Audio('./audio/umbrella-close.mp3'),
    star: new Audio('./audio/star-hit.mp3'),
    starWater: new Audio('./audio/star-water.mp3'),
    starBell: new Audio('./audio/star-bell.mp3'),
    eraser: new Audio('./audio/eraser.mp3')
  };
  audio.rainMusic.loop = true;
  audio.sunMusic.loop = true;
  audio.rainLoop.loop = true;
  audio.rainMusic.volume = .13;
  audio.sunMusic.volume = .16;
  audio.rainLoop.volume = 0;
  audio.umbrellaOpen.volume = .16;
  audio.umbrellaClose.volume = .13;
  audio.star.volume = .09;
  audio.starWater.volume = .035;
  audio.starBell.volume = .025;
  audio.eraser.volume = .08;
  audio.eraser.loop = true;
  Object.values(audio).forEach(track => { track.preload = 'auto'; });

  function fadeAudio(track, target, duration = 520, pauseAtEnd = false) {
    const token = {};
    fadeTokens.set(track, token);
    const from = track.volume;
    const began = performance.now();
    const step = now => {
      if (fadeTokens.get(track) !== token) return;
      const p = clamp((now - began) / duration, 0, 1);
      track.volume = from + (target - from) * (p * (2 - p));
      if (p < 1) requestAnimationFrame(step);
      else if (pauseAtEnd) track.pause();
    };
    requestAnimationFrame(step);
  }

  function playOneShot(track) {
    if (soundMuted) return;
    track.currentTime = 0;
    void track.play().catch(() => {});
  }

  function startSoundscape() {
    if (soundMuted) return;
    soundStarted = true;
    const bgm = cycle.sunny ? audio.sunMusic : audio.rainMusic;
    void bgm.play().catch(() => {});
    if (!cycle.sunny && umbrellaOpen) {
      void audio.rainLoop.play().then(() => fadeAudio(audio.rainLoop, .17, 700)).catch(() => {});
    }
  }

  function stopSoundscape() {
    Object.values(audio).forEach(track => track.pause());
    audio.rainLoop.volume = 0;
    soundStarted = false;
  }

  function syncSoundButton() {
    soundToggle.classList.toggle('muted', soundMuted);
    soundToggle.setAttribute('aria-pressed', String(soundMuted));
    soundToggle.setAttribute('aria-label', soundMuted ? 'Turn sound on' : 'Turn sound off');
  }

  const random = (min, max) => Math.random() * (max - min) + min;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function seedPaperTexture() {
    textureLayer.width = 112;
    textureLayer.height = 112;
    textureCtx.clearRect(0, 0, 112, 112);
    for (let i = 0; i < 1900; i++) {
      const light = Math.random() > .44;
      textureCtx.fillStyle = light ? `rgba(255,255,245,${random(.03, .16)})` : `rgba(17,54,71,${random(.018, .09)})`;
      const size = Math.random() > .93 ? random(1.1, 1.8) : random(.35, .9);
      textureCtx.fillRect(random(0, 112), random(0, 112), size, size);
    }
    grainPattern = ctx.createPattern(textureLayer, 'repeat');
    cloudGrainPattern = cloudCtx.createPattern(textureLayer, 'repeat');
  }

  function drawPaperTexture(alpha = .55) {
    if (!grainPattern) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function resize() {
    width = innerWidth;
    height = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cloudLayer.width = Math.round(width * dpr);
    cloudLayer.height = Math.round(height * dpr);
    cloudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedPaperTexture();
    groundY = height * (width < 700 ? .79 : .82);
    seedScene();
  }

  function seedScene() {
    const rainCount = Math.round(clamp(width / 14, 24, 48));
    rain = Array.from({ length: rainCount }, (_, i) => makeDrop(i));
    starBursts = [];
    fallingLetters = [];
    motes = cycle.sunny ? Array.from({ length: Math.round(clamp(width / 13, 28, 58)) }, () => ({
      x: random(0, width), y: random(0, groundY), r: random(.5, 1.8), a: random(.12, .55), speed: random(4, 13), drift: random(-6, 6)
    })) : [];
  }

  function chooseNote() {
    if (!notes.length || Math.random() > Math.min(.5, .12 + notes.length * .055)) return '';
    return notes[Math.floor(Math.random() * notes.length)];
  }

  function makeDrop(index, scattered = false) {
    const canopyRadius = clamp(width * .23, 72, 132);
    const startY = height * .28 + random(12, 46);
    return {
      x: width / 2 + random(-canopyRadius * .72, canopyRadius * .72),
      y: scattered ? random(startY, groundY * .72) : startY,
      speed: random(82, 148),
      len: random(68, 142),
      alpha: random(.25, .62),
      message: index % 4 === 0 ? chooseNote() : '',
      fontSize: random(11, 13.5)
    };
  }

  function emitStarBurst(x, y, strong = false) {
    const count = strong ? 14 : 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const life = random(1.05, 1.75);
      starBursts.push({
        x: x + random(-3, 3), y: y + random(-2, 2),
        vx: random(-34, 34) * (strong ? 1.2 : 1), vy: random(-66, -20),
        gravity: random(42, 70), life, maxLife: life,
        size: random(2.1, strong ? 5.4 : 4.4), angle: random(0, Math.PI),
        spin: random(-4, 4), star: Math.random() > .28,
        color: ['#ffe86a', '#ff5f82', '#5ee9ff', '#ff994d'][Math.floor(Math.random() * 4)]
      });
    }
    if (starBursts.length > 180) starBursts.splice(0, starBursts.length - 180);
    const now = performance.now();
    if (soundStarted && !soundMuted && now >= nextStarSoundAt) {
      const source = Math.random() < .62 ? audio.starWater : (Math.random() < .74 ? audio.umbrellaClose : audio.starBell);
      const sparkle = source.cloneNode();
      sparkle.volume = source === audio.starBell ? .018 : source === audio.starWater ? .032 : .026;
      sparkle.playbackRate = random(.88, 1.02);
      void sparkle.play().catch(() => {});
      nextStarSoundAt = now + random(5600, 9400);
    }
  }

  function addRipple(x, y, warm = false) {
    if (ripples.length > 42) ripples.shift();
    ripples.push({ x, y, r: 1, alpha: warm ? .62 : .36, warm });
  }

  function drawFlower(time, placement = {}) {
    const cx = placement.x ?? width / 2;
    const baseY = placement.baseY ?? groundY + 3;
    const scale = (placement.scale ?? 1) * clamp(width / 430, .78, 1.08);
    const sway = reducedMotion ? 0 : Math.sin(time * .00072) * 2.2;
    const pulse = reducedMotion ? 1 : 1 + Math.sin(time * .0009) * .0045;
    const warm = cycle.sunny;

    ctx.save();
    ctx.translate(cx + sway, baseY);
    ctx.scale(scale * pulse, scale * pulse);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const aura = ctx.createRadialGradient(0, -82, 8, 0, -82, 92);
    aura.addColorStop(0, warm ? 'rgba(255, 194, 47, .32)' : 'rgba(255, 238, 188, .18)');
    aura.addColorStop(.52, warm ? 'rgba(245, 139, 5, .12)' : 'rgba(246, 210, 140, .07)');
    aura.addColorStop(1, 'rgba(255, 222, 140, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(-105, -190, 210, 205);

    ctx.shadowBlur = warm ? 22 : 16;
    ctx.shadowColor = warm ? 'rgba(255, 194, 47, .62)' : 'rgba(255, 231, 178, .48)';
    ctx.fillStyle = warm ? 'rgba(255, 194, 47, .98)' : 'rgba(248, 219, 147, .62)';
    ctx.strokeStyle = warm ? 'rgba(245, 139, 5, .92)' : 'rgba(255, 241, 209, .58)';
    ctx.lineWidth = 1.2;

    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 4;
      ctx.save();
      ctx.translate(Math.cos(angle) * 35, -103 + Math.sin(angle) * 35);
      ctx.rotate(angle + Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = warm ? 'rgba(255, 253, 238, .99)' : 'rgba(255, 247, 218, .88)';
    ctx.beginPath();
    ctx.ellipse(0, -103, 33, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = warm ? 'rgba(245, 139, 5, .94)' : 'rgba(252, 242, 210, .80)';
    ctx.beginPath();
    ctx.moveTo(-20, -74);
    ctx.quadraticCurveTo(-27, -42, -30, -17);
    ctx.quadraticCurveTo(0, -8, 30, -17);
    ctx.quadraticCurveTo(27, -42, 20, -74);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.lineWidth = 5.5;
    ctx.strokeStyle = warm ? 'rgba(255, 253, 238, .98)' : 'rgba(255, 245, 216, .82)';
    ctx.beginPath();
    ctx.moveTo(-19, -66);
    ctx.quadraticCurveTo(-31, -69, -34, -88);
    ctx.moveTo(19, -66);
    ctx.quadraticCurveTo(31, -69, 34, -88);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.ellipse(-35, -91, 8, 10, -.24, 0, Math.PI * 2);
    ctx.ellipse(35, -91, 8, 10, .24, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(-11, -16);
    ctx.lineTo(-12, 1);
    ctx.moveTo(11, -16);
    ctx.lineTo(12, 1);
    ctx.stroke();
    ctx.fillStyle = warm ? 'rgba(40, 112, 151, .90)' : 'rgba(22, 42, 38, .72)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(-14, 4, 10, 4.6, -.08, 0, Math.PI * 2);
    ctx.ellipse(14, 4, 10, 4.6, .08, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 3;
    ctx.fillStyle = warm ? 'rgba(43, 119, 158, .92)' : 'rgba(40, 66, 57, .82)';
    ctx.beginPath();
    ctx.arc(-9, -106, 1.7, 0, Math.PI * 2);
    ctx.arc(9, -106, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = warm ? 'rgba(245, 139, 5, .92)' : 'rgba(198, 112, 88, .70)';
    ctx.lineWidth = 1.6;
    const smileAmount = warm ? 1 : clamp((umbrellaProgress - .12) / .78, 0, 1);
    const mouthControlY = -108 + smileAmount * 15;
    const mouthEdgeY = -100 + smileAmount * -.5;
    ctx.beginPath();
    ctx.moveTo(-6.4, mouthEdgeY);
    ctx.quadraticCurveTo(0, mouthControlY, 6.4, mouthEdgeY);
    ctx.stroke();

    ctx.shadowBlur = 10;
    for (let i = 0; i < 14; i++) {
      const a = i * 2.399 + time * .00012;
      const r = 54 + (i % 4) * 8;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 104, 127, .55)' : i % 3 === 1 ? 'rgba(89, 226, 255, .52)' : 'rgba(255, 231, 107, .60)';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, -101 + Math.sin(a) * r, i % 5 === 0 ? 1.5 : .9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStarShape(x, y, size, angle, alpha, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowBlur = 16;
    ctx.shadowColor = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 4;
      const r = i % 2 ? size * .25 : size;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawStarBursts(dt) {
    for (let i = starBursts.length - 1; i >= 0; i--) {
      const star = starBursts[i];
      star.life -= dt;
      if (star.life <= 0) { starBursts.splice(i, 1); continue; }
      star.vy += star.gravity * dt;
      star.x += star.vx * dt;
      star.y += star.vy * dt;
      star.angle += star.spin * dt;
      const alpha = Math.pow(star.life / star.maxLife, .7);
      if (star.star) drawStarShape(star.x, star.y, star.size, star.angle, alpha, star.color);
      else {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = star.color;
        ctx.shadowBlur = 12;
        ctx.shadowColor = star.color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size * .62, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function messageRainLength(message, fontSize) {
    return [...message].reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? .62 : 1) * fontSize, 0);
  }

  function releaseMessageLetters(drop) {
    const chars = [...drop.message];
    const advances = chars.map(char => (char.charCodeAt(0) < 128 ? .62 : 1) * drop.fontSize);
    const total = advances.reduce((sum, advance) => sum + advance, 0);
    let cursor = 0;
    const colors = ['#ffe86a', '#ff6f91', '#61e8ff', '#ffad55'];

    chars.forEach((char, index) => {
      const advance = advances[index];
      const center = cursor + advance * .5;
      const distanceToGround = Math.max(0, total - center);
      fallingLetters.push({
        char,
        x: drop.x + random(-1.6, 1.6),
        y: groundY - distanceToGround,
        vx: random(-5.5, 5.5),
        vy: drop.speed * random(.84, .96),
        gravity: random(112, 148),
        fontSize: drop.fontSize,
        angle: Math.PI / 2 + random(-.035, .035),
        spin: random(-1.25, 1.25),
        color: colors[index % colors.length],
        alpha: Math.min(.86, drop.alpha + .28),
        landed: false,
        bounceCount: 0,
        life: 2.7,
        maxLife: 2.7
      });
      cursor += advance;
    });

    if (fallingLetters.length > 150) fallingLetters.splice(0, fallingLetters.length - 150);
  }

  function emitLetterSpark(letter) {
    const hitFlower = Math.abs(letter.x - width / 2) < 52;
    const count = hitFlower ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const life = random(.72, 1.18);
      starBursts.push({
        x: letter.x + random(-2.5, 2.5), y: groundY + random(-1.5, 1.5),
        vx: random(-25, 25), vy: random(-49, -18), gravity: random(45, 68),
        life, maxLife: life, size: random(1.7, hitFlower ? 4.1 : 3.2),
        angle: random(0, Math.PI), spin: random(-4, 4), star: true, color: letter.color
      });
    }
    if (starBursts.length > 180) starBursts.splice(0, starBursts.length - 180);
  }

  function drawFallingLetters(dt) {
    for (let i = fallingLetters.length - 1; i >= 0; i--) {
      const letter = fallingLetters[i];
      letter.vy += letter.gravity * dt;
      letter.x += letter.vx * dt;
      letter.y += letter.vy * dt;
      letter.angle += letter.spin * dt;

      if (letter.y >= groundY) {
        letter.y = groundY;
        if (!letter.landed) {
          letter.landed = true;
          letter.bounceCount = 1;
          letter.vy = -random(42, 72);
          letter.vx += random(-14, 14);
          letter.spin *= 1.45;
          addRipple(letter.x, groundY + random(-1, 2));
          emitLetterSpark(letter);
        } else if (letter.bounceCount < 2 && Math.abs(letter.vy) > 12) {
          letter.bounceCount += 1;
          letter.vy = -Math.abs(letter.vy) * .28;
          letter.vx *= .58;
        } else {
          letter.vy = 0;
          letter.vx *= Math.exp(-7 * dt);
        }
      }

      if (letter.landed) letter.life -= dt;
      if (letter.life <= 0) {
        fallingLetters.splice(i, 1);
        continue;
      }

      const fade = letter.landed ? clamp(letter.life / letter.maxLife, 0, 1) : 1;
      ctx.save();
      ctx.translate(letter.x, letter.y);
      ctx.rotate(letter.angle);
      ctx.font = `${letter.fontSize}px "ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = letter.color;
      ctx.globalAlpha = letter.alpha * Math.pow(fade, .72);
      ctx.shadowBlur = 10 + (1 - fade) * 6;
      ctx.shadowColor = letter.color;
      ctx.fillText(letter.char, 0, 0);
      if (letter.landed) drawStarShape(0, 0, Math.max(2.2, letter.fontSize * .28), -letter.angle, .34 * fade, letter.color);
      ctx.restore();
    }
  }

  function drawUmbrella(time, opacity = 1, openAmount = umbrellaProgress) {
    if (opacity <= 0) return;
    const open = clamp(openAmount, 0, 1);
    const radius = clamp(width * .23, 72, 132);
    const cx = width / 2;
    const cy = height * .265;
    const spread = Math.max(.055, open);
    const tilt = (1 - open) * -.18 + (reducedMotion ? 0 : Math.sin(time * .0007) * .01);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.globalAlpha = opacity;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.save();
    ctx.scale(spread, 1);
    ctx.fillStyle = '#df3a31';
    ctx.strokeStyle = 'rgba(255, 237, 205, .82)';
    ctx.lineWidth = 1.25;
    ctx.shadowBlur = 17;
    ctx.shadowColor = 'rgba(255, 67, 48, .42)';
    ctx.beginPath();
    ctx.moveTo(-radius, 8);
    ctx.quadraticCurveTo(-radius * .54, -radius * .72, 0, -radius * .76);
    ctx.quadraticCurveTo(radius * .54, -radius * .72, radius, 8);
    ctx.quadraticCurveTo(radius * .75, -radius * .07, radius * .5, 10);
    ctx.quadraticCurveTo(radius * .25, -radius * .06, 0, 10);
    ctx.quadraticCurveTo(-radius * .25, -radius * .06, -radius * .5, 10);
    ctx.quadraticCurveTo(-radius * .75, -radius * .07, -radius, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = .68;
    ctx.fillStyle = grainPattern;
    ctx.fillRect(-radius - 8, -radius, radius * 2 + 16, radius * 1.2);
    ctx.globalAlpha = .17;
    ctx.lineWidth = .72;
    for (let i = 0; i < 52; i++) {
      const px = -radius + 7 + ((i * 41) % Math.max(12, radius * 2 - 14));
      const py = -radius * .68 + ((i * 23) % Math.max(10, radius * .72));
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(255,241,214,.82)' : 'rgba(121,32,37,.70)';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 8 + (i % 4) * 3, py + (i % 2 ? 2 : -2));
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(111, 25, 29, .48)';
    ctx.lineWidth = .75;
    [-.5, 0, .5].forEach(f => {
      ctx.beginPath();
      ctx.moveTo(0, -radius * .76);
      ctx.quadraticCurveTo(radius * f * .72, -radius * .42, radius * f, 9);
      ctx.stroke();
    });
    ctx.restore();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 222, 190, .70)';
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.moveTo(0, -radius * .77);
    ctx.lineTo(0, radius * .72);
    ctx.quadraticCurveTo(0, radius * 1.03, radius * .16, radius * .98);
    ctx.quadraticCurveTo(radius * .29, radius * .93, radius * .25, radius * .75);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 224, 196, .88)';
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(255, 179, 139, .72)';
    ctx.beginPath();
    ctx.arc(0, -radius * .79, 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRain(dt, intensity) {
    if (intensity <= .01) return;
    ctx.lineCap = 'round';
    rain.forEach((drop, i) => {
      drop.y += drop.speed * dt;
      const messageHeight = drop.message ? messageRainLength(drop.message, drop.fontSize) : drop.len;
      if (drop.y + messageHeight > groundY) {
        if (drop.message) {
          releaseMessageLetters(drop);
        } else {
          addRipple(drop.x, groundY + random(-2, 3));
          const hitFlower = Math.abs(drop.x - width / 2) < 52;
          emitStarBurst(drop.x, groundY, hitFlower);
        }
        rain[i] = makeDrop(i);
        return;
      }
      if (drop.message) {
        ctx.save();
        ctx.translate(drop.x, drop.y);
        ctx.rotate(Math.PI / 2);
        ctx.font = `${drop.fontSize}px "ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(225, 239, 229, ${Math.min(.78, (drop.alpha + .18) * intensity)})`;
        ctx.shadowBlur = 5;
        ctx.shadowColor = 'rgba(151, 208, 196, .38)';
        ctx.fillText(drop.message, 0, 0);
        ctx.restore();
      } else {
        const grad = ctx.createLinearGradient(drop.x, drop.y - drop.len, drop.x, drop.y);
        grad.addColorStop(0, 'rgba(142, 192, 185, 0)');
        grad.addColorStop(1, `rgba(213, 235, 224, ${drop.alpha * intensity})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = .7;
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y - drop.len);
        ctx.lineTo(drop.x - 1.5, drop.y);
        ctx.stroke();
      }
    });
  }

  function drawRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const ripple = ripples[i];
      ripple.r += 28 * dt;
      ripple.alpha -= .27 * dt;
      if (ripple.alpha <= 0) { ripples.splice(i, 1); continue; }
      ctx.strokeStyle = ripple.warm ? `rgba(246, 206, 121, ${ripple.alpha})` : `rgba(147, 205, 193, ${ripple.alpha})`;
      ctx.lineWidth = .8;
      ctx.beginPath();
      ctx.ellipse(ripple.x, ripple.y, ripple.r * 1.9, ripple.r * .38, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawNight(dt, time) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#126f9f');
    sky.addColorStop(.42, '#218fc1');
    sky.addColorStop(.76, '#167eae');
    sky.addColorStop(1, '#0e638f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    drawPaperTexture(.88);

    const rainHalo = ctx.createRadialGradient(width / 2, height * .34, 8, width / 2, height * .34, Math.max(width * .54, 210));
    rainHalo.addColorStop(0, `rgba(255, 203, 180, ${.13 + umbrellaProgress * .08})`);
    rainHalo.addColorStop(.42, `rgba(133, 209, 232, ${.09 + umbrellaProgress * .05})`);
    rainHalo.addColorStop(1, 'rgba(19, 119, 161, 0)');
    ctx.fillStyle = rainHalo;
    ctx.fillRect(0, 0, width, height);

    const flowerHalo = ctx.createRadialGradient(width / 2, groundY - 84, 4, width / 2, groundY - 84, Math.max(width * .37, 145));
    flowerHalo.addColorStop(0, 'rgba(255, 237, 190, .22)');
    flowerHalo.addColorStop(.38, 'rgba(255, 210, 160, .08)');
    flowerHalo.addColorStop(1, 'rgba(16, 109, 151, 0)');
    ctx.fillStyle = flowerHalo;
    ctx.fillRect(0, 0, width, height);

    drawRain(dt * umbrellaProgress, umbrellaProgress);

    drawUmbrella(time);
    drawFallingLetters(dt);
    drawRipples(dt);
    drawStarBursts(dt);
    drawPaperTexture(.22);
  }

  function cloudShapePath(target, cx, cy) {
    const blobs = [
      [-58, 9, 31, 23], [-31, -5, 38, 30], [5, -12, 45, 35],
      [42, -1, 36, 29], [67, 12, 28, 21], [5, 15, 79, 24]
    ];
    target.beginPath();
    blobs.forEach(([x, y, rx, ry]) => {
      target.ellipse(cx + x, cy + y, rx, ry, 0, 0, Math.PI * 2);
    });
  }

  function drawCloud(cx, cy, time) {
    const floatY = cy + (reducedMotion ? 0 : Math.sin(time * .00065) * 1.8);
    eraseMarks = eraseMarks.filter(mark => time - mark.at < 3900);

    if (cloudMemory && eraseMarks.length) {
      ctx.save();
      cloudShapePath(ctx, cx, floatY);
      ctx.clip();
      ctx.fillStyle = 'rgba(38, 72, 78, .84)';
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(255, 220, 133, .44)';
      ctx.font = '400 14px "ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const words = String(cloudMemory).split(' ');
      const lines = [];
      let line = '';
      words.forEach(word => {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > 124 && line) { lines.push(line); line = word; }
        else line = test;
      });
      if (line) lines.push(line);
      const shown = lines.slice(0, 3);
      shown.forEach((text, i) => ctx.fillText(text, cx, floatY + 3 + (i - (shown.length - 1) / 2) * 16, 124));
      ctx.restore();
    }

    cloudCtx.clearRect(0, 0, width, height);
    cloudCtx.save();
    cloudCtx.fillStyle = 'rgba(255, 253, 238, .99)';
    cloudCtx.shadowBlur = 22;
    cloudCtx.shadowColor = 'rgba(255, 194, 47, .48)';
    cloudShapePath(cloudCtx, cx, floatY);
    cloudCtx.fill();
    cloudCtx.shadowBlur = 0;
    cloudCtx.fillStyle = 'rgba(255, 194, 47, .24)';
    cloudCtx.beginPath();
    cloudCtx.ellipse(cx + 3, floatY + 25, 73, 9, 0, 0, Math.PI * 2);
    cloudCtx.fill();
    cloudCtx.save();
    cloudShapePath(cloudCtx, cx, floatY);
    cloudCtx.clip();
    cloudCtx.globalAlpha = .72;
    cloudCtx.fillStyle = cloudGrainPattern;
    cloudCtx.fillRect(cx - 92, floatY - 58, 184, 108);
    cloudCtx.globalAlpha = .15;
    cloudCtx.lineWidth = .65;
    for (let i = 0; i < 19; i++) {
      const px = cx - 76 + ((i * 37) % 151);
      const py = floatY - 31 + ((i * 19) % 55);
      cloudCtx.strokeStyle = i % 3 ? '#f58b05' : '#7fbbdd';
      cloudCtx.beginPath();
      cloudCtx.moveTo(px, py);
      cloudCtx.lineTo(px + 9 + (i % 5) * 2, py + (i % 2 ? 1.5 : -1.5));
      cloudCtx.stroke();
    }
    cloudCtx.restore();

    cloudCtx.globalCompositeOperation = 'destination-out';
    eraseMarks.forEach((mark, index) => {
      const fade = 1 - clamp((time - mark.at - 2450) / 1250, 0, 1);
      if (fade <= 0) return;
      cloudCtx.globalAlpha = fade;
      cloudCtx.beginPath();
      cloudCtx.ellipse(mark.x, mark.y, mark.r * 1.45, mark.r * .62, mark.tilt, 0, Math.PI * 2);
      cloudCtx.fill();
      if (index % 2 === 0) {
        cloudCtx.beginPath();
        cloudCtx.arc(mark.x + mark.r * .48, mark.y - mark.r * .22, mark.r * .42, 0, Math.PI * 2);
        cloudCtx.fill();
      }
    });
    cloudCtx.restore();
    ctx.drawImage(cloudLayer, 0, 0, width, height);

    if (!eraseMarks.length) cloudMemory = '';
  }

  function drawSunPendant(x, y, size, alpha, phase, time) {
    ctx.save();
    ctx.translate(x + (reducedMotion ? 0 : Math.sin(time * .0012 + phase) * 2.2), y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#f58b05';
    ctx.fillStyle = 'rgba(255, 194, 47, .82)';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 13;
    ctx.shadowColor = 'rgba(255, 194, 47, .82)';
    ctx.beginPath();
    ctx.arc(0, 0, size * .5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, size * .45, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = alpha * .18;
    ctx.strokeStyle = '#7f6d16';
    ctx.lineWidth = .7;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-size * .42, i * size * .16);
      ctx.lineTo(size * .42, i * size * .16 - size * .2);
      ctx.stroke();
    }
    ctx.restore();
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5 + Math.sin(i * 7.7) * .035;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * size * .68, Math.sin(a) * size * .68);
      ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha * .4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(1, 1, size * .37, .2, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();
  }

  function drawRoughSunRing(cx, cy, radius, color, lineWidth, phase) {
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const angle = i / 96 * Math.PI * 2;
      const wobble = Math.sin(i * 2.37 + phase) * 1.25 + Math.sin(i * 5.91 + phase * 1.7) * .62;
      const r = radius + wobble;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function drawBottomSun(time) {
    const radius = Math.min(width * .38, 190);
    const cx = width / 2;
    const cy = height - radius * .04 + (reducedMotion ? 0 : Math.sin(time * .00055) * .7);
    const glow = ctx.createRadialGradient(cx, cy - radius * .46, 5, cx, cy - radius * .46, radius * 1.34);
    glow.addColorStop(0, 'rgba(255, 194, 47, .32)');
    glow.addColorStop(.55, 'rgba(255, 194, 47, .09)');
    glow.addColorStop(1, 'rgba(255, 194, 47, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, cy - radius * 1.35, width, radius * 1.45);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 14;
    ctx.shadowColor = 'rgba(255, 194, 47, .34)';
    drawRoughSunRing(cx, cy, radius + 27, 'rgba(255, 194, 47, .92)', 4.3, .7);
    drawRoughSunRing(cx, cy, radius + 18, 'rgba(255, 206, 61, .58)', 2.2, 2.1);
    drawRoughSunRing(cx, cy, radius + 11, 'rgba(255, 194, 47, .42)', 1.2, 4.2);

    const face = ctx.createRadialGradient(cx - radius * .17, cy - radius * .48, radius * .06, cx, cy, radius);
    face.addColorStop(0, '#ffd94f');
    face.addColorStop(1, '#ffc22f');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.shadowBlur = 0;
    for (let i = 0; i < 92; i++) {
      const span = Math.max(1, radius * 2);
      const px = cx - radius + ((i * 47.3) % span);
      const py = cy - radius + ((i * 31.7) % span);
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(255, 246, 174, .18)' : 'rgba(245, 139, 5, .12)';
      ctx.lineWidth = i % 7 === 0 ? 1.35 : .72;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 7 + (i % 5) * 2.6, py - 2.5 + (i % 4) * 1.7);
      ctx.stroke();
    }
    for (let i = 0; i < 54; i++) {
      const angle = i * 2.399;
      const distance = radius * (.12 + ((i * 37) % 83) / 100);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 250, 201, .18)' : 'rgba(239, 137, 10, .10)';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, i % 6 === 0 ? 1.1 : .55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.shadowBlur = 7;
    ctx.shadowColor = 'rgba(245, 139, 5, .24)';
    for (let i = 0; i < 7; i++) {
      const offsetX = Math.sin(i * 3.7) * radius * .018;
      const offsetY = Math.cos(i * 2.9) * radius * .012;
      ctx.fillStyle = i % 2 ? 'rgba(245, 139, 5, .12)' : 'rgba(239, 123, 12, .15)';
      ctx.beginPath();
      ctx.ellipse(cx - radius * .48 + offsetX, cy - radius * .02 + offsetY, radius * .23, radius * .18, -.08, 0, Math.PI * 2);
      ctx.ellipse(cx + radius * .48 - offsetX, cy - radius * .02 + offsetY, radius * .23, radius * .18, .08, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#87551f';
    ctx.lineWidth = Math.max(2.1, radius * .017);
    ctx.beginPath();
    ctx.moveTo(cx - radius * .42, cy - radius * .62);
    ctx.quadraticCurveTo(cx - radius * .30, cy - radius * .75, cx - radius * .18, cy - radius * .62);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + radius * .18, cy - radius * .62);
    ctx.quadraticCurveTo(cx + radius * .30, cy - radius * .75, cx + radius * .42, cy - radius * .62);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - radius * .18, cy - radius * .45);
    ctx.quadraticCurveTo(cx, cy - radius * .34, cx + radius * .18, cy - radius * .45);
    ctx.stroke();
    ctx.restore();
  }

  function drawSun(dt, time) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#c4e9f2');
    sky.addColorStop(.48, '#a9dced');
    sky.addColorStop(1, '#7fbbdd');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const mist = ctx.createRadialGradient(width * .64, height * .72, 8, width * .64, height * .72, Math.max(width, height) * .46);
    mist.addColorStop(0, 'rgba(255, 194, 47, .25)');
    mist.addColorStop(.46, 'rgba(245, 139, 5, .08)');
    mist.addColorStop(1, 'rgba(127, 187, 221, 0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, 0, width, height);

    drawBottomSun(time);

    motes.forEach(mote => {
      if (!reducedMotion) {
        mote.y -= mote.speed * dt * .45;
        mote.x += Math.sin(time * .00065 + mote.y) * mote.drift * dt;
        if (mote.y < -4) { mote.y = groundY; mote.x = random(0, width); }
      }
      ctx.fillStyle = `rgba(255, 194, 47, ${mote.a * .72})`;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
      ctx.fill();
    });

    const targetSwing = sunnyStage >= 1 ? 1 : 0;
    const targetPendants = sunnyStage >= 2 ? 1 : 0;
    if (reducedMotion) {
      swingDrop = targetSwing;
      pendantDrop = targetPendants;
      swingAngle = 0;
      swingVelocity = 0;
    } else {
      swingDrop += (targetSwing - swingDrop) * (1 - Math.exp(-dt * 4.2));
      pendantDrop += (targetPendants - pendantDrop) * (1 - Math.exp(-dt * 3.6));
    }
    if (!reducedMotion && !swingDragging && swingDrop > .96) {
      swingVelocity += -5.6 * Math.sin(swingAngle) * dt;
      swingVelocity *= Math.exp(-1.18 * dt);
      swingAngle += swingVelocity * dt;
      if (Math.abs(swingAngle) < .0007 && Math.abs(swingVelocity) < .0012) {
        swingAngle = 0;
        swingVelocity = 0;
      }
    }

    const anchorX = width / 2;
    const anchorY = height * .195 + 18;
    const ropeLength = Math.max(210, height * .53) * swingDrop;

    if (pendantDrop > .01) {
      const specs = [
        [-68, 74, 9, .00], [-41, 128, 8, .10], [32, 92, 9, .18], [58, 142, 10, .27], [76, 66, 7, .34]
      ];
      specs.forEach(([offset, len, size, delay], i) => {
        const p = clamp((pendantDrop - delay) / (1 - delay), 0, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const sway = (reducedMotion ? 0 : Math.sin(time * .0011 + i * 1.7) * 3) + swingAngle * len * .34;
        ctx.strokeStyle = `rgba(255, 250, 218, ${.74 * p})`;
        ctx.lineWidth = .9;
        ctx.beginPath();
        ctx.moveTo(anchorX + offset, anchorY - 6);
        ctx.lineTo(anchorX + offset + sway, anchorY + len * eased);
        ctx.stroke();
        drawSunPendant(anchorX + offset + sway, anchorY + len * eased, size, p, i, time);
      });
    }

    if (swingDrop > .01) {
      ctx.save();
      ctx.translate(anchorX, anchorY);
      ctx.rotate(swingAngle);
      ctx.strokeStyle = `rgba(255, 251, 228, ${.88 * swingDrop})`;
      ctx.lineWidth = 1.25;
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(255, 241, 194, .48)';
      ctx.beginPath();
      ctx.moveTo(-31, 0);
      ctx.lineTo(-31, ropeLength);
      ctx.moveTo(31, 0);
      ctx.lineTo(31, ropeLength);
      ctx.stroke();
      if (swingDrop > .52) drawFlower(time, { x: 0, baseY: ropeLength - 5, scale: .72 });
      ctx.fillStyle = 'rgba(255, 253, 238, .98)';
      ctx.shadowBlur = 13;
      ctx.beginPath();
      ctx.roundRect(-44, ropeLength - 4, 88, 8, 2);
      ctx.fill();
      ctx.restore();
    }

    drawCloud(anchorX, height * .195, time);
    drawPaperTexture(.58);
  }

  function frame(time) {
    const rawDt = (time - lastTime) / 1000;
    const dt = Math.min(rawDt, .033);
    lastTime = time;
    const target = umbrellaOpen ? 1 : 0;
    if (reducedMotion) umbrellaProgress = target;
    else umbrellaProgress += (target - umbrellaProgress) * (1 - Math.exp(-dt * 5.8));
    if (Math.abs(target - umbrellaProgress) < .001) umbrellaProgress = target;
    if (cycle.sunny) drawSun(dt, time);
    else {
      drawNight(dt, time);
      drawFlower(time);
    }
    requestAnimationFrame(frame);
  }

  function openDialog() {
    hint.style.opacity = '0';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    setTimeout(() => input.focus(), 180);
  }

  function toggleUmbrella() {
    if (cycle.sunny) return;
    if (!soundStarted) startSoundscape();
    umbrellaOpen = !umbrellaOpen;
    umbrellaHit.setAttribute('aria-expanded', String(umbrellaOpen));
    umbrellaHit.setAttribute('aria-label', umbrellaOpen ? 'Close the umbrella' : 'Open the umbrella');
    hint.textContent = umbrellaOpen ? 'Tap the flower' : 'Tap the umbrella';
    if (umbrellaOpen) {
      markWateredToday();
      playOneShot(audio.umbrellaOpen);
      audio.rainLoop.volume = 0;
      if (!soundMuted) void audio.rainLoop.play().then(() => fadeAudio(audio.rainLoop, .17, 820)).catch(() => {});
      rain = rain.map((_, i) => makeDrop(i));
    } else {
      playOneShot(audio.umbrellaClose);
      fadeAudio(audio.rainLoop, 0, 580, true);
    }
  }

  function scheduleMidnightRefresh() {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 120);
    setTimeout(() => location.reload(), Math.max(1000, nextMidnight.getTime() - now.getTime()));
  }

  function advanceSunnyScene() {
    if (!cycle.sunny) return;
    if (!soundStarted) startSoundscape();
    if (sunnyStage === 0) {
      sunnyStage = 1;
      swingHit.disabled = false;
      cloudHit.setAttribute('aria-label', 'Tap the cloud again to lower the sun charms');
      hint.textContent = 'Tap the cloud again';
      playOneShot(audio.umbrellaOpen);
    } else if (sunnyStage === 1) {
      sunnyStage = 2;
      cloudHit.setAttribute('aria-label', 'The sun charms are down');
      hint.textContent = 'Swing it, or wipe the cloud';
      playOneShot(audio.star);
    }
  }

  function beginCloudGesture(event) {
    if (!cycle.sunny) return;
    cloudGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false
    };
    cloudHit.setPointerCapture?.(event.pointerId);
  }

  function moveCloudGesture(event) {
    if (!cloudGesture || cloudGesture.pointerId !== event.pointerId) return;
    const totalX = event.clientX - cloudGesture.startX;
    const totalY = event.clientY - cloudGesture.startY;
    if (!cloudGesture.moved && Math.hypot(totalX, totalY) < 7) return;
    if (!cloudGesture.moved) {
      cloudGesture.moved = true;
      cloudMemory = freshNote || (notes.length ? notes[Math.floor(Math.random() * notes.length)] : 'Write a line on a rainy day first');
      if (!soundStarted) startSoundscape();
      if (!soundMuted) {
        audio.eraser.currentTime = 0;
        void audio.eraser.play().catch(() => {});
      }
    }

    const dx = event.clientX - cloudGesture.lastX;
    const dy = event.clientY - cloudGesture.lastY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const steps = Math.ceil(distance / 7);
    const cloudY = height * .195;
    for (let i = 1; i <= steps; i++) {
      const x = cloudGesture.lastX + dx * (i / steps);
      const y = cloudGesture.lastY + dy * (i / steps);
      if (Math.abs(x - width / 2) < 86 && Math.abs(y - cloudY) < 43) {
        const at = performance.now();
        eraseMarks.push({ x, y, r: random(9, 15), tilt: random(-.28, .28), at });
        eraseMarks.push({ x: x + random(-5, 5), y: y + random(-9, -3), r: random(4, 9), tilt: random(-.5, .5), at });
        eraseMarks.push({ x: x + random(-5, 5), y: y + random(3, 9), r: random(4, 9), tilt: random(-.5, .5), at });
      }
    }
    if (eraseMarks.length > 240) eraseMarks.splice(0, eraseMarks.length - 240);
    cloudGesture.lastX = event.clientX;
    cloudGesture.lastY = event.clientY;
  }

  function endCloudGesture(event) {
    if (!cloudGesture || cloudGesture.pointerId !== event.pointerId) return;
    cloudSkipClick = cloudGesture.moved;
    cloudGesture = null;
    audio.eraser.pause();
    audio.eraser.currentTime = 0;
    cloudHit.releasePointerCapture?.(event.pointerId);
  }

  function beginSwingDrag(event) {
    if (!cycle.sunny || sunnyStage < 1 || swingDrop < .68) return;
    swingDragging = true;
    dragStartX = event.clientX;
    dragStartAngle = swingAngle;
    dragLastAngle = swingAngle;
    dragLastAt = event.timeStamp;
    swingVelocity = 0;
    swingHit.setPointerCapture?.(event.pointerId);
    playOneShot(audio.umbrellaClose);
  }

  function moveSwingDrag(event) {
    if (!swingDragging) return;
    const next = clamp(dragStartAngle + (event.clientX - dragStartX) / Math.max(width * .72, 250), -.48, .48);
    const elapsed = Math.max((event.timeStamp - dragLastAt) / 1000, .008);
    swingVelocity = clamp((next - dragLastAngle) / elapsed, -2.8, 2.8);
    swingAngle = next;
    dragLastAngle = next;
    dragLastAt = event.timeStamp;
  }

  function endSwingDrag(event) {
    if (!swingDragging) return;
    swingDragging = false;
    swingHit.releasePointerCapture?.(event.pointerId);
  }

  function storeNote(rawValue) {
    const value = String(rawValue || '').trim().replace(/\s+/g, ' ');
    if (!value || [...value].length > 48) throw new Error('Write 1 to 48 characters');
    notes.push(value);
    if (notes.length > 120) notes = notes.slice(-120);
    noteStore = { cycleKey: cycle.cycleKey, items: notes };
    localStorage.setItem(NOTES, JSON.stringify(noteStore));
    rain.forEach((drop, i) => { if (i % 5 === 0) drop.message = chooseNote(); });
    if (rain.length) {
      const immediate = rain[Math.floor(rain.length * .36)];
      immediate.message = value;
      immediate.x = width / 2 + random(-clamp(width * .18, 58, 104), clamp(width * .18, 58, 104));
      immediate.y = height * .32;
    }
    if (!cycle.sunny && !umbrellaOpen) toggleUmbrella();
    return value;
  }

  umbrellaHit.addEventListener('click', toggleUmbrella);
  flowerHit.addEventListener('click', openDialog);
  cloudHit.addEventListener('pointerdown', beginCloudGesture);
  cloudHit.addEventListener('pointermove', moveCloudGesture);
  cloudHit.addEventListener('pointerup', endCloudGesture);
  cloudHit.addEventListener('pointercancel', endCloudGesture);
  cloudHit.addEventListener('click', () => {
    if (cloudSkipClick) { cloudSkipClick = false; return; }
    advanceSunnyScene();
  });
  swingHit.addEventListener('pointerdown', beginSwingDrag);
  swingHit.addEventListener('pointermove', moveSwingDrag);
  swingHit.addEventListener('pointerup', endSwingDrag);
  swingHit.addEventListener('pointercancel', endSwingDrag);
  experience.addEventListener('pointerdown', () => {
    if (!soundStarted && !soundMuted) startSoundscape();
  }, { passive: true });
  soundToggle.addEventListener('click', event => {
    event.stopPropagation();
    soundMuted = !soundMuted;
    localStorage.setItem(SOUND, soundMuted ? '1' : '0');
    syncSoundButton();
    if (soundMuted) stopSoundscape();
    else startSoundscape();
  });
  input.addEventListener('input', () => { count.textContent = `${[...input.value].length} / 48`; });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit(document.getElementById('sendNote'));
    }
  });

  form.addEventListener('submit', event => {
    const submitter = event.submitter;
    if (!submitter || submitter.value === 'cancel') return;
    event.preventDefault();
    let value;
    try { value = storeNote(input.value); }
    catch { input.focus(); return; }
    input.value = '';
    count.textContent = '0 / 48';
    dialog.close();
    clearTimeout(toastTimer);
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  });

  dialog.addEventListener('close', () => { hint.style.opacity = ''; });

  const modelContext = document.modelContext;
  if (modelContext?.registerTool) {
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(modelContext.registerTool({
        name: 'add_rain_message',
        title: 'Write into the rain',
        description: 'Add a line of up to 48 characters to the text rain on this device.',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string', minLength: 1, maxLength: 48 } },
          required: ['message'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(payload) {
          if (!payload || typeof payload.message !== 'string') throw new Error('message must be text');
          const message = storeNote(payload.message);
          return { saved: true, message, total: notes.length };
        }
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch {}
  }

  addEventListener('resize', resize, { passive: true });
  syncSoundButton();
  resize();
  scheduleMidnightRefresh();
  requestAnimationFrame(frame);
})();
