/* 生化模式 · Zombie Mode
 * 俯视角生存射击：WASD 移动 + 鼠标瞄准射击，队友可被感染。
 * 重武器系统：霰弹枪 / 加特林 / 巴雷特，击杀母体必掉武器箱。
 * AI 指挥：DeepSeek 驱动 3 名 NPC 队友的战术机动与喊话，掉线自动回退本地战术。
 * 触屏：左半屏虚拟摇杆移动，右半屏按住瞄准射击。
 * 无依赖，仅在 _pages/zombie.md 中加载。
 */
(function () {
  "use strict";

  var W = 960, H = 540, WALL = 18;

  var canvas = document.getElementById("zb-canvas");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");

  var el = {
    hpFill: document.getElementById("zb-hp-fill"),
    hpText: document.getElementById("zb-hp-text"),
    ammo: document.getElementById("zb-ammo"),
    wname: document.getElementById("zb-wname"),
    wpill: document.getElementById("zb-weapon-pill"),
    wave: document.getElementById("zb-wave"),
    score: document.getElementById("zb-score"),
    alive: document.getElementById("zb-alive"),
    ai: document.getElementById("zb-ai"),
    msg: document.getElementById("zb-msg"),
    overlay: document.getElementById("zb-overlay"),
    ovTitle: document.getElementById("zb-overlay-title"),
    ovDesc: document.getElementById("zb-overlay-desc"),
    ovBtn: document.getElementById("zb-overlay-btn")
  };

  // ---------- 工具 ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

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
  function tone(f0, f1, dur, gainV, delay, type) {
    var a = ac(); if (!a) return;
    var t0 = a.currentTime + (delay || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur * 0.85);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainV, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function sShot() { noiseBurst(0.07, "bandpass", 1900, 700, 0.28); tone(240, 90, 0.06, 0.16, 0, "square"); }
  function sShotgun() { noiseBurst(0.16, "lowpass", 900, 180, 0.42); tone(130, 55, 0.14, 0.28, 0, "square"); }
  function sGatling() { noiseBurst(0.05, "bandpass", 2400, 1000, 0.2); }
  function sSniper() { noiseBurst(0.2, "bandpass", 1300, 250, 0.45); tone(170, 45, 0.3, 0.3, 0, "sawtooth"); }
  function sBotShot() { noiseBurst(0.05, "bandpass", 1600, 800, 0.1); }
  function sHit() { noiseBurst(0.08, "lowpass", 500, 150, 0.2); }
  function sDie() { tone(150, 45, 0.32, 0.18, 0, "sawtooth"); }
  function sInfect() { tone(620, 110, 0.7, 0.2, 0, "sine"); noiseBurst(0.5, "bandpass", 800, 300, 0.1); }
  function sWave() { tone(440, 440, 0.12, 0.18); tone(660, 660, 0.2, 0.18, 0.12); }
  function sPickup() { tone(660, 990, 0.12, 0.18); }
  function sWeapon() { tone(523, 523, 0.09, 0.2); tone(659, 659, 0.09, 0.2, 0.09); tone(784, 784, 0.16, 0.22, 0.18); }
  function sHurt() { tone(120, 60, 0.2, 0.3); noiseBurst(0.1, "lowpass", 400, 120, 0.2); }
  function sEmpty() { tone(1300, 1300, 0.04, 0.1, 0, "square"); }
  function sReload() { tone(300, 500, 0.09, 0.12); tone(500, 300, 0.09, 0.12, 0.5); }
  function sGameOver() { tone(300, 60, 1.2, 0.25, 0, "sawtooth"); }

  // ---------- 静态场景 ----------
  var obstacles = [
    { x: 190, y: 120, w: 96, h: 26 }, { x: 674, y: 120, w: 96, h: 26 },
    { x: 190, y: 394, w: 96, h: 26 }, { x: 674, y: 394, w: 96, h: 26 },
    { x: 452, y: 246, w: 56, h: 48 }
  ];
  var cracks = [], debris = [], fogs = [];
  var i;
  for (i = 0; i < 5; i++) {
    var pts = [{ x: rand(0, W), y: rand(0, H) }];
    for (var k = 0; k < 4; k++) pts.push({ x: pts[k].x + rand(-90, 90), y: pts[k].y + rand(-60, 60) });
    cracks.push(pts);
  }
  for (i = 0; i < 46; i++) debris.push({ x: rand(WALL, W - WALL), y: rand(WALL, H - WALL), r: rand(1, 2.6) });
  for (i = 0; i < 4; i++) fogs.push({ x: rand(0, W), y: rand(60, H - 60), rx: rand(120, 220), ry: rand(30, 55), sp: rand(4, 10), ph: rand(0, 6.28) });

  var ZT = {
    walker: { r: 13, hp: 30, speed: 58, dmg: 10, score: 100, color: "#6f9a52", dark: "#4e7039" },
    runner: { r: 11, hp: 20, speed: 130, dmg: 8, score: 150, color: "#93c45c", dark: "#6a9440" },
    brute: { r: 23, hp: 180, speed: 42, dmg: 25, score: 500, color: "#a05a6e", dark: "#74404f" }
  };

  // ---------- 武器 ----------
  // pellets: 单次射击弹丸数；pierce: 可穿透僵尸数；knock: 击退系数；tracer: 曳光宽度
  var WEAPONS = {
    rifle:   { name: "步枪",   icon: "🔫", dmg: 12,  cool: 0.125, spread: 0.035, pellets: 1, speed: 880,  life: 0.8, magSize: 30,  ammo: 90, color: "#ffd97a", knock: 0.012, pierce: 0, tracer: 3,   reload: 1.2 },
    shotgun: { name: "霰弹枪", icon: "💥", dmg: 8,   cool: 0.68,  spread: 0.16,  pellets: 6, speed: 760,  life: 0.3, magSize: 6,   ammo: 18, color: "#ffab5e", knock: 0.045, pierce: 0, tracer: 3,   reload: 1.6 },
    gatling: { name: "加特林", icon: "🌀", dmg: 9,   cool: 0.055, spread: 0.07,  pellets: 1, speed: 940,  life: 0.8, magSize: 150, ammo: 0,  color: "#7ae8ff", knock: 0.008, pierce: 0, tracer: 2.5, reload: 2.4 },
    sniper:  { name: "巴雷特", icon: "🎯", dmg: 120, cool: 0.95,  spread: 0.004, pellets: 1, speed: 1500, life: 1.1, magSize: 5,   ammo: 10, color: "#e8c8ff", knock: 0.05,  pierce: 3, tracer: 4.5, reload: 1.8 }
  };
  function pickWeapon() {
    var r = Math.random();
    return r < 0.4 ? "shotgun" : r < 0.75 ? "gatling" : "sniper";
  }

  // ---------- AI 指挥（DeepSeek · 经 /api/zombie-command 代理，密钥在服务端）----------
  var AI = {
    enabled: true,
    url: "/api/zombie-command",
    interval: 3.4,   // 指挥循环（秒）
    timeout: 6000,
    busy: false,
    fails: 0,
    t: 2.2           // 开局 2.2s 后首次请示
  };

  // 提示词与密钥都在服务端（worker/zombie.ts），浏览器只发战场快照。

  function aiSnapshot() {
    var zs = zombies.slice().sort(function (a, b) {
      return dist(a.x, a.y, player.x, player.y) - dist(b.x, b.y, player.x, player.y);
    }).slice(0, 12).map(function (z) {
      return { id: z.id, t: z.type === "brute" ? "b" : z.type === "runner" ? "r" : "w", x: Math.round(z.x), y: Math.round(z.y) };
    });
    return {
      wave: wave,
      hp: Math.round(player.hp),
      weapon: player.weapon,
      px: Math.round(player.x), py: Math.round(player.y),
      bots: bots.map(function (b, idx) { return { id: idx, x: Math.round(b.x), y: Math.round(b.y), infected: !!b.infected }; }),
      zombies: zs,
      crates: crates.map(function (c) { return { k: c.kind, x: Math.round(c.x), y: Math.round(c.y) }; })
    };
  }

  function applyAiOrders(parsed) {
    var orders = parsed && parsed.orders;
    if (!(orders instanceof Array)) return;
    for (var k = 0; k < orders.length; k++) {
      var o = orders[k];
      var b = bots[o.id];
      if (!b || b.infected) continue;
      var mx = clamp(Number(o.mx) || b.x, WALL + 20, W - WALL - 20);
      var my = clamp(Number(o.my) || b.y, WALL + 20, H - WALL - 20);
      var focus = String(o.focus || "nearest");
      if (["nearest", "brute", "none"].indexOf(focus) < 0) focus = "nearest";
      b.ai = { mx: mx, my: my, focus: focus, until: time + AI.interval + 2.5 };
      if (typeof o.say === "string" && o.say) {
        floaters.push({ x: b.x, y: b.y - b.r - 12, t: 0, life: 1.8, text: o.say.slice(0, 14), color: "#bfe8a8", size: 13 });
      }
    }
  }

  function aiCommand() {
    if (AI.busy || typeof fetch === "undefined") return;
    if (!window.HaoqiAiGate) {
      AI.enabled = false;
      setMsg("安全验证不可用，已切换本地战术。");
      return;
    }
    AI.busy = true;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    var gateAcquired = false;
    window.HaoqiAiGate.getSession("zombie").then(function (token) {
      gateAcquired = true;
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, AI.timeout);
      return fetch(window.HaoqiAiGate.url(AI.url), {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ snapshot: aiSnapshot() }),
        signal: ctrl ? ctrl.signal : undefined
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (data) {
      applyAiOrders(data); // 服务端已返回 { orders: [...] } 并完成校验
      AI.fails = 0;
    }).catch(function () {
      if (!gateAcquired) {
        AI.enabled = false;
        setMsg("AI 安全验证未完成，已切换本地战术。");
        return;
      }
      AI.fails += 1;
      if (AI.fails >= 3 && AI.enabled) {
        AI.enabled = false;
        setMsg("AI 指挥离线，已切换本地战术。");
      }
    }).then(function () {
      if (timer) clearTimeout(timer);
      AI.busy = false;
    });
  }

  // ---------- 状态 ----------
  var state = "menu";
  var player, bots, zombies, bullets, particles, floaters, splats, crates;
  var wave, score, spawnQueue, spawnT, interT;
  var best = 0;
  try { best = parseInt(localStorage.getItem("zombieBest") || "0", 10) || 0; } catch (e) {}
  var shakeT = 0, shakeDur = 0.001, shakeAmp = 0;
  var hurtFlash = 0;
  var banner = null;
  var time = 0;
  var keys = {};
  var firing = false;
  var aimPos = { x: W * 0.7, y: H / 2 };
  var moveTouch = null, aimTouch = null;
  var zidSeq = 0;

  function setMsg(t) { el.msg.textContent = t; }
  function addShake(amp, dur) { shakeAmp = amp; shakeDur = dur; shakeT = dur; }

  function makeBot(x, y) {
    return { x: x, y: y, r: 12, hp: 60, angle: -Math.PI / 2, cool: rand(0, 0.4), infected: false, infectT: 0, anchorX: x, anchorY: y, isBot: true, ai: null };
  }

  function reset() {
    player = {
      x: W / 2, y: H / 2 + 130, r: 13, hp: 100, maxHp: 100, speed: 225,
      angle: -Math.PI / 2, cool: 0, mag: 30, magSize: 30, reserve: 90,
      reloadT: 0, muzzleT: 0, weapon: "rifle", spinT: 0, savedRifle: null
    };
    bots = [makeBot(W / 2 - 80, H / 2 + 100), makeBot(W / 2 + 80, H / 2 + 100), makeBot(W / 2, H / 2 + 178)];
    zombies = []; bullets = []; particles = []; floaters = []; crates = [];
    splats = []; spawnQueue = [];
    wave = 0; score = 0; interT = 0; hurtFlash = 0; banner = null;
  }

  function waveComp(n) {
    var total = 5 + 3 * n;
    var brutes = n % 3 === 0 ? Math.min(2, Math.floor(n / 3)) : 0;
    var runners = n >= 2 ? Math.round(total * Math.min(0.12 * n, 0.45)) : 0;
    var out = [];
    for (var a = 0; a < total - runners - brutes; a++) out.push("walker");
    for (var b = 0; b < runners; b++) out.push("runner");
    for (var c = 0; c < brutes; c++) out.push("brute");
    for (var s = out.length - 1; s > 0; s--) {
      var j = Math.floor(Math.random() * (s + 1));
      var tmp = out[s]; out[s] = out[j]; out[j] = tmp;
    }
    return out;
  }

  function spawnZombie(type) {
    var s = ZT[type];
    var side = Math.floor(rand(0, 4)), x, y;
    if (side === 0) { x = rand(50, W - 50); y = WALL + 16; }
    else if (side === 1) { x = rand(50, W - 50); y = H - WALL - 16; }
    else if (side === 2) { x = WALL + 16; y = rand(50, H - 50); }
    else { x = W - WALL - 16; y = rand(50, H - 50); }
    var hp = Math.round(s.hp * (1 + (wave - 1) * 0.07));
    zombies.push({
      id: ++zidSeq,
      x: x, y: y, r: s.r, type: type, hp: hp, maxHp: hp,
      speed: s.speed * (1 + (wave - 1) * 0.02), dmg: s.dmg, score: s.score,
      color: s.color, dark: s.dark, angle: 0, cool: 0, hitT: 0,
      kvx: 0, kvy: 0, wob: rand(0, 6.28)
    });
  }

  function nextWave() {
    wave += 1;
    spawnQueue = waveComp(wave);
    spawnT = 0.4;
    var hasBrute = spawnQueue.indexOf("brute") >= 0;
    banner = { text: "第 " + wave + " 波" + (hasBrute ? " · ☣ 母体出现" : ""), t: 0, dur: 1.6 };
    el.wave.textContent = wave;
    sWave();
    state = "playing";
  }

  function dropCrate(kind, x, y, wkey) {
    crates.push({ kind: kind, w: wkey || null, x: clamp(x, 60, W - 60), y: clamp(y, 60, H - 60), ph: rand(0, 6.28) });
  }

  function waveClear() {
    score += 250;
    floaters.push({ x: W / 2, y: H / 2 - 40, t: 0, life: 1.4, text: "第 " + wave + " 波肃清 +250", color: "#8fd07a", size: 30 });
    dropCrate("ammo", rand(W * 0.3, W * 0.7), rand(H * 0.3, H * 0.7));
    dropCrate("med", rand(W * 0.3, W * 0.7), rand(H * 0.3, H * 0.7));
    if (wave >= 2 && Math.random() < 0.45) dropCrate("weapon", rand(W * 0.3, W * 0.7), rand(H * 0.3, H * 0.7), pickWeapon());
    if (bots.length < 3) {
      bots.push(makeBot(player.x + rand(-60, 60), player.y + rand(-40, 40)));
      setMsg("增援抵达！补给已投放。");
    } else {
      setMsg("第 " + wave + " 波肃清！补给已投放。");
    }
    sPickup();
    state = "intermission";
    interT = 3;
  }

  function gameOver() {
    state = "gameover";
    firing = false;
    if (score > best) {
      best = score;
      try { localStorage.setItem("zombieBest", String(best)); } catch (e) {}
    }
    burst(player.x, player.y, 30, "gas");
    sGameOver();
    el.ovTitle.textContent = "你已被感染…";
    el.ovDesc.innerHTML = "你在第 " + wave + " 波倒下了。<br>最终得分 <b>" + score + "</b> · 历史最佳 <b>" + best + "</b><br>生化危机，无人能幸免。";
    el.ovBtn.textContent = "再来一局 (R)";
    el.overlay.hidden = false;
  }

  function startGame() {
    reset();
    el.overlay.hidden = true;
    setMsg("尸潮将至，守住阵地！");
    nextWave();
    syncHud();
  }

  // ---------- 粒子 ----------
  function burst(x, y, n, type) {
    for (var k = 0; k < n; k++) {
      var p = { type: type, x: x, y: y, t: 0, rot: rand(0, 6.28) };
      if (type === "blood") {
        p.vx = rand(-120, 120); p.vy = rand(-120, 120);
        p.life = rand(0.25, 0.6); p.r = rand(1.5, 3.5); p.color = "#a32e2e";
      } else if (type === "gas") {
        p.vx = rand(-26, 26); p.vy = rand(-60, -16);
        p.life = rand(0.7, 1.4); p.r = rand(3, 7); p.color = "#7ac96a";
      } else if (type === "spark") {
        p.vx = rand(-90, 90); p.vy = rand(-90, 90);
        p.life = rand(0.1, 0.25); p.r = rand(1, 2); p.color = "#ffd97a";
      }
      particles.push(p);
    }
  }

  // ---------- 武器切换 ----------
  function grantWeapon(key) {
    var wp = WEAPONS[key];
    if (player.weapon === "rifle") player.savedRifle = { mag: player.mag, reserve: player.reserve };
    player.weapon = key;
    player.magSize = wp.magSize;
    player.mag = wp.magSize;
    player.reserve = wp.ammo;
    player.reloadT = 0;
    player.spinT = 0;
    player.cool = 0.15;
    floaters.push({ x: player.x, y: player.y - 26, t: 0, life: 1.2, text: "获得 " + wp.name + "！", color: "#f5a301", size: 20 });
    setMsg("捡到 " + wp.icon + " " + wp.name + "！子弹打光后自动切回步枪。");
    sWeapon();
  }

  function revertToRifle() {
    var s = player.savedRifle || { mag: 30, reserve: 0 };
    player.weapon = "rifle";
    player.magSize = WEAPONS.rifle.magSize;
    player.mag = s.mag;
    player.reserve = s.reserve;
    player.reloadT = 0;
    player.spinT = 0;
    player.savedRifle = null;
    floaters.push({ x: player.x, y: player.y - 26, t: 0, life: 1.1, text: "切回步枪", color: "#cfe8ff", size: 16 });
    setMsg("重武器弹尽，切回步枪。");
  }

  // ---------- 战斗 ----------
  function startReload() {
    if (player.reloadT > 0 || player.mag >= player.magSize || player.reserve <= 0) return;
    player.reloadT = WEAPONS[player.weapon].reload;
    sReload();
    setMsg("换弹中…");
  }

  function tryShoot() {
    var wp = WEAPONS[player.weapon];
    if (player.mag <= 0) {
      if (player.weapon !== "rifle" && player.reserve <= 0) { revertToRifle(); return; }
      player.cool = 0.25;
      sEmpty();
      startReload();
      return;
    }
    player.mag -= 1;
    player.cool = player.weapon === "gatling"
      ? 0.16 + (wp.cool - 0.16) * clamp(player.spinT / 0.7, 0, 1)
      : wp.cool;
    player.muzzleT = 0.05;
    var gx = player.x + Math.cos(player.angle) * 20;
    var gy = player.y + Math.sin(player.angle) * 20;
    for (var pe = 0; pe < wp.pellets; pe++) {
      var a = player.angle + rand(-wp.spread, wp.spread);
      bullets.push({
        x: gx, y: gy,
        vx: Math.cos(a) * wp.speed, vy: Math.sin(a) * wp.speed,
        life: wp.life * rand(0.85, 1.15), dmg: wp.dmg, color: wp.color,
        knock: wp.knock, pierce: wp.pierce, hits: 0, hitSet: null, tw: wp.tracer
      });
    }
    if (player.weapon === "shotgun") sShotgun();
    else if (player.weapon === "gatling") sGatling();
    else if (player.weapon === "sniper") { sSniper(); addShake(2.5, 0.12); }
    else sShot();
    // 重武器最后一颗子弹出膛后切回步枪
    if (player.mag <= 0 && player.reserve <= 0 && player.weapon !== "rifle") revertToRifle();
  }

  function botShoot(bot, target) {
    var a = Math.atan2(target.y - bot.y, target.x - bot.x) + rand(-0.07, 0.07);
    bullets.push({
      x: bot.x + Math.cos(bot.angle) * 18, y: bot.y + Math.sin(bot.angle) * 18,
      vx: Math.cos(a) * 760, vy: Math.sin(a) * 760, life: 0.8, dmg: 9, color: "#cfe8ff",
      knock: 0.012, pierce: 0, hits: 0, hitSet: null, tw: 3
    });
    sBotShot();
  }

  function damagePlayer(dmg) {
    player.hp -= dmg;
    hurtFlash = 0.45;
    addShake(4, 0.2);
    sHurt();
    if (player.hp <= 0) {
      player.hp = 0;
      gameOver();
    }
  }

  function killZombie(zi) {
    var z = zombies[zi];
    score += z.score;
    floaters.push({ x: z.x, y: z.y - z.r - 8, t: 0, life: 0.9, text: "+" + z.score, color: z.type === "brute" ? "#f5a301" : "#d9483b", size: z.type === "brute" ? 26 : 18 });
    splats.push({ x: z.x, y: z.y, r: z.r * 1.2, a: 0.55 });
    if (splats.length > 80) splats.shift();
    burst(z.x, z.y, 10, "blood");
    sDie();
    if (z.type === "brute") dropCrate("weapon", z.x, z.y, pickWeapon());
    else if (Math.random() < 0.04) dropCrate("weapon", z.x, z.y, pickWeapon());
    else if (Math.random() < 0.12) dropCrate("ammo", z.x, z.y);
    zombies.splice(zi, 1);
  }

  function nearestHuman(x, y) {
    var bestD = dist(x, y, player.x, player.y), res = player;
    for (var k = 0; k < bots.length; k++) {
      if (bots[k].infected) continue;
      var d = dist(x, y, bots[k].x, bots[k].y);
      if (d < bestD) { bestD = d; res = bots[k]; }
    }
    return res;
  }

  function nearestZombie(x, y, maxD) {
    var bestD = maxD, res = null;
    for (var k = 0; k < zombies.length; k++) {
      var d = dist(x, y, zombies[k].x, zombies[k].y);
      if (d < bestD) { bestD = d; res = zombies[k]; }
    }
    return res;
  }

  function nearestBrute(x, y, maxD) {
    var bestD = maxD, res = null;
    for (var k = 0; k < zombies.length; k++) {
      if (zombies[k].type !== "brute") continue;
      var d = dist(x, y, zombies[k].x, zombies[k].y);
      if (d < bestD) { bestD = d; res = zombies[k]; }
    }
    return res;
  }

  function collideObstacles(e) {
    for (var k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      var nx = clamp(e.x, o.x, o.x + o.w), ny = clamp(e.y, o.y, o.y + o.h);
      var dx = e.x - nx, dy = e.y - ny;
      var d2 = dx * dx + dy * dy;
      if (d2 < e.r * e.r) {
        var d = Math.sqrt(d2) || 0.01;
        var push = e.r - d;
        e.x += (dx / d) * push;
        e.y += (dy / d) * push;
      }
    }
    e.x = clamp(e.x, WALL + e.r, W - WALL - e.r);
    e.y = clamp(e.y, WALL + e.r, H - WALL - e.r);
  }

  function pointInObstacle(x, y) {
    for (var k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return true;
    }
    return false;
  }

  // ---------- 更新 ----------
  function update(dt) {
    time += dt;

    for (i = 0; i < fogs.length; i++) {
      var f = fogs[i];
      f.x += f.sp * dt;
      if (f.x - f.rx > W) f.x = -f.rx;
    }

    var active = state === "playing" || state === "intermission";

    if (active && player.hp > 0) {
      // 移动
      var dx = 0, dy = 0;
      if (keys.KeyA || keys.ArrowLeft) dx -= 1;
      if (keys.KeyD || keys.ArrowRight) dx += 1;
      if (keys.KeyW || keys.ArrowUp) dy -= 1;
      if (keys.KeyS || keys.ArrowDown) dy += 1;
      if (moveTouch) {
        dx = clamp((moveTouch.x - moveTouch.x0) / 46, -1, 1);
        dy = clamp((moveTouch.y - moveTouch.y0) / 46, -1, 1);
      }
      var len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      // 加特林开火时沉重减速
      var spd = player.speed;
      if (player.weapon === "gatling" && firing && player.reloadT <= 0) spd *= 0.55;
      player.x += dx * spd * dt;
      player.y += dy * spd * dt;
      collideObstacles(player);

      // 加特林枪管预热 / 冷却
      if (player.weapon === "gatling" && firing) player.spinT = Math.min(0.7, player.spinT + dt);
      else player.spinT = Math.max(0, player.spinT - dt * 3);

      player.angle = Math.atan2(aimPos.y - player.y, aimPos.x - player.x);
      player.cool -= dt;
      player.muzzleT -= dt;

      if (player.reloadT > 0) {
        player.reloadT -= dt;
        if (player.reloadT <= 0) {
          var take = Math.min(player.magSize - player.mag, player.reserve);
          player.mag += take;
          player.reserve -= take;
          setMsg("");
        }
      } else if (firing && player.cool <= 0) {
        tryShoot();
      }
    }

    // 队友（AI 指挥层 + 本地反射层）
    for (i = bots.length - 1; i >= 0; i--) {
      var b = bots[i];
      if (b.infected) {
        b.infectT -= dt;
        if (Math.random() < 0.3) burst(b.x, b.y, 1, "gas");
        if (b.infectT <= 0) {
          bots.splice(i, 1);
          zombies.push({
            id: ++zidSeq,
            x: b.x, y: b.y, r: ZT.runner.r, type: "runner",
            hp: ZT.runner.hp, maxHp: ZT.runner.hp, speed: ZT.runner.speed * 1.1,
            dmg: ZT.runner.dmg, score: ZT.runner.score, color: ZT.runner.color, dark: ZT.runner.dark,
            angle: 0, cool: 0, hitT: 0, kvx: 0, kvy: 0, wob: rand(0, 6.28)
          });
          burst(b.x, b.y, 16, "gas");
          setMsg("一名队友变异了！");
        }
        continue;
      }
      b.cool -= dt;
      var aiActive = AI.enabled && b.ai && time < b.ai.until;
      // 索敌：AI 集火母体指令优先
      var target = null;
      if (aiActive && b.ai.focus === "brute") target = nearestBrute(b.x, b.y, 1e9) || nearestZombie(b.x, b.y, 380);
      else if (aiActive && b.ai.focus === "none") target = null;
      else target = nearestZombie(b.x, b.y, 380);
      if (target) {
        b.angle = Math.atan2(target.y - b.y, target.x - b.x);
        if (b.cool <= 0) {
          botShoot(b, target);
          b.cool = 0.5 + rand(0, 0.3);
        }
      } else if (!aiActive) {
        b.angle += Math.sin(time * 0.8 + b.anchorX) * 0.01;
      }
      // 机动：AI 指令优先，否则回锚点
      if (aiActive) {
        var ox = b.ai.mx - b.x, oy = b.ai.my - b.y;
        var od = Math.hypot(ox, oy);
        if (od > 12) { b.x += (ox / od) * 132 * dt; b.y += (oy / od) * 132 * dt; }
      } else if (!target) {
        var ax = b.anchorX - b.x, ay = b.anchorY - b.y;
        var ad = Math.hypot(ax, ay);
        if (ad > 14) { b.x += (ax / ad) * 60 * dt; b.y += (ay / ad) * 60 * dt; }
      }
      // 队友间 separation
      for (var s2 = 0; s2 < bots.length; s2++) {
        if (bots[s2] === b || bots[s2].infected) continue;
        var sx = b.x - bots[s2].x, sy = b.y - bots[s2].y;
        var sd = Math.hypot(sx, sy);
        if (sd > 0 && sd < 30) { b.x += (sx / sd) * 24 * dt; b.y += (sy / sd) * 24 * dt; }
      }
      collideObstacles(b);
    }

    // 僵尸
    for (i = zombies.length - 1; i >= 0; i--) {
      var z = zombies[i];
      var h = nearestHuman(z.x, z.y);
      z.angle = Math.atan2(h.y - z.y, h.x - z.x);
      z.wob += dt * 6;
      z.x += Math.cos(z.angle) * z.speed * dt + z.kvx * dt;
      z.y += Math.sin(z.angle) * z.speed * dt + z.kvy * dt;
      z.kvx *= (1 - 6 * dt); z.kvy *= (1 - 6 * dt);
      z.cool -= dt; z.hitT -= dt;

      // separation
      for (var s3 = 0; s3 < zombies.length; s3++) {
        if (zombies[s3] === z) continue;
        var zx = z.x - zombies[s3].x, zy = z.y - zombies[s3].y;
        var zd = Math.hypot(zx, zy);
        if (zd > 0 && zd < z.r * 1.6) { z.x += (zx / zd) * 26 * dt; z.y += (zy / zd) * 26 * dt; }
      }
      collideObstacles(z);

      if (dist(z.x, z.y, h.x, h.y) < z.r + h.r + 2 && z.cool <= 0) {
        if (h === player) {
          damagePlayer(z.dmg);
          z.cool = 0.9;
        } else {
          h.infected = true;
          h.infectT = 1.4;
          z.cool = 1.2;
          sInfect();
          burst(h.x, h.y, 10, "gas");
          setMsg("一名队友被感染了！");
        }
      }
    }

    // 子弹
    for (i = bullets.length - 1; i >= 0; i--) {
      var bl = bullets[i];
      bl.x += bl.vx * dt;
      bl.y += bl.vy * dt;
      bl.life -= dt;
      var dead = bl.life <= 0 || bl.x < 0 || bl.x > W || bl.y < 0 || bl.y > H;
      if (!dead && pointInObstacle(bl.x, bl.y)) {
        burst(bl.x, bl.y, 3, "spark");
        dead = true;
      }
      if (!dead) {
        for (var zi = zombies.length - 1; zi >= 0; zi--) {
          var zz = zombies[zi];
          if (bl.hitSet && bl.hitSet[zz.id]) continue;
          if (dist(bl.x, bl.y, zz.x, zz.y) < zz.r + 3) {
            zz.hp -= bl.dmg;
            zz.hitT = 0.12;
            var kn = bl.knock || 0.012;
            zz.kvx += bl.vx * kn;
            zz.kvy += bl.vy * kn;
            burst(bl.x, bl.y, 4, "blood");
            sHit();
            if (zz.hp <= 0) killZombie(zi);
            if (bl.pierce > 0) {
              bl.hits += 1;
              if (!bl.hitSet) bl.hitSet = {};
              bl.hitSet[zz.id] = 1;
              if (bl.hits > bl.pierce) { dead = true; break; }
            } else {
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) bullets.splice(i, 1);
    }

    // 补给箱拾取
    for (i = crates.length - 1; i >= 0; i--) {
      var c = crates[i];
      if (active && dist(player.x, player.y, c.x, c.y) < player.r + 16) {
        if (c.kind === "weapon") {
          grantWeapon(c.w);
        } else if (c.kind === "ammo") {
          player.reserve += 60;
          floaters.push({ x: c.x, y: c.y - 16, t: 0, life: 0.9, text: "弹药 +60", color: "#ffd97a", size: 16 });
          sPickup();
        } else {
          player.hp = Math.min(player.maxHp, player.hp + 40);
          floaters.push({ x: c.x, y: c.y - 16, t: 0, life: 0.9, text: "生命 +40", color: "#8fd07a", size: 16 });
          sPickup();
        }
        crates.splice(i, 1);
      }
    }

    // 波次推进
    if (state === "playing") {
      spawnT -= dt;
      if (spawnQueue.length > 0 && spawnT <= 0) {
        spawnZombie(spawnQueue.pop());
        spawnT = 0.55;
      }
      var pendingInfect = 0;
      for (i = 0; i < bots.length; i++) if (bots[i].infected) pendingInfect++;
      if (spawnQueue.length === 0 && zombies.length === 0 && pendingInfect === 0) waveClear();
    } else if (state === "intermission") {
      interT -= dt;
      if (interT <= 0) nextWave();
    }

    // AI 指挥循环
    if (AI.enabled && state === "playing") {
      AI.t -= dt;
      if (AI.t <= 0) { AI.t = AI.interval; aiCommand(); }
    }

    // 粒子 / 飘字 / 其他计时
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === "blood") { p.vx *= (1 - 4 * dt); p.vy *= (1 - 4 * dt); }
      if (p.t > p.life) particles.splice(i, 1);
    }
    for (i = floaters.length - 1; i >= 0; i--) {
      var fl = floaters[i];
      fl.t += dt; fl.y -= 30 * dt;
      if (fl.t > fl.life) floaters.splice(i, 1);
    }
    if (shakeT > 0) shakeT -= dt;
    if (hurtFlash > 0) hurtFlash -= dt;
    if (banner) {
      banner.t += dt;
      if (banner.t > banner.dur) banner = null;
    }
  }

  function syncHud() {
    var hpPct = clamp(player.hp / player.maxHp, 0, 1);
    el.hpFill.style.width = (hpPct * 100).toFixed(0) + "%";
    el.hpFill.classList.toggle("zb-low", hpPct < 0.35);
    el.hpText.textContent = Math.ceil(player.hp);
    var wp = WEAPONS[player.weapon];
    el.wname.textContent = wp.icon + " " + wp.name;
    el.wpill.classList.toggle("zb-special", player.weapon !== "rifle");
    el.ammo.textContent = player.reloadT > 0 ? "换弹…" : player.mag + " / " + player.reserve;
    el.score.textContent = score;
    if (el.ai) el.ai.textContent = AI.enabled ? "AI 指挥中" : "本地战术";
    var aliveBots = 0;
    for (var k = 0; k < bots.length; k++) if (!bots[k].infected) aliveBots++;
    el.alive.textContent = aliveBots + 1;
  }

  // ---------- 绘制 ----------
  function drawGround() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#24282f");
    g.addColorStop(1, "#16191f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 2;
    ctx.setLineDash([26, 30]);
    for (var y = H / 3; y < H; y += H / 3) {
      ctx.beginPath(); ctx.moveTo(WALL, y); ctx.lineTo(W - WALL, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1.4;
    for (var c = 0; c < cracks.length; c++) {
      ctx.beginPath();
      ctx.moveTo(cracks[c][0].x, cracks[c][0].y);
      for (var k = 1; k < cracks[c].length; k++) ctx.lineTo(cracks[c][k].x, cracks[c][k].y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (var d = 0; d < debris.length; d++) {
      ctx.beginPath(); ctx.arc(debris[d].x, debris[d].y, debris[d].r, 0, Math.PI * 2); ctx.fill();
    }

    // 血迹
    for (var s = 0; s < splats.length; s++) {
      ctx.fillStyle = "rgba(130,32,32," + splats[s].a + ")";
      ctx.beginPath();
      ctx.ellipse(splats[s].x, splats[s].y, splats[s].r, splats[s].r * 0.6, splats[s].x % 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 围墙
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 3;
    ctx.strokeRect(WALL, WALL, W - WALL * 2, H - WALL * 2);
  }

  function drawObstacles() {
    for (var k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      ctx.fillStyle = "#454b54";
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = "#5a626d";
      ctx.fillRect(o.x, o.y, o.w, 5);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(o.x, o.y + o.h - 5, o.w, 5);
    }
  }

  function drawCrates() {
    for (var k = 0; k < crates.length; k++) {
      var c = crates[k];
      var bob = Math.sin(time * 3 + c.ph) * 2;
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      if (c.kind === "weapon") {
        // 武器箱：金色光晕 + 缎带 + 武器图标
        var glow = 0.5 + Math.sin(time * 4 + c.ph) * 0.3;
        ctx.fillStyle = "rgba(245,163,1," + (0.16 * glow + 0.06) + ")";
        ctx.beginPath(); ctx.arc(0, 0, 21, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#6a4a12";
        ctx.fillRect(-12, -10, 24, 20);
        ctx.fillStyle = "#f5a301";
        ctx.fillRect(-12, -10, 24, 6);
        ctx.fillStyle = "#8a630f";
        ctx.fillRect(-2.5, -10, 5, 20);
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(WEAPONS[c.w].icon, 0, 3);
      } else if (c.kind === "ammo") {
        ctx.fillStyle = "#8a6a2f";
        ctx.fillRect(-11, -9, 22, 18);
        ctx.fillStyle = "#b98a3c";
        ctx.fillRect(-11, -9, 22, 5);
        ctx.fillStyle = "#ffe9b0";
        ctx.font = "bold 11px 'PingFang SC', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("弹", 0, 3);
      } else {
        ctx.fillStyle = "#dfe5e8";
        ctx.fillRect(-11, -9, 22, 18);
        ctx.fillStyle = "#4fae5f";
        ctx.fillRect(-3, -6, 6, 12);
        ctx.fillRect(-7, -2, 14, 4);
      }
      ctx.restore();
    }
  }

  function drawHuman(h, isPlayer) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.angle);
    // 枪（按武器区分造型）
    var gunLen = 16, gunW = 5.2, gunCol = "#2c343c", muz = 1;
    if (isPlayer) {
      gunLen = 19;
      if (player.weapon === "shotgun") { gunLen = 17; gunW = 6.8; gunCol = "#4a3a2c"; muz = 1.2; }
      else if (player.weapon === "gatling") { gunLen = 22; gunW = 6; gunCol = "#3a444e"; muz = 1.1; }
      else if (player.weapon === "sniper") { gunLen = 28; gunW = 3.6; gunCol = "#232a31"; muz = 1.6; }
    }
    ctx.fillStyle = gunCol;
    ctx.fillRect(6, -gunW / 2, gunLen, gunW);
    if (isPlayer && player.weapon === "gatling") {
      // 旋转枪管组
      ctx.save();
      ctx.translate(6 + gunLen - 3, 0);
      ctx.rotate(player.spinT > 0 ? time * 22 : 0);
      ctx.fillStyle = "#5d6873";
      for (var gb = 0; gb < 3; gb++) {
        var ba = gb * 2.094;
        ctx.beginPath(); ctx.arc(Math.cos(ba) * 3.2, Math.sin(ba) * 3.2, 1.7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (isPlayer && player.weapon === "sniper") {
      ctx.fillStyle = "#3a444e";
      ctx.fillRect(13, -gunW / 2 - 3.4, 6, 3);
    }
    if (isPlayer && h.muzzleT > 0) {
      var tip = 6 + gunLen;
      ctx.fillStyle = "rgba(255,214,110," + clamp(h.muzzleT * 14, 0, 1) + ")";
      ctx.beginPath();
      ctx.moveTo(tip + 1, 0); ctx.lineTo(tip + 1 + 10 * muz, -4.5 * muz); ctx.lineTo(tip + 1 + 10 * muz, 4.5 * muz);
      ctx.closePath(); ctx.fill();
    }
    // 身体
    ctx.beginPath(); ctx.arc(0, 0, h.r, 0, Math.PI * 2);
    ctx.fillStyle = isPlayer ? "#7fd4e8" : "#9fd07f";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isPlayer ? "#3f87a0" : "#5d8a48";
    ctx.stroke();
    // 面向
    ctx.beginPath(); ctx.arc(h.r * 0.35, 0, h.r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fill();
    ctx.restore();

    if (h.infected) {
      var pulse = 1 + Math.sin(time * 8) * 0.15;
      ctx.strokeStyle = "rgba(122,201,106,0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(h.x, h.y, (h.r + 6) * pulse, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawZombie(z) {
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.rotate(z.angle + Math.sin(z.wob) * 0.12);
    // 手臂
    ctx.strokeStyle = z.dark;
    ctx.lineWidth = 3.4;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(z.r * 0.3, -z.r * 0.62); ctx.lineTo(z.r * 1.15, -z.r * 0.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(z.r * 0.3, z.r * 0.62); ctx.lineTo(z.r * 1.15, z.r * 0.4); ctx.stroke();
    // 身体
    ctx.beginPath(); ctx.arc(0, 0, z.r, 0, Math.PI * 2);
    ctx.fillStyle = z.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = z.dark;
    ctx.stroke();
    // 暗斑
    ctx.beginPath(); ctx.arc(-z.r * 0.3, z.r * 0.25, z.r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fill();
    // 眼睛
    ctx.fillStyle = "#e03b3b";
    ctx.beginPath(); ctx.arc(z.r * 0.42, -z.r * 0.28, z.type === "brute" ? 3 : 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(z.r * 0.42, z.r * 0.28, z.type === "brute" ? 3 : 2.1, 0, Math.PI * 2); ctx.fill();
    // 母体尖刺
    if (z.type === "brute") {
      ctx.fillStyle = z.dark;
      for (var s = 0; s < 7; s++) {
        var a = (s / 7) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * z.r, Math.sin(a) * z.r);
        ctx.lineTo(Math.cos(a + 0.22) * (z.r + 8), Math.sin(a + 0.22) * (z.r + 8));
        ctx.lineTo(Math.cos(a + 0.44) * z.r, Math.sin(a + 0.44) * z.r);
        ctx.closePath(); ctx.fill();
      }
    }
    // 受击闪白
    if (z.hitT > 0) {
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255," + clamp(z.hitT * 4, 0, 0.7) + ")";
      ctx.fill();
    }
    ctx.restore();
    // 血条
    if (z.hp < z.maxHp) {
      var w = z.r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(z.x - w / 2, z.y - z.r - 10, w, 4);
      ctx.fillStyle = "#d9483b";
      ctx.fillRect(z.x - w / 2, z.y - z.r - 10, w * clamp(z.hp / z.maxHp, 0, 1), 4);
    }
  }

  function drawBanner() {
    if (!banner) return;
    var t = banner.t / banner.dur;
    var a = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
    var s = t < 0.15 ? 0.7 + (t / 0.15) * 0.3 : 1;
    ctx.save();
    ctx.translate(W / 2, H / 2 - 60);
    ctx.scale(s, s);
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = "bold 42px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(banner.text, 0, 0);
    ctx.fillStyle = "#e8efe9";
    ctx.fillText(banner.text, 0, 0);
    ctx.restore();
  }

  function drawTouchUI() {
    // 触屏虚拟摇杆（仅触摸时显示）
    if (moveTouch) {
      ctx.strokeStyle = "rgba(255,255,255,0.38)";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(moveTouch.x0, moveTouch.y0, 46, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.beginPath(); ctx.arc(moveTouch.x, moveTouch.y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.arc(moveTouch.x, moveTouch.y, 7, 0, Math.PI * 2); ctx.fill();
    }
    if (aimTouch) {
      ctx.strokeStyle = "rgba(255,140,100,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(aimPos.x, aimPos.y, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(aimPos.x - 20, aimPos.y); ctx.lineTo(aimPos.x - 8, aimPos.y);
      ctx.moveTo(aimPos.x + 8, aimPos.y); ctx.lineTo(aimPos.x + 20, aimPos.y);
      ctx.moveTo(aimPos.x, aimPos.y - 20); ctx.lineTo(aimPos.x, aimPos.y - 8);
      ctx.moveTo(aimPos.x, aimPos.y + 8); ctx.lineTo(aimPos.x, aimPos.y + 20);
      ctx.stroke();
    }
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
    if (shakeT > 0) {
      var sh = shakeAmp * (shakeT / shakeDur);
      ctx.translate(rand(-sh, sh), rand(-sh, sh));
    }

    drawGround();
    drawObstacles();
    drawCrates();

    // 尸体（僵尸死时移除，血迹代替）→ 画实体
    var k;
    for (k = 0; k < bots.length; k++) drawHuman(bots[k], false);
    if (state !== "menu") drawHuman(player, true);
    for (k = 0; k < zombies.length; k++) drawZombie(zombies[k]);

    // 子弹
    ctx.lineCap = "round";
    for (k = 0; k < bullets.length; k++) {
      var bl = bullets[k];
      ctx.strokeStyle = bl.color;
      ctx.lineWidth = bl.tw || 3;
      ctx.beginPath();
      ctx.moveTo(bl.x, bl.y);
      ctx.lineTo(bl.x - bl.vx * 0.014, bl.y - bl.vy * 0.014);
      ctx.stroke();
    }

    // 粒子
    for (k = 0; k < particles.length; k++) {
      var p = particles[k];
      var a = clamp(1 - p.t / p.life, 0, 1);
      ctx.globalAlpha = p.type === "gas" ? a * 0.55 : a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 飘字
    for (k = 0; k < floaters.length; k++) {
      var fl = floaters[k];
      ctx.globalAlpha = clamp(1 - fl.t / fl.life, 0, 1);
      ctx.font = "bold " + fl.size + "px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(fl.text, fl.x, fl.y);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x, fl.y);
    }
    ctx.globalAlpha = 1;

    // 雾
    for (k = 0; k < fogs.length; k++) {
      var fg = fogs[k];
      ctx.fillStyle = "rgba(160,170,185,0.05)";
      ctx.beginPath();
      ctx.ellipse(fg.x, fg.y + Math.sin(time * 0.6 + fg.ph) * 8, fg.rx, fg.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 玩家光环 + 暗角
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (state !== "menu" && player.hp > 0) {
      var lg = ctx.createRadialGradient(player.x, player.y, 20, player.x, player.y, 260);
      lg.addColorStop(0, "rgba(255,240,200,0.08)");
      lg.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, W, H);
    }
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 1.0);
    vg.addColorStop(0, "rgba(5,8,12,0)");
    vg.addColorStop(1, "rgba(5,8,12,0.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // 受击红闪
    if (hurtFlash > 0) {
      ctx.fillStyle = "rgba(190,30,30," + clamp(hurtFlash * 0.5, 0, 0.28) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    // 换弹指示环
    if (player.reloadT > 0 && state !== "menu") {
      var pct = 1 - player.reloadT / WEAPONS[player.weapon].reload;
      ctx.strokeStyle = "rgba(255,217,122,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r + 8, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
      ctx.stroke();
    }

    drawTouchUI();
    drawBanner();
  }

  // ---------- 输入 ----------
  function evtPos(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * W,
      y: (e.clientY - r.top) / r.height * H
    };
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (state !== "playing" && state !== "intermission") return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    var p = evtPos(e);
    if (e.pointerType === "touch") {
      if (p.x < W / 2 && !moveTouch) {
        moveTouch = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y };
      } else if (!aimTouch) {
        aimTouch = { id: e.pointerId, x: p.x, y: p.y };
        aimPos = { x: p.x, y: p.y };
        firing = true;
      }
    } else {
      aimPos = p;
      firing = true;
    }
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", function (e) {
    var p = evtPos(e);
    if (e.pointerType === "touch") {
      if (moveTouch && e.pointerId === moveTouch.id) { moveTouch.x = p.x; moveTouch.y = p.y; }
      if (aimTouch && e.pointerId === aimTouch.id) { aimTouch.x = p.x; aimTouch.y = p.y; aimPos = p; }
    } else {
      aimPos = p;
    }
  });
  function endPointer(e) {
    if (e.pointerType === "touch") {
      if (moveTouch && e.pointerId === moveTouch.id) moveTouch = null;
      if (aimTouch && e.pointerId === aimTouch.id) { aimTouch = null; firing = false; }
    } else {
      firing = false;
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  window.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === "KeyR") {
      if (state === "gameover" || state === "menu") startGame();
      else startReload();
    }
  });
  window.addEventListener("keyup", function (e) { keys[e.code] = false; });
  window.addEventListener("blur", function () { keys = {}; firing = false; moveTouch = null; aimTouch = null; });

  el.ovBtn.addEventListener("click", startGame);

  // ---------- 主循环 ----------
  var last = 0;
  function loop(ts) {
    var dt = Math.min(0.033, (ts - last) / 1000 || 0);
    last = ts;
    if (state !== "menu" && state !== "gameover") update(dt);
    render();
    if (state !== "menu") syncHud();
    requestAnimationFrame(loop);
  }

  // 调试句柄
  window.__zombie = {
    start: startGame,
    give: function (k) {
      if (WEAPONS[k] && k !== "rifle" && (state === "playing" || state === "intermission")) grantWeapon(k);
    },
    step: function (sec) { // 测试用：同步快进游戏时间
      var n = Math.max(0, Math.round(sec * 60));
      for (var si = 0; si < n; si++) update(1 / 60);
    },
    state: function () {
      return {
        state: state, wave: wave, score: score, zombies: zombies.length, bots: bots.length,
        hp: player.hp, weapon: player.weapon, mag: player.mag, reserve: player.reserve,
        ai: AI.enabled, botsPos: bots.map(function (b) { return { x: Math.round(b.x), y: Math.round(b.y), ai: !!(b.ai && time < b.ai.until) }; })
      };
    }
  };

  resize();
  window.addEventListener("resize", resize);
  reset();
  requestAnimationFrame(loop);
})();
