/* 扔培根大作战 —— Bacon Toss (Deluxe)
 * 纯手绘 Canvas 小游戏：弹弓拖拽，把培根扔进煎锅。
 * 无依赖，仅在 _pages/game.md 中加载。
 */
(function () {
  "use strict";

  // ---------- 常量 ----------
  var W = 960, H = 540;            // 逻辑画布尺寸
  var GROUND_Y = H - 52;           // 地面 y
  var OX = 118, OY = GROUND_Y - 40;// 弹弓皮兜（发射点）
  var GRAVITY = 1350;              // 重力 px/s^2
  var POWER = 4.2;                 // 拖拽距离 -> 初速度
  var MAX_SPEED = 1500;
  var MAX_DRAG = 260;

  var canvas = document.getElementById("bacon-canvas");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var el = {
    score: document.getElementById("bg-score"),
    streak: document.getElementById("bg-streak"),
    best: document.getElementById("bg-best"),
    level: document.getElementById("bg-level"),
    wind: document.getElementById("bg-wind"),
    msg: document.getElementById("bg-message"),
    restart: document.getElementById("bg-restart")
  };

  // ---------- 工具 ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ellipse(x, y, rx, ry) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- 状态 ----------
  var state = "aim";               // "aim" | "fly" | "resolve"
  var score, streak, hits, level;
  var best = 0;
  try { best = parseInt(localStorage.getItem("baconTossBest") || "0", 10) || 0; } catch (e) {}
  var wind = 0;                    // 水平加速度 px/s^2
  var pan;                         // { baseX, x, y, r, oscAmp, oscSpeed, bounceT }
  var bacon;                       // { x, y, vx, vy, rot, spin, phase }
  var dragPos = null;
  var resolveT = 0;
  var lastWasHit = false;
  var shakeT = 0, shakeDur = 0.001, shakeAmp = 0;
  var levelUpT = 0;
  var sizzleT = 0;
  var time = 0;
  var i, j;

  var particles = [];              // {type, x,y,vx,vy,t,life,r,color,rot,spin}
  var floaters = [];               // {x,y,t,life,text,color,size}
  var splats = [];                 // {x,y,t,rot}
  var rings = [];                  // {x,y,t}
  var trail = [];                  // 飞行拖尾 {x,y,rot,phase}
  var clouds = [];
  var tufts = [];
  var flowers = [];
  var butterfly = null;
  var butterflyTimer = rand(6, 12);
  var leafTimer = 0;

  for (i = 0; i < 4; i++) {
    clouds.push({ x: rand(0, W), y: rand(44, 128), s: rand(0.7, 1.3), lobes: [] });
    var c = clouds[i];
    var n = 4 + Math.floor(rand(0, 2));
    for (j = 0; j < n; j++) c.lobes.push({ dx: (j - n / 2) * 16 + rand(-5, 5), dy: rand(-7, 4), r: rand(11, 19) });
  }
  for (i = 0; i < 64; i++) tufts.push({ x: rand(4, W - 4), h: rand(6, 14), ph: rand(0, 6.28), w: rand(0.7, 1.3) });
  var FLOWER_COLORS = ["#ff8fa3", "#ffd166", "#c8a2f0", "#ff9e7d", "#8fd3ff"];
  for (i = 0; i < 13; i++) flowers.push({ x: rand(30, W - 30), y: GROUND_Y + rand(14, 34), c: FLOWER_COLORS[i % FLOWER_COLORS.length], s: rand(0.7, 1.1) });

  // ---------- 音效 ----------
  var actx = null;
  function ac() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function noiseBurst(dur, type, f0, f1, gainV) {
    var a = ac(); if (!a) return;
    var n = Math.floor(a.sampleRate * dur);
    var buf = a.createBuffer(1, n, a.sampleRate);
    var d = buf.getChannelData(0);
    for (var k = 0; k < n; k++) d[k] = Math.random() * 2 - 1;
    var src = a.createBufferSource(); src.buffer = buf;
    var f = a.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, a.currentTime);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), a.currentTime + dur);
    var g = a.createGain();
    g.gain.setValueAtTime(gainV, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start();
  }
  function tone(f0, f1, dur, gainV, delay) {
    var a = ac(); if (!a) return;
    var t0 = a.currentTime + (delay || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainV, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function playWhoosh() { noiseBurst(0.24, "bandpass", 500, 1600, 0.22); }
  function playSizzle() { noiseBurst(0.85, "highpass", 2800, 3800, 0.3); }
  function playThud() { tone(110, 50, 0.2, 0.3); noiseBurst(0.12, "lowpass", 300, 120, 0.2); }
  function playDing() { tone(880, 880, 0.12, 0.2); tone(1318, 1318, 0.22, 0.2, 0.09); }
  function playLevelUp() { tone(523, 523, 0.12, 0.2); tone(659, 659, 0.12, 0.2, 0.1); tone(784, 784, 0.24, 0.22, 0.2); }

  // ---------- 游戏逻辑 ----------
  function newWind() {
    var maxW = Math.min(300, 80 + level * 40);
    wind = rand(-maxW, maxW);
    if (Math.abs(wind) < 40) wind = 0;
    var arrow = wind > 0 ? "→" : wind < 0 ? "←" : "·";
    el.wind.innerHTML = "🌬️ 风 <b>" + arrow + " " + Math.abs(wind / 60).toFixed(1) + "</b> m/s";
  }

  function newPan() {
    var r = Math.max(26, 44 - (level - 1) * 3);
    var baseX = rand(W * 0.42, W * 0.9);
    pan = {
      baseX: baseX, x: baseX, y: GROUND_Y - 10, r: r,
      oscAmp: level >= 3 ? Math.min(70, 30 + level * 6) : 0,
      oscSpeed: rand(0.9, 1.5), bounceT: 0
    };
  }

  function resetBacon() {
    bacon = { x: OX, y: OY, vx: 0, vy: 0, rot: -0.3, spin: 0, phase: rand(0, 6.28) };
    trail = [];
  }

  function pop(elm) {
    if (!elm) return;
    var p = elm.closest(".bg-pill");
    if (!p) return;
    p.classList.remove("bg-pop");
    void p.offsetWidth;
    p.classList.add("bg-pop");
  }

  function syncHud(changed) {
    el.score.textContent = score;
    el.streak.textContent = streak;
    el.best.textContent = best;
    el.level.textContent = level;
    (changed || []).forEach(pop);
  }

  function setMsg(t) { el.msg.textContent = t; }

  function resetGame() {
    score = 0; streak = 0; hits = 0; level = 1;
    particles = []; floaters = []; splats = []; rings = [];
    levelUpT = 0; sizzleT = 0; shakeT = 0;
    newWind(); newPan(); resetBacon();
    state = "aim";
    setMsg("按住画布向后拖拽瞄准，松手扔出培根！🥓");
    syncHud();
  }

  function clampDrag(p) {
    var dx = p.x - OX, dy = p.y - OY;
    var d = Math.hypot(dx, dy);
    if (d > MAX_DRAG) { dx *= MAX_DRAG / d; dy *= MAX_DRAG / d; }
    return { x: OX + dx, y: OY + dy };
  }

  function launch(p) {
    var vx = (OX - p.x) * POWER;
    var vy = (OY - p.y) * POWER;
    var sp = Math.hypot(vx, vy);
    if (sp < 90) return;
    if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; }
    bacon.vx = vx; bacon.vy = vy;
    bacon.spin = rand(4, 7) * (vx >= 0 ? 1 : -1);
    state = "fly";
    playWhoosh();
    setMsg("");
  }

  function addShake(amp, dur) {
    if (reducedMotion) return;
    shakeAmp = amp; shakeDur = dur; shakeT = dur;
  }

  function burst(x, y, n, type, opt) {
    for (var k = 0; k < n; k++) {
      var p = { type: type, x: x, y: y, t: 0, rot: rand(0, 6.28), spin: rand(-4, 4) };
      if (type === "oil") {
        p.x += rand(-pan.r * 0.6, pan.r * 0.6); p.y += rand(-4, 2);
        p.vx = rand(-70, 70); p.vy = rand(-190, -60);
        p.life = rand(0.5, 1.0); p.r = rand(1.6, 3.4);
        p.color = Math.random() < 0.5 ? "#ffd985" : "#fff3d6";
      } else if (type === "steam") {
        p.x += rand(-pan.r * 0.5, pan.r * 0.5);
        p.vx = rand(-8, 8); p.vy = rand(-60, -34);
        p.life = rand(0.9, 1.6); p.r = rand(4, 8);
        p.color = "#ffffff";
      } else if (type === "dust") {
        p.vx = rand(-70, 70); p.vy = rand(-70, -12);
        p.life = rand(0.4, 0.8); p.r = rand(4, 9);
        p.color = "#cbb89d";
      } else if (type === "confetti") {
        p.vx = rand(-160, 160); p.vy = rand(-260, -80);
        p.life = rand(0.9, 1.6); p.r = rand(2.5, 4.5);
        p.color = ["#ff6b6b", "#ffd166", "#6bcb77", "#4d96ff", "#c8a2f0"][k % 5];
      } else if (type === "sparkle") {
        p.vx = rand(-24, 24); p.vy = rand(-24, 24);
        p.life = rand(0.25, 0.5); p.r = rand(1.2, 2.4);
        p.color = "#fff6c9";
      } else if (type === "leaf") {
        p.vx = 0; p.vy = 0;
        p.life = rand(5, 9); p.r = rand(3.5, 5.5);
        p.color = ["#7fbf5a", "#a4c96b", "#e0a94e"][k % 3];
      }
      if (opt) for (var key in opt) p[key] = opt[key];
      particles.push(p);
    }
  }

  function onHit(centerRatio) {
    var perfect = centerRatio <= 0.38;
    var gained = 100 + streak * 25 + (perfect ? 50 : 0);
    score += gained;
    hits += 1; streak += 1;
    if (score > best) {
      best = score;
      try { localStorage.setItem("baconTossBest", String(best)); } catch (e) {}
    }
    var newLevel = Math.floor(hits / 5) + 1;

    playSizzle();
    if (perfect) playDing();
    pan.bounceT = 0.35;
    addShake(perfect ? 5 : 3, 0.22);
    sizzleT = 1.25;

    floaters.push({
      x: pan.x, y: pan.y - 40, t: 0, life: 1.15,
      text: perfect ? "PERFECT +" + gained : "+" + gained,
      color: perfect ? "#f5a301" : "#d9483b", size: perfect ? 34 : 28
    });
    if (perfect) rings.push({ x: pan.x, y: pan.y - 6, t: 0 });
    burst(pan.x, pan.y - 6, perfect ? 34 : 24, "oil");
    burst(pan.x, pan.y - 10, 8, "steam");

    bacon.x = pan.x; bacon.y = pan.y - 6; bacon.rot = rand(-0.35, 0.35);
    lastWasHit = true;
    state = "resolve"; resolveT = 1.3;

    if (newLevel > level) {
      level = newLevel;
      levelUpT = 1.6;
      playLevelUp();
      burst(W / 2, H / 2 - 40, 46, "confetti");
    }
    setMsg(perfect ? "完美入锅！+" + gained + " 分 🎯" : "下锅啦，滋滋作响！+" + gained + " 分" + (streak >= 3 ? "，连击 x" + streak + "！" : ""));
    syncHud([el.score, el.streak, el.best, el.level]);
  }

  function onMiss() {
    streak = 0;
    playThud();
    burst(bacon.x, GROUND_Y + 2, 12, "dust");
    splats.push({ x: clamp(bacon.x, 26, W - 26), y: GROUND_Y + 8, rot: bacon.rot, t: 0 });
    if (splats.length > 6) splats.shift();
    lastWasHit = false;
    state = "resolve"; resolveT = 0.9;
    setMsg("哎呀，掉地上了…… 调整力度再来一次！");
    syncHud([el.streak]);
  }

  function update(dt) {
    time += dt;

    // 云
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.x += (6 + wind * 0.06) * dt * c.s;
      if (c.x > W + 110) c.x = -110;
      if (c.x < -120) c.x = W + 100;
    }

    // 飘叶（风的方向指示）
    leafTimer -= dt;
    if (leafTimer <= 0) {
      leafTimer = rand(0.7, 1.6);
      var fromLeft = wind >= 0;
      burst(fromLeft ? -14 : W + 14, rand(70, GROUND_Y - 90), 1, "leaf");
    }

    // 蝴蝶
    butterflyTimer -= dt;
    if (butterflyTimer <= 0 && !butterfly) {
      butterflyTimer = rand(14, 26);
      butterfly = { x: -20, y: rand(150, 260), t: 0, dir: 1, hue: rand(0, 360) };
    }
    if (butterfly) {
      butterfly.t += dt;
      butterfly.x += butterfly.dir * 34 * dt;
      if (butterfly.x > W + 30) butterfly = null;
    }

    // 锅移动 / 弹跳
    if (pan.oscAmp > 0) pan.x = pan.baseX + Math.sin(time * pan.oscSpeed) * pan.oscAmp;
    if (pan.bounceT > 0) pan.bounceT -= dt;

    // 培根静置呼吸
    if (state === "aim" && !dragPos) bacon.phase += dt * 2;

    if (state === "fly") {
      bacon.vy += GRAVITY * dt;
      bacon.vx += wind * dt;
      bacon.x += bacon.vx * dt;
      bacon.y += bacon.vy * dt;
      bacon.rot += bacon.spin * dt;
      bacon.phase += dt * (6 + Math.hypot(bacon.vx, bacon.vy) * 0.004);

      trail.unshift({ x: bacon.x, y: bacon.y, rot: bacon.rot, phase: bacon.phase });
      if (trail.length > 9) trail.pop();
      if (Math.random() < 0.35) burst(bacon.x, bacon.y, 1, "sparkle");

      if (bacon.vy > 0 &&
          Math.abs(bacon.x - pan.x) <= pan.r * 0.95 &&
          bacon.y >= pan.y - 12 && bacon.y <= pan.y + 16) {
        onHit(Math.abs(bacon.x - pan.x) / pan.r);
      } else if (bacon.y >= GROUND_Y + 6 || bacon.x > W + 70 || bacon.x < -90) {
        onMiss();
      }
    } else if (state === "resolve") {
      resolveT -= dt;
      if (sizzleT > 0) {
        sizzleT -= dt;
        if (Math.random() < 0.5) burst(pan.x, pan.y - 10, 1, "steam");
        if (Math.random() < 0.25) burst(pan.x, pan.y - 6, 1, "oil");
      }
      if (resolveT <= 0) {
        if (lastWasHit) {
          newPan(); newWind();
          setMsg("新一锅就位，继续！🍳");
        }
        resetBacon();
        state = "aim";
      }
    }

    // 粒子
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.t += dt;
      if (p.type === "oil" || p.type === "confetti" || p.type === "dust") {
        p.vy += (p.type === "confetti" ? 500 : 900) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.type === "confetti") { p.rot += p.spin * dt; p.vx *= (1 - 1.6 * dt); }
      } else if (p.type === "steam") {
        p.x += (p.vx + Math.sin(p.t * 6 + p.rot) * 14) * dt;
        p.y += p.vy * dt;
        p.r += 6 * dt;
      } else if (p.type === "sparkle") {
        p.x += p.vx * dt; p.y += p.vy * dt;
      } else if (p.type === "leaf") {
        p.vx = wind * 0.9 + Math.sin(p.t * 2.4 + p.rot) * 22;
        p.vy = 26 + Math.sin(p.t * 3.1 + p.rot) * 14;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.spin * 0.4 * dt;
        if (p.y > GROUND_Y + 20) p.t = p.life;
      }
      if (p.t > p.life || p.x < -60 || p.x > W + 60) particles.splice(i, 1);
    }

    // 飘字 / 光环 / 落地培根
    for (i = floaters.length - 1; i >= 0; i--) {
      var fl = floaters[i];
      fl.t += dt; fl.y -= 32 * dt;
      if (fl.t > fl.life) floaters.splice(i, 1);
    }
    for (i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t > 0.6) rings.splice(i, 1);
    }
    for (i = 0; i < splats.length; i++) splats[i].t += dt;
    if (shakeT > 0) shakeT -= dt;
    if (levelUpT > 0) levelUpT -= dt;
  }

  // ---------- 绘制 ----------
  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#6ec1f0");
    g.addColorStop(0.55, "#a9dcf7");
    g.addColorStop(0.8, "#e8f4e9");
    g.addColorStop(1, "#fdeed3");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 太阳光晕
    var sx = W - 96, sy = 78;
    var sg = ctx.createRadialGradient(sx, sy, 8, sx, sy, 96);
    sg.addColorStop(0, "rgba(255,240,190,0.95)");
    sg.addColorStop(0.35, "rgba(255,214,106,0.55)");
    sg.addColorStop(1, "rgba(255,214,106,0)");
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sx, sy, 96, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd96a";
    ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.arc(sx - 8, sy - 9, 9, 0, Math.PI * 2); ctx.fill();
  }

  function drawClouds() {
    for (var k = 0; k < clouds.length; k++) {
      var c = clouds[k];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.s, c.s);
      ctx.fillStyle = "rgba(210,228,240,0.85)";
      for (var m = 0; m < c.lobes.length; m++) {
        var l = c.lobes[m];
        ctx.beginPath(); ctx.arc(l.dx, l.dy + 5, l.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      for (m = 0; m < c.lobes.length; m++) {
        l = c.lobes[m];
        ctx.beginPath(); ctx.arc(l.dx, l.dy, l.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawHills() {
    ctx.fillStyle = "#b5dba0";
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.quadraticCurveTo(W * 0.18, GROUND_Y - 74, W * 0.42, GROUND_Y - 20);
    ctx.quadraticCurveTo(W * 0.6, GROUND_Y + 6, W * 0.78, GROUND_Y - 46);
    ctx.quadraticCurveTo(W * 0.92, GROUND_Y - 72, W, GROUND_Y - 26);
    ctx.lineTo(W, GROUND_Y); ctx.closePath(); ctx.fill();

    ctx.fillStyle = "#93c97b";
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.quadraticCurveTo(W * 0.3, GROUND_Y - 40, W * 0.58, GROUND_Y - 8);
    ctx.quadraticCurveTo(W * 0.8, GROUND_Y + 8, W, GROUND_Y - 14);
    ctx.lineTo(W, GROUND_Y); ctx.closePath(); ctx.fill();
  }

  function drawGround() {
    var g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, "#86c95a");
    g.addColorStop(1, "#5fa83e");
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = "#4e9334";
    ctx.fillRect(0, GROUND_Y, W, 4);

    // 随风摆动的草
    var swayBase = clamp(wind * 0.02, -7, 7);
    for (var k = 0; k < tufts.length; k++) {
      var t = tufts[k];
      var sway = Math.sin(time * 1.7 + t.ph) * 2.2 + swayBase;
      ctx.strokeStyle = k % 3 ? "#57a13a" : "#6cb84a";
      ctx.lineWidth = 1.6 * t.w;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(t.x, GROUND_Y + 3);
      ctx.quadraticCurveTo(t.x + sway * 0.4, GROUND_Y - t.h * 0.6, t.x + sway, GROUND_Y - t.h);
      ctx.stroke();
    }

    // 小花
    for (var f = 0; f < flowers.length; f++) {
      var fl = flowers[f];
      ctx.save();
      ctx.translate(fl.x, fl.y);
      ctx.scale(fl.s, fl.s);
      ctx.fillStyle = fl.c;
      for (var pt = 0; pt < 5; pt++) {
        var a = pt / 5 * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 3.4, Math.sin(a) * 3.4, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#ffe08a";
      ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawButterfly() {
    if (!butterfly) return;
    var b = butterfly;
    var y = b.y + Math.sin(b.t * 2.2) * 24;
    var flap = Math.abs(Math.sin(b.t * 13));
    ctx.save();
    ctx.translate(b.x, y);
    ctx.fillStyle = "hsl(" + b.hue + ",75%,72%)";
    ctx.save(); ctx.rotate(-0.5); ctx.scale(0.4 + flap * 0.6, 1);
    ctx.beginPath(); ctx.ellipse(-6, 0, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.rotate(0.5); ctx.scale(0.4 + flap * 0.6, 1);
    ctx.beginPath(); ctx.ellipse(6, 0, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.strokeStyle = "#5a4632";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();
    ctx.restore();
  }

  // 手绘波浪培根
  function drawBaconStrip(x, y, rot, phase, scaleF, squash, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scaleF, scaleF * (squash ? 0.3 : 1));

    var LEN = 46, WID = 15, WAVES = 2.1, AMP = 3.6, STEPS = 22;
    function path(off0, off1) {
      ctx.beginPath();
      for (var k = 0; k <= STEPS; k++) {
        var t = k / STEPS;
        var px = -LEN / 2 + t * LEN;
        var py = Math.sin(t * Math.PI * 2 * WAVES + phase) * AMP + off0;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      for (var k2 = STEPS; k2 >= 0; k2--) {
        var t2 = k2 / STEPS;
        var px2 = -LEN / 2 + t2 * LEN;
        var py2 = Math.sin(t2 * Math.PI * 2 * WAVES + phase) * AMP + off1;
        ctx.lineTo(px2, py2);
      }
      ctx.closePath();
    }

    // 主体（瘦肉）
    path(-WID / 2, WID / 2);
    ctx.fillStyle = "#d84f45";
    ctx.fill();
    ctx.strokeStyle = "#b23a31";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 脂肪条纹
    path(-WID / 2 + 2, -WID / 2 + 5.5);
    ctx.fillStyle = "#f6b3a1";
    ctx.fill();
    path(1.5, 5);
    ctx.fillStyle = "#f9c4b5";
    ctx.fill();
    // 高光
    path(-WID / 2 + 6.5, -WID / 2 + 7.8);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fill();

    ctx.restore();
  }

  function drawSkillet() {
    var bounce = 0, squash = 1;
    if (pan.bounceT > 0) {
      var bt = 1 - pan.bounceT / 0.35;
      bounce = Math.sin(bt * Math.PI) * 12;
      squash = 1 + Math.sin(bt * Math.PI) * 0.12;
    }
    var x = pan.x, y = pan.y - bounce;

    // 影子
    ctx.fillStyle = "rgba(30,50,30,0.22)";
    ellipse(pan.x, GROUND_Y + 8, pan.r * (1.05 + bounce * 0.01), 7);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(squash, 2 - squash > 0 ? 1 / squash : 1);

    // 手柄
    ctx.fillStyle = "#26292d";
    roundRect(pan.r * 0.7, -7, pan.r * 1.25, 9, 4.5);
    ctx.fill();
    ctx.fillStyle = "#3a3f45";
    ctx.beginPath(); ctx.arc(pan.r * 0.7 + pan.r * 1.1, -2.5, 2.4, 0, Math.PI * 2); ctx.fill();

    // 锅身
    var g = ctx.createLinearGradient(0, -pan.r * 0.5, 0, pan.r * 0.3);
    g.addColorStop(0, "#4a5057");
    g.addColorStop(1, "#26292d");
    ctx.fillStyle = g;
    ellipse(0, 0, pan.r, pan.r * 0.46);
    ctx.fill();

    // 锅内壁
    var g2 = ctx.createRadialGradient(-pan.r * 0.2, -pan.r * 0.12, 2, 0, 0, pan.r);
    g2.addColorStop(0, "#5b636c");
    g2.addColorStop(1, "#343a40");
    ctx.fillStyle = g2;
    ellipse(0, -pan.r * 0.06, pan.r * 0.8, pan.r * 0.33);
    ctx.fill();

    // 油面光泽
    ctx.fillStyle = "rgba(255,230,150," + (0.14 + 0.08 * Math.sin(time * 3)) + ")";
    ellipse(0, -pan.r * 0.06, pan.r * 0.58, pan.r * 0.22);
    ctx.fill();

    // 锅沿高光
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -1, pan.r - 1, pan.r * 0.46 - 1, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    ctx.restore();

    // 瞄准时的提示圈
    if (state === "aim") {
      var pulse = 1 + Math.sin(time * 3) * 0.06;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      ellipse(pan.x, pan.y - 2, pan.r * 1.25 * pulse, pan.r * 0.62 * pulse);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  var P1 = { x: OX - 14, y: OY - 16 };  // 弹弓左叉尖
  var P2 = { x: OX + 13, y: OY - 14 };  // 弹弓右叉尖

  function drawSlingshot(pouch) {
    // 皮筋（先画，垫在培根下面）
    ctx.strokeStyle = "#b8452f";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    var px = pouch ? pouch.x : OX, py = pouch ? pouch.y : OY - 2;
    ctx.beginPath(); ctx.moveTo(P1.x, P1.y); ctx.lineTo(px, py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(P2.x, P2.y); ctx.lineTo(px, py); ctx.stroke();

    // 木叉
    ctx.strokeStyle = "#8a5a34";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(OX - 2, GROUND_Y + 4);
    ctx.quadraticCurveTo(OX - 4, OY + 14, OX - 8, OY + 2);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(OX - 6, OY + 6); ctx.lineTo(P1.x, P1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(OX - 5, OY + 7); ctx.lineTo(P2.x, P2.y); ctx.stroke();
    // 树皮高光
    ctx.strokeStyle = "rgba(255,220,180,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(OX - 4, GROUND_Y - 2);
    ctx.quadraticCurveTo(OX - 6, OY + 12, OX - 9, OY);
    ctx.stroke();

    // 影子
    ctx.fillStyle = "rgba(30,50,30,0.2)";
    ellipse(OX - 2, GROUND_Y + 6, 16, 4.5);
    ctx.fill();
  }

  function drawTrajectory(p) {
    var vx = (OX - p.x) * POWER, vy = (OY - p.y) * POWER;
    var sp = Math.hypot(vx, vy);
    if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; }
    var sx = OX, sy = OY, dt = 1 / 30;
    for (var k = 0; k < 44; k++) {
      vy += GRAVITY * dt; vx += wind * dt;
      sx += vx * dt; sy += vy * dt;
      if (sy > GROUND_Y || sx > W || sx < 0) break;
      if (k % 2 === 0) {
        var a = 0.75 * (1 - k / 46);
        ctx.fillStyle = "rgba(255,255,255," + a + ")";
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(2.2, 5.5 - k * 0.075), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(216,79,69," + a * 0.85 + ")";
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.2, 3 - k * 0.05), 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawParticles() {
    for (var k = 0; k < particles.length; k++) {
      var p = particles[k];
      var a = clamp(1 - p.t / p.life, 0, 1);
      if (p.type === "steam") {
        ctx.fillStyle = "rgba(255,255,255," + a * 0.5 + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === "leaf") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot + Math.sin(p.t * 3) * 0.6);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(90,60,20,0.5)";
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-p.r, 0); ctx.lineTo(p.r, 0); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === "confetti") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.type === "dust") {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a * 0.55;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t * 2), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawRings() {
    for (var k = 0; k < rings.length; k++) {
      var r = rings[k];
      var t = r.t / 0.6;
      ctx.strokeStyle = "rgba(245,179,1," + (1 - t) * 0.9 + ")";
      ctx.lineWidth = 4 * (1 - t) + 1;
      ellipse(r.x, r.y, 14 + t * 80, (14 + t * 80) * 0.4);
      ctx.stroke();
    }
  }

  function drawFloaters() {
    for (var k = 0; k < floaters.length; k++) {
      var fl = floaters[k];
      var a = clamp(1 - fl.t / fl.life, 0, 1);
      var popScale = fl.t < 0.16 ? 0.6 + (fl.t / 0.16) * 0.55 : 1.15 - Math.min(0.15, (fl.t - 0.16) * 0.4);
      ctx.save();
      ctx.translate(fl.x, fl.y);
      ctx.scale(popScale, popScale);
      ctx.globalAlpha = a;
      ctx.font = "bold " + fl.size + "px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(fl.text, 0, 0);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, 0, 0);
      ctx.restore();
    }
  }

  function drawLevelUp() {
    if (levelUpT <= 0) return;
    var t = 1.6 - levelUpT;
    var a = t < 0.15 ? t / 0.15 : levelUpT < 0.35 ? levelUpT / 0.35 : 1;
    var s = t < 0.2 ? 0.6 + (t / 0.2) * 0.5 : 1.1 - Math.min(0.1, (t - 0.2) * 0.2);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 60);
    ctx.scale(s, s);
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = "bold 44px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.strokeText("LEVEL UP!", 0, 0);
    var g = ctx.createLinearGradient(0, -30, 0, 12);
    g.addColorStop(0, "#ffcf3f");
    g.addColorStop(1, "#ff8a3d");
    ctx.fillStyle = g;
    ctx.fillText("LEVEL UP!", 0, 0);
    ctx.font = "bold 22px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.lineWidth = 5;
    ctx.strokeText("等级 " + level + " · 锅更小更快了！", 0, 34);
    ctx.fillStyle = "#d9483b";
    ctx.fillText("等级 " + level + " · 锅更小更快了！", 0, 34);
    ctx.restore();
  }

  var scale = 1;
  function resize() {
    var r = canvas.getBoundingClientRect();
    if (r.width < 1) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.width * (H / W) * dpr);
    scale = canvas.width / W;
  }

  function render() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // 屏幕震动
    if (shakeT > 0) {
      var sh = shakeAmp * (shakeT / shakeDur);
      ctx.translate(rand(-sh, sh), rand(-sh, sh));
    }

    drawSky();
    drawClouds();
    drawHills();
    drawGround();
    drawButterfly();

    // 地上的培根
    for (var k = 0; k < splats.length; k++) {
      var s = splats[k];
      drawBaconStrip(s.x, s.y, s.rot, 0, 1, true, clamp(1.2 - s.t / 5, 0.3, 0.9));
    }

    drawSkillet();

    // 弹弓 + 培根
    if (state === "aim") {
      var pouch = dragPos ? clampDrag(dragPos) : null;
      drawSlingshot(pouch);
      if (dragPos) {
        drawTrajectory(pouch);
        drawBaconStrip(pouch.x, pouch.y, -0.3, bacon.phase, 1, false, 1);
      } else {
        drawBaconStrip(OX, OY - 2, -0.3 + Math.sin(time * 2) * 0.07, bacon.phase, 1, false, 1);
      }
    } else {
      drawSlingshot(null);
      // 拖尾
      for (var k2 = trail.length - 1; k2 >= 1; k2--) {
        var tr = trail[k2];
        drawBaconStrip(tr.x, tr.y, tr.rot, tr.phase, 0.85, false, 0.06 + (trail.length - k2) * 0.016);
      }
      var inPan = state === "resolve" && lastWasHit;
      drawBaconStrip(bacon.x, bacon.y, bacon.rot, bacon.phase, 1, false, 1);
      if (inPan) { /* 培根已在锅内，由蒸汽粒子覆盖 */ }
    }

    drawParticles();
    drawRings();
    drawFloaters();
    drawLevelUp();

    // 暗角
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, "rgba(20,40,60,0)");
    vg.addColorStop(1, "rgba(20,40,60,0.12)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- 交互 ----------
  function evtPos(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * W,
      y: (e.clientY - r.top) / r.height * H
    };
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (state !== "aim") return;
    dragPos = evtPos(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragPos) dragPos = evtPos(e);
  });
  canvas.addEventListener("pointerup", function () {
    if (!dragPos) return;
    var p = clampDrag(dragPos);
    dragPos = null;
    launch(p);
  });
  canvas.addEventListener("pointercancel", function () { dragPos = null; });

  canvas.addEventListener("keydown", function (e) {
    if (state !== "aim") return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key) >= 0) {
      if (!dragPos) dragPos = { x: OX - 120, y: OY + 70 };
      if (e.key === "ArrowLeft") dragPos.x -= 8;
      if (e.key === "ArrowRight") dragPos.x += 8;
      if (e.key === "ArrowUp") dragPos.y -= 8;
      if (e.key === "ArrowDown") dragPos.y += 8;
      dragPos = clampDrag(dragPos);
      setMsg("方向键微调；按空格或回车发射。🥓");
      e.preventDefault();
    } else if ((e.key === " " || e.key === "Enter") && dragPos) {
      var p = clampDrag(dragPos);
      dragPos = null;
      launch(p);
      e.preventDefault();
    } else if (e.key === "Escape") {
      dragPos = null;
      setMsg("已取消瞄准。");
      e.preventDefault();
    }
  });

  el.restart.addEventListener("click", resetGame);
  window.addEventListener("keydown", function (e) {
    if (e.key === "r" || e.key === "R") resetGame();
  });

  // ---------- 主循环 ----------
  var last = 0, frameId = 0;
  function loop(ts) {
    if (document.hidden) { frameId = 0; return; }
    var dt = Math.min(0.033, (ts - last) / 1000 || 0);
    last = ts;
    update(dt);
    render();
    frameId = requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !frameId) {
      last = performance.now();
      frameId = requestAnimationFrame(loop);
    }
  });

  // 调试句柄：控制台可用 __bacon.pan() 查看锅位置，__bacon.aimAt() 求解必中拖拽点
  window.__bacon = {
    pan: function () { return { x: pan.x, y: pan.y, r: pan.r }; },
    wind: function () { return wind; },
    aimAt: function (T) {
      T = T || 0.95;
      var vx = (pan.x - OX - 0.5 * wind * T * T) / T;
      var vy = (pan.y - OY - 0.5 * GRAVITY * T * T) / T;
      return { x: OX - vx / POWER, y: OY - vy / POWER };
    }
  };

  resize();
  window.addEventListener("resize", resize);
  resetGame();
  frameId = requestAnimationFrame(loop);
})();
