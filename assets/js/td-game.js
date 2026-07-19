/* 王国防线 · Tower Defense
 * 双路进犯塔防：红方军团走上路、黄方军团走下路，S 形蜿蜒后在桥头汇合，
 * 一起攻向右侧的蓝色水晶基地。点击绿色建造牌布防三种塔，守住 10 波即胜利。
 * 纯 Canvas 手绘 + WebAudio 程序合成音效，无依赖，仅在 _pages/td.md 中加载。
 */
(function () {
  "use strict";

  // ---------- 常量 ----------
  var W = 960, H = 540;                 // 逻辑画布尺寸
  var START_GOLD = 180, START_LIVES = 20;
  var PREP_TIME = 4;                    // 每波间隔倒计时（秒）
  var FIRST_PREP = 8;                   // 第一波给更长布防时间
  var WIN_WAVE = 10;                    // 撑过该波次即胜利
  var EARLY_BONUS = 15;                 // 立即出怪奖励金币
  var SELL_RATE = 0.7;                  // 出售返还比例
  var SPAWN_INTERVAL = 0.75;            // 同波出兵间隔
  var FROST_SLOW = 0.35;                // 冰塔减速比例

  var canvas = document.getElementById("td-canvas");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");

  var el = {
    gold: document.getElementById("td-gold"),
    wave: document.getElementById("td-wave"),
    lives: document.getElementById("td-lives"),
    kills: document.getElementById("td-kills"),
    stage: document.getElementById("td-stage"),
    overlay: document.getElementById("td-overlay"),
    oTitle: document.getElementById("td-overlay-title"),
    oDesc: document.getElementById("td-overlay-desc"),
    oBtn: document.getElementById("td-overlay-btn"),
    oBtn2: document.getElementById("td-overlay-btn2"),
    msgText: document.getElementById("td-msg-text"),
    nowBtn: document.getElementById("td-now-btn")
  };
  if (!el.stage || !el.overlay) return;

  // ---------- 小工具 ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // 点到线段最短距离（用于装饰/建造牌避让路径）
  function segDist(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay;
    var wx = px - ax, wy = py - ay;
    var c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.sqrt(wx * wx + wy * wy);
    var c2 = vx * vx + vy * vy;
    if (c2 <= c1) { var dx = px - bx, dy = py - by; return Math.sqrt(dx * dx + dy * dy); }
    var t = c1 / c2;
    var qx = ax + t * vx - px, qy = ay + t * vy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }

  // ---------- 路径（折线 waypoint，S 形蜿蜒，两路在桥头汇合） ----------
  var RED_PTS = [[-30, 90], [150, 90], [230, 160], [130, 220], [310, 230], [420, 200], [528, 265]];
  var YEL_PTS = [[-30, 450], [180, 450], [260, 380], [140, 320], [320, 310], [430, 335], [528, 265]];
  var COMMON_PTS = [[528, 265], [625, 265], [690, 195], [765, 300], [840, 255], [864, 243]];
  var BASE = { x: 864, y: 243 };        // 蓝色水晶基地（x≈90%, y≈45%）
  var POND = { x: 528, y: 285, rx: 76, ry: 50 };  // 汇合处桥下水潭

  // 由前缀 lane + 共用段拼出完整路径，并预计算累计弧长
  function makeLane(prefix, common) {
    var pts = prefix.concat(common.slice(1));
    var cum = [0], i, t = 0;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      t += Math.sqrt(dx * dx + dy * dy);
      cum.push(t);
    }
    return { pts: pts, cum: cum, total: t };
  }
  var lanes = [makeLane(RED_PTS, COMMON_PTS), makeLane(YEL_PTS, COMMON_PTS)]; // 0=红 1=黄

  function ptsLen(pts) {
    var t = 0, i;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      t += Math.sqrt(dx * dx + dy * dy);
    }
    return t;
  }
  var YEL_PREFIX_LEN = ptsLen(YEL_PTS);

  var tmpP = { x: 0, y: 0, ang: 0 };    // 复用的路径查询结果对象（避免热循环分配）
  // 按弧长 d 查询路径上的位置与朝向
  function posAt(lane, d, out) {
    var pts = lane.pts, cum = lane.cum, n = pts.length, i = 1;
    if (d >= lane.total) {
      out.x = pts[n - 1][0]; out.y = pts[n - 1][1];
      out.ang = Math.atan2(pts[n - 1][1] - pts[n - 2][1], pts[n - 1][0] - pts[n - 2][0]);
      return out;
    }
    while (i < n - 1 && cum[i] < d) i++;
    var d0 = cum[i - 1], d1 = cum[i];
    var t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    var x0 = pts[i - 1][0], y0 = pts[i - 1][1], x1 = pts[i][0], y1 = pts[i][1];
    out.x = x0 + (x1 - x0) * t; out.y = y0 + (y1 - y0) * t;
    out.ang = Math.atan2(y1 - y0, x1 - x0);
    return out;
  }
  function inPond(x, y) {
    var dx = (x - POND.x) / (POND.rx + 14), dy = (y - POND.y) / (POND.ry + 14);
    return dx * dx + dy * dy < 1;
  }
  function distToPaths(x, y) {
    var m = 1e9, i;
    for (i = 0; i < RED_PTS.length - 1; i++) m = Math.min(m, segDist(x, y, RED_PTS[i][0], RED_PTS[i][1], RED_PTS[i + 1][0], RED_PTS[i + 1][1]));
    for (i = 0; i < YEL_PTS.length - 1; i++) m = Math.min(m, segDist(x, y, YEL_PTS[i][0], YEL_PTS[i][1], YEL_PTS[i + 1][0], YEL_PTS[i + 1][1]));
    for (i = 0; i < COMMON_PTS.length - 1; i++) m = Math.min(m, segDist(x, y, COMMON_PTS[i][0], COMMON_PTS[i][1], COMMON_PTS[i + 1][0], COMMON_PTS[i + 1][1]));
    return m;
  }

  // ---------- 建造牌（8 个路边空地基，位置预定义、避开路径） ----------
  var PAD_DEFS = [[95, 165], [300, 135], [470, 130], [105, 380], [330, 420], [470, 420], [600, 130], [730, 380]];
  var pads = [];
  var i, j;
  for (i = 0; i < PAD_DEFS.length; i++) pads.push({ x: PAD_DEFS[i][0], y: PAD_DEFS[i][1], tower: null, phase: i * 1.3 });

  // ---------- 地图装饰（固定种子 LCG 生成，布局稳定） ----------
  var patches = [];                     // 低多边形草地色块
  (function genPatches() {
    var seed = 99;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var cols = ["#9ccf77", "#84b55e", "#a5d683", "#7fb35f"];
    for (var k = 0; k < 12; k++) {
      var cx = rnd() * W, cy = rnd() * H, r = 60 + rnd() * 110, nv = 4 + Math.floor(rnd() * 3);
      var verts = [];
      for (var m = 0; m < nv; m++) {
        var a = (m / nv) * Math.PI * 2 + rnd() * 0.5;
        var rr = r * (0.6 + rnd() * 0.5);
        verts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7]);
      }
      patches.push({ v: verts, c: cols[k % cols.length] });
    }
  })();

  var decors = [];                      // 小树/石头/灌木/花
  (function genDecors() {
    var seed = 20240521;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var defs = [["tree", 7, 60], ["rock", 6, 50], ["bush", 8, 54], ["flower", 16, 48]];
    for (var di = 0; di < defs.length; di++) {
      var kind = defs[di][0], count = defs[di][1], clear = defs[di][2];
      var placed = 0, tries = 0;
      while (placed < count && tries < 300) {
        tries++;
        var x = 24 + rnd() * (W - 48), y = 30 + rnd() * (H - 60);
        if (distToPaths(x, y) < clear) continue;
        if (inPond(x, y)) continue;
        var bdx = x - BASE.x, bdy = y - BASE.y;
        if (bdx * bdx + bdy * bdy < 90 * 90) continue;
        var ok = true, pi;
        for (pi = 0; pi < PAD_DEFS.length; pi++) {
          var pdx = x - PAD_DEFS[pi][0], pdy = y - PAD_DEFS[pi][1];
          if (pdx * pdx + pdy * pdy < 48 * 48) { ok = false; break; }
        }
        if (!ok) continue;
        for (pi = 0; pi < decors.length; pi++) {
          var ddx = x - decors[pi].x, ddy = y - decors[pi].y;
          if (ddx * ddx + ddy * ddy < 34 * 34) { ok = false; break; }
        }
        if (!ok) continue;
        decors.push({ kind: kind, x: x, y: y, s: 0.75 + rnd() * 0.55, v: rnd() });
        placed++;
      }
    }
  })();

  var pebbles = [];                     // 路边小石子
  (function genPebbles() {
    var seed = 7;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    function add(lane, maxD) {
      var d = 26;
      while (d < Math.min(lane.total - 10, maxD)) {
        posAt(lane, d, tmpP);
        var side = (Math.floor(d / 48) % 2 === 0) ? 1 : -1;
        var off = 27 + rnd() * 6;
        var x = tmpP.x + Math.cos(tmpP.ang + Math.PI / 2) * off * side;
        var y = tmpP.y + Math.sin(tmpP.ang + Math.PI / 2) * off * side;
        if (!inPond(x, y) && x > -10 && x < W + 10) {
          pebbles.push({ x: x, y: y, r: 1.8 + rnd() * 1.8, c: rnd() < 0.5 ? "#c9b078" : "#bfa46a" });
        }
        d += 42 + rnd() * 22;
      }
    }
    add(lanes[0], 1e9);                 // 红 lane 全程（含汇合段）
    add(lanes[1], YEL_PREFIX_LEN);      // 黄 lane 只画汇合前，避免重复
  })();

  // ---------- 塔与敌人定义 ----------
  var TOWER_TYPES = {
    arrow:  { name: "箭塔", icon: "🏹", cost: 70,  range: 110, rate: 0.55, dmg: 10, color: "#b0824a" },
    cannon: { name: "炮塔", icon: "💣", cost: 110, range: 100, rate: 1.6,  dmg: 24, splash: 55, color: "#7a7f8a" },
    frost:  { name: "冰塔", icon: "❄️", cost: 90,  range: 95,  rate: 1.0,  dmg: 4,  slowDur: 2, color: "#79b8e8" }
  };
  var ENEMY_TYPES = {
    grunt:  { hp: 42,  speed: 52,   bounty: 8,   r: 11, cost: 1 },
    runner: { hp: 26,  speed: 88.4, bounty: 10,  r: 9,  cost: 1 },
    tank:   { hp: 115, speed: 31.2, bounty: 18,  r: 14, cost: 1 },
    boss:   { hp: 900, speed: 34,   bounty: 120, r: 22, cost: 5 }
  };
  // 升级：2 级 60% 原价、3 级 80% 原价；伤害 ×1.6 / ×2.4，射程 +10% / +20%
  function dmgOf(t) { return TOWER_TYPES[t.type].dmg * (t.level === 1 ? 1 : t.level === 2 ? 1.6 : 2.4); }
  function rangeOf(t) { return TOWER_TYPES[t.type].range * (1 + 0.1 * (t.level - 1)); }
  function upCostOf(t) { return Math.round(TOWER_TYPES[t.type].cost * (t.level === 1 ? 0.6 : 0.8)); }

  // ---------- 游戏状态 ----------
  var state = "menu";                   // "menu" | "prep" | "wave" | "victory" | "over"
  var gold = START_GOLD, lives = START_LIVES, kills = 0, wave = 0;
  var endless = false, prepT = 0;
  var enemies = [], towers = [], queue = [], spawnIdx = 0, spawnT = 0;
  var time = 0, shakeT = 0, shakeDur = 0.001, shakeAmp = 0, baseFlashT = 0;
  var selPad = -1, overlayMode = "menu";
  var best = 0;
  try { best = parseInt(localStorage.getItem("tdBest") || "0", 10) || 0; } catch (e) {}
  function saveBest() { try { localStorage.setItem("tdBest", String(best)); } catch (e) {} }

  // ---------- 对象池（子弹/粒子/浮字/涟漪，热循环不分配对象） ----------
  function makePool(n, init) {
    var items = [], k;
    for (k = 0; k < n; k++) { var o = init(); o.__alive = false; items.push(o); }
    return { items: items };
  }
  function poolSpawn(p) {
    for (var k = 0; k < p.items.length; k++) if (!p.items[k].__alive) { p.items[k].__alive = true; return p.items[k]; }
    return null;
  }
  var arrows = makePool(48, function () { return { x: 0, y: 0, dx: 1, dy: 0, tx: 0, ty: 0, spd: 560, dmg: 0, target: null }; });
  var shells = makePool(24, function () { return { sx: 0, sy: 0, tx: 0, ty: 0, x: 0, y: 0, t: 0, dur: 0.55, pt: 0, dmg: 0, splash: 55, primary: null }; });
  var parts = makePool(220, function () { return { x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0.4, r0: 2, r1: 0.5, color: "255,255,255" }; });
  var floaters = makePool(24, function () { return { x: 0, y: 0, t: 0, life: 1, text: "", color: "#fff" }; });
  var rings = makePool(20, function () { return { x: 0, y: 0, r0: 10, r1: 60, t: 0, life: 0.45, color: "255,255,255" }; });

  function sparkFx(x, y, color, n, spd) {
    for (var k = 0; k < n; k++) {
      var p = poolSpawn(parts); if (!p) return;
      var a = Math.random() * Math.PI * 2, v = (spd || 120) * (0.4 + Math.random() * 0.8);
      p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
      p.t = 0; p.life = 0.3 + Math.random() * 0.2; p.r0 = 2.4; p.r1 = 0.4; p.color = color;
    }
  }
  function smokeFx(x, y, n) {
    for (var k = 0; k < n; k++) {
      var p = poolSpawn(parts); if (!p) return;
      p.x = x + rand(-6, 6); p.y = y + rand(-6, 6); p.vx = rand(-18, 18); p.vy = rand(-40, -14);
      p.t = 0; p.life = 0.5 + Math.random() * 0.3; p.r0 = 3; p.r1 = 9; p.color = "110,112,110";
    }
  }
  function ringFx(x, y, r0, r1, color) {
    var g = poolSpawn(rings); if (!g) return;
    g.x = x; g.y = y; g.r0 = r0; g.r1 = r1; g.t = 0; g.life = 0.45; g.color = color;
  }
  function floater(text, x, y, color) {
    var f = poolSpawn(floaters); if (!f) return;
    f.text = text; f.x = x; f.y = y; f.t = 0; f.life = 1.0; f.color = color;
  }
  function buildFx(x, y) { sparkFx(x, y, "150,235,125", 10, 150); ringFx(x, y, 8, 42, "150,235,125"); }
  function explosionFx(x, y) {
    sparkFx(x, y, "255,178,72", 10, 190);
    sparkFx(x, y, "255,230,160", 5, 120);
    smokeFx(x, y, 6);
    ringFx(x, y, 8, 58, "255,170,60");
  }
  function deathFx(e) {
    sparkFx(e.x, e.y, e.lane === 0 ? "217,72,59" : "232,169,28", 6, 110);
  }
  function addShake(amp, dur) {
    var cur = shakeT > 0 ? shakeAmp * (shakeT / shakeDur) : 0;
    if (amp >= cur) { shakeAmp = amp; shakeDur = dur; shakeT = dur; }
  }

  // ---------- 音效（WebAudio 程序合成，首次点击后才创建 AudioContext） ----------
  var actx = null, lastCoinT = -1;
  function ac() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(f0, f1, dur, type, gainV, delay) {
    if (!actx) return;
    var t0 = actx.currentTime + (delay || 0);
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(Math.max(30, f0), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainV, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noiseBurst(dur, f0, f1, gainV, type) {
    if (!actx) return;
    var n = Math.floor(actx.sampleRate * dur);
    var buf = actx.createBuffer(1, n, actx.sampleRate);
    var d = buf.getChannelData(0);
    for (var k = 0; k < n; k++) d[k] = Math.random() * 2 - 1;
    var src = actx.createBufferSource(); src.buffer = buf;
    var f = actx.createBiquadFilter(); f.type = type || "lowpass";
    f.frequency.setValueAtTime(f0, actx.currentTime);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), actx.currentTime + dur);
    var g = actx.createGain();
    g.gain.setValueAtTime(gainV, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(actx.destination);
    src.start();
  }
  function sndShoot() { tone(1150, 420, 0.07, "triangle", 0.05); }
  function sndCannonFire() { noiseBurst(0.12, 500, 120, 0.10); }
  function sndBoom() { noiseBurst(0.3, 320, 60, 0.22); tone(110, 38, 0.3, "sine", 0.16); }
  function sndFrost() { tone(1500, 2400, 0.16, "sine", 0.045); tone(2200, 2800, 0.12, "sine", 0.03, 0.05); }
  function sndCoin() {
    if (time - lastCoinT < 0.07) return;  // 节流，避免连杀刷屏
    lastCoinT = time;
    tone(950, 950, 0.05, "sine", 0.05); tone(1420, 1420, 0.08, "sine", 0.05, 0.05);
  }
  function sndLeak() { tone(170, 55, 0.3, "sawtooth", 0.14); noiseBurst(0.2, 400, 90, 0.12); }
  function sndBuild() { tone(280, 620, 0.12, "triangle", 0.09); }
  function sndUpgrade() { tone(520, 520, 0.07, "sine", 0.07); tone(660, 660, 0.07, "sine", 0.07, 0.07); tone(880, 880, 0.1, "sine", 0.08, 0.14); }
  function sndSell() { tone(700, 300, 0.14, "triangle", 0.08); }
  function sndError() { tone(220, 150, 0.14, "square", 0.06); }
  function sndHorn() { tone(330, 495, 0.18, "triangle", 0.08); tone(495, 660, 0.14, "triangle", 0.06, 0.12); }
  function sndWin() { var ns = [523, 659, 784, 1047]; for (var k = 0; k < 4; k++) tone(ns[k], ns[k], 0.16, "sine", 0.09, k * 0.13); }
  function sndLose() { var ns = [392, 330, 262, 196]; for (var k = 0; k < 4; k++) tone(ns[k], ns[k] * 0.94, 0.22, "sawtooth", 0.07, k * 0.16); }

  // ---------- 游戏流程 ----------
  function clearPools() {
    var ps = [arrows, shells, parts, floaters, rings], pi, ki;
    for (pi = 0; pi < ps.length; pi++) for (ki = 0; ki < ps[pi].items.length; ki++) ps[pi].items[ki].__alive = false;
  }
  function resetPads() { for (var k = 0; k < pads.length; k++) pads[k].tower = null; }

  function startGame() {
    gold = START_GOLD; lives = START_LIVES; kills = 0; wave = 0;
    endless = false;
    enemies.length = 0; towers.length = 0; queue.length = 0;
    spawnIdx = 0; spawnT = 0; baseFlashT = 0; shakeT = 0;
    resetPads(); clearPools(); closePanel(); hideOverlay();
    state = "prep"; prepT = FIRST_PREP;
    updateMsg(true); refreshHud(true);
    try { canvas.focus(); } catch (e) {}
  }
  function continueEndless() {
    endless = true;
    state = "prep"; prepT = PREP_TIME;
    hideOverlay(); closePanel();
    updateMsg(true); refreshHud(true);
  }
  // 波次配置：数量 6+2n，随波混入快跑/重甲；每 5 波 1 只 BOSS
  function buildQueue(n) {
    var q = [], boss = (n % 5 === 0);
    var slots = n * 2 + 6 - (boss ? 1 : 0);
    var runF = n < 3 ? 0 : Math.min(0.45, 0.12 + 0.06 * (n - 3));
    var tankF = n < 6 ? 0 : Math.min(0.38, 0.08 + 0.06 * (n - 6));
    for (var k = 0; k < slots; k++) {
      var r = Math.random(), t = "grunt";
      if (r < tankF) t = "tank"; else if (r < tankF + runF) t = "runner";
      q.push({ type: t, lane: k % 2 });   // 红黄两路交替出兵
    }
    if (boss) q.unshift({ type: "boss", lane: Math.random() < 0.5 ? 0 : 1 });
    return q;
  }
  function startWave() {
    if (state !== "prep") return;
    wave++;
    state = "wave";
    queue = buildQueue(wave); spawnIdx = 0; spawnT = 0;
    if (wave > best) { best = wave; saveBest(); }
    sndHorn();
    updateMsg(true); refreshHud(true);
  }
  function earlyStart() {               // 立即出怪，奖励金币
    if (state !== "prep") return;
    gold += EARLY_BONUS;
    floater("+" + EARLY_BONUS + " 💰", W / 2, 64, "#ffd75e");
    sndCoin();
    startWave();
  }
  function spawnEnemy(type, laneIdx) {
    var def = ENEMY_TYPES[type];
    var hp = Math.round(def.hp * (1 + 0.12 * (wave - 1)));  // hp 随波次成长
    var e = {
      type: type, lane: laneIdx, dist: 0, x: 0, y: 0, ang: 0,
      hp: hp, maxHp: hp, speed: def.speed, r: def.r,
      bounty: def.bounty, cost: def.cost, slowT: 0, dead: false
    };
    posAt(lanes[laneIdx], 0, tmpP);
    e.x = tmpP.x; e.y = tmpP.y; e.ang = tmpP.ang;
    enemies.push(e);
  }
  function removeEnemyAt(idx) {
    enemies[idx] = enemies[enemies.length - 1];
    enemies.pop();
  }
  function hurt(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.dead = true;
      gold += e.bounty; kills++;
      floater("+" + e.bounty, e.x, e.y - e.r - 6, "#ffd75e");
      deathFx(e);
      sndCoin();
    }
  }
  function leak(e) {
    lives -= e.cost;
    baseFlashT = 0.45; addShake(5, 0.3);
    floater("-" + e.cost + " ❤", BASE.x - 34, BASE.y - 44, "#ff6a55");
    ringFx(BASE.x, BASE.y, 26, 84, "255,80,60");
    sndLeak();
    if (lives <= 0) { lives = 0; doGameOver(); }
  }
  function onWaveCleared() {
    if (!endless && wave >= WIN_WAVE) {
      state = "victory";
      sndWin();
      showOverlay("victory", "🏆 王国守住了！",
        "10 波进犯全数击退！击杀 <b>" + kills + "</b> · 剩余生命 <b>" + lives + "</b><br>最佳纪录：第 " + best + " 波",
        "继续无尽模式 →", "重新开始");
    } else {
      state = "prep"; prepT = PREP_TIME;
      floater("第 " + wave + " 波已肃清 ✓", W / 2, 70, "#ffffff");
    }
    updateMsg(true); refreshHud(true);
  }
  function doGameOver() {
    state = "over";
    sndLose();
    closePanel();
    showOverlay("over", "💥 水晶基地陷落",
      "坚守到第 <b>" + wave + "</b> 波 · 击杀 <b>" + kills + "</b><br>最佳纪录：第 " + best + " 波",
      "重新开始", null);
    updateMsg(true); refreshHud(true);
  }

  // ---------- 建造 / 升级 / 出售 ----------
  function tryBuild(padIdx, type, free) {
    var pad = pads[padIdx];
    var def = TOWER_TYPES[type];
    if (!pad || pad.tower || !def) return false;
    if (state !== "prep" && state !== "wave") return false;
    if (!free && gold < def.cost) { sndError(); return false; }
    if (!free) gold -= def.cost;
    var t = { pad: padIdx, x: pad.x, y: pad.y, type: type, level: 1, invested: def.cost, cd: 0, ang: -Math.PI / 2, flash: 0 };
    pad.tower = t; towers.push(t);
    buildFx(pad.x, pad.y);
    sndBuild();
    closePanel();
    updateMsg(true); refreshHud(true);
    return true;
  }
  function tryUpgrade(padIdx) {
    var pad = pads[padIdx];
    if (!pad || !pad.tower) return false;
    var t = pad.tower;
    if (t.level >= 3) return false;
    var cost = upCostOf(t);
    if (gold < cost) { sndError(); return false; }
    gold -= cost; t.invested += cost; t.level++;
    buildFx(t.x, t.y);
    sndUpgrade();
    renderPanel();
    refreshHud(true);
    return true;
  }
  function trySell(padIdx) {
    var pad = pads[padIdx];
    if (!pad || !pad.tower) return false;
    var t = pad.tower;
    var refund = Math.floor(t.invested * SELL_RATE);
    gold += refund;
    pad.tower = null;
    for (var k = 0; k < towers.length; k++) if (towers[k] === t) { towers.splice(k, 1); break; }
    floater("+" + refund + " 💰", t.x, t.y - 20, "#ffd75e");
    sparkFx(t.x, t.y, "255,215,94", 8, 120);
    sndSell();
    closePanel();
    updateMsg(true); refreshHud(true);
    return true;
  }

  // ---------- 建塔/升级面板（HTML 绝对定位小卡片） ----------
  var panel = document.createElement("div");
  panel.id = "td-panel";
  panel.className = "td-panel";
  panel.hidden = true;
  el.stage.appendChild(panel);

  function renderPanel() {
    if (selPad < 0) return;
    var pad = pads[selPad], html = "", k, def;
    if (!pad.tower) {
      html += '<div class="td-panel__title">选择防御塔</div>';
      for (k in TOWER_TYPES) {
        def = TOWER_TYPES[k];
        html += '<button type="button" data-build="' + k + '"' + (gold < def.cost ? " disabled" : "") + '>' +
          def.icon + " " + def.name + " <b>" + def.cost + " 💰</b></button>";
      }
    } else {
      var t = pad.tower; def = TOWER_TYPES[t.type];
      html += '<div class="td-panel__title">' + def.icon + " " + def.name + " · Lv." + t.level + "</div>";
      html += '<div class="td-panel__stats">伤害 ' + Math.round(dmgOf(t)) + " · 射程 " + Math.round(rangeOf(t)) +
        (t.type === "frost" ? " · 减速 35%" : (t.type === "cannon" ? " · 溅射" : "")) + "</div>";
      if (t.level < 3) {
        var uc = upCostOf(t);
        html += '<button type="button" data-up="1"' + (gold < uc ? " disabled" : "") + ">升级 Lv." + (t.level + 1) + " <b>" + uc + " 💰</b></button>";
      } else {
        html += '<button type="button" disabled>已满级 ⭐⭐⭐</button>';
      }
      html += '<button type="button" data-sell="1">出售 <b>+' + Math.floor(t.invested * SELL_RATE) + " 💰</b></button>";
    }
    panel.innerHTML = html;
  }
  function positionPanel() {
    if (selPad < 0) return;
    var r = canvas.getBoundingClientRect();
    var sr = el.stage.getBoundingClientRect();
    var pad = pads[selPad];
    var x = (r.left - sr.left) + pad.x / W * r.width;
    var y = (r.top - sr.top) + pad.y / H * r.height;
    x = clamp(x, 96, Math.max(96, sr.width - 96));
    panel.style.left = x + "px";
    panel.style.top = y + "px";
    if (pad.y > H * 0.45) panel.classList.add("td-panel--above");
    else panel.classList.remove("td-panel--above");
  }
  function openPanel(idx) {
    selPad = idx;
    renderPanel();
    positionPanel();
    panel.hidden = false;
    tone(700, 900, 0.06, "sine", 0.04);
  }
  function closePanel() { panel.hidden = true; selPad = -1; }
  panel.addEventListener("click", function (e) {
    var b = e.target;
    while (b && b !== panel && b.tagName !== "BUTTON") b = b.parentNode;
    if (!b || b === panel || b.disabled || selPad < 0) return;
    e.stopPropagation();
    ac();
    var tb = b.getAttribute("data-build");
    if (tb) tryBuild(selPad, tb, false);
    else if (b.getAttribute("data-up")) tryUpgrade(selPad);
    else if (b.getAttribute("data-sell")) trySell(selPad);
  });

  // ---------- HUD 与消息行 ----------
  var lastHud = { gold: -1, wave: "", lives: -1, kills: -1 };
  function refreshHud(force) {
    var wv = state === "menu" ? "–" : (state === "prep" ? String(wave + 1) : String(wave));
    if (force || gold !== lastHud.gold) {
      el.gold.textContent = gold; lastHud.gold = gold;
      if (!panel.hidden && selPad >= 0) renderPanel();   // 金币变化时刷新面板可用状态
    }
    if (force || wv !== lastHud.wave) { el.wave.textContent = wv; lastHud.wave = wv; }
    if (force || lives !== lastHud.lives) { el.lives.textContent = lives; lastHud.lives = lives; }
    if (force || kills !== lastHud.kills) { el.kills.textContent = kills; lastHud.kills = kills; }
  }
  var lastMsgKey = "";
  function updateMsg(force) {
    var key, text;
    if (state === "prep") { key = "p" + (wave + 1) + ":" + Math.ceil(prepT); text = "第 " + (wave + 1) + " 波将在 " + Math.ceil(prepT) + " 秒后来袭——抓紧布防！"; }
    else if (state === "wave") { key = "w" + wave + ":" + (enemies.length + queue.length - spawnIdx); text = "第 " + wave + " 波交战中 · 剩余敌人 " + (enemies.length + queue.length - spawnIdx); }
    else if (state === "menu") { key = "m"; text = "点击「开始游戏」布防防线。"; }
    else if (state === "victory") { key = "v"; text = "🏆 胜利！可继续无尽模式冲分。"; }
    else { key = "o"; text = "💥 基地陷落，点击「重新开始」再战。"; }
    if (!force && key === lastMsgKey) return;
    lastMsgKey = key;
    el.msgText.textContent = text;
    el.nowBtn.hidden = state !== "prep";
  }

  // ---------- 更新逻辑 ----------
  function updateEnemies(dt) {
    var i, e;
    for (i = enemies.length - 1; i >= 0; i--) {
      e = enemies[i];
      if (e.dead) { removeEnemyAt(i); continue; }
      if (e.slowT > 0) e.slowT -= dt;
      var sp = e.speed * (e.slowT > 0 ? (1 - FROST_SLOW) : 1);
      e.dist += sp * dt;
      var lane = lanes[e.lane];
      if (e.dist >= lane.total) {
        leak(e);
        removeEnemyAt(i);
        if (state !== "wave") return;   // 已被判负，停止后续更新
        continue;
      }
      posAt(lane, e.dist, tmpP);
      e.x = tmpP.x; e.y = tmpP.y; e.ang = tmpP.ang;
    }
  }
  function fireTower(t, def, target) {
    var dmg = dmgOf(t), k, e, d;
    if (t.type === "arrow") {
      var a = poolSpawn(arrows);
      if (a) {
        a.x = t.x; a.y = t.y - 14; a.target = target;
        a.tx = target.x; a.ty = target.y; a.spd = 560; a.dmg = dmg; a.dx = 1; a.dy = 0;
      }
      sndShoot();
    } else if (t.type === "cannon") {
      var s = poolSpawn(shells);
      if (s) {
        s.sx = t.x; s.sy = t.y - 16; s.tx = target.x; s.ty = target.y;
        s.x = s.sx; s.y = s.sy; s.t = 0; s.pt = 0; s.dur = 0.55;
        s.dmg = dmg; s.splash = def.splash; s.primary = target;
      }
      sndCannonFire();
    } else {                            // 冰塔：范围内脉冲，全体伤害 + 减速
      var r = rangeOf(t);
      ringFx(t.x, t.y, 12, r, "150,210,255");
      for (k = 0; k < enemies.length; k++) {
        e = enemies[k];
        if (e.dead) continue;
        d = (e.x - t.x) * (e.x - t.x) + (e.y - t.y) * (e.y - t.y);
        if (d <= r * r) {
          e.slowT = Math.max(e.slowT, def.slowDur);
          hurt(e, dmg);
        }
      }
      sndFrost();
    }
  }
  function updateTowers(dt) {
    var i, k, t, def, e;
    for (i = 0; i < towers.length; i++) {
      t = towers[i]; def = TOWER_TYPES[t.type];
      t.cd -= dt;
      if (t.flash > 0) t.flash -= dt;
      if (t.cd > 0) continue;
      var r = rangeOf(t), r2 = r * r;
      // 索敌：范围内路径进度最大者（最接近基地）
      var bestE = null, bestD = -1;
      for (k = 0; k < enemies.length; k++) {
        e = enemies[k];
        if (e.dead) continue;
        var d2 = (e.x - t.x) * (e.x - t.x) + (e.y - t.y) * (e.y - t.y);
        if (d2 <= r2 && e.dist > bestD) { bestE = e; bestD = e.dist; }
      }
      if (!bestE) continue;
      t.ang = Math.atan2(bestE.y - t.y, bestE.x - t.x);
      t.cd = def.rate;
      t.flash = 0.08;
      fireTower(t, def, bestE);
    }
  }
  function explodeShell(s) {
    var k, e, d;
    for (k = 0; k < enemies.length; k++) {
      e = enemies[k];
      if (e.dead) continue;
      d = Math.sqrt((e.x - s.tx) * (e.x - s.tx) + (e.y - s.ty) * (e.y - s.ty));
      if (d <= s.splash) hurt(e, (e === s.primary && d <= 40) ? s.dmg : s.dmg * 0.5);
    }
    explosionFx(s.tx, s.ty);
    addShake(3.5, 0.22);
    sndBoom();
  }
  function updateProjectiles(dt) {
    var k, a, s;
    for (k = 0; k < arrows.items.length; k++) {   // 箭矢：追踪锁定目标
      a = arrows.items[k];
      if (!a.__alive) continue;
      if (a.target && !a.target.dead) { a.tx = a.target.x; a.ty = a.target.y; }
      var dx = a.tx - a.x, dy = a.ty - a.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var mv = a.spd * dt;
      if (d <= mv + 6) {
        if (a.target && !a.target.dead && d < 26) hurt(a.target, a.dmg);
        sparkFx(a.tx, a.ty, "255,242,200", 3, 80);
        a.__alive = false;
        continue;
      }
      a.dx = dx / d; a.dy = dy / d;
      a.x += a.dx * mv; a.y += a.dy * mv;
    }
    for (k = 0; k < shells.items.length; k++) {   // 炮弹：抛物线落地爆炸
      s = shells.items[k];
      if (!s.__alive) continue;
      s.t += dt;
      var q = s.t / s.dur;
      if (q >= 1) { s.__alive = false; explodeShell(s); continue; }
      s.x = s.sx + (s.tx - s.sx) * q;
      s.y = s.sy + (s.ty - s.sy) * q - Math.sin(Math.PI * q) * 70;
      if (s.t - s.pt > 0.05) { s.pt = s.t; smokeFx(s.x, s.y, 1); }
    }
  }
  function updateFx(dt) {
    var k, p, g, f;
    for (k = 0; k < parts.items.length; k++) {
      p = parts.items[k];
      if (!p.__alive) continue;
      p.t += dt;
      if (p.t >= p.life) { p.__alive = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 90 * dt;
    }
    for (k = 0; k < rings.items.length; k++) {
      g = rings.items[k];
      if (!g.__alive) continue;
      g.t += dt;
      if (g.t >= g.life) g.__alive = false;
    }
    for (k = 0; k < floaters.items.length; k++) {
      f = floaters.items[k];
      if (!f.__alive) continue;
      f.t += dt;
      if (f.t >= f.life) f.__alive = false;
    }
  }
  function update(dt) {
    time += dt;
    if (shakeT > 0) shakeT -= dt;
    if (baseFlashT > 0) baseFlashT -= dt;
    updateFx(dt);
    if (state === "prep") {
      prepT -= dt;
      if (prepT <= 0) startWave();
      else updateMsg(false);
    } else if (state === "wave") {
      if (spawnIdx < queue.length) {    // 按节奏出兵
        spawnT -= dt;
        while (spawnT <= 0 && spawnIdx < queue.length) {
          var it = queue[spawnIdx++];
          spawnEnemy(it.type, it.lane);
          spawnT += (it.type === "boss" ? 2.2 : SPAWN_INTERVAL);
        }
      }
      updateEnemies(dt);
      if (state === "wave") { updateTowers(dt); updateProjectiles(dt); }
      if (state === "wave") {
        updateMsg(false);
        if (spawnIdx >= queue.length && enemies.length === 0) onWaveCleared();
      }
    }
    refreshHud(false);
  }

  // ---------- 绘制 ----------
  function strokePts(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.stroke();
  }
  function drawPath(pts) {              // 米黄色宽路径：三层描边做出圆角路缘
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "#cdb271"; ctx.lineWidth = 52; strokePts(pts);
    ctx.strokeStyle = "#e8d5a0"; ctx.lineWidth = 46; strokePts(pts);
    ctx.strokeStyle = "#f6ecc9"; ctx.lineWidth = 34; strokePts(pts);
  }
  function drawPond() {                 // 汇合处桥下水潭
    ctx.fillStyle = "#6fb6d6";
    ellipse(POND.x, POND.y, POND.rx, POND.ry); ctx.fill();
    ctx.fillStyle = "#8fcde6";
    ellipse(POND.x - 8, POND.y - 6, POND.rx * 0.72, POND.ry * 0.62); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(POND.x + 14, POND.y + 10, POND.rx * 0.4, POND.ry * 0.3, 0, 0.3, 1.6); ctx.stroke();
  }
  function drawBridge() {               // 桥面木板 + 两侧矮栏
    var x;
    ctx.strokeStyle = "#a5763b"; ctx.lineWidth = 5; ctx.lineCap = "round";
    for (x = 544; x <= 584; x += 10) {
      ctx.beginPath(); ctx.moveTo(x, 240); ctx.lineTo(x, 290); ctx.stroke();
    }
    ctx.strokeStyle = "#8a5f2c"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(536, 240); ctx.lineTo(592, 240); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(536, 290); ctx.lineTo(592, 290); ctx.stroke();
  }
  function drawDecor(d) {
    var s = d.s;
    if (d.kind === "tree") {            // 小树：三角 + 圆
      ctx.fillStyle = "#8a6238";
      ctx.fillRect(d.x - 2.5 * s, d.y - 2 * s, 5 * s, 12 * s);
      ctx.fillStyle = "#4e8f3f";
      ctx.beginPath(); ctx.moveTo(d.x, d.y - 16 * s); ctx.lineTo(d.x + 15 * s, d.y + 4 * s); ctx.lineTo(d.x - 15 * s, d.y + 4 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#5ea34b";
      ctx.beginPath(); ctx.moveTo(d.x, d.y - 24 * s); ctx.lineTo(d.x + 11 * s, d.y - 6 * s); ctx.lineTo(d.x - 11 * s, d.y - 6 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#6fb757";
      circle(d.x, d.y - 21 * s, 5.5 * s); ctx.fill();
    } else if (d.kind === "rock") {     // 石头：灰色多边形
      ctx.fillStyle = "#b9bdb3";
      ctx.beginPath();
      ctx.moveTo(d.x - 10 * s, d.y + 6 * s);
      ctx.lineTo(d.x - 6 * s, d.y - 5 * s);
      ctx.lineTo(d.x + 2 * s, d.y - 9 * s);
      ctx.lineTo(d.x + 10 * s, d.y - 2 * s);
      ctx.lineTo(d.x + 11 * s, d.y + 6 * s);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#9a9e92"; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (d.kind === "bush") {     // 灌木：三团圆叶
      ctx.fillStyle = "#5f9c49";
      circle(d.x - 7 * s, d.y + 2 * s, 7 * s); ctx.fill();
      circle(d.x + 7 * s, d.y + 2 * s, 7 * s); ctx.fill();
      circle(d.x, d.y - 4 * s, 8 * s); ctx.fill();
      ctx.fillStyle = "#74b35b";
      circle(d.x - 2 * s, d.y - 6 * s, 3 * s); ctx.fill();
      circle(d.x + 6 * s, d.y, 2.4 * s); ctx.fill();
    } else {                            // 小花
      var cols = ["#ff8fa3", "#ffd166", "#c8a2f0", "#ff9e7d", "#ffffff"];
      var c = cols[Math.floor(d.v * cols.length) % cols.length];
      ctx.strokeStyle = "#4e8f3f"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(d.x, d.y + 6 * s); ctx.lineTo(d.x, d.y); ctx.stroke();
      ctx.fillStyle = c;
      circle(d.x - 3 * s, d.y - 2 * s, 2.2 * s); ctx.fill();
      circle(d.x + 3 * s, d.y - 2 * s, 2.2 * s); ctx.fill();
      circle(d.x, d.y - 5 * s, 2.2 * s); ctx.fill();
      ctx.fillStyle = "#ffd75e";
      circle(d.x, d.y - 2 * s, 1.6 * s); ctx.fill();
    }
  }
  function drawCrystal(cx, cy, w, h, color) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + w * 0.55, cy - h * 0.3);
    ctx.lineTo(cx + w * 0.35, cy);
    ctx.lineTo(cx - w * 0.35, cy);
    ctx.lineTo(cx - w * 0.55, cy - h * 0.3);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - h); ctx.lineTo(cx - w * 0.2, cy - h * 0.12); ctx.stroke();
  }
  function drawBase() {                 // 蓝色水晶基地
    ctx.fillStyle = "rgba(140,210,255,0.18)";
    circle(BASE.x, BASE.y, 46); ctx.fill();
    ctx.fillStyle = "#cfc39e";
    ellipse(BASE.x, BASE.y + 16, 34, 12); ctx.fill();
    ctx.strokeStyle = "#b3a67f"; ctx.lineWidth = 2;
    ellipse(BASE.x, BASE.y + 16, 34, 12); ctx.stroke();
    drawCrystal(BASE.x - 16, BASE.y + 12, 13, 30, "#77c4f2");
    drawCrystal(BASE.x + 16, BASE.y + 12, 13, 26, "#8fd0f5");
    drawCrystal(BASE.x, BASE.y + 10, 22, 54, "#4aa8e8");
    ctx.strokeStyle = "#7a5a34"; ctx.lineWidth = 2;   // 小旗
    ctx.beginPath(); ctx.moveTo(BASE.x, BASE.y - 44); ctx.lineTo(BASE.x, BASE.y - 58); ctx.stroke();
    ctx.fillStyle = "#e05a4e";
    ctx.beginPath(); ctx.moveTo(BASE.x, BASE.y - 58); ctx.lineTo(BASE.x + 14, BASE.y - 53); ctx.lineTo(BASE.x, BASE.y - 48); ctx.closePath(); ctx.fill();
    if (baseFlashT > 0) {               // 被漏怪时红闪
      ctx.fillStyle = "rgba(255,70,50," + (0.4 * baseFlashT / 0.45) + ")";
      circle(BASE.x, BASE.y, 62); ctx.fill();
    }
  }
  function drawPad(p) {
    if (p.tower) {                      // 已建塔：只画木底座
      ctx.fillStyle = "#a98a5a";
      ellipse(p.x, p.y + 8, 18, 7); ctx.fill();
      return;
    }
    var bob = Math.sin(time * 2.2 + p.phase) * 3;   // 空牌呼吸浮动
    ctx.fillStyle = "rgba(60,50,30,0.2)";
    ellipse(p.x, p.y + 4, 16, 6); ctx.fill();
    ctx.fillStyle = "#cbb98a";          // 空地基
    ellipse(p.x, p.y, 15, 7); ctx.fill();
    ctx.fillStyle = "#8a6238";          // 木杆
    ctx.fillRect(p.x - 2.5, p.y - 26 + bob, 5, 26);
    ctx.fillStyle = "#4f9e3f";          // 绿色数字建造牌
    roundRectPath(p.x - 24, p.y - 50 + bob, 48, 28, 6); ctx.fill();
    ctx.strokeStyle = "#35702a"; ctx.lineWidth = 2;
    roundRectPath(p.x - 24, p.y - 50 + bob, 48, 28, 6); ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("70", p.x, p.y - 35 + bob);
  }
  function drawTower(t) {
    var def = TOWER_TYPES[t.type];
    var s = 1 + 0.08 * (t.level - 1);
    var r = 15 * s;
    ctx.fillStyle = "#3f4a3f";          // 底座圆盘
    circle(t.x, t.y, r + 2.5); ctx.fill();
    ctx.fillStyle = def.color;
    circle(t.x, t.y, r); ctx.fill();
    if (t.type === "cannon") {          // 炮管朝向目标
      ctx.save();
      ctx.translate(t.x, t.y); ctx.rotate(t.ang);
      ctx.fillStyle = "#2f333a";
      roundRectPath(2, -3.5, 16, 7, 3); ctx.fill();
      ctx.restore();
    }
    ctx.font = Math.round(17 * s) + "px sans-serif";  // 特色 emoji 顶部
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(def.icon, t.x, t.y - 1);
    if (t.flash > 0) {                  // 开火闪光
      ctx.fillStyle = "rgba(255,240,180," + (t.flash / 0.08 * 0.7) + ")";
      circle(t.x, t.y, r + 4); ctx.fill();
    }
    var k;                              // 等级金星
    for (k = 0; k < t.level; k++) {
      ctx.fillStyle = "#ffd75e";
      circle(t.x - (t.level - 1) * 4.5 + k * 9, t.y + r + 7, 2.8); ctx.fill();
      ctx.strokeStyle = "#b8860b"; ctx.lineWidth = 0.8;
      circle(t.x - (t.level - 1) * 4.5 + k * 9, t.y + r + 7, 2.8); ctx.stroke();
    }
  }
  function drawRangeCircle() {          // 选中塔时画射程圈
    if (selPad < 0 || panel.hidden) return;
    var t = pads[selPad] && pads[selPad].tower;
    if (!t) return;
    ctx.setLineDash([8, 7]);
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2;
    circle(t.x, t.y, rangeOf(t)); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    circle(t.x, t.y, rangeOf(t)); ctx.fill();
    ctx.setLineDash([]);
  }
  function drawEnemy(e) {
    var col = e.lane === 0 ? "#d9483b" : "#e8a91c";   // 红/黄两色军团
    var dark = e.lane === 0 ? "#9e2f24" : "#a97a0e";
    var fx = Math.cos(e.ang), fy = Math.sin(e.ang);
    var px = -fy, py = fx;
    ctx.fillStyle = "rgba(40,50,30,0.25)";
    ellipse(e.x, e.y + e.r * 0.85, e.r * 0.9, e.r * 0.35); ctx.fill();
    if (e.type === "runner") {          // 快跑兵速度线
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(e.x - fx * e.r * 1.3, e.y - fy * e.r * 1.3); ctx.lineTo(e.x - fx * e.r * 2.1, e.y - fy * e.r * 2.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(e.x - fx * e.r * 1.3 + px * 4, e.y - fy * e.r * 1.3 + py * 4); ctx.lineTo(e.x - fx * e.r * 1.9 + px * 4, e.y - fy * e.r * 1.9 + py * 4); ctx.stroke();
    }
    ctx.fillStyle = col;                // 圆头小兵：身体 + 头顶小圆
    circle(e.x, e.y, e.r); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 2;
    circle(e.x, e.y, e.r); ctx.stroke();
    circle(e.x, e.y - e.r * 0.9, e.r * 0.55); ctx.fill();
    circle(e.x, e.y - e.r * 0.9, e.r * 0.55); ctx.stroke();
    ctx.fillStyle = dark;               // 头盔
    ctx.beginPath(); ctx.arc(e.x, e.y - e.r * 0.9, e.r * 0.55, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#ffffff";          // 眼睛（朝向行进方向）
    circle(e.x + fx * e.r * 0.35 + px * e.r * 0.28, e.y + fy * e.r * 0.35 + py * e.r * 0.28, e.r * 0.16); ctx.fill();
    circle(e.x + fx * e.r * 0.35 - px * e.r * 0.28, e.y + fy * e.r * 0.35 - py * e.r * 0.28, e.r * 0.16); ctx.fill();
    if (e.type === "tank") {            // 重甲盾牌
      ctx.strokeStyle = "rgba(60,60,70,0.9)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.78, e.ang - 0.9, e.ang + 0.9); ctx.stroke();
    }
    if (e.type === "boss") {            // BOSS 金冠
      ctx.fillStyle = "#ffd75e";
      var bx = e.x, by = e.y - e.r * 1.45;
      ctx.beginPath();
      ctx.moveTo(bx - 9, by + 5); ctx.lineTo(bx - 9, by - 3); ctx.lineTo(bx - 4.5, by + 1);
      ctx.lineTo(bx, by - 6); ctx.lineTo(bx + 4.5, by + 1); ctx.lineTo(bx + 9, by - 3); ctx.lineTo(bx + 9, by + 5);
      ctx.closePath(); ctx.fill();
    }
    if (e.slowT > 0) {                  // 挂霜变蓝
      ctx.fillStyle = "rgba(140,200,255,0.45)";
      circle(e.x, e.y, e.r + 1.5); ctx.fill();
    }
    if (e.hp < e.maxHp) {               // 血条
      var w = Math.max(e.r * 2.2, e.type === "boss" ? 46 : 0);
      var pct = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = "rgba(30,30,30,0.55)";
      ctx.fillRect(e.x - w / 2, e.y - e.r - 13, w, 4);
      ctx.fillStyle = pct > 0.5 ? "#6fc24a" : pct > 0.25 ? "#e8a91c" : "#e0523c";
      ctx.fillRect(e.x - w / 2, e.y - e.r - 13, w * pct, 4);
    }
  }
  function render() {
    var k;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (shakeT > 0) {                   // 震屏微幅
      var q = shakeT / shakeDur;
      ctx.translate((Math.random() * 2 - 1) * shakeAmp * q, (Math.random() * 2 - 1) * shakeAmp * q);
    }
    ctx.fillStyle = "#8fbf6a";          // 嫩绿草地
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.globalAlpha = 0.28;             // 低多边形草地色块
    for (k = 0; k < patches.length; k++) {
      ctx.fillStyle = patches[k].c;
      ctx.beginPath();
      ctx.moveTo(patches[k].v[0][0], patches[k].v[0][1]);
      for (var m = 1; m < patches[k].v.length; m++) ctx.lineTo(patches[k].v[m][0], patches[k].v[m][1]);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawPond();                         // 水潭在路径之下
    drawPath(RED_PTS);
    drawPath(YEL_PTS);
    drawPath(COMMON_PTS);
    for (k = 0; k < pebbles.length; k++) {   // 路边小石子
      ctx.fillStyle = pebbles[k].c;
      circle(pebbles[k].x, pebbles[k].y, pebbles[k].r); ctx.fill();
    }
    drawBridge();
    for (k = 0; k < decors.length; k++) drawDecor(decors[k]);
    drawBase();
    for (k = 0; k < pads.length; k++) drawPad(pads[k]);
    drawRangeCircle();
    for (k = 0; k < towers.length; k++) drawTower(towers[k]);
    for (k = 0; k < enemies.length; k++) if (!enemies[k].dead) drawEnemy(enemies[k]);
    ctx.strokeStyle = "#6b4a2a"; ctx.lineWidth = 2;   // 箭矢细线
    ctx.lineCap = "round";
    var a;
    for (k = 0; k < arrows.items.length; k++) {
      a = arrows.items[k];
      if (!a.__alive) continue;
      ctx.beginPath();
      ctx.moveTo(a.x - a.dx * 9, a.y - a.dy * 9);
      ctx.lineTo(a.x + a.dx * 3, a.y + a.dy * 3);
      ctx.stroke();
    }
    var s;
    for (k = 0; k < shells.items.length; k++) {   // 炮弹
      s = shells.items[k];
      if (!s.__alive) continue;
      ctx.fillStyle = "#2e2e33";
      circle(s.x, s.y, 4); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      circle(s.x - 1.2, s.y - 1.2, 1.3); ctx.fill();
    }
    var p;
    for (k = 0; k < parts.items.length; k++) {   // 粒子
      p = parts.items[k];
      if (!p.__alive) continue;
      var pk = p.t / p.life;
      ctx.fillStyle = "rgba(" + p.color + "," + ((1 - pk) * 0.9) + ")";
      circle(p.x, p.y, p.r0 + (p.r1 - p.r0) * pk); ctx.fill();
    }
    var g;
    for (k = 0; k < rings.items.length; k++) {   // 涟漪（冰脉冲/建造/漏怪）
      g = rings.items[k];
      if (!g.__alive) continue;
      var gk = g.t / g.life;
      ctx.strokeStyle = "rgba(" + g.color + "," + ((1 - gk) * 0.8) + ")";
      ctx.lineWidth = 3;
      circle(g.x, g.y, g.r0 + (g.r1 - g.r0) * gk); ctx.stroke();
    }
    var f;
    for (k = 0; k < floaters.items.length; k++) {   // 金币/伤害飘字
      f = floaters.items[k];
      if (!f.__alive) continue;
      var fk = f.t / f.life;
      ctx.globalAlpha = 1 - fk;
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(40,40,40,0.6)"; ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y - 32 * fk);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - 32 * fk);
      ctx.globalAlpha = 1;
    }
    if (state === "prep") {             // 出怪倒计时横幅
      var txt = "第 " + (wave + 1) + " 波倒计时 " + Math.ceil(prepT) + " 秒 · 点击下方按钮立即出怪 +" + EARLY_BONUS + " 金";
      ctx.font = "bold 15px sans-serif";
      var tw = ctx.measureText(txt).width + 36;
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      roundRectPath(W / 2 - tw / 2, 14, tw, 32, 16); ctx.fill();
      ctx.strokeStyle = "rgba(110,160,90,0.4)"; ctx.lineWidth = 1.5;
      roundRectPath(W / 2 - tw / 2, 14, tw, 32, 16); ctx.stroke();
      ctx.fillStyle = "#3d4a40";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(txt, W / 2, 30);
    }
  }

  // ---------- 覆盖层（菜单/胜利/失败） ----------
  function showOverlay(mode, title, descHtml, btn1, btn2) {
    overlayMode = mode;
    el.oTitle.textContent = title;
    el.oDesc.innerHTML = descHtml;
    el.oBtn.textContent = btn1;
    if (btn2) { el.oBtn2.textContent = btn2; el.oBtn2.hidden = false; }
    else el.oBtn2.hidden = true;
    el.overlay.hidden = false;
  }
  function hideOverlay() { el.overlay.hidden = true; }
  el.oBtn.addEventListener("click", function () {
    ac();
    if (overlayMode === "victory") continueEndless();
    else startGame();
  });
  el.oBtn2.addEventListener("click", function () { ac(); startGame(); });
  el.nowBtn.addEventListener("click", function () { ac(); earlyStart(); });

  // ---------- 输入（tap 即 click，天然支持触屏） ----------
  function handleTap(x, y) {
    if (state !== "prep" && state !== "wave") { closePanel(); return; }
    var hit = -1, k;
    for (k = 0; k < pads.length; k++) {
      var dx = x - pads[k].x, dy = y - pads[k].y;
      if (dx * dx + dy * dy <= 27 * 27) { hit = k; break; }
    }
    if (hit >= 0) {
      if (selPad === hit && !panel.hidden) closePanel();
      else openPanel(hit);
    } else closePanel();
  }
  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    ac();                               // 首次点击后创建 AudioContext
    var r = canvas.getBoundingClientRect();
    if (r.width < 1) return;
    var x = (e.clientX - r.left) * W / r.width;
    var y = (e.clientY - r.top) * H / r.height;
    handleTap(x, y);
  });

  // ---------- 尺寸自适应（dpr + resize） ----------
  var scale = 1;
  function resize() {
    var r = canvas.getBoundingClientRect();
    if (r.width < 1) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.width * (H / W) * dpr);
    scale = canvas.width / W;
    if (!panel.hidden) positionPanel();
  }

  // ---------- 主循环 ----------
  var frameId = 0, last = performance.now();
  function loop(ts) {
    var dt = (ts - last) / 1000;
    last = ts;
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;           // 切后台回来不跳帧
    update(dt);
    render();
    frameId = requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (frameId) { cancelAnimationFrame(frameId); frameId = 0; }
    } else if (!frameId) {
      last = performance.now();
      frameId = requestAnimationFrame(loop);
    }
  });

  // ---------- 调试句柄 ----------
  window.__td = {
    start: startGame,
    state: function () {
      return { state: state, wave: wave, gold: gold, lives: lives, kills: kills, enemies: enemies.length, towers: towers.length };
    },
    step: function (sec) {              // 同步快进：按 1/60 步进
      var n = Math.max(0, Math.round((sec || 0) * 60)), k;
      for (k = 0; k < n; k++) update(1 / 60);
      render();
    },
    build: function (padIndex, type) {  // 测试用直接建塔（免扣金币）
      return tryBuild(padIndex, type, true);
    },
    upgrade: function (padIndex) {      // 测试辅助：升级（正常扣金币）
      return tryUpgrade(padIndex);
    },
    sell: function (padIndex) {         // 测试辅助：出售（返还 70%）
      return trySell(padIndex);
    },
    startWave: function () { startWave(); }
  };

  // ---------- 启动 ----------
  resize();
  window.addEventListener("resize", resize);
  showOverlay("menu", "王国防线 · Tower Defense",
    "红黄两路军团沿蜿蜒小径进犯，在桥头汇合后直扑水晶基地！<br>点击绿色建造牌布防：🏹 箭塔 70 · 💣 炮塔 110 · ❄️ 冰塔 90<br>守住 <b>10</b> 波即胜利，之后可继续无尽模式冲分。" +
    (best > 0 ? "<br>最佳纪录：第 " + best + " 波" : ""),
    "开始游戏", null);
  updateMsg(true);
  refreshHud(true);
  frameId = requestAnimationFrame(loop);
})();
