/* 生死狙击 · 变异战 3D
 * 第一人称射击（FPS）：WASD 移动 / Shift 疾跑 / Space 跳跃（可跳上矮箱）/ 鼠标视角 /
 * 按住左键射击 / R 换弹 / 1~4 切枪 / Esc 暂停。第一人称枪模（M4 黑 / 霰弹枪木色 /
 * 加特林弹鼓 / 巴雷特白黑科幻长管），明亮工业仓库地图，苍白僵尸（行走 + 爬行），绿血。
 * 规则与站内 2D「生化模式」一致：队友被咬 1.4 秒后变异，击杀母体必掉重武器箱，每 3 波出母体。
 * 依赖 three.js r128 UMD（全局 THREE），仅在 _pages/tps.md 中加载。
 */
(function () {
  "use strict";

  var canvas = document.getElementById("tps-canvas");
  if (!canvas) return;

  var el = {
    radar: document.getElementById("tps-radar"),
    topWave: document.getElementById("tps-top-wave"),
    topTime: document.getElementById("tps-top-time"),
    topLeft: document.getElementById("tps-top-left"),
    topScore: document.getElementById("tps-top-score"),
    feed: document.getElementById("tps-feed"),
    alive: document.getElementById("tps-alive"),
    hpSegs: document.getElementById("tps-hp-segs"),
    wname: document.getElementById("tps-wname"),
    ammoMag: document.getElementById("tps-ammo-mag"),
    ammoRes: document.getElementById("tps-ammo-res"),
    slots: document.getElementById("tps-slots"),
    cross: document.getElementById("tps-cross"),
    medal: document.getElementById("tps-medal"),
    banner: document.getElementById("tps-banner"),
    hurt: document.getElementById("tps-hurt"),
    touch: document.getElementById("tps-touch"),
    stick: document.getElementById("tps-stick"),
    stickKnob: document.getElementById("tps-stick-knob"),
    btnFire: document.getElementById("tps-btn-fire"),
    btnJump: document.getElementById("tps-btn-jump"),
    overlay: document.getElementById("tps-overlay"),
    ovTitle: document.getElementById("tps-overlay-title"),
    ovDesc: document.getElementById("tps-overlay-desc"),
    ovBtn: document.getElementById("tps-overlay-btn"),
    record: document.getElementById("tps-record"),
    msg: document.getElementById("tps-msg")
  };
  var stage = canvas.parentElement;

  var isTouch = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window;

  // ---------- 3D 引擎缺失降级 ----------
  if (typeof THREE === "undefined") {
    el.ovDesc.textContent = "3D 引擎加载失败，请检查网络后刷新。";
    el.ovBtn.disabled = true;
    window.__tps = {
      start: function () {},
      state: function () { return { state: "error", wave: 0, score: 0, zombies: 0, bots: 0, hp: 0, weapon: "none", gl: false }; },
      step: function () {},
      give: function () {}
    };
    return;
  }

  // ---------- 工具 ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2d(x1, z1, x2, z2) { return Math.hypot(x2 - x1, z2 - z1); }
  function setMsg(t) { el.msg.textContent = t; }

  // ---------- 音效（WebAudio 程序合成，首次点击后创建） ----------
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
  function sShot() { noiseBurst(0.07, "bandpass", 1900, 700, 0.26); tone(240, 90, 0.06, 0.15, 0, "square"); }
  function sShotgun() { noiseBurst(0.16, "lowpass", 900, 180, 0.4); tone(130, 55, 0.14, 0.26, 0, "square"); }
  function sGatling() { noiseBurst(0.05, "bandpass", 2400, 1000, 0.18); }
  function sSniper() { noiseBurst(0.2, "bandpass", 1300, 250, 0.42); tone(170, 45, 0.3, 0.28, 0, "sawtooth"); }
  function sBotShot() { noiseBurst(0.05, "bandpass", 1600, 800, 0.09); }
  function sHit() { noiseBurst(0.08, "lowpass", 500, 150, 0.18); }
  function sDie() { tone(150, 45, 0.32, 0.16, 0, "sawtooth"); }
  function sInfect() { tone(620, 110, 0.7, 0.2, 0, "sine"); noiseBurst(0.5, "bandpass", 800, 300, 0.1); }
  function sWave() { tone(440, 440, 0.12, 0.18); tone(660, 660, 0.2, 0.18, 0.12); }
  function sPickup() { tone(660, 990, 0.12, 0.18); }
  function sWeapon() { tone(523, 523, 0.09, 0.2); tone(659, 659, 0.09, 0.2, 0.09); tone(784, 784, 0.16, 0.22, 0.18); }
  function sHurt() { tone(120, 60, 0.2, 0.3); noiseBurst(0.1, "lowpass", 400, 120, 0.2); }
  function sEmpty() { tone(1300, 1300, 0.04, 0.1, 0, "square"); }
  function sReload() { tone(300, 500, 0.09, 0.12); tone(500, 300, 0.09, 0.12, 0.5); }
  function sSwap() { tone(500, 700, 0.06, 0.1); tone(700, 500, 0.05, 0.08, 0.07); }
  function sJump() { tone(280, 480, 0.09, 0.07); }
  function sLand() { noiseBurst(0.07, "lowpass", 300, 90, 0.12); }
  function sWind() { noiseBurst(0.5, "bandpass", 400, 2400, 0.3); tone(200, 640, 0.45, 0.12, 0, "sine"); }
  function sSlam() { noiseBurst(0.35, "lowpass", 220, 55, 0.5); tone(110, 38, 0.4, 0.3, 0, "sine"); }
  function sCharge() { noiseBurst(0.3, "bandpass", 300, 1000, 0.28); }
  function sSpit() { tone(520, 180, 0.25, 0.16, 0, "sawtooth"); }
  function sRoar() { tone(85, 240, 0.8, 0.32, 0, "sawtooth"); noiseBurst(0.6, "lowpass", 520, 140, 0.28); }
  function sWindup() { tone(180, 520, 0.4, 0.14, 0, "square"); }
  function sGameOver() { tone(300, 60, 1.2, 0.25, 0, "sawtooth"); }

  // ---------- 常量 ----------
  var FIELD = 60;                 // 战场边长（米）
  var HALF = FIELD / 2;
  var WALL_H = 10;                // 仓库墙高
  var CEIL_H = 10;                // 天花板高度
  var BOUND = HALF - 1.2;         // 实体可活动边界
  var EYE_H = 1.6;                // 第一人称眼高
  var PITCH_LIM = 80 * Math.PI / 180;
  var GRAV = 13.5;                // 跳跃重力
  var JUMP_V = 5.2;               // 跳跃初速度（可跳上 ~1m 矮箱）
  var WIND_V = 11;                // 风洞喷射初速度（apex ≈ 4.5m，可上全部高台）
  var STEP_H = 0.45;              // 可迈上的台阶高度
  var ZOMBIE_CAP = 40;

  // 武器表：recoil 视角上跳 / kick 枪身后座力度 / slot 切枪键位
  var WEAPONS = {
    rifle:   { name: "M4 步枪", icon: "🔫", dmg: 12,  cool: 0.125, spread: 0.02,  pellets: 1, range: 90,  magSize: 30,  ammo: 90, color: 0xffd97a, knock: 1.6, pierce: 0, tracer: 0.035, reload: 1.2, recoil: 0.010, kick: 1.0, slot: 1 },
    shotgun: { name: "霰弹枪",  icon: "💥", dmg: 8,   cool: 0.68,  spread: 0.09,  pellets: 6, range: 30,  magSize: 6,   ammo: 18, color: 0xffab5e, knock: 2.2, pierce: 0, tracer: 0.045, reload: 1.6, recoil: 0.038, kick: 1.6, slot: 2 },
    gatling: { name: "加特林",  icon: "🌀", dmg: 9,   cool: 0.055, spread: 0.035, pellets: 1, range: 90,  magSize: 150, ammo: 0,  color: 0x7ae8ff, knock: 0.8, pierce: 0, tracer: 0.03,  reload: 2.4, recoil: 0.007, kick: 0.7, slot: 3 },
    sniper:  { name: "巴雷特",  icon: "🎯", dmg: 120, cool: 0.95,  spread: 0.001, pellets: 1, range: 140, magSize: 5,   ammo: 10, color: 0xe8c8ff, knock: 5.0, pierce: 2, tracer: 0.06,  reload: 1.8, recoil: 0.055, kick: 2.2, slot: 4 }
  };
  var SLOT_KEYS = ["rifle", "shotgun", "gatling", "sniper"];
  function pickWeapon() {
    var r = Math.random();
    return r < 0.4 ? "shotgun" : r < 0.75 ? "gatling" : "sniper";
  }

  // 僵尸类型表（苍白系配色，爬行 walker 高度更矮）
  var ZT = {
    walker: { r: 0.42, h: 1.75, hp: 30,  speed: 2.3, dmg: 10, score: 100, body: 0x8a9478, head: 0xc9c2b0, label: "游荡者" },
    runner: { r: 0.38, h: 1.7,  hp: 20,  speed: 4.9, dmg: 8,  score: 150, body: 0xa8b894, head: 0xdcd6c4, label: "疾行体" },
    brute:  { r: 0.85, h: 2.6,  hp: 180, speed: 1.7, dmg: 25, score: 500, body: 0x8a5f6a, head: 0xc09aa2, label: "母体" }
  };

  // 障碍物：kind 决定配色（olive 军绿帆布箱 / wood 木箱 / low 可跳矮箱）
  var OBST_DEFS = [
    { x: -11, z: -9,  w: 1.8, h: 1.6,  d: 1.8, rot: 0.3, kind: "olive" },
    { x: 10,  z: -12, w: 2.6, h: 1.2,  d: 1.2, rot: 0,   kind: "wood" },
    { x: -15, z: 4,   w: 3.2, h: 0.75, d: 0.9, rot: 0.5, kind: "low" },
    { x: 13,  z: 8,   w: 1.8, h: 1.8,  d: 1.8, rot: 0,   kind: "olive" },
    { x: 7.5, z: -18, w: 1.4, h: 0.95, d: 1.4, rot: 0,   kind: "low" },   // 叠层跳台 A（跳→B→集装箱顶）
    { x: 5.3, z: -18, w: 1.5, h: 1.9,  d: 1.5, rot: 0,   kind: "wood" },  // 叠层跳台 B
    { x: -7,  z: 15,  w: 2.2, h: 1.5,  d: 2.2, rot: 0.2, kind: "wood" },
    { x: 16,  z: -3,  w: 1.6, h: 0.75, d: 1.6, rot: 0.7, kind: "low" },
    { x: -2,  z: 10,  w: 3.0, h: 1.1,  d: 0.8, rot: 1.1, kind: "wood" },
    { x: 20,  z: 18,  w: 2.4, h: 1.3,  d: 1.4, rot: 0.4, kind: "olive" },
    { x: -20, z: -14, w: 2.0, h: 1.1,  d: 2.0, rot: 0,   kind: "low" },
    { x: 24,  z: -8,  w: 2.0, h: 1.4,  d: 1.2, rot: 0.2, kind: "wood" }
  ];

  // ---------- 渲染器 / 场景（明亮工业仓库） ----------
  var renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  } catch (e) {
    renderer = null; // 无 WebGL 环境（如无头测试）时仅跑逻辑
  }

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8f887a);
  scene.fog = new THREE.Fog(0x8f887a, 34, 105);

  var camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 220);
  camera.rotation.order = "YXZ"; // FPS：先 yaw 后 pitch
  scene.add(camera);             // 枪模/枪口灯挂在相机上，需把相机加入场景

  // 明亮暖色光照：半球环境 + 暖阳光 + 顶灯补光
  scene.add(new THREE.HemisphereLight(0xe8e2d2, 0x8f8674, 1.0));
  var sun = new THREE.DirectionalLight(0xfff2d8, 0.85);
  sun.position.set(18, 30, 10);
  scene.add(sun);
  var lampLight = new THREE.PointLight(0xfff4e0, 0.85, 60, 2);
  lampLight.position.set(0, CEIL_H - 0.5, 0);
  scene.add(lampLight);

  // 水泥地：Canvas 程序纹理（暖灰 + 伸缩缝 + 污渍裂纹）
  function makeGroundTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 512;
    var g = c.getContext("2d");
    g.fillStyle = "#a49c8c";
    g.fillRect(0, 0, 512, 512);
    var i, k;
    for (i = 0; i < 2200; i++) {
      g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(40,35,25,0.07)";
      g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    for (i = 0; i < 26; i++) { // 污渍
      g.fillStyle = "rgba(60,55,40," + rand(0.03, 0.09).toFixed(3) + ")";
      g.beginPath();
      g.arc(Math.random() * 512, Math.random() * 512, rand(12, 46), 0, 6.2832);
      g.fill();
    }
    g.strokeStyle = "rgba(70,64,50,0.5)"; // 伸缩缝
    g.lineWidth = 2;
    for (i = 0; i <= 512; i += 128) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
    }
    g.strokeStyle = "rgba(60,54,42,0.4)"; // 裂纹
    g.lineWidth = 1.2;
    for (i = 0; i < 6; i++) {
      var x = Math.random() * 512, y = Math.random() * 512;
      g.beginPath(); g.moveTo(x, y);
      for (k = 0; k < 5; k++) { x += rand(-70, 70); y += rand(-70, 70); g.lineTo(x, y); }
      g.stroke();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }
  var ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD, FIELD),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // 瓦楞铁墙：Canvas 纹理（竖向波纹 + 锈渍 + 底部护板）
  function makeWallTexture() {
    var c = document.createElement("canvas");
    c.width = 512; c.height = 256;
    var g = c.getContext("2d");
    g.fillStyle = "#8d8271";
    g.fillRect(0, 0, 512, 256);
    for (var i = 0; i < 512; i += 16) { // 瓦楞竖纹
      g.fillStyle = "rgba(255,255,255,0.07)";
      g.fillRect(i, 0, 4, 256);
      g.fillStyle = "rgba(30,25,18,0.13)";
      g.fillRect(i + 8, 0, 5, 256);
    }
    for (var k = 0; k < 20; k++) { // 锈渍
      g.fillStyle = "rgba(120,70,35," + rand(0.05, 0.14).toFixed(3) + ")";
      g.fillRect(Math.random() * 512, Math.random() * 200, rand(4, 20), rand(20, 60));
    }
    g.fillStyle = "rgba(50,44,34,0.55)"; // 底部护板
    g.fillRect(0, 226, 512, 30);
    g.fillStyle = "rgba(200,190,160,0.25)";
    g.fillRect(0, 224, 512, 3);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 1);
    if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }
  var wallTex = makeWallTexture();
  var wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
  var wallBoxes = []; // 供射线挡弹的 AABB
  function addWall(x, z, w, d) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
    m.position.set(x, WALL_H / 2, z);
    scene.add(m);
    wallBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: WALL_H, minZ: z - d / 2, maxZ: z + d / 2 });
  }
  addWall(0, -HALF - 0.5, FIELD + 2, 1);
  addWall(0, HALF + 0.5, FIELD + 2, 1);
  addWall(-HALF - 0.5, 0, 1, FIELD + 2);
  addWall(HALF + 0.5, 0, 1, FIELD + 2);

  // 天花板 + 长条顶灯
  var ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD + 2, FIELD + 2),
    new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 0.95, emissive: 0x55504a, emissiveIntensity: 0.35 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = CEIL_H;
  scene.add(ceil);
  var stripMat = new THREE.MeshStandardMaterial({ color: 0xf4eedd, emissive: 0xfff4e0, emissiveIntensity: 1.0 });
  [-18, -6, 6, 18].forEach(function (sx) {
    var strip = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 0.6), stripMat);
    strip.position.set(sx, CEIL_H - 0.08, 0);
    scene.add(strip);
    var strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 7), stripMat);
    strip2.position.set(0, CEIL_H - 0.08, sx);
    scene.add(strip2);
  });

  // 第三人称玩家身体（在角色拼装段之后构建，按 V 切换视角时显示）
  var playerBody = null, pbUd = null, pbShadow = null;

  // 障碍物（军绿帆布箱 / 木箱 / 集装箱 / 矮箱）
  var OBST_STYLE = {
    olive: { body: 0x5f6b45, lid: 0x4a5438 },
    wood: { body: 0x8a6a42, lid: 0x6f5433 },
    container: { body: 0x7a3f30, lid: 0x653326 },
    low: { body: 0x9a7a4e, lid: 0x7d6238 }
  };
  var obstacles = []; // { minX,maxX,minZ,maxZ,h }
  OBST_DEFS.forEach(function (o) {
    var st = OBST_STYLE[o.kind] || OBST_STYLE.wood;
    var bodyMat = new THREE.MeshStandardMaterial({ color: st.body, roughness: 0.9 });
    var m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), bodyMat);
    m.position.set(o.x, o.h / 2, o.z);
    m.rotation.y = o.rot;
    scene.add(m);
    if (o.h >= 1.0) { // 盖子/篷布顶
      var lid = new THREE.Mesh(new THREE.BoxGeometry(o.w * 1.04, 0.08, o.d * 1.04),
        new THREE.MeshStandardMaterial({ color: st.lid, roughness: 0.92 }));
      lid.position.set(o.x, o.h + 0.04, o.z);
      lid.rotation.y = o.rot;
      scene.add(lid);
    }
    var c = Math.abs(Math.cos(o.rot)), s = Math.abs(Math.sin(o.rot));
    var ex = (o.w / 2) * c + (o.d / 2) * s;
    var ez = (o.w / 2) * s + (o.d / 2) * c;
    obstacles.push({ minX: o.x - ex, maxX: o.x + ex, minZ: o.z - ez, maxZ: o.z + ez, h: o.h });
  });

  // ---------- 立体结构：高台 / 斜坡 / 风洞 ----------
  // 高台：台面高 2.8~3.4m，可站可走位（无空气墙，护栏仅视觉矮挡板）
  var PLATFORM_DEFS = [
    { minX: -14, maxX: 14,  minZ: -28.5, maxZ: -26.1, top: 3.0, kind: "catwalk" },  // 北墙猫道（宽 2.4m）
    { minX: -18, maxX: -12, minZ: 8,     maxZ: 14,    top: 3.4, kind: "tower" },    // 中央瞭望塔（6×6）
    { minX: -2,  maxX: 4,   minZ: -19.2, maxZ: -16.8, top: 2.8, kind: "container" } // 集装箱叠层高台
  ];
  // 斜坡：矩形区域内沿 axis 线性升高（from/h0 → to/h1），玩家/僵尸/队友都能走
  var RAMP_DEFS = [
    { minX: 14,  maxX: 21,  minZ: -28.5, maxZ: -26.1, axis: "x", from: 21,  to: 14,  h0: 0, h1: 3.0 }, // 猫道东坡
    { minX: -21, maxX: -14, minZ: -28.5, maxZ: -26.1, axis: "x", from: -21, to: -14, h0: 0, h1: 3.0 }, // 猫道西坡
    { minX: -12, maxX: -5,  minZ: 9.5,   maxZ: 12.5,  axis: "x", from: -5,  to: -12, h0: 0, h1: 3.4 }  // 瞭望塔坡道
  ];
  // 风洞垫：仅玩家可被气流顶起（初速 11m/s，~4.5m 大跳），每垫 1s 冷却
  var WIND_PADS = [
    { x: 7,  z: -14.5, r: 1.15, cool: 0 },
    { x: 16, z: 20,    r: 1.15, cool: 0 }
  ];
  var PLAT_SPOTS = [ // 高台补给投放点（台面中心）
    { x: 0, z: -27.3 }, { x: -15, z: 11 }, { x: 1, z: -18 }
  ];

  var platforms = PLATFORM_DEFS, ramps = RAMP_DEFS;
  function rampLocalH(r, x, z) { // 斜坡局部高度（线性插值）
    var t = r.axis === "x" ? (x - r.from) / (r.to - r.from) : (z - r.from) / (r.to - r.from);
    return r.h0 + (r.h1 - r.h0) * clamp(t, 0, 1);
  }

  // 高台/斜坡视觉：钢平台 + 立柱 + 护栏，集装箱实心台
  var deckMat = new THREE.MeshStandardMaterial({ color: 0x6a6f66, roughness: 0.7, metalness: 0.35 });
  var railMat = new THREE.MeshStandardMaterial({ color: 0x8a8f85, roughness: 0.6, metalness: 0.4 });
  var legMat = new THREE.MeshStandardMaterial({ color: 0x4a4f48, roughness: 0.8 });
  var contMat = new THREE.MeshStandardMaterial({ color: 0x7a3f30, roughness: 0.85 });
  var contLidMat = new THREE.MeshStandardMaterial({ color: 0x653326, roughness: 0.85 });
  function addRail(x, z, w, d, topY) { // 视觉矮护栏（无碰撞）
    var r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), railMat);
    r.position.set(x, topY + 0.45, z);
    scene.add(r);
  }
  PLATFORM_DEFS.forEach(function (p) {
    var w = p.maxX - p.minX, d = p.maxZ - p.minZ;
    var cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
    if (p.kind === "container") {
      var body = new THREE.Mesh(new THREE.BoxGeometry(w, p.top, d), contMat);
      body.position.set(cx, p.top / 2, cz);
      scene.add(body);
      var lid = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, 0.1, d * 1.03), contLidMat);
      lid.position.set(cx, p.top + 0.05, cz);
      scene.add(lid);
    } else {
      var deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), deckMat);
      deck.position.set(cx, p.top - 0.11, cz);
      scene.add(deck);
      var legXs = p.kind === "catwalk" ? [-12, -6, 0, 6, 12] : [-2.6, 2.6];
      var legZs = p.kind === "catwalk" ? [cz] : [p.minZ + 0.4, p.maxZ - 0.4];
      legXs.forEach(function (lx) {
        legZs.forEach(function (lz) {
          var leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, p.top, 0.22), legMat);
          leg.position.set(p.kind === "catwalk" ? lx : cx + lx, p.top / 2, lz);
          scene.add(leg);
        });
      });
      if (p.kind === "catwalk") {
        addRail(cx, p.maxZ - 0.05, w, 0.08, p.top); // 前缘通长护栏
      } else { // 瞭望塔三面护栏，东侧留坡道口
        addRail(cx, p.minZ + 0.05, w, 0.08, p.top);
        addRail(cx, p.maxZ - 0.05, w, 0.08, p.top);
        addRail(p.minX + 0.05, cz, 0.08, d, p.top);
      }
    }
  });
  RAMP_DEFS.forEach(function (r) { // 斜坡板
    var w = r.maxX - r.minX, d = r.maxZ - r.minZ;
    var cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    var len = Math.abs(r.to - r.from), rise = r.h1 - r.h0;
    var slope = Math.sqrt(len * len + rise * rise);
    var m;
    if (r.axis === "x") {
      m = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.18, d), deckMat);
      m.rotation.z = Math.atan2(rise, r.to - r.from);
    } else {
      m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, slope), deckMat);
      m.rotation.x = -Math.atan2(rise, r.to - r.from);
    }
    m.position.set(cx, (r.h0 + r.h1) / 2 - 0.09, cz);
    scene.add(m);
  });

  // 风洞垫视觉：发光底盘 + 光环 + 青色光柱 + 点光
  var windPads = [];
  var padDiscGeo = new THREE.CircleGeometry(1.05, 24);
  var padRingGeo = new THREE.RingGeometry(1.05, 1.35, 24);
  var padColGeo = new THREE.CylinderGeometry(0.85, 0.85, 4.6, 14, 1, true);
  var padBladeGeo = new THREE.BoxGeometry(1.5, 0.025, 0.14);
  var padHubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10);
  var padGrillMat = new THREE.MeshStandardMaterial({ color: 0x2c3438, roughness: 0.5, metalness: 0.55 });
  WIND_PADS.forEach(function (p) {
    var disc = new THREE.Mesh(padDiscGeo, new THREE.MeshStandardMaterial({ color: 0x1c3a44, emissive: 0x2ec8e8, emissiveIntensity: 1.1, roughness: 0.4 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.x, 0.03, p.z);
    scene.add(disc);
    var ring = new THREE.Mesh(padRingGeo, new THREE.MeshBasicMaterial({ color: 0x6fe8ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.035, p.z);
    scene.add(ring);
    var col = new THREE.Mesh(padColGeo, new THREE.MeshBasicMaterial({ color: 0x55d8ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    col.position.set(p.x, 2.3, p.z);
    scene.add(col);
    var light = new THREE.PointLight(0x55d8ff, 0.7, 9, 2);
    light.position.set(p.x, 1.2, p.z);
    scene.add(light);
    var blades = new THREE.Group(); // 环形格栅叶片（缓慢反转）
    for (var bl = 0; bl < 6; bl++) {
      var bm = new THREE.Mesh(padBladeGeo, padGrillMat);
      bm.rotation.y = bl * Math.PI / 3;
      blades.add(bm);
    }
    blades.add(new THREE.Mesh(padHubGeo, padGrillMat));
    blades.position.set(p.x, 0.09, p.z);
    scene.add(blades);
    p.disc = disc; p.ring = ring; p.col = col; p.light = light; p.blades = blades; p.cool = 0;
    windPads.push(p);
  });

  // 预计算弹道遮挡 AABB（墙 + 障碍 + 高台 + 斜坡），热循环零分配
  var raySolids = wallBoxes.slice();
  obstacles.forEach(function (o) { raySolids.push({ minX: o.minX, maxX: o.maxX, minY: 0, maxY: o.h, minZ: o.minZ, maxZ: o.maxZ }); });
  platforms.forEach(function (p) { raySolids.push({ minX: p.minX, maxX: p.maxX, minY: 0, maxY: p.top, minZ: p.minZ, maxZ: p.maxZ }); });
  ramps.forEach(function (r) { raySolids.push({ minX: r.minX, maxX: r.maxX, minY: 0, maxY: r.h1, minZ: r.minZ, maxZ: r.maxZ }); });

  // ---------- 场景细节：工业感道具（共享几何/材质，一次性预建，运行时零分配） ----------
  (function () {
    var steelMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.55, metalness: 0.5 });
    var darkSteel = new THREE.MeshStandardMaterial({ color: 0x32363c, roughness: 0.6, metalness: 0.45 });
    var pipeMat = new THREE.MeshStandardMaterial({ color: 0x6a6f72, roughness: 0.45, metalness: 0.6 });

    // 墙面壁柱（每 12m 一根，四面墙）
    var pillarGeo = new THREE.BoxGeometry(0.55, WALL_H, 0.4);
    [-24, -12, 0, 12, 24].forEach(function (px2) {
      var n = new THREE.Mesh(pillarGeo, steelMat);
      n.position.set(px2, WALL_H / 2, -HALF + 0.2); scene.add(n);
      var s = new THREE.Mesh(pillarGeo, steelMat);
      s.position.set(px2, WALL_H / 2, HALF - 0.2); scene.add(s);
      var w = new THREE.Mesh(pillarGeo, steelMat);
      w.rotation.y = Math.PI / 2; w.position.set(-HALF + 0.2, WALL_H / 2, px2); scene.add(w);
      var e = new THREE.Mesh(pillarGeo, steelMat);
      e.rotation.y = Math.PI / 2; e.position.set(HALF - 0.2, WALL_H / 2, px2); scene.add(e);
    });

    // 高处采光窗（窗框/窗棂烤进 Canvas 纹理，柔和自发光=白炽天光）
    var wc = document.createElement("canvas");
    wc.width = 128; wc.height = 72;
    var wg = wc.getContext("2d");
    wg.fillStyle = "#3a3f45"; wg.fillRect(0, 0, 128, 72);
    wg.fillStyle = "#cfe2ee"; wg.fillRect(8, 8, 112, 56);
    wg.fillStyle = "#3a3f45"; wg.fillRect(60, 8, 8, 56); wg.fillRect(8, 32, 112, 8);
    var winTex = new THREE.CanvasTexture(wc);
    var winGeo = new THREE.PlaneGeometry(2.4, 1.35);
    var winMat = new THREE.MeshStandardMaterial({ map: winTex, emissive: 0x9fb8c8, emissiveIntensity: 0.42, emissiveMap: winTex, roughness: 0.6 });
    [-21, -7, 7, 21].forEach(function (wx) {
      var n = new THREE.Mesh(winGeo, winMat);
      n.position.set(wx, 7.6, -HALF + 0.08); scene.add(n);
      var s = new THREE.Mesh(winGeo, winMat);
      s.rotation.y = Math.PI; s.position.set(wx, 7.6, HALF - 0.08); scene.add(s);
      var w = new THREE.Mesh(winGeo, winMat);
      w.rotation.y = Math.PI / 2; w.position.set(-HALF + 0.08, 7.6, wx); scene.add(w);
      var e = new THREE.Mesh(winGeo, winMat);
      e.rotation.y = -Math.PI / 2; e.position.set(HALF - 0.08, 7.6, wx); scene.add(e);
    });

    // 南门门框 + 黄黑警示条纹柱
    var sc = document.createElement("canvas");
    sc.width = 64; sc.height = 64;
    var sgc = sc.getContext("2d");
    sgc.fillStyle = "#d8a818"; sgc.fillRect(0, 0, 64, 64);
    sgc.fillStyle = "#1c1c1c";
    for (var s2 = -64; s2 < 64; s2 += 24) {
      sgc.beginPath();
      sgc.moveTo(s2, 64); sgc.lineTo(s2 + 12, 64); sgc.lineTo(s2 + 76, 0); sgc.lineTo(s2 + 64, 0);
      sgc.closePath(); sgc.fill();
    }
    var stripeTex = new THREE.CanvasTexture(sc);
    stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
    stripeTex.repeat.set(1, 3);
    var stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.7 });
    var doorFrame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, 0.35), darkSteel);
    doorFrame.position.set(10, 1.8, HALF - 0.18); scene.add(doorFrame);
    var door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 0.14), steelMat);
    door.position.set(10, 1.6, HALF - 0.3); scene.add(door);
    var postGeo = new THREE.BoxGeometry(0.42, 3.6, 0.46);
    [8.1, 11.9].forEach(function (dx2) {
      var p = new THREE.Mesh(postGeo, stripeMat);
      p.position.set(dx2, 1.8, HALF - 0.25);
      scene.add(p);
    });

    // 天花板横梁 + 顶灯灯罩（不再只是浮着的发光条）
    var beamGeo = new THREE.BoxGeometry(FIELD + 2, 0.5, 0.7);
    [-25, -15, -5, 5, 15, 25].forEach(function (bz) {
      var b = new THREE.Mesh(beamGeo, darkSteel);
      b.position.set(0, CEIL_H - 0.3, bz);
      scene.add(b);
    });
    var hoodGeoX = new THREE.BoxGeometry(7.4, 0.16, 0.95);
    var hoodGeoZ = new THREE.BoxGeometry(0.95, 0.16, 7.4);
    [-18, -6, 6, 18].forEach(function (sx) {
      var h1 = new THREE.Mesh(hoodGeoX, darkSteel);
      h1.position.set(sx, CEIL_H - 0.02, 0); scene.add(h1);
      var h2 = new THREE.Mesh(hoodGeoZ, darkSteel);
      h2.position.set(0, CEIL_H - 0.02, sx); scene.add(h2);
    });

    // 靠墙管道（西墙/北墙，贴墙不挡走位）
    var pipeGeo = new THREE.CylinderGeometry(0.12, 0.12, 44, 10);
    [[-HALF + 0.35, 0.5, 0], [-HALF + 0.35, 0.95, 0]].forEach(function (pp) {
      var p = new THREE.Mesh(pipeGeo, pipeMat);
      p.rotation.x = Math.PI / 2;
      p.position.set(pp[0], pp[1], pp[2]);
      scene.add(p);
    });
    [[0.5, -HALF + 0.35], [0.95, -HALF + 0.35]].forEach(function (pp) {
      var p = new THREE.Mesh(pipeGeo, pipeMat);
      p.rotation.z = Math.PI / 2;
      p.position.set(0, pp[0], pp[1]);
      scene.add(p);
    });
    var elbowGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.5, 10);
    [[-HALF + 0.35, -18], [-HALF + 0.35, 14], [-16, -HALF + 0.35], [12, -HALF + 0.35]].forEach(function (pp) {
      var v = new THREE.Mesh(elbowGeo, pipeMat);
      v.position.set(pp[0], 0.72, pp[1]);
      scene.add(v);
    });

    // 油桶（军绿/锈红，带碰撞 + 挡弹，可当跳跃掩护）
    var barrelGeo = new THREE.CylinderGeometry(0.32, 0.34, 0.92, 12);
    var barrelLidGeo = new THREE.CylinderGeometry(0.345, 0.345, 0.06, 12);
    var barrelGreen = new THREE.MeshStandardMaterial({ color: 0x55603a, roughness: 0.6, metalness: 0.3 });
    var barrelRust = new THREE.MeshStandardMaterial({ color: 0x7a4030, roughness: 0.75, metalness: 0.2 });
    var BARRELS = [
      [25.2, 25.2, 0], [26.1, 24.4, 1], [24.5, 24.3, 0],
      [-25.5, -21.5, 1], [-24.6, -22.4, 0],
      [23.8, -24.6, 0], [24.7, -25.3, 1]
    ];
    BARRELS.forEach(function (bp) {
      var mat = bp[2] ? barrelRust : barrelGreen;
      var b = new THREE.Mesh(barrelGeo, mat);
      b.position.set(bp[0], 0.46, bp[1]); scene.add(b);
      var lid = new THREE.Mesh(barrelLidGeo, mat);
      lid.position.set(bp[0], 0.95, bp[1]); scene.add(lid);
      obstacles.push({ minX: bp[0] - 0.34, maxX: bp[0] + 0.34, minZ: bp[1] - 0.34, maxZ: bp[1] + 0.34, h: 0.95 });
      raySolids.push({ minX: bp[0] - 0.34, maxX: bp[0] + 0.34, minY: 0, maxY: 0.95, minZ: bp[1] - 0.34, maxZ: bp[1] + 0.34 });
    });

    // 电缆卷（角落道具，带碰撞）
    var reelSide = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 14);
    var reelCore = new THREE.CylinderGeometry(0.24, 0.24, 0.56, 10);
    var reelCable = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 14);
    var reelMat = new THREE.MeshStandardMaterial({ color: 0x6b5233, roughness: 0.85 });
    var cableMat = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.9 });
    var rl = new THREE.Mesh(reelSide, reelMat); rl.rotation.z = Math.PI / 2; rl.position.set(-27.5, 0.55, 27.2); scene.add(rl);
    var rr = new THREE.Mesh(reelSide, reelMat); rr.rotation.z = Math.PI / 2; rr.position.set(-26.9, 0.55, 27.2); scene.add(rr);
    var rc = new THREE.Mesh(reelCore, reelMat); rc.rotation.z = Math.PI / 2; rc.position.set(-27.2, 0.55, 27.2); scene.add(rc);
    var rw = new THREE.Mesh(reelCable, cableMat); rw.rotation.z = Math.PI / 2; rw.position.set(-27.2, 0.55, 27.2); scene.add(rw);
    obstacles.push({ minX: -27.8, maxX: -26.6, minZ: 26.6, maxZ: 27.8, h: 1.1 });
    raySolids.push({ minX: -27.8, maxX: -26.6, minY: 0, maxY: 1.1, minZ: 26.6, maxZ: 27.8 });

    // 高台梯子（猫道正面 + 瞭望塔东面）
    var railGeo = new THREE.BoxGeometry(0.08, 3.4, 0.08);
    var rungGeo = new THREE.BoxGeometry(0.5, 0.06, 0.06);
    function addLadder(x, z, ry, h) {
      var lg = new THREE.Group();
      var r1 = new THREE.Mesh(railGeo, steelMat); r1.position.set(-0.28, h / 2, 0); lg.add(r1);
      var r2 = new THREE.Mesh(railGeo, steelMat); r2.position.set(0.28, h / 2, 0); lg.add(r2);
      for (var r3 = 0; r3 < 5; r3++) {
        var rg = new THREE.Mesh(rungGeo, steelMat);
        rg.position.set(0, 0.5 + r3 * (h - 0.9) / 4, 0);
        lg.add(rg);
      }
      lg.position.set(x, 0, z);
      lg.rotation.y = ry;
      scene.add(lg);
    }
    addLadder(0, -26.0, 0, 3.2);
    addLadder(-11.9, 11, Math.PI / 2, 3.5);

    // 高台斜撑
    var braceGeo = new THREE.BoxGeometry(0.1, 3.2, 0.1);
    [[-13, -27.3, 0.5], [13, -27.3, -0.5], [-16.5, 9.5, 0.5], [-16.5, 12.5, -0.5]].forEach(function (bp2) {
      var br = new THREE.Mesh(braceGeo, darkSteel);
      br.position.set(bp2[0], 1.4, bp2[1]);
      br.rotation.z = bp2[2];
      scene.add(br);
    });
  })();

  // ---------- 角色拼装（分件人形：骨盆/躯干/四肢枢轴 + 发光眼 + 行走动画） ----------
  var GEO = {};
  (function () {
    GEO.pelvis = new THREE.BoxGeometry(0.4, 0.2, 0.26);
    GEO.chest = new THREE.BoxGeometry(0.44, 0.52, 0.27);
    GEO.arm = new THREE.BoxGeometry(0.12, 0.62, 0.14); GEO.arm.translate(0, -0.31, 0);  // 肩部枢轴
    GEO.leg = new THREE.BoxGeometry(0.15, 0.85, 0.17); GEO.leg.translate(0, -0.425, 0);  // 胯部枢轴
    GEO.skull = new THREE.SphereGeometry(0.16, 10, 8); GEO.skull.scale(0.95, 1.08, 1);
    GEO.jaw = new THREE.BoxGeometry(0.2, 0.07, 0.1); GEO.jaw.translate(0, -0.09, 0.09);  // 下颌前突
    GEO.eye = new THREE.SphereGeometry(0.03, 6, 5);
    GEO.spike = new THREE.ConeGeometry(0.06, 0.24, 6);   // 母体背刺
    GEO.crack = new THREE.BoxGeometry(0.12, 0.025, 0.02);// 母体发光裂纹
    GEO.pad = new THREE.BoxGeometry(0.22, 0.14, 0.3);    // 精英肩甲
    GEO.horn = new THREE.ConeGeometry(0.05, 0.2, 5);     // 精英头角
    GEO.core = new THREE.BoxGeometry(0.3, 0.3, 0.12);    // 精英核心
    GEO.helmet = new THREE.SphereGeometry(0.185, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    GEO.visor = new THREE.BoxGeometry(0.2, 0.06, 0.03);
    GEO.gun = new THREE.BoxGeometry(0.07, 0.13, 0.66); GEO.gun.translate(0, -0.02, 0.28); // 持枪前指
  })();
  // 共享材质（眼睛/裂纹/装甲/枪械，全局各一份，禁止 dispose）
  var ZSKINS = [0x8a9478, 0x99a181, 0x7d8a6c, 0xa6b08e]; // 僵尸肤色轮换
  var ZCLOTH = [0x5b5348, 0x49566a, 0x6d4c3c, 0x40493c, 0x585f6b]; // 僵尸衣色轮换
  var ZEYE_MAT = new THREE.MeshBasicMaterial({ color: 0xc6ff4a }); // 丧尸绿黄发光眼
  var ELEYE_MAT = new THREE.MeshBasicMaterial({ color: 0xff5a3a }); // 精英红眼
  var CRACK_MAT = new THREE.MeshStandardMaterial({ color: 0x30100a, emissive: 0xff7a2a, emissiveIntensity: 1.1, roughness: 0.6 });
  var ARMOR_MAT = new THREE.MeshStandardMaterial({ color: 0x2a1218, roughness: 0.45, metalness: 0.45 });
  var GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.45, metalness: 0.5 });
  var BOT_HELM_MAT = new THREE.MeshStandardMaterial({ color: 0x3c4a2e, roughness: 0.6, metalness: 0.25 });
  var PB_HELM_MAT = new THREE.MeshStandardMaterial({ color: 0x44546a, roughness: 0.55, metalness: 0.3 });
  var VISOR_MAT = new THREE.MeshStandardMaterial({ color: 0x16222a, emissive: 0x2a4a55, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4 });

  function makeHumanoid(opt) {
    // opt: { cloth, skin, eyeMat, hunch, crawl, armsForward, gun, helmetMat, visor, scale, brute }
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshStandardMaterial({ color: opt.cloth, roughness: 0.9 });
    var headMat = new THREE.MeshStandardMaterial({ color: opt.skin, roughness: 0.85 });
    var hip = new THREE.Group(); hip.position.y = 0.85; g.add(hip);
    var legL = new THREE.Group(); legL.position.set(-0.115, 0, 0); hip.add(legL);
    legL.add(new THREE.Mesh(GEO.leg, bodyMat));
    var legR = new THREE.Group(); legR.position.set(0.115, 0, 0); hip.add(legR);
    legR.add(new THREE.Mesh(GEO.leg, bodyMat));
    var torso = new THREE.Group(); hip.add(torso);
    var pelvis = new THREE.Mesh(GEO.pelvis, bodyMat); pelvis.position.y = 0.08; torso.add(pelvis);
    var chest = new THREE.Mesh(GEO.chest, bodyMat); chest.position.y = 0.42; torso.add(chest);
    var armL = new THREE.Group(); armL.position.set(-0.28, 0.62, 0); torso.add(armL);
    armL.add(new THREE.Mesh(GEO.arm, bodyMat));
    var armR = new THREE.Group(); armR.position.set(0.28, 0.62, 0); torso.add(armR);
    armR.add(new THREE.Mesh(GEO.arm, bodyMat));
    var headG = new THREE.Group(); headG.position.y = 0.78; torso.add(headG);
    var skull = new THREE.Mesh(GEO.skull, headMat); skull.position.y = 0.08; headG.add(skull);
    var jaw = new THREE.Mesh(GEO.jaw, headMat); jaw.position.set(0, 0.02, 0.05); headG.add(jaw);
    if (opt.eyeMat) { // 发光眼（暗处辨识度极高）
      var eL = new THREE.Mesh(GEO.eye, opt.eyeMat); eL.position.set(-0.062, 0.1, 0.15); headG.add(eL);
      var eR = new THREE.Mesh(GEO.eye, opt.eyeMat); eR.position.set(0.062, 0.1, 0.15); headG.add(eR);
    }
    var armBase = 0;
    if (opt.gun) { // 持枪姿态：双臂前指，枪挂右臂枢轴并反向校平
      armBase = -1.05;
      var gun = new THREE.Mesh(GEO.gun, GUN_MAT);
      gun.position.set(0, -0.58, 0.06);
      gun.rotation.x = -armBase;
      armR.add(gun);
      armL.rotation.z = 0.35; // 左手托握
    } else if (opt.armsForward) { // 丧尸经典双臂前伸
      armBase = -1.35;
    }
    armL.rotation.x = armBase; armR.rotation.x = armBase;
    if (opt.helmetMat) {
      var hm = new THREE.Mesh(GEO.helmet, opt.helmetMat);
      hm.position.y = 0.13; headG.add(hm);
      if (opt.visor) {
        var vs = new THREE.Mesh(GEO.visor, VISOR_MAT);
        vs.position.set(0, 0.08, 0.165); headG.add(vs);
      }
    }
    if (opt.brute) { // 母体：背部尖刺 + 发光裂纹（共享材质）
      for (var si = 0; si < 4; si++) {
        var sp = new THREE.Mesh(GEO.spike, CRACK_MAT);
        sp.position.set(-0.12 + si * 0.08, 0.66 - si * 0.12, -0.17);
        sp.rotation.x = -0.7;
        torso.add(sp);
      }
      for (var ci2 = 0; ci2 < 2; ci2++) {
        var cr = new THREE.Mesh(GEO.crack, CRACK_MAT);
        cr.position.set(ci2 ? 0.12 : -0.08, 0.38 + ci2 * 0.16, 0.15);
        cr.rotation.z = ci2 ? 0.5 : -0.35;
        torso.add(cr);
      }
    }
    if (opt.crawl) { // 爬行：躯干放平，头前探，腿拖行
      hip.position.y = 0.5;
      torso.rotation.x = 1.2;
      headG.rotation.x = -1.0;
      legL.rotation.x = 1.15; legR.rotation.x = 1.15;
      armBase = -1.3;
      armL.rotation.x = armBase; armR.rotation.x = armBase;
    } else if (opt.hunch) {
      torso.rotation.x = opt.hunch;
      headG.rotation.x = -opt.hunch * 0.7;
    }
    if (opt.scale && opt.scale !== 1) g.scale.set(opt.scale, opt.scale, opt.scale);
    g.userData = { bodyMat: bodyMat, headMat: headMat, torso: torso, headG: headG, armL: armL, armR: armR, legL: legL, legR: legR, armBase: armBase, crawl: !!opt.crawl };
    return g;
  }

  // ---------- 对象池：贴地投影（径向渐变 blob shadow，消除漂浮感） ----------
  var SHADOW_N = 48;
  var shadowPool = [];
  (function () {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g2 = c.getContext("2d");
    var grd = g2.createRadialGradient(64, 64, 6, 64, 64, 62);
    grd.addColorStop(0, "rgba(0,0,0,0.42)");
    grd.addColorStop(0.7, "rgba(0,0,0,0.16)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g2.fillStyle = grd;
    g2.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    var geo = new THREE.CircleGeometry(1, 16);
    var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    for (var i = 0; i < SHADOW_N; i++) {
      var m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      shadowPool.push({ mesh: m, used: false });
    }
  })();
  function allocShadow(scale) {
    for (var i = 0; i < SHADOW_N; i++) {
      if (!shadowPool[i].used) {
        shadowPool[i].used = true;
        shadowPool[i].mesh.scale.set(scale, scale, 1);
        shadowPool[i].mesh.visible = true;
        return shadowPool[i];
      }
    }
    return null;
  }
  function freeShadow(s) {
    if (!s) return;
    s.used = false; s.mesh.visible = false;
  }

  // 第三人称玩家身体：分件四肢 + 头盔面罩 + 双手持枪前指
  playerBody = makeHumanoid({ cloth: 0x50607a, skin: 0xd8b894, eyeMat: null, gun: true, helmetMat: PB_HELM_MAT, visor: true });
  playerBody.visible = false;
  scene.add(playerBody);
  pbUd = playerBody.userData;
  pbShadow = allocShadow(0.7);
  if (pbShadow) pbShadow.mesh.visible = false;

  // ---------- 补给箱 ----------
  var CRATE_STYLE = {
    weapon: { color: 0xf5a301, em: 0x8a5c00 },
    ammo: { color: 0xd9c25a, em: 0x6a5a10 },
    med: { color: 0x5fbf6e, em: 0x1d5a2a }
  };
  var crateGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);

  // ---------- 第一人称枪械视模（挂相机，画面右下，指向屏幕中心） ----------
  var GUN_BASE = { x: 0.26, y: -0.24, z: -0.42 };
  var gunRig = new THREE.Group(); // 所有枪模的容器（后座/换弹/摆动统一作用于它）
  gunRig.position.set(GUN_BASE.x, GUN_BASE.y, GUN_BASE.z);
  camera.add(gunRig);
  var muzzleLight = new THREE.PointLight(0xffc27a, 0, 14, 2); // 枪口火光
  muzzleLight.position.set(GUN_BASE.x, GUN_BASE.y + 0.06, GUN_BASE.z - 0.6);
  camera.add(muzzleLight);

  function gunMat(color, metal) {
    var mt = metal == null ? 0.35 : metal;
    return new THREE.MeshStandardMaterial({ color: color, roughness: Math.max(0.22, 0.55 - mt * 0.25), metalness: mt });
  }
  function bx(w, h, d, mat, x, y, z, rx) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    return m;
  }
  function cyl(r, len, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
    m.rotation.x = Math.PI / 2; // 指向 -Z
    m.position.set(x, y, z);
    return m;
  }
  function makeFlash() { // 枪口火光小平面
    var m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    m.visible = false;
    return m;
  }

  function buildGuns() {
    var guns = {};
    var g, st, bk, st2, wd, wh, accent;

    // M4 步枪：深金属双色 + 导轨 + 弧形弹匣 + 制退器（15 件）
    g = new THREE.Group();
    st = gunMat(0x2b2f36, 0.75); bk = gunMat(0x14161a, 0.6); st2 = gunMat(0x3a3f47, 0.7);
    g.add(bx(0.07, 0.09, 0.34, st, 0, 0, -0.05));             // 机匣
    g.add(bx(0.062, 0.07, 0.22, bk, 0, 0, -0.28));            // 护木
    g.add(bx(0.024, 0.018, 0.52, bk, 0, 0.055, -0.1));        // 顶部导轨
    g.add(cyl(0.013, 0.24, st2, 0, 0.008, -0.47));            // 枪管
    g.add(bx(0.03, 0.03, 0.07, bk, 0, 0.008, -0.6));          // 枪口制退器
    g.add(cyl(0.017, 0.02, bk, 0, 0.008, -0.645));            // 制退器端帽
    g.add(bx(0.014, 0.05, 0.014, bk, 0, 0.06, -0.44));        // 前准星
    g.add(bx(0.02, 0.032, 0.16, st, 0, 0.07, 0.02));          // 提把
    g.add(bx(0.016, 0.02, 0.05, bk, 0, 0.058, 0.13));         // 拉机柄
    g.add(bx(0.045, 0.12, 0.065, bk, 0, -0.1, -0.02, 0.18));  // 弹匣
    g.add(bx(0.047, 0.05, 0.06, bk, 0, -0.168, -0.005, 0.32));// 弹匣弧头
    g.add(bx(0.05, 0.07, 0.15, st, 0, -0.005, 0.22));         // 枪托
    g.add(bx(0.052, 0.08, 0.025, bk, 0, -0.005, 0.3));        // 托垫
    g.add(bx(0.04, 0.09, 0.05, bk, 0, -0.09, 0.1, 0.35));     // 握把
    g.add(bx(0.072, 0.03, 0.05, st2, 0, 0.01, -0.02));        // 抛壳窗亮面
    g.userData.muzzle = new THREE.Vector3(0, 0.008, -0.67);
    guns.rifle = g;

    // 霰弹枪：木钢双色 + 弹仓管 + 侧鞍弹壳（14 件）
    g = new THREE.Group();
    bk = gunMat(0x201d1a, 0.65); st = gunMat(0x35302a, 0.7); wd = gunMat(0x7a5230, 0.08);
    var shell = gunMat(0xa8342a, 0.3);
    g.add(bx(0.07, 0.09, 0.28, bk, 0, 0, -0.02));             // 机匣
    g.add(cyl(0.017, 0.36, st, 0, 0.02, -0.34));              // 枪管
    g.add(cyl(0.013, 0.3, st, 0, -0.025, -0.3));              // 下弹仓管
    g.add(cyl(0.021, 0.025, bk, 0, 0.02, -0.51));             // 枪口箍
    g.add(bx(0.06, 0.05, 0.14, wd, 0, -0.045, -0.26));        // 木泵动护木
    g.add(bx(0.062, 0.018, 0.1, bk, 0, -0.045, -0.26));       // 护木防滑纹
    g.add(bx(0.055, 0.085, 0.18, wd, 0, -0.02, 0.2));         // 木枪托
    g.add(bx(0.057, 0.09, 0.02, bk, 0, -0.02, 0.29));         // 托垫
    g.add(bx(0.04, 0.07, 0.05, wd, 0, -0.07, 0.08, 0.3));     // 握把
    g.add(bx(0.012, 0.03, 0.012, st, 0, 0.058, -0.5));        // 珠形准星
    g.add(bx(0.075, 0.03, 0.12, bk, 0, 0.035, 0.02));         // 侧鞍弹壳座
    for (var sh = 0; sh < 3; sh++) g.add(cyl(0.008, 0.05, shell, 0, 0.058, -0.015 + sh * 0.04)); // 红色弹壳 ×3
    g.add(bx(0.015, 0.02, 0.07, bk, 0, -0.062, 0.02));        // 扳机护圈
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.55);
    guns.shotgun = g;

    // 加特林：6 管组 + 双卡箍 + 弹鼓 + 发光电池（16 件）
    g = new THREE.Group();
    var gm = gunMat(0x3a4046, 0.7), dk = gunMat(0x26292e, 0.65);
    accent = new THREE.MeshStandardMaterial({ color: 0x1c3a44, emissive: 0x2ec8e8, emissiveIntensity: 0.8, roughness: 0.4 });
    g.add(bx(0.1, 0.12, 0.3, gm, 0, 0, -0.02));               // 机体
    g.add(bx(0.09, 0.1, 0.12, dk, 0, 0.01, 0.18));            // 后机匣
    for (var b6 = 0; b6 < 6; b6++) {                          // 6 管组（环形排布）
      var ba = b6 * Math.PI / 3;
      g.add(cyl(0.011, 0.4, dk, Math.cos(ba) * 0.028, 0.02 + Math.sin(ba) * 0.028, -0.4));
    }
    g.add(cyl(0.046, 0.03, gm, 0, 0.02, -0.52));              // 前卡箍
    g.add(cyl(0.046, 0.03, gm, 0, 0.02, -0.32));              // 后卡箍
    var drum = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), dk);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -0.1, 0.02);                          // 大弹鼓
    g.add(drum);
    var drumCap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.065, 12), gm);
    drumCap.rotation.z = Math.PI / 2;
    drumCap.position.set(0, -0.1, 0.02);                       // 弹鼓轴盖
    g.add(drumCap);
    g.add(bx(0.02, 0.05, 0.12, gm, 0, 0.1, 0));               // 提把
    g.add(bx(0.02, 0.045, 0.02, gm, 0, 0.075, -0.05));        // 提把前柱
    g.add(bx(0.02, 0.045, 0.02, gm, 0, 0.075, 0.05));         // 提把后柱
    g.add(bx(0.06, 0.07, 0.12, dk, 0, -0.02, 0.27));          // 后托
    g.add(bx(0.04, 0.08, 0.05, bk, 0, -0.1, 0.08, 0.3));      // 握把
    g.add(bx(0.102, 0.04, 0.1, accent, 0, -0.03, -0.05));     // 发光电池仓
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.62);
    guns.gatling = g;

    // 巴雷特：白黑科幻 + 制退器 + 双脚架 + 大瞄镜（16 件）
    g = new THREE.Group();
    wh = gunMat(0xe6e8ec, 0.35); bk = gunMat(0x22252b, 0.65); st2 = gunMat(0x3a3f47, 0.7);
    accent = new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x2288cc, emissiveIntensity: 0.9, roughness: 0.4 });
    g.add(bx(0.075, 0.1, 0.42, wh, 0, 0, -0.06));             // 机匣
    g.add(cyl(0.014, 0.52, bk, 0, 0.02, -0.52));              // 长枪管
    g.add(bx(0.05, 0.05, 0.1, bk, 0, 0.02, -0.76));           // 枪口制退器
    g.add(bx(0.056, 0.018, 0.03, st2, 0, 0.02, -0.74));       // 制退器侧窗
    g.add(cyl(0.02, 0.02, bk, 0, 0.02, -0.825));              // 制退器端帽
    g.add(cyl(0.032, 0.16, bk, 0, 0.095, -0.08));             // 瞄镜筒
    g.add(bx(0.02, 0.05, 0.02, bk, 0, 0.062, -0.14));         // 瞄镜前环
    g.add(bx(0.02, 0.05, 0.02, bk, 0, 0.062, -0.02));         // 瞄镜后环
    var lensF = new THREE.Mesh(new THREE.CircleGeometry(0.028, 14), accent);
    lensF.position.set(0, 0.095, -0.163); lensF.rotation.y = Math.PI;
    g.add(lensF);                                              // 前镜片（蓝）
    var lensR = new THREE.Mesh(new THREE.CircleGeometry(0.024, 14), accent);
    lensR.position.set(0, 0.095, 0.005);
    g.add(lensR);                                              // 后镜片
    var bpL = cyl(0.006, 0.16, bk, -0.045, -0.06, -0.56); bpL.rotation.x = 0.45; bpL.rotation.z = 0.3;
    g.add(bpL);                                                // 左架腿
    var bpR = cyl(0.006, 0.16, bk, 0.045, -0.06, -0.56); bpR.rotation.x = 0.45; bpR.rotation.z = -0.3;
    g.add(bpR);                                                // 右架腿
    g.add(bx(0.05, 0.08, 0.17, wh, 0, -0.02, 0.22));          // 枪托
    g.add(bx(0.05, 0.03, 0.1, bk, 0, 0.045, 0.2));            // 托腮板
    g.add(bx(0.045, 0.12, 0.06, bk, 0, -0.1, 0.02, 0.15));    // 弹匣
    g.add(bx(0.078, 0.02, 0.1, accent, 0, -0.045, -0.2));     // 蓝色侧贴条
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.85);
    guns.sniper = g;

    // 统一挂接：每把枪带一个枪口火光平面
    Object.keys(guns).forEach(function (key) {
      var grp = guns[key];
      var flash = makeFlash();
      flash.position.copy(grp.userData.muzzle);
      grp.add(flash);
      grp.visible = false;
      gunRig.add(grp);
      guns[key] = { group: grp, muzzle: grp.userData.muzzle, flash: flash, flashT: 0 };
    });
    return guns;
  }
  var guns = buildGuns();

  // ---------- 对象池：曳光弹 ----------
  var TRACER_N = 26;
  var tracers = [];
  (function () {
    var geo = new THREE.BoxGeometry(1, 1, 1);
    for (var i = 0; i < TRACER_N; i++) {
      var mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      var m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      tracers.push({ mesh: m, t: 0, life: 0.07 });
    }
  })();
  var tracerIdx = 0;
  var _tv = new THREE.Vector3();
  function spawnTracer(fx, fy, fz, tx, ty, tz, color, width) {
    var tr = tracers[tracerIdx]; tracerIdx = (tracerIdx + 1) % TRACER_N;
    var m = tr.mesh;
    _tv.set(tx - fx, ty - fy, tz - fz);
    var len = _tv.length();
    if (len < 0.01) return;
    m.position.set((fx + tx) / 2, (fy + ty) / 2, (fz + tz) / 2);
    m.scale.set(width, width, len);
    m.lookAt(tx, ty, tz);
    m.material.color.setHex(color);
    m.material.opacity = 0.85;
    m.visible = true;
    tr.t = tr.life;
  }

  // ---------- 对象池：粒子（绿血 / 感染绿雾 / 尘土 / 火花，单个 THREE.Points） ----------
  var PART_N = 320;
  var partPos = new Float32Array(PART_N * 3);
  var partCol = new Float32Array(PART_N * 3);
  var parts = [];
  (function () {
    for (var i = 0; i < PART_N; i++) {
      partPos[i * 3 + 1] = -999;
      parts.push({ vx: 0, vy: 0, vz: 0, t: 0, life: 1, grav: -9 });
    }
  })();
  var partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute("position", new THREE.BufferAttribute(partPos, 3));
  partGeo.setAttribute("color", new THREE.BufferAttribute(partCol, 3));
  var partPoints = new THREE.Points(partGeo, new THREE.PointsMaterial({
    size: 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false
  }));
  partPoints.frustumCulled = false;
  scene.add(partPoints);
  var partIdx = 0;
  var PART_COLORS = {
    blood: [0.22, 0.72, 0.2],   // 变异体绿血
    gas: [0.42, 0.78, 0.35],
    dust: [0.55, 0.53, 0.48],
    spark: [1.0, 0.85, 0.45],
    wind: [0.4, 0.85, 1.0]      // 风洞气流
  };
  function spawnParticle(x, y, z, kind, spread, up, grav, life) {
    var p = parts[partIdx], i3 = partIdx * 3;
    partIdx = (partIdx + 1) % PART_N;
    partPos[i3] = x; partPos[i3 + 1] = y; partPos[i3 + 2] = z;
    p.vx = rand(-spread, spread); p.vy = rand(up * 0.4, up); p.vz = rand(-spread, spread);
    p.grav = grav; p.t = p.life = life * rand(0.7, 1.3);
    var c = PART_COLORS[kind];
    partCol[i3] = c[0] * rand(0.8, 1.2); partCol[i3 + 1] = c[1] * rand(0.8, 1.2); partCol[i3 + 2] = c[2] * rand(0.8, 1.2);
  }
  function burst3(x, y, z, n, kind) {
    for (var k = 0; k < n; k++) {
      if (kind === "blood") spawnParticle(x, y, z, "blood", 2.4, 3.2, -9.8, 0.45);
      else if (kind === "gas") spawnParticle(x, y, z, "gas", 0.9, 1.8, 1.6, 1.1);
      else if (kind === "dust") spawnParticle(x, y, z, "dust", 1.4, 1.8, -6, 0.4);
      else if (kind === "wind") spawnParticle(x, y, z, "wind", 0.8, 5.0, 3.0, 0.8);
      else spawnParticle(x, y, z, "spark", 3.2, 2.4, -8, 0.16);
    }
  }

  // ---------- 对象池：地面血渍贴片（绿色） ----------
  var SPLAT_N = 48;
  var splats = [];
  (function () {
    var geo = new THREE.CircleGeometry(1, 12);
    for (var i = 0; i < SPLAT_N; i++) {
      var mat = new THREE.MeshBasicMaterial({ color: 0x2f7a1e, transparent: true, opacity: 0, depthWrite: false });
      var m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      splats.push({ mesh: m, t: 0, life: 14 });
    }
  })();
  var splatIdx = 0;
  function spawnSplat(x, z, r, y) {
    var sp = splats[splatIdx]; splatIdx = (splatIdx + 1) % SPLAT_N;
    sp.mesh.position.set(x, (y || 0) + 0.015, z);
    sp.mesh.scale.set(r, r, 1);
    sp.mesh.rotation.z = rand(0, 6.28);
    sp.mesh.material.opacity = 0.55;
    sp.mesh.visible = true;
    sp.t = sp.life;
  }

  // ---------- 对象池：飘字（HTML div 投影） ----------
  var FLOAT_N = 14;
  var floaters = [];
  (function () {
    for (var i = 0; i < FLOAT_N; i++) {
      var d = document.createElement("div");
      d.className = "tps-floater";
      stage.appendChild(d);
      floaters.push({ el: d, x: 0, y: 0, z: 0, t: 0, life: 1 });
    }
  })();
  var floatIdx = 0;
  function floatText(x, y, z, text, color, size) {
    var f = floaters[floatIdx]; floatIdx = (floatIdx + 1) % FLOAT_N;
    f.x = x; f.y = y; f.z = z; f.t = f.life = 0.95;
    f.el.textContent = text;
    f.el.style.color = color;
    f.el.style.fontSize = (size || 15) + "px";
    f.el.style.display = "block";
  }

  // ---------- 游戏状态 ----------
  var state = "menu"; // menu | playing | paused | intermission | gameover
  var resumeState = "playing";
  var player = null;
  var bots = [];
  var zombies = [];
  var elites = [];            // 精英变异体（LLM 驱动决策）
  var crates = [];
  var wave = 0, score = 0, best = 0, bestWave = 0;
  var spawnQueue = [], spawnT = 0, interT = 0;
  var time = 0, missionT = 0, zidSeq = 0;
  var keys = {};
  var firing = false, jumpQueued = false;
  var yaw = 0, pitch = 0;       // FPS：yaw=0 → 面向 -Z
  var hadLock = false;
  var shakeAmp = 0, shakeT = 0, shakeDur = 1;
  var hurtFlash = 0;
  var bannerT = 0, bannerDur = 1;
  var viewW = 960, viewH = 540;
  var bobPhase = 0, landDip = 0, recoilOff = 0, gunKick = 0, swapT = 0;
  var fovKick = 0;              // 风洞大跳 FOV 冲击
  var multiN = 0, multiT = 0;   // 连杀窗口
  var crossHeat = 0;            // 准星扩散
  // 单档存档：历史最佳分数 + 最远波次（永远从第 1 波开打，不提供选关）
  try {
    var _sv = localStorage.getItem("tpsSave");
    if (_sv) {
      var _sp = JSON.parse(_sv);
      best = parseInt(_sp && _sp.score, 10) || 0;
      bestWave = parseInt(_sp && _sp.wave, 10) || 0;
    } else {
      best = parseInt(localStorage.getItem("tpsBest") || "0", 10) || 0; // 迁移旧分数档
    }
  } catch (e) {}
  function persistSave() {
    try { localStorage.setItem("tpsSave", JSON.stringify({ score: best, wave: bestWave })); } catch (e) {}
  }
  function syncRecord() {
    if (!el.record) return;
    el.record.textContent = (bestWave > 0 || best > 0) ? "📜 历史最佳：最远第 " + bestWave + " 波 · " + best + " 分" : "";
  }
  syncRecord();

  var botMeshes = [];
  function makeBot(x, z, y) {
    var mesh = makeHumanoid({ cloth: 0x51663c, skin: 0xd9c8a8, eyeMat: null, gun: true, helmetMat: BOT_HELM_MAT });
    mesh.position.set(x, y || 0, z);
    scene.add(mesh);
    botMeshes.push(mesh);
    return { x: x, z: z, y: y || 0, vy: 0, r: 0.42, cool: rand(0, 0.5), infected: false, infectT: 0, wob: rand(0, 6.28), mesh: mesh, ud: mesh.userData, shadow: allocShadow(0.7) };
  }

  function makeZombie(type, x, z, y) {
    var s = ZT[type];
    var crawl = type === "walker" && Math.random() < 0.3; // 部分 walker 爬行（照页游变异体）
    var brute = type === "brute";
    var mesh = makeHumanoid({
      cloth: brute ? 0x6a3a44 : ZCLOTH[(Math.random() * ZCLOTH.length) | 0],
      skin: brute ? 0xc09aa2 : ZSKINS[(Math.random() * ZSKINS.length) | 0],
      eyeMat: ZEYE_MAT, armsForward: true,
      hunch: type === "walker" ? 0.32 : type === "runner" ? 0.18 : 0.12,
      crawl: crawl, brute: brute,
      scale: brute ? 1.4 : 1
    });
    y = y || 0;
    mesh.position.set(x, y, z);
    scene.add(mesh);
    var hp = Math.round(s.hp * (1 + (wave - 1) * 0.07));
    return {
      id: ++zidSeq, type: type, crawl: crawl, x: x, z: z, y: y, vy: 0,
      r: s.r, h: crawl ? 0.9 : s.h,
      hp: hp, maxHp: hp, speed: s.speed * (1 + (wave - 1) * 0.02),
      dmg: s.dmg, score: s.score, cool: 0, hitT: 0, hasteT: 0,
      kvx: 0, kvz: 0, wob: rand(0, 6.28), mesh: mesh, ud: mesh.userData, lastHitBy: "player",
      bodyMat: mesh.userData.bodyMat, headMat: mesh.userData.headMat,
      shadow: allocShadow(brute ? 1.15 : 0.72)
    };
  }

  function removeZombieAt(i) {
    var z = zombies[i];
    scene.remove(z.mesh);
    z.bodyMat.dispose(); z.headMat.dispose();
    freeShadow(z.shadow);
    zombies.splice(i, 1);
  }

  function dropCrate(kind, x, z, wkey) {
    var st = CRATE_STYLE[kind];
    var mat = new THREE.MeshStandardMaterial({ color: st.color, emissive: st.em, emissiveIntensity: 0.9, roughness: 0.4 });
    var m = new THREE.Mesh(crateGeo, mat);
    x = clamp(x, -BOUND + 1, BOUND - 1); z = clamp(z, -BOUND + 1, BOUND - 1);
    var cy = groundHeight(x, z, 99); // 落到所在表面（含高台/斜坡）
    m.position.set(x, cy + 0.55, z);
    scene.add(m);
    crates.push({ kind: kind, w: wkey || null, x: x, z: z, y: cy, ph: rand(0, 6.28), mesh: m, mat: mat });
  }
  // 找一块不在障碍/高台内部的地面点（重试 8 次，兜底中路）
  function groundSpot(x, z) {
    for (var i = 0; i < 8; i++) {
      var sx = clamp(x + rand(-3, 3), -BOUND + 1, BOUND - 1);
      var sz = clamp(z + rand(-3, 3), -BOUND + 1, BOUND - 1);
      if (!pointInSolid(sx, sz)) return { x: sx, z: sz };
    }
    return { x: 0, z: -8 };
  }
  function removeCrateAt(i) {
    scene.remove(crates[i].mesh);
    crates[i].mat.dispose();
    crates.splice(i, 1);
  }

  // ---------- 击杀信息 / 奖牌 ----------
  function feed(html, green) {
    var d = document.createElement("div");
    d.className = "tps-feed__item" + (green ? " tps-feed--green" : "");
    d.innerHTML = html;
    el.feed.insertBefore(d, el.feed.firstChild);
    while (el.feed.children.length > 5) el.feed.removeChild(el.feed.lastChild);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 4100);
  }
  var MULTI_TEXT = ["击 杀", "双 杀", "三连杀", "四连杀", "五连杀", "超 神！"];
  function medal(text, gold) {
    el.medal.textContent = text;
    el.medal.classList.toggle("gold", !!gold);
    el.medal.classList.remove("show");
    void el.medal.offsetWidth; // 重触发动画
    el.medal.classList.add("show");
  }

  // ---------- 武器库存 / 切换 ----------
  function saveAmmo() {
    if (player.inv[player.weapon]) {
      player.inv[player.weapon].mag = player.mag;
      player.inv[player.weapon].reserve = player.reserve;
    }
  }
  function updateGunVisibility() {
    for (var k in guns) guns[k].group.visible = (k === player.weapon);
  }
  var slotEls = {};
  function buildSlots() {
    SLOT_KEYS.forEach(function (key, i) {
      var d = document.createElement("div");
      d.className = "tps-slot";
      d.innerHTML = "<em>" + (i + 1) + "</em>" + WEAPONS[key].icon;
      el.slots.appendChild(d);
      slotEls[key] = d;
    });
  }
  function updateSlots() {
    SLOT_KEYS.forEach(function (key) {
      slotEls[key].classList.toggle("owned", !!player.inv[key]);
      slotEls[key].classList.toggle("active", player.weapon === key);
    });
  }
  function switchWeapon(key, force) {
    if (!WEAPONS[key] || !player.inv[key] || key === player.weapon) return;
    if (player.reloadT > 0 && !force) return;
    saveAmmo();
    player.weapon = key;
    var st = player.inv[key];
    player.mag = st.mag;
    player.reserve = st.reserve;
    player.magSize = WEAPONS[key].magSize;
    player.reloadT = 0;
    player.spinT = 0;
    player.cool = Math.max(player.cool, 0.2);
    swapT = 0.26; // 收枪-抬枪动画
    updateGunVisibility();
    updateSlots();
    sSwap();
  }
  function grantWeapon(key) {
    var wp = WEAPONS[key];
    if (!wp || key === "rifle") return;
    player.inv[key] = { mag: wp.magSize, reserve: wp.ammo }; // 新枪满弹，已有则补满
    floatText(player.x, player.y + 1.9, player.z, "获得 " + wp.name + "！", "#f5a301", 19);
    setMsg("捡到 " + wp.icon + " " + wp.name + "！子弹打光后自动切回步枪。");
    feed("✦ <b>你</b> 拾取了 " + wp.name, true);
    sWeapon();
    switchWeapon(key, true);
  }
  function revertToRifle() {
    floatText(player.x, player.y + 1.9, player.z, "切回步枪", "#cfe8ff", 15);
    setMsg("重武器弹尽，切回步枪。");
    switchWeapon("rifle", true);
  }
  function startReload() {
    if (player.reloadT > 0 || player.mag >= player.magSize || player.reserve <= 0) return;
    player.reloadT = WEAPONS[player.weapon].reload;
    sReload();
    setMsg("换弹中…");
  }

  // ---------- 碰撞 / 跳跃地形 ----------
  function pushOut(e, minX, maxX, minZ, maxZ) {
    var nx = clamp(e.x, minX, maxX), nz = clamp(e.z, minZ, maxZ);
    var dx = e.x - nx, dz = e.z - nz;
    var d2 = dx * dx + dz * dz;
    if (d2 >= e.r * e.r) return;
    var d = Math.sqrt(d2) || 0.01;
    var push = e.r - d;
    e.x += (dx / d) * push;
    e.z += (dz / d) * push;
  }
  // 统一规则：表面高度 ≤ feetY+STEP_H 可行走/不挡，否则视为墙体推出
  function collideWorld(e, feetY) {
    var k;
    for (k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      if (o.h <= feetY + STEP_H) continue; // 矮障碍可站上/跳过
      pushOut(e, o.minX, o.maxX, o.minZ, o.maxZ);
    }
    for (k = 0; k < platforms.length; k++) {
      var p = platforms[k];
      if (p.top <= feetY + STEP_H) continue;
      pushOut(e, p.minX, p.maxX, p.minZ, p.maxZ);
    }
    for (k = 0; k < ramps.length; k++) {
      var rm = ramps[k];
      if (rampLocalH(rm, e.x, e.z) <= feetY + STEP_H) continue;
      pushOut(e, rm.minX, rm.maxX, rm.minZ, rm.maxZ);
    }
    e.x = clamp(e.x, -BOUND + e.r, BOUND - e.r);
    e.z = clamp(e.z, -BOUND + e.r, BOUND - e.r);
  }
  function groundHeight(x, z, feetY) {
    var h = 0, k, hh;
    for (k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      if (o.h <= h || o.h > feetY + STEP_H) continue;
      if (x >= o.minX - 0.15 && x <= o.maxX + 0.15 && z >= o.minZ - 0.15 && z <= o.maxZ + 0.15) h = o.h;
    }
    for (k = 0; k < platforms.length; k++) {
      var p = platforms[k];
      if (p.top <= h || p.top > feetY + STEP_H) continue;
      if (x >= p.minX - 0.15 && x <= p.maxX + 0.15 && z >= p.minZ - 0.15 && z <= p.maxZ + 0.15) h = p.top;
    }
    for (k = 0; k < ramps.length; k++) {
      var rm = ramps[k];
      if (x >= rm.minX && x <= rm.maxX && z >= rm.minZ && z <= rm.maxZ) {
        hh = rampLocalH(rm, x, z);
        if (hh > h && hh <= feetY + STEP_H) h = hh;
      }
    }
    return h;
  }
  //  footprint 检测：刷怪 / 补给避开障碍与高台内部
  function pointInSolid(x, z) {
    var k;
    for (k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      if (x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ) return true;
    }
    for (k = 0; k < platforms.length; k++) {
      var p = platforms[k];
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return true;
    }
    return false;
  }
  // 僵尸 / 队友竖直跟随：贴上可行走表面，悬空则受重力跌落
  function updateVertical(e, dt) {
    var gh = groundHeight(e.x, e.z, e.y);
    if (e.y > gh + 0.001) {
      e.vy -= GRAV * dt;
      e.y += e.vy * dt;
      if (e.y <= gh) { e.y = gh; e.vy = 0; }
    } else {
      e.y = gh;
      if (e.vy < 0) e.vy = 0;
    }
  }

  // ---------- 弹道数学 ----------
  function rayBox(ox, oy, oz, idx, idy, idz, b) {
    var t1 = (b.minX - ox) * idx, t2 = (b.maxX - ox) * idx;
    var tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
    t1 = (b.minY - oy) * idy; t2 = (b.maxY - oy) * idy;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (b.minZ - oz) * idz; t2 = (b.maxZ - oz) * idz;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax < 0 || tmin > tmax) return Infinity;
    return tmin > 0 ? tmin : 0;
  }
  // 场景几何（墙 + 障碍 + 高台 + 斜坡 + 地面 + 天花板）对射线的截断
  function worldRayLimit(ox, oy, oz, dx, dy, dz, maxT) {
    var idx = 1 / (dx || 1e-9), idy = 1 / (dy || 1e-9), idz = 1 / (dz || 1e-9);
    var t = maxT, k, h;
    for (k = 0; k < raySolids.length; k++) {
      h = rayBox(ox, oy, oz, idx, idy, idz, raySolids[k]);
      if (h < t) t = h;
    }
    if (dy < -1e-6) { h = -oy / dy; if (h > 0 && h < t) t = h; }          // 地面
    else if (dy > 1e-6) { h = (CEIL_H - oy) / dy; if (h > 0 && h < t) t = h; } // 天花板
    return t;
  }
  // 射线 vs 僵尸竖直圆柱（线段最近距离），命中返回 t，否则 -1
  function rayZombie(ox, oy, oz, dx, dy, dz, maxT, z) {
    var d1x = dx * maxT, d1y = dy * maxT, d1z = dz * maxT;
    var d2y = z.h;
    var rx = ox - z.x, ry = oy - z.y, rz = oz - z.z;
    var a = d1x * d1x + d1y * d1y + d1z * d1z;
    var e = d2y * d2y;
    var f = d2y * ry;
    var c = d1x * rx + d1y * ry + d1z * rz;
    var b = d1y * d2y;
    var denom = a * e - b * b;
    var s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
    var t2 = e > 1e-9 ? (b * s + f) / e : 0;
    if (t2 < 0) { t2 = 0; s = clamp(-c / a, 0, 1); }
    else if (t2 > 1) { t2 = 1; s = clamp((b - c) / a, 0, 1); }
    var px = ox + d1x * s - z.x;
    var py = oy + d1y * s - (z.y + d2y * t2);
    var pz = oz + d1z * s - z.z;
    var rr = z.r + 0.12;
    if (px * px + py * py + pz * pz <= rr * rr) return s * maxT;
    return -1;
  }

  // ---------- 战斗 ----------
  var hitArr = [];
  (function () { for (var i = 0; i < 48; i++) hitArr.push({ z: null, t: 0 }); })();

  function addShake(amp, dur) { shakeAmp = amp; shakeT = dur; shakeDur = dur; }

  function damagePlayer(dmg) {
    if (state === "gameover") return;
    player.hp -= dmg;
    hurtFlash = 0.45;
    addShake(0.22, 0.18);
    sHurt();
    if (player.hp <= 0) { player.hp = 0; gameOver(); }
  }

  function killZombie(i) {
    var z = zombies[i];
    score += z.score;
    floatText(z.x, z.y + z.h + 0.25, z.z, "+" + z.score, z.type === "brute" ? "#f5a301" : "#7be06a", z.type === "brute" ? 22 : 15);
    spawnSplat(z.x, z.z, z.r * 1.7, z.y);
    burst3(z.x, z.y + Math.max(0.5, z.h * 0.55), z.z, 10, "blood");
    sDie();
    if (z.lastHitBy === "player") {
      multiN++; multiT = 3;
      if (z.type === "brute") medal("☣ 击杀母体", true);
      else medal(MULTI_TEXT[Math.min(multiN, 6) - 1], multiN >= 4);
      feed("☠ <b>你</b> 击毙了 " + ZT[z.type].label + " +" + z.score);
    } else {
      feed("☠ 队友 击毙了 " + ZT[z.type].label, true);
    }
    if (z.type === "brute") dropCrate("weapon", z.x, z.z, pickWeapon()); // 母体必掉重武器
    else {
      var r = Math.random();
      if (r < 0.04) dropCrate("weapon", z.x, z.z, pickWeapon());
      else if (r < 0.16) dropCrate("ammo", z.x, z.z);
    }
    removeZombieAt(i);
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
    // 第一人称反馈：视角上跳 + 枪身后座 + 准星扩散 + 枪口火光
    recoilOff = Math.min(0.09, recoilOff + wp.recoil);
    gunKick = Math.min(1.6, gunKick + wp.kick * 0.55);
    crossHeat = Math.min(1, crossHeat + 0.3);
    var curGun = guns[player.weapon];
    curGun.flashT = 0.05;
    curGun.flash.visible = true;
    curGun.flash.material.opacity = 0.95;
    curGun.flash.rotation.z = rand(0, 6.28);
    var fsc = rand(0.8, 1.5);
    curGun.flash.scale.set(fsc, fsc, 1);
    muzzleLight.intensity = 2.4;
    // 基准方向（forward = (-sin·cos, sin, -cos·cos)）与正交基
    var sy = Math.sin(yaw), cy = Math.cos(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var bdx = -sy * cp, bdy = sp, bdz = -cy * cp;
    var ux = cy, uz = -sy;                    // 右
    var vx = sy * sp, vy = cp, vz = cy * sp;  // 上
    var ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
    // 曳光起点（解析枪口：视线前方偏右下）
    var mfx = ox + bdx * 0.7 + ux * 0.22;
    var mfy = oy + bdy * 0.7 - 0.16;
    var mfz = oz + bdz * 0.7 + uz * 0.22;

    for (var pe = 0; pe < wp.pellets; pe++) {
      var s1 = rand(-wp.spread, wp.spread), s2 = rand(-wp.spread, wp.spread);
      var dx = bdx + ux * s1 + vx * s2;
      var dy = bdy + vy * s2;
      var dz = bdz + uz * s1 + vz * s2;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      var maxT = worldRayLimit(ox, oy, oz, dx, dy, dz, wp.range);
      var hitsN = 0, k;
      for (k = 0; k < zombies.length; k++) {
        var t = rayZombie(ox, oy, oz, dx, dy, dz, maxT, zombies[k]);
        if (t >= 0 && t <= maxT && hitsN < hitArr.length) {
          hitArr[hitsN].z = zombies[k]; hitArr[hitsN].t = t; hitsN++;
        }
      }
      for (k = 0; k < elites.length; k++) {
        t = rayZombie(ox, oy, oz, dx, dy, dz, maxT, elites[k]);
        if (t >= 0 && t <= maxT && hitsN < hitArr.length) {
          hitArr[hitsN].z = elites[k]; hitArr[hitsN].t = t; hitsN++;
        }
      }
      // 仅对前 hitsN 个命中做插入排序（不截断预分配池）
      for (var s3 = 1; s3 < hitsN; s3++) {
        var tmpH = hitArr[s3], s4 = s3 - 1;
        while (s4 >= 0 && hitArr[s4].t > tmpH.t) { hitArr[s4 + 1] = hitArr[s4]; s4--; }
        hitArr[s4 + 1] = tmpH;
      }
      var maxTargets = 1 + (wp.pierce || 0);
      for (k = 0; k < hitsN && k < maxTargets; k++) {
        var hz = hitArr[k].z;
        hz.hp -= wp.dmg;
        hz.hitT = 0.12;
        hz.lastHitBy = "player";
        hz.kvx += dx * wp.knock;
        hz.kvz += dz * wp.knock;
      }
      var endT;
      if (hitsN > 0) {
        endT = hitArr[0].t;
        burst3(ox + dx * endT, oy + dy * endT, oz + dz * endT, 4, "blood");
        sHit();
      } else {
        endT = maxT;
        if (maxT < wp.range - 0.01) burst3(ox + dx * endT, Math.max(0.05, oy + dy * endT), oz + dz * endT, 3, "dust");
      }
      spawnTracer(mfx, mfy, mfz, ox + dx * endT, oy + dy * endT, oz + dz * endT, wp.color, wp.tracer);
    }
    if (player.weapon === "shotgun") { sShotgun(); addShake(0.13, 0.1); }
    else if (player.weapon === "gatling") sGatling();
    else if (player.weapon === "sniper") { sSniper(); addShake(0.3, 0.16); }
    else sShot();
    // 重武器最后一颗子弹出膛后切回步枪
    if (player.mag <= 0 && player.reserve <= 0 && player.weapon !== "rifle") revertToRifle();
  }

  function botShoot(bot, tz) {
    var ox = bot.x, oy = bot.y + 1.2, oz = bot.z;
    var dx = tz.x - ox + rand(-0.25, 0.25);
    var dy = (tz.y + tz.h * 0.55) - oy + rand(-0.12, 0.12);
    var dz = tz.z - oz + rand(-0.25, 0.25);
    var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    var maxT = worldRayLimit(ox, oy, oz, dx, dy, dz, 40);
    var bestT = Infinity, bestZ = null;
    for (var k = 0; k < zombies.length; k++) {
      var t = rayZombie(ox, oy, oz, dx, dy, dz, maxT, zombies[k]);
      if (t >= 0 && t < bestT) { bestT = t; bestZ = zombies[k]; }
    }
    for (k = 0; k < elites.length; k++) {
      t = rayZombie(ox, oy, oz, dx, dy, dz, maxT, elites[k]);
      if (t >= 0 && t < bestT) { bestT = t; bestZ = elites[k]; }
    }
    var endT = maxT;
    if (bestZ) {
      bestZ.hp -= 9;
      bestZ.hitT = 0.12;
      bestZ.lastHitBy = "bot";
      bestZ.kvx += dx * 1.2;
      bestZ.kvz += dz * 1.2;
      endT = bestT;
      burst3(ox + dx * endT, oy + dy * endT, oz + dz * endT, 3, "blood");
    }
    spawnTracer(ox, oy, oz, ox + dx * endT, oy + dy * endT, oz + dz * endT, 0xcfe8ff, 0.025);
    sBotShot();
  }

  function nearestHuman(x, z) {
    var bestD = dist2d(x, z, player.x, player.z), res = player;
    for (var k = 0; k < bots.length; k++) {
      if (bots[k].infected) continue;
      var d = dist2d(x, z, bots[k].x, bots[k].z);
      if (d < bestD) { bestD = d; res = bots[k]; }
    }
    return res;
  }

  function nearestZombie(x, z, maxD) {
    var bestD = maxD, res = null, k, d;
    for (k = 0; k < zombies.length; k++) {
      d = dist2d(x, z, zombies[k].x, zombies[k].z);
      if (d < bestD) { bestD = d; res = zombies[k]; }
    }
    for (k = 0; k < elites.length; k++) { // 精英同样是队友的射击目标
      d = dist2d(x, z, elites[k].x, elites[k].z);
      if (d < bestD) { bestD = d; res = elites[k]; }
    }
    return res;
  }

  // ---------- 精英变异体（DeepSeek LLM 决策 + 本地兜底） ----------
  // 数值：慢速高威胁，HP ≈ 28 发 M4；技能由代码执行，LLM 只做选择，冷却客户端强制执行
  var ELITE_HP = 340, ELITE_SPEED = 1.3, ELITE_DMG = 25, ELITE_SCORE = 500;
  var ELITE_WINDUP = { slam: 1.0, charge: 0.7, spit: 0.8, roar: 0.8, summon: 1.0 };
  var ELITE_ACTIONS = ["stalk", "charge", "spit", "roar", "slam", "summon"];
  var eliteThinkT = 4, eliteInFlight = false, eliteAbort = null, eliteLastOrders = [], eliteAiDisabled = false;

  // 瘟疫吐息弹丸池
  var SPIT_N = 10;
  var spits = [];
  (function () {
    var geo = new THREE.SphereGeometry(0.17, 8, 6);
    var mat = new THREE.MeshBasicMaterial({ color: 0xa8e84a });
    for (var i = 0; i < SPIT_N; i++) {
      var m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      spits.push({ mesh: m, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    }
  })();
  var spitIdx = 0;
  function fireSpit(x0, y0, z0, tx, ty, tz) { // 3D 抛物线，可打到高台
    var s = spits[spitIdx]; spitIdx = (spitIdx + 1) % SPIT_N;
    var dx = tx - x0, dy = ty - y0, dz = tz - z0;
    var T = clamp(Math.hypot(dx, dz) / 11, 0.6, 1.5);
    var G = 9.8;
    s.x = x0; s.y = y0; s.z = z0;
    s.vx = dx / T; s.vz = dz / T; s.vy = (dy + 0.5 * G * T * T) / T;
    s.t = 3.2;
    s.mesh.visible = true;
  }
  function updateSpits(dt) {
    for (var i = 0; i < SPIT_N; i++) {
      var s = spits[i];
      if (s.t <= 0) continue;
      s.t -= dt;
      s.vy -= 9.8 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      var pdx = s.x - player.x, pdy = s.y - (player.y + 1.1), pdz = s.z - player.z;
      var hit = (pdx * pdx + pdy * pdy + pdz * pdz < 0.8) || s.t <= 0;
      var gh = groundHeight(s.x, s.z, s.y);
      if (s.y <= gh + 0.1) { s.y = gh; hit = true; }
      if (hit) {
        burst3(s.x, s.y + 0.2, s.z, 10, "gas");
        spawnSplat(s.x, s.z, 1.3, s.y);
        if (player.hp > 0 && dist2d(s.x, s.z, player.x, player.z) < 2.5 && Math.abs(player.y - s.y) < 1.8) {
          damagePlayer(20);
          setMsg("被瘟疫吐息溅射！");
        }
        s.t = 0; s.mesh.visible = false;
      } else {
        s.mesh.position.set(s.x, s.y, s.z);
      }
    }
  }

  function makeElite(x, z) {
    var mesh = makeHumanoid({ cloth: 0x4a1a22, skin: 0x7a5560, eyeMat: ELEYE_MAT, armsForward: true, hunch: 0.1, scale: 1.7 });
    mesh.position.set(x, 0, z);
    var torso = mesh.userData.torso;
    var padL = new THREE.Mesh(GEO.pad, ARMOR_MAT); padL.position.set(-0.3, 0.72, 0); torso.add(padL); // 肩甲
    var padR = new THREE.Mesh(GEO.pad, ARMOR_MAT); padR.position.set(0.3, 0.72, 0); torso.add(padR);
    var headG = mesh.userData.headG;
    var hornL = new THREE.Mesh(GEO.horn, ARMOR_MAT); hornL.position.set(-0.09, 0.24, 0); hornL.rotation.z = 0.35; headG.add(hornL); // 头角
    var hornR = new THREE.Mesh(GEO.horn, ARMOR_MAT); hornR.position.set(0.09, 0.24, 0); hornR.rotation.z = -0.35; headG.add(hornR);
    var coreMat = new THREE.MeshStandardMaterial({ color: 0x2a0a10, emissive: 0xff3a2a, emissiveIntensity: 0.9, roughness: 0.4 });
    var core = new THREE.Mesh(GEO.core, coreMat);
    core.position.set(0, 0.42, 0.2); // 胸前大发光核心
    torso.add(core);
    scene.add(mesh);
    return {
      id: ++zidSeq, x: x, z: z, y: 0, vy: 0, r: 0.66, h: 2.95,
      hp: ELITE_HP, maxHp: ELITE_HP, speed: ELITE_SPEED, dmg: ELITE_DMG, score: ELITE_SCORE,
      mode: "stalk", modeT: 0, pending: "", tx: x, tz: z,
      cdSlam: 0, cdCharge: 0, cdSpit: 0, cdRoar: 0, cdSummon: 0, atkT: 0,
      chargeDx: 0, chargeDz: 0, chargeLeft: 0,
      kvx: 0, kvz: 0, wob: rand(0, 6.28), hitT: 0, lastHitBy: "player",
      mesh: mesh, ud: mesh.userData, coreMat: coreMat,
      bodyMat: mesh.userData.bodyMat, headMat: mesh.userData.headMat,
      shadow: allocShadow(1.2)
    };
  }

  function spawnElite() {
    var x = 0, z = -BOUND + 2.5, ok = false;
    for (var tries = 0; tries < 10 && !ok; tries++) {
      var side = Math.floor(rand(0, 4)), m = 2.5;
      if (side === 0) { x = rand(-BOUND + m, BOUND - m); z = -BOUND + m; }
      else if (side === 1) { x = rand(-BOUND + m, BOUND - m); z = BOUND - m; }
      else if (side === 2) { x = -BOUND + m; z = rand(-BOUND + m, BOUND - m); }
      else { x = BOUND - m; z = rand(-BOUND + m, BOUND - m); }
      ok = !pointInSolid(x, z) && dist2d(x, z, player.x, player.z) > 12;
    }
    var e = makeElite(x, z);
    e.tx = player.x; e.tz = player.z;
    elites.push(e);
    sRoar();
    floatText(x, 3.6, z, "⚔ 精英变异体", "#ff8a2a", 22);
  }

  function killElite(i) {
    var e = elites[i];
    score += e.score;
    floatText(e.x, e.y + e.h + 0.3, e.z, "+" + e.score, "#ff8a2a", 22);
    burst3(e.x, e.y + 1.6, e.z, 16, "blood");
    spawnSplat(e.x, e.z, e.r * 1.8, e.y);
    sDie();
    if (e.lastHitBy === "player") {
      medal("⚔ 击杀精英", true);
      feed("☠ <b>你</b> 击毙了 精英变异体 +" + e.score);
    } else {
      feed("☠ 队友 击毙了 精英变异体", true);
    }
    dropCrate("weapon", e.x, e.z, pickWeapon()); // 必掉重武器
    scene.remove(e.mesh);
    e.bodyMat.dispose(); e.headMat.dispose(); e.coreMat.dispose();
    freeShadow(e.shadow);
    elites.splice(i, 1);
  }

  // 指令落地：stalk 直接改目标；技能进 windup 前摇（冷却不信任模型，强制校验）
  function issueOrder(e, action, tx, tz, say) {
    if (e.hp <= 0) return;
    if (say) floatText(e.x, e.y + e.h + 0.3, e.z, String(say).slice(0, 24), "#ff9a5a", 14);
    e.tx = clamp(typeof tx === "number" ? tx : player.x, -BOUND + 1, BOUND - 1);
    e.tz = clamp(typeof tz === "number" ? tz : player.z, -BOUND + 1, BOUND - 1);
    if (e.mode !== "stalk" && e.mode !== "recover") return;
    if (action === "stalk") { e.mode = "stalk"; return; }
    if (ELITE_ACTIONS.indexOf(action) < 0 || !ELITE_WINDUP[action]) return;
    if (action === "slam" && e.cdSlam > 0) return;
    if (action === "charge" && e.cdCharge > 0) return;
    if (action === "spit" && e.cdSpit > 0) return;
    if (action === "roar" && e.cdRoar > 0) return;
    if (action === "summon" && e.cdSummon > 0) return;
    e.pending = action;
    e.mode = "windup";
    e.modeT = ELITE_WINDUP[action];
    sWindup();
  }

  function execEliteSkill(e) {
    var act = e.pending, k;
    e.pending = "";
    if (act === "slam") { // 重力震击：4m AOE 30 伤 + 击退
      e.cdSlam = 8; e.mode = "recover"; e.modeT = 0.9;
      sSlam(); addShake(0.4, 0.35);
      for (k = 0; k < 14; k++) {
        var a = k / 14 * 6.2832;
        spawnParticle(e.x + Math.cos(a) * 2.2, 0.25, e.z + Math.sin(a) * 2.2, "dust", 1.6, 2.6, -7, 0.5);
      }
      if (player.hp > 0 && dist2d(e.x, e.z, player.x, player.z) < 4 && Math.abs(player.y - e.y) < 1.6) {
        damagePlayer(30);
        var nx = player.x - e.x, nz = player.z - e.z, nl = Math.hypot(nx, nz) || 1;
        player.x += nx / nl * 2.4; player.z += nz / nl * 2.4;
        collideWorld(player, player.y);
        setMsg("被重力震击掀飞！");
      }
      for (k = 0; k < bots.length; k++) {
        var b = bots[k];
        if (b.infected) continue;
        if (dist2d(e.x, e.z, b.x, b.z) < 4 && Math.abs(b.y - e.y) < 1.6) {
          var bx2 = b.x - e.x, bz2 = b.z - e.z, bl = Math.hypot(bx2, bz2) || 1;
          b.x += bx2 / bl * 1.8; b.z += bz2 / bl * 1.8;
        }
      }
    } else if (act === "charge") { // 狂暴冲刺：8m/s 直线冲撞
      e.cdCharge = 9;
      var cx = e.tx - e.x, cz = e.tz - e.z, cl = Math.hypot(cx, cz) || 1;
      e.chargeDx = cx / cl; e.chargeDz = cz / cl;
      e.chargeLeft = Math.min(cl + 2, 20);
      e.mode = "charge";
      sCharge();
    } else if (act === "spit") { // 瘟疫吐息：抛物线弹，瞄玩家实时高度
      e.cdSpit = 6; e.mode = "recover"; e.modeT = 0.7;
      fireSpit(e.x, e.y + 2.2, e.z, e.tx, player.y + 1.0, e.tz);
      sSpit();
    } else if (act === "roar") { // 恐惧咆哮：14m 内尸群 +40% 移速 6s
      e.cdRoar = 12; e.mode = "recover"; e.modeT = 0.8;
      sRoar();
      burst3(e.x, e.y + 2.4, e.z, 12, "gas");
      for (k = 0; k < zombies.length; k++) {
        if (dist2d(e.x, e.z, zombies[k].x, zombies[k].z) < 14) zombies[k].hasteT = 6;
      }
      setMsg("精英咆哮，尸群狂暴加速！");
    } else if (act === "summon") { // 召唤：身边孵化 2~3 只普通僵尸
      e.cdSummon = 14; e.mode = "recover"; e.modeT = 0.9;
      sInfect();
      var n = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (k = 0; k < n && zombies.length < ZOMBIE_CAP; k++) {
        var sx = clamp(e.x + rand(-2.5, 2.5), -BOUND + 1, BOUND - 1);
        var sz = clamp(e.z + rand(-2.5, 2.5), -BOUND + 1, BOUND - 1);
        if (pointInSolid(sx, sz)) { sx = e.x; sz = e.z; }
        zombies.push(makeZombie(Math.random() < 0.3 ? "runner" : "walker", sx, sz, 0));
        burst3(sx, 0.8, sz, 8, "gas");
      }
      setMsg("精英召唤了援军！");
    } else {
      e.mode = "stalk";
    }
  }

  function updateElites(dt) {
    for (var i = elites.length - 1; i >= 0; i--) {
      var e = elites[i];
      if (e.hp <= 0) { killElite(i); continue; }
      if (e.cdSlam > 0) e.cdSlam -= dt;
      if (e.cdCharge > 0) e.cdCharge -= dt;
      if (e.cdSpit > 0) e.cdSpit -= dt;
      if (e.cdRoar > 0) e.cdRoar -= dt;
      if (e.cdSummon > 0) e.cdSummon -= dt;
      e.atkT -= dt; e.hitT -= dt;
      e.wob += dt * (e.mode === "charge" ? 14 : 4);
      // 重型躯体：射击击退只生效 30%
      e.x += e.kvx * dt * 0.3; e.z += e.kvz * dt * 0.3;
      e.kvx *= (1 - 6 * dt); e.kvz *= (1 - 6 * dt);
      var dx = player.x - e.x, dz = player.z - e.z;
      var pd = Math.hypot(dx, dz) || 0.01;
      if (e.mode === "windup") { // 技能前摇：核心高亮脉冲预警
        e.modeT -= dt;
        e.mesh.rotation.y = Math.atan2(e.tx - e.x, e.tz - e.z);
        e.coreMat.emissiveIntensity = 1.6 + 1.4 * Math.sin(time * 18);
        if (e.modeT <= 0) execEliteSkill(e);
      } else if (e.mode === "charge") {
        var step = 8 * dt;
        e.x += e.chargeDx * step; e.z += e.chargeDz * step;
        e.chargeLeft -= step;
        if (Math.random() < 0.5) spawnParticle(e.x, 0.2, e.z, "dust", 0.8, 1.2, -4, 0.35);
        if (player.hp > 0 && pd < e.r + player.r + 0.4 && Math.abs(player.y - e.y) < 1.6) {
          damagePlayer(ELITE_DMG);
          player.x += e.chargeDx * 2.2; player.z += e.chargeDz * 2.2;
          collideWorld(player, player.y);
          setMsg("被精英冲撞击飞！");
          e.chargeLeft = 0;
        }
        if (e.chargeLeft <= 0) { e.mode = "recover"; e.modeT = 0.8; }
        e.mesh.rotation.y = Math.atan2(e.chargeDx, e.chargeDz);
      } else if (e.mode === "recover") {
        e.modeT -= dt;
        if (e.modeT <= 0) e.mode = "stalk";
      } else { // stalk 逼近
        var mx = e.tx - e.x, mz = e.tz - e.z;
        var md = Math.hypot(mx, mz);
        if (md > 0.3) {
          e.x += (mx / md) * e.speed * dt;
          e.z += (mz / md) * e.speed * dt;
          e.mesh.rotation.y = Math.atan2(mx, mz);
        }
        if (player.hp > 0 && pd < e.r + player.r + 0.35 && Math.abs(player.y - e.y) < 1.6 && e.atkT <= 0) {
          damagePlayer(e.dmg); // 近身抓取：重伤 + 击退
          player.x += dx / pd * 1.8; player.z += dz / pd * 1.8;
          collideWorld(player, player.y);
          burst3(player.x, player.y + 1.2, player.z, 6, "blood");
          e.atkT = 1.4;
          setMsg("被精英抓击！");
        }
      }
      collideWorld(e, e.y);
      updateVertical(e, dt);
      if (e.mode !== "windup") e.coreMat.emissiveIntensity = 0.8 + 0.3 * Math.sin(time * 3 + e.id);
      e.mesh.position.set(e.x, e.y + Math.abs(Math.sin(e.wob)) * 0.03, e.z);
      var esw = Math.sin(e.wob) * (e.mode === "stalk" || e.mode === "charge" ? 1 : 0.25);
      e.ud.legL.rotation.x = esw * 0.42; e.ud.legR.rotation.x = -esw * 0.42;
      e.ud.armL.rotation.x = e.ud.armBase + esw * 0.1;
      e.ud.armR.rotation.x = e.ud.armBase - esw * 0.1;
      if (e.shadow) e.shadow.mesh.position.set(e.x, e.y + 0.02, e.z);
      var em = e.hitT > 0 ? 0x7a1515 : 0x000000;
      e.bodyMat.emissive.setHex(em);
      e.headMat.emissive.setHex(em);
    }
  }

  // 本地启发式兜底（与 LLM 版行为一致，离线/404/超时时玩家无感）
  function eliteBrainLocal(e) {
    var d = dist2d(e.x, e.z, player.x, player.z);
    var zn = 0;
    for (var k = 0; k < zombies.length; k++) {
      if (dist2d(e.x, e.z, zombies[k].x, zombies[k].z) < 10) zn++;
    }
    var act = "stalk";
    if (zn < 3 && e.cdSummon <= 0 && Math.random() < 0.5) act = "summon";
    else if (player.hp <= 35 && zn > 0 && e.cdRoar <= 0 && Math.random() < 0.5) act = "roar";
    else if (d < 6) act = e.cdSlam <= 0 ? "slam" : "stalk";
    else if (d < 18) {
      if (player.y > 1.2) act = e.cdSpit <= 0 ? "spit" : "stalk";      // 高台必吐息
      else if (e.cdCharge <= 0) act = "charge";
      else if (e.cdSpit <= 0) act = "spit";
    }
    else if (player.y > 1.2 && e.cdSpit <= 0) act = "spit";
    issueOrder(e, act, player.x, player.z, null);
  }
  function eliteThinkLocal() {
    for (var k = 0; k < elites.length; k++) eliteBrainLocal(elites[k]);
  }

  // LLM 决策循环：每 4s 一批，fire-and-forget 不阻塞帧，同一时刻最多 1 个在途请求
  function eliteThink() {
    if (elites.length === 0) return;
    if (eliteAiDisabled || !window.HaoqiAiGate) { eliteThinkLocal(); return; }
    if (location.protocol !== "http:" && location.protocol !== "https:") { eliteThinkLocal(); return; }
    if (eliteInFlight) return;
    var zn = 0, k, e;
    for (k = 0; k < zombies.length; k++) {
      if (dist2d(elites[0].x, elites[0].z, zombies[k].x, zombies[k].z) < 10) zn++;
    }
    var snap = {
      wave: wave,
      playerX: Math.round(player.x * 10) / 10,
      playerY: Math.round(player.y * 10) / 10,
      playerZ: Math.round(player.z * 10) / 10,
      playerHp: Math.round(player.hp),
      playerHigh: player.y > 1.2,
      zombiesNear: zn,
      elites: []
    };
    for (k = 0; k < elites.length; k++) {
      e = elites[k];
      snap.elites.push({
        id: e.id,
        x: Math.round(e.x * 10) / 10,
        z: Math.round(e.z * 10) / 10,
        hp: Math.round(e.hp),
        dist: Math.round(dist2d(e.x, e.z, player.x, player.z) * 10) / 10,
        canSpit: e.cdSpit <= 0, canCharge: e.cdCharge <= 0, canRoar: e.cdRoar <= 0,
        canSlam: e.cdSlam <= 0, canSummon: e.cdSummon <= 0
      });
    }
    eliteInFlight = true;
    var ctrl = new AbortController();
    eliteAbort = ctrl;
    var timer = null;
    var gateAcquired = false;
    window.HaoqiAiGate.getSession("elite").then(function (token) {
      gateAcquired = true;
      timer = setTimeout(function () { ctrl.abort(); }, 6000);
      return fetch(window.HaoqiAiGate.url("/api/elite-command"), {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ snapshot: snap }),
        signal: ctrl.signal
      });
    }).then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    }).then(function (data) {
      if (timer) clearTimeout(timer); eliteInFlight = false; eliteAbort = null;
      var orders = data && data.orders;
      if (!orders || !orders.length) { eliteThinkLocal(); return; }
      eliteLastOrders = orders;
      var acted = {}, k2, j, o;
      for (k2 = 0; k2 < orders.length; k2++) {
        o = orders[k2];
        if (!o) continue;
        e = null;
        for (j = 0; j < elites.length; j++) { if (elites[j].id == o.id) { e = elites[j]; break; } } // eslint-disable-line eqeqeq
        if (!e || e.hp <= 0) continue;
        var act = ELITE_ACTIONS.indexOf(o.action) >= 0 ? o.action : "stalk";
        issueOrder(e, act, o.tx, o.tz, o.say);
        acted[e.id] = true;
      }
      for (k2 = 0; k2 < elites.length; k2++) { // 没被点名的精英走本地兜底，避免发呆
        if (!acted[elites[k2].id]) eliteBrainLocal(elites[k2]);
      }
    }).catch(function () { // 404 / 超时 / 离线 / 限流 → 本地兜底
      if (timer) clearTimeout(timer); eliteInFlight = false; eliteAbort = null;
      if (!gateAcquired) eliteAiDisabled = true;
      eliteThinkLocal();
    });
  }

  // ---------- 重置 / 流程 ----------
  function reset() {
    var i;
    for (i = zombies.length - 1; i >= 0; i--) removeZombieAt(i);
    for (i = elites.length - 1; i >= 0; i--) {
      scene.remove(elites[i].mesh);
      elites[i].bodyMat.dispose(); elites[i].headMat.dispose(); elites[i].coreMat.dispose();
    }
    elites = [];
    for (i = 0; i < SPIT_N; i++) { spits[i].t = 0; spits[i].mesh.visible = false; }
    eliteThinkT = 4; eliteInFlight = false; eliteLastOrders = [];
    if (eliteAbort) { try { eliteAbort.abort(); } catch (ex) {} eliteAbort = null; }
    for (i = crates.length - 1; i >= 0; i--) removeCrateAt(i);
    for (i = 0; i < botMeshes.length; i++) {
      scene.remove(botMeshes[i]);
      botMeshes[i].userData.bodyMat.dispose();
      botMeshes[i].userData.headMat.dispose();
    }
    botMeshes = [];
    for (i = 0; i < bots.length; i++) freeShadow(bots[i].shadow);
    for (i = 0; i < tracers.length; i++) { tracers[i].t = 0; tracers[i].mesh.visible = false; }
    for (i = 0; i < splats.length; i++) { splats[i].t = 0; splats[i].mesh.visible = false; }
    for (i = 0; i < floaters.length; i++) { floaters[i].t = 0; floaters[i].el.style.display = "none"; }
    for (i = 0; i < PART_N; i++) { parts[i].t = 0; partPos[i * 3 + 1] = -999; }
    partGeo.attributes.position.needsUpdate = true;
    SLOT_KEYS.forEach(function (key) { guns[key].flashT = 0; guns[key].flash.visible = false; });
    muzzleLight.intensity = 0;

    player = {
      x: 0, z: 6, y: 0, vy: 0, grounded: true, r: 0.42, hp: 100, maxHp: 100,
      speed: 5.4, cool: 0, mag: 30, magSize: 30, reserve: 90,
      reloadT: 0, muzzleT: 0, weapon: "rifle", spinT: 0, wob: 0,
      inv: { rifle: { mag: 30, reserve: 90 } }
    };
    bots = [makeBot(-2.2, 7.8), makeBot(2.2, 7.8), makeBot(0, 9.6)];
    zombies = []; crates = [];
    wave = 0; score = 0; interT = 0; hurtFlash = 0; bannerT = 0; missionT = 0;
    spawnQueue = []; spawnT = 0;
    yaw = 0; pitch = 0; firing = false; jumpQueued = false;
    shakeAmp = 0; shakeT = 0;
    bobPhase = 0; landDip = 0; recoilOff = 0; gunKick = 0; swapT = 0;
    multiN = 0; multiT = 0; crossHeat = 0;
    for (i = 0; i < windPads.length; i++) windPads[i].cool = 0;
    fovKick = 0; camera.fov = 72; camera.updateProjectionMatrix();
    el.topWave.textContent = "–";
    updateGunVisibility();
    updateSlots();
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

  function spawnZombieFromQueue() {
    var type = spawnQueue.shift();
    var x = 0, z = -BOUND + 1.6, ok = false;
    for (var tries = 0; tries < 10 && !ok; tries++) { // 避开障碍/高台内部
      var side = Math.floor(rand(0, 4)), m = 1.6;
      if (side === 0) { x = rand(-BOUND + m, BOUND - m); z = -BOUND + m; }
      else if (side === 1) { x = rand(-BOUND + m, BOUND - m); z = BOUND - m; }
      else if (side === 2) { x = -BOUND + m; z = rand(-BOUND + m, BOUND - m); }
      else { x = BOUND - m; z = rand(-BOUND + m, BOUND - m); }
      ok = !pointInSolid(x, z);
    }
    zombies.push(makeZombie(type, x, z, 0)); // 僵尸只刷地面层，靠斜坡爬上高台
  }

  function showBanner(text, dur) {
    el.banner.textContent = text;
    bannerT = bannerDur = dur || 2;
  }

  function nextWave() {
    wave += 1;
    if (wave > bestWave) { bestWave = wave; persistSave(); } // 抵达新波次立即存档
    spawnQueue = waveComp(wave);
    spawnT = 0.5;
    var hasBrute = spawnQueue.indexOf("brute") >= 0;
    var hasElite = wave >= 4 && (wave - 4) % 3 === 0 && elites.length < 2; // 第 4 波起每 3 波 1 只，场上最多 2 只
    if (hasElite) spawnElite();
    showBanner("第 " + wave + " 波" + (hasBrute ? " · ☣ 母体出现" : "") + (hasElite ? " · ⚔ 精英变异体出现" : ""), 2.2);
    el.topWave.textContent = wave;
    sWave();
    state = "playing";
  }

  function waveClear() {
    score += 250;
    showBanner("第 " + wave + " 波肃清 +250", 1.8);
    var s1 = groundSpot(rand(-8, 8), rand(-8, 8));
    dropCrate("ammo", s1.x, s1.z);
    var s2 = groundSpot(rand(-8, 8), rand(-8, 8));
    dropCrate("med", s2.x, s2.z);
    if (wave >= 2 && Math.random() < 0.45) {
      var s3 = groundSpot(rand(-10, 10), rand(-10, 10));
      dropCrate("weapon", s3.x, s3.z, pickWeapon());
    }
    if (Math.random() < 0.4) { // 40% 往高台投一份补给，鼓励抢制高点
      var ps = PLAT_SPOTS[Math.floor(rand(0, PLAT_SPOTS.length))];
      dropCrate(Math.random() < 0.5 ? "ammo" : "med", ps.x, ps.z);
    }
    if (bots.length < 3) {
      bots.push(makeBot(player.x + rand(-3, 3), player.z + rand(2, 4), player.y));
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
    if (document.exitPointerLock) document.exitPointerLock();
    if (score > best) { best = score; }
    persistSave();
    burst3(player.x, 1, player.z, 26, "gas");
    sGameOver();
    el.ovTitle.textContent = "你已被感染…";
    el.ovDesc.innerHTML = "你在第 " + wave + " 波倒下了。<br>最终得分 <b>" + score + "</b> · 历史最佳 <b>" + best + "</b> 分 · 最远第 <b>" + bestWave + "</b> 波<br>生化危机，无人能幸免。";
    el.ovBtn.textContent = "再来一局 (R)";
    syncRecord();
    el.overlay.hidden = false;
  }

  function startGame() {
    ac();
    reset();
    hadLock = false; // 重置持锁记录，避免上一局残留状态误触发自动暂停
    el.overlay.hidden = true;
    el.ovTitle.textContent = "生死狙击 · 变异战";
    setMsg("尸潮将至，守住阵地！");
    nextWave();
  }

  function pauseGame() {
    if (state !== "playing" && state !== "intermission") return;
    resumeState = state;
    state = "paused";
    firing = false;
    el.ovTitle.textContent = "已暂停";
    el.ovDesc.textContent = "点击继续，重新锁定鼠标返回战场。";
    el.ovBtn.textContent = "继续战斗";
    syncRecord();
    el.overlay.hidden = false;
  }

  function resumeGame() {
    el.overlay.hidden = true;
    state = resumeState;
    lockPointer();
  }

  // ---------- 主更新 ----------
  var playerMoving = false, playerSprinting = false;
  function update(dt) {
    time += dt;
    missionT += dt;
    var i, k;

    // --- 玩家（第一人称移动 + 跳跃） ---
    playerMoving = false; playerSprinting = false;
    if (player.hp > 0) {
      var mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
      var mx2 = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      if (touchMove) { mz += touchMove.z; mx2 += touchMove.x; }
      mz = clamp(mz, -1, 1); mx2 = clamp(mx2, -1, 1);
      var sy = Math.sin(yaw), cy = Math.cos(yaw);
      if (mz !== 0 || mx2 !== 0) {
        playerMoving = true;
        // forward=(-sy,-cy)，right=(cy,-sy)
        var vx2 = -sy * mz + cy * mx2;
        var vz2 = -cy * mz - sy * mx2;
        var vl = Math.hypot(vx2, vz2) || 1;
        playerSprinting = !!(keys.ShiftLeft || keys.ShiftRight);
        var spd = player.speed * (playerSprinting ? 1.5 : 1);
        if (player.weapon === "gatling" && firing && player.reloadT <= 0) spd *= 0.55; // 加特林开火减速 45%
        player.x += (vx2 / vl) * spd * dt;
        player.z += (vz2 / vl) * spd * dt;
        bobPhase += dt * (playerSprinting ? 11.5 : 8);
      }
      collideWorld(player, player.y);
      // 跳跃：初速度 + 重力 + 落地（含矮箱顶）
      if (jumpQueued && player.grounded) { player.vy = JUMP_V; player.grounded = false; sJump(); }
      jumpQueued = false;
      if (!player.grounded) {
        player.vy -= GRAV * dt;
        player.y += player.vy * dt;
        var gh = groundHeight(player.x, player.z, player.y);
        if (player.y <= gh && player.vy <= 0) {
          player.y = gh; player.vy = 0; player.grounded = true;
          landDip = 1;
          sLand();
        }
      } else {
        var gh2 = groundHeight(player.x, player.z, player.y);
        if (player.y > gh2 + 0.01) { player.grounded = false; player.vy = 0; } // 走出箱顶边缘
        else player.y = gh2;
      }
      // 加特林预热 / 冷却
      if (player.weapon === "gatling" && firing) player.spinT = Math.min(0.7, player.spinT + dt);
      else player.spinT = Math.max(0, player.spinT - dt * 3);
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
      } else if (firing && player.cool <= 0 && swapT <= 0 && state === "playing") {
        tryShoot();
      }
    } else {
      jumpQueued = false;
    }

    // --- 枪模动画标量 ---
    if (swapT > 0) swapT -= dt;
    recoilOff *= Math.max(0, 1 - 12 * dt);
    gunKick *= Math.max(0, 1 - 10 * dt);
    landDip *= Math.max(0, 1 - 9 * dt);
    crossHeat = Math.max(0, crossHeat - dt * 2.2);
    fovKick = Math.max(0, fovKick - dt * 3);
    for (i = 0; i < SLOT_KEYS.length; i++) {
      var G = guns[SLOT_KEYS[i]];
      if (G.flashT > 0) {
        G.flashT -= dt;
        G.flash.material.opacity = 0.95 * Math.max(0, G.flashT / 0.05);
        if (G.flashT <= 0) G.flash.visible = false;
      }
    }
    if (multiT > 0) { multiT -= dt; if (multiT <= 0) multiN = 0; }

    // --- 队友 AI ---
    for (i = bots.length - 1; i >= 0; i--) {
      var b = bots[i];
      if (b.infected) { // 1.4 秒后变异成 runner 反水
        b.infectT -= dt;
        if (Math.random() < 0.3) burst3(b.x, b.y + 1.1, b.z, 1, "gas");
        if (b.infectT <= 0) {
          scene.remove(b.mesh);
          b.mesh.userData.bodyMat.dispose();
          b.mesh.userData.headMat.dispose();
          freeShadow(b.shadow);
          botMeshes.splice(botMeshes.indexOf(b.mesh), 1);
          bots.splice(i, 1);
          var mut = makeZombie("runner", b.x, b.z, b.y);
          mut.speed *= 1.1;
          zombies.push(mut);
          burst3(b.x, b.y + 1, b.z, 14, "gas");
          feed("☣ 一名队友<b>变异</b>了！");
          setMsg("一名队友变异了！");
        }
        continue;
      }
      b.cool -= dt;
      var target = nearestZombie(b.x, b.z, 24);
      if (target) {
        b.mesh.rotation.y = Math.atan2(target.x - b.x, target.z - b.z);
        if (b.cool <= 0) {
          botShoot(b, target);
          b.cool = 0.5 + rand(0, 0.3);
        }
      } else {
        b.mesh.rotation.y = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
      }
      var dp = dist2d(b.x, b.z, player.x, player.z);
      var bmv = 0;
      if (dp > 9.4) { b.x += ((player.x - b.x) / dp) * 4.6 * dt; b.z += ((player.z - b.z) / dp) * 4.6 * dt; bmv = 1; }
      else if (dp < 3.0 && dp > 0.01) { b.x -= ((player.x - b.x) / dp) * 2.2 * dt; b.z -= ((player.z - b.z) / dp) * 2.2 * dt; bmv = 1; }
      for (k = 0; k < bots.length; k++) {
        var ob = bots[k];
        if (ob === b || ob.infected) continue;
        var sx = b.x - ob.x, sz = b.z - ob.z;
        var sd = Math.hypot(sx, sz);
        if (sd > 0 && sd < 2) { b.x += (sx / sd) * 1.5 * dt; b.z += (sz / sd) * 1.5 * dt; bmv = 1; }
      }
      collideWorld(b, b.y);
      updateVertical(b, dt);
      b.wob += dt * (bmv ? 8 : 1.5);
      b.mesh.position.set(b.x, b.y + (bmv ? Math.abs(Math.sin(b.wob)) * 0.05 : 0), b.z);
      b.mesh.rotation.z = bmv ? Math.sin(b.wob) * 0.045 : 0;
      var bsw = bmv ? Math.sin(b.wob) : 0; // 行走摆腿
      b.ud.legL.rotation.x = bsw * 0.5; b.ud.legR.rotation.x = -bsw * 0.5;
      b.ud.armL.rotation.x = b.ud.armBase + bsw * 0.06;
      b.ud.armR.rotation.x = b.ud.armBase - bsw * 0.06;
      if (b.shadow) b.shadow.mesh.position.set(b.x, b.y + 0.02, b.z);
    }

    // --- 僵尸 ---
    for (i = zombies.length - 1; i >= 0; i--) {
      var z = zombies[i];
      var h = nearestHuman(z.x, z.z);
      var hx = h.x - z.x, hz = h.z - z.z;
      var hd = Math.hypot(hx, hz) || 0.01;
      z.wob += dt * 6;
      var zspd = z.speed * (z.hasteT > 0 ? 1.4 : 1); // 精英咆哮加速
      z.x += (hx / hd) * zspd * dt + z.kvx * dt;
      z.z += (hz / hd) * zspd * dt + z.kvz * dt;
      z.kvx *= (1 - 6 * dt); z.kvz *= (1 - 6 * dt);
      z.cool -= dt; z.hitT -= dt;
      if (z.hasteT > 0) z.hasteT -= dt;
      for (k = 0; k < zombies.length; k++) {
        var oz = zombies[k];
        if (oz === z) continue;
        var zx = z.x - oz.x, zz = z.z - oz.z;
        var zd = Math.hypot(zx, zz);
        if (zd > 0 && zd < z.r * 1.6) { z.x += (zx / zd) * 1.4 * dt; z.z += (zz / zd) * 1.4 * dt; }
      }
      collideWorld(z, z.y);
      updateVertical(z, dt);
      if (hd < z.r + h.r + 0.35 && z.cool <= 0) {
        if (h === player) {
          if (Math.abs(player.y - z.y) < 1.35) { // 跳上高台/高箱可躲避啃咬
            damagePlayer(z.dmg);
            z.cool = 0.9;
          }
        } else if (!h.infected && Math.abs(h.y - z.y) < 1.35) {
          h.infected = true;
          h.infectT = 1.4;
          z.cool = 1.2;
          sInfect();
          burst3(h.x, 1.1, h.z, 10, "gas");
          feed("⚠ 一名队友<b>被感染</b>！");
          setMsg("一名队友被感染了！");
        }
      }
      var amp = z.crawl ? 0.015 : (z.type === "brute" ? 0.06 : 0.04);
      z.mesh.position.set(z.x, z.y + Math.abs(Math.sin(z.wob)) * amp, z.z);
      z.mesh.rotation.y = Math.atan2(hx, hz);
      z.mesh.rotation.z = Math.sin(z.wob) * (z.crawl ? 0.03 : 0.07);
      var zud = z.ud, zsw = Math.sin(z.wob); // 行走动画：腿部交替 + 手臂晃动
      if (zud.crawl) { // 爬行：双臂划水 + 拖腿
        zud.armL.rotation.x = zud.armBase + zsw * 0.35;
        zud.armR.rotation.x = zud.armBase - zsw * 0.35;
        zud.legL.rotation.x = 1.15 + zsw * 0.12;
        zud.legR.rotation.x = 1.15 - zsw * 0.12;
      } else {
        zud.legL.rotation.x = zsw * 0.55;
        zud.legR.rotation.x = -zsw * 0.55;
        zud.armL.rotation.x = zud.armBase + zsw * 0.13;
        zud.armR.rotation.x = zud.armBase - zsw * 0.13;
      }
      if (z.shadow) z.shadow.mesh.position.set(z.x, z.y + 0.02, z.z);
      var em = z.hitT > 0 ? 0x7a1515 : 0x000000;
      z.bodyMat.emissive.setHex(em);
      z.headMat.emissive.setHex(em);
    }

    // --- 精英变异体（LLM 每 4s 决策一批，本地兜底，不阻塞帧） ---
    updateElites(dt);
    updateSpits(dt);
    if (state === "playing" && elites.length > 0) {
      eliteThinkT -= dt;
      if (eliteThinkT <= 0) { eliteThinkT = 4; eliteThink(); }
    }

    // --- 波次刷怪 ---
    if (spawnQueue.length > 0 && zombies.length < ZOMBIE_CAP) {
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnZombieFromQueue();
        spawnT = 0.4;
      }
    }

    // --- 阵亡结算 ---
    for (i = zombies.length - 1; i >= 0; i--) {
      if (zombies[i].hp <= 0) killZombie(i);
    }

    // --- 补给箱 ---
    for (i = crates.length - 1; i >= 0; i--) {
      var c = crates[i];
      c.mesh.rotation.y += dt * 1.6;
      c.mesh.position.y = c.y + 0.55 + Math.sin(time * 2 + c.ph) * 0.12;
      c.mat.emissiveIntensity = 0.7 + 0.4 * Math.sin(time * 3 + c.ph);
      if (dist2d(c.x, c.z, player.x, player.z) < 1.7 && Math.abs(player.y - c.y) < 1.3 && player.hp > 0) {
        if (c.kind === "weapon") {
          grantWeapon(c.w || pickWeapon());
        } else if (c.kind === "ammo") {
          player.reserve += 60;
          floatText(player.x, player.y + 1.9, player.z, "+60 弹药", "#ffd97a", 15);
          setMsg("拾取弹药箱，当前武器备弹 +60。");
          sPickup();
        } else {
          player.hp = Math.min(player.maxHp, player.hp + 40);
          floatText(player.x, player.y + 1.9, player.z, "+40 HP", "#5fbf6e", 15);
          setMsg("拾取医疗箱，生命 +40。");
          sPickup();
        }
        removeCrateAt(i);
      }
    }

    // --- 风洞（仅玩家可用：垂直气流大跳，僵尸走斜坡） ---
    for (i = 0; i < windPads.length; i++) {
      var wp = windPads[i];
      if (wp.cool > 0) wp.cool -= dt;
      wp.col.rotation.y += dt * 2.4;
      wp.blades.rotation.y -= dt * 1.8;
      var glow = wp.cool > 0 ? 0.35 : 0.85 + 0.35 * Math.sin(time * 4 + wp.x);
      wp.disc.material.emissiveIntensity = glow * 1.2;
      wp.light.intensity = glow * 0.9;
      if (Math.random() < 0.45) { // 常驻上升气流粒子
        spawnParticle(wp.x + rand(-0.6, 0.6), 0.15, wp.z + rand(-0.6, 0.6), "wind", 0.3, 3.2, 2.2, rand(0.7, 1.1));
      }
      if (player.hp > 0 && player.grounded && player.y < 0.6 && wp.cool <= 0 &&
          dist2d(player.x, player.z, wp.x, wp.z) < wp.r) {
        player.vy = WIND_V;
        player.grounded = false;
        wp.cool = 1.0;
        burst3(wp.x, 0.4, wp.z, 16, "wind");
        sWind();
        addShake(0.1, 0.22);
        fovKick = 1;
        setMsg("风洞气流把你顶上了天！");
      }
    }

    // --- 特效池 ---
    for (i = 0; i < tracers.length; i++) {
      var tr = tracers[i];
      if (tr.t > 0) {
        tr.t -= dt;
        tr.mesh.material.opacity = 0.85 * Math.max(0, tr.t / tr.life);
        if (tr.t <= 0) tr.mesh.visible = false;
      }
    }
    var posDirty = false;
    for (i = 0; i < PART_N; i++) {
      var p = parts[i];
      if (p.t > 0) {
        p.t -= dt;
        var i3 = i * 3;
        if (p.t <= 0) { partPos[i3 + 1] = -999; }
        else {
          p.vy += p.grav * dt;
          partPos[i3] += p.vx * dt;
          partPos[i3 + 1] += p.vy * dt;
          partPos[i3 + 2] += p.vz * dt;
          if (partPos[i3 + 1] < 0.02 && p.grav < 0) { partPos[i3 + 1] = 0.02; p.vx *= 0.6; p.vz *= 0.6; p.vy = 0; }
        }
        posDirty = true;
      }
    }
    if (posDirty) partGeo.attributes.position.needsUpdate = true;
    for (i = 0; i < splats.length; i++) {
      var sp2 = splats[i];
      if (sp2.t > 0) {
        sp2.t -= dt;
        sp2.mesh.material.opacity = 0.55 * clamp(sp2.t / 3, 0, 1);
        if (sp2.t <= 0) sp2.mesh.visible = false;
      }
    }
    for (i = 0; i < floaters.length; i++) {
      if (floaters[i].t > 0) floaters[i].t -= dt;
    }
    if (muzzleLight.intensity > 0) muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 36);
    if (hurtFlash > 0) hurtFlash -= dt;
    if (bannerT > 0) bannerT -= dt;

    // --- 波次流程 ---
    if (state === "playing" && spawnQueue.length === 0 && zombies.length === 0 && elites.length === 0) {
      waveClear();
    } else if (state === "intermission") {
      interT -= dt;
      if (interT <= 0) nextWave();
    }
  }

  // ---------- 相机（第一人称眼高 1.6m / V 键切第三人称越肩） ----------
  function updateCamera(dt) {
    var bobY = (playerMoving && player.grounded) ? Math.sin(bobPhase * 2) * (playerSprinting ? 0.045 : 0.028) : 0;
    var eyeY = player.y + EYE_H + bobY - landDip * 0.09;
    if (viewMode === "tp") { // 第三人称：相机拉到身后上方
      var vsy = Math.sin(yaw), vcy = Math.cos(yaw);
      camera.position.set(
        clamp(player.x + vsy * 3.1, -BOUND + 0.6, BOUND - 0.6),
        eyeY + 0.55,
        clamp(player.z + vcy * 3.1, -BOUND + 0.6, BOUND - 0.6)
      );
    } else {
      camera.position.set(player.x, eyeY, player.z);
    }
    if (shakeT > 0) {
      shakeT -= dt;
      var s = shakeAmp * (shakeT / shakeDur);
      camera.position.x += rand(-s, s) * 0.1;
      camera.position.y += rand(-s, s) * 0.1;
    }
    camera.rotation.y = yaw;
    camera.rotation.x = pitch + recoilOff;
    camera.rotation.z = 0;
    // 身体/枪模可见性与姿态同步
    playerBody.visible = (viewMode === "tp");
    gunRig.visible = (viewMode !== "tp");
    if (viewMode === "tp") {
      playerBody.position.set(player.x, player.y, player.z);
      playerBody.rotation.y = yaw + Math.PI; // 模型正面 +Z，玩家面向 -Z
      var psw = (playerMoving && player.grounded) ? Math.sin(bobPhase) : 0;
      pbUd.legL.rotation.x = psw * 0.55; pbUd.legR.rotation.x = -psw * 0.55;
      pbUd.armL.rotation.x = pbUd.armBase + psw * 0.06;
      pbUd.armR.rotation.x = pbUd.armBase - psw * 0.06;
      if (pbShadow) { // 影子贴下方地面，跳跃时不跟飞
        pbShadow.mesh.visible = true;
        pbShadow.mesh.position.set(player.x, groundHeight(player.x, player.z, player.y) + 0.02, player.z);
      }
    } else if (pbShadow) {
      pbShadow.mesh.visible = false;
    }
    // 风洞大跳 FOV 冲击
    var fov = 72 + fovKick * 7;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // ---------- 枪模动画（摆动 / 后座 / 换弹 / 切枪） ----------
  function updateGunRig() {
    var sway = (playerMoving && player.grounded) ? 1 : 0.3;
    var gx = GUN_BASE.x + Math.sin(bobPhase) * 0.008 * sway;
    var gy = GUN_BASE.y + Math.abs(Math.cos(bobPhase)) * 0.01 * sway + Math.sin(time * 1.7) * 0.002;
    var gz = GUN_BASE.z + gunKick * 0.09;
    var rx = gunKick * 0.1, rz = 0;
    if (swapT > 0) { // 收枪-抬枪
      var p = 1 - swapT / 0.26;
      gy -= Math.sin(p * Math.PI) * 0.24;
      rz = Math.sin(p * Math.PI) * 0.45;
    }
    if (player.reloadT > 0) { // 换弹：下沉旋转再回位
      var rp = 1 - player.reloadT / WEAPONS[player.weapon].reload;
      gy -= Math.sin(rp * Math.PI) * 0.15;
      rx -= Math.sin(rp * Math.PI) * 0.5;
    }
    gunRig.position.set(gx, gy, gz);
    gunRig.rotation.x = rx;
    gunRig.rotation.z = rz;
  }

  // ---------- HUD ----------
  var segEls = [];
  function buildHpSegs() {
    for (var i = 0; i < 10; i++) {
      var s = document.createElement("span");
      el.hpSegs.appendChild(s);
      segEls.push(s);
    }
  }
  function fmtTime(t) {
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  var _cursorMode = ""; // 兜底模式（无法指针锁定）时战斗中隐藏系统指针，准星即鼠标
  function syncCursor() {
    var cm = (lockFailed && el.overlay.hidden) ? "none" : "";
    if (cm !== _cursorMode) { _cursorMode = cm; stage.style.cursor = cm; }
  }
  function syncHud() {
    if (!player) return;
    var filled = Math.ceil(clamp(player.hp, 0, 100) / 10);
    for (var i = 0; i < 10; i++) segEls[i].classList.toggle("on", i < filled);
    el.hpSegs.classList.toggle("low", player.hp <= 30);
    var wp = WEAPONS[player.weapon];
    el.wname.textContent = wp.icon + " " + wp.name;
    el.ammoMag.textContent = player.mag;
    el.ammoRes.textContent = player.reserve;
    el.topScore.textContent = score;
    el.topLeft.textContent = zombies.length + spawnQueue.length + elites.length;
    el.topTime.textContent = state === "intermission" ? ("备战 " + Math.max(0, Math.ceil(interT))) : fmtTime(missionT);
    var alive = player.hp > 0 ? 1 : 0;
    for (i = 0; i < bots.length; i++) if (!bots[i].infected) alive++;
    el.alive.textContent = alive;
    el.hurt.style.opacity = clamp(hurtFlash * 1.8, 0, 0.85);
    el.banner.style.opacity = bannerT > 0 ? clamp(bannerT / (bannerDur * 0.4), 0, 1) : 0;
    el.cross.style.setProperty("--g", (5 + crossHeat * 14 + (player.weapon === "shotgun" ? 5 : 0)) + "px");
  }

  // ---------- 雷达小地图 ----------
  var radarCtx = el.radar.getContext("2d");
  function drawRadar() {
    if (!radarCtx || !player) return;
    var S = 140, C = S / 2, R = C - 6, scale = R / 30;
    var g = radarCtx;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(C, C, C - 1, 0, 6.2832); g.clip();
    g.fillStyle = "rgba(14,20,14,0.62)";
    g.fillRect(0, 0, S, S);
    var cb = Math.cos(yaw), sb = Math.sin(yaw);
    // 世界相对坐标 → 雷达坐标（玩家朝向恒为上）
    function px(rx, rz) { return rx * cb - rz * sb; }
    function py(rx, rz) { return rx * sb + rz * cb; }
    // 场地方框
    var corners = [[-30, -30], [30, -30], [30, 30], [-30, 30]];
    g.strokeStyle = "rgba(190,210,160,0.45)";
    g.lineWidth = 1.5;
    g.beginPath();
    for (var ci = 0; ci < 4; ci++) {
      var wx = corners[ci][0] - player.x, wz = corners[ci][1] - player.z;
      var X = C + px(wx, wz) * scale, Y = C + py(wx, wz) * scale;
      if (ci === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    }
    g.closePath();
    g.stroke();
    // 高台 / 斜坡（旋转矩形，与场地方框同一变换）
    function radarRect(minX, minZ, maxX, maxZ) {
      var cs = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
      g.beginPath();
      for (var ri = 0; ri < 4; ri++) {
        var rwx = cs[ri][0] - player.x, rwz = cs[ri][1] - player.z;
        var rX = C + px(rwx, rwz) * scale, rY = C + py(rwx, rwz) * scale;
        if (ri === 0) g.moveTo(rX, rY); else g.lineTo(rX, rY);
      }
      g.closePath(); g.fill();
    }
    var k0;
    g.fillStyle = "rgba(220,214,190,0.85)";
    for (k0 = 0; k0 < platforms.length; k0++) {
      radarRect(platforms[k0].minX, platforms[k0].minZ, platforms[k0].maxX, platforms[k0].maxZ);
    }
    g.fillStyle = "rgba(190,184,160,0.5)";
    for (k0 = 0; k0 < ramps.length; k0++) {
      radarRect(ramps[k0].minX, ramps[k0].minZ, ramps[k0].maxX, ramps[k0].maxZ);
    }
    // 风洞：青色圆点
    g.fillStyle = "#5fd7ff";
    for (k0 = 0; k0 < windPads.length; k0++) {
      var wdx = windPads[k0].x - player.x, wdz = windPads[k0].z - player.z;
      var wX = px(wdx, wdz) * scale, wY = py(wdx, wdz) * scale;
      if (wX * wX + wY * wY > R * R) continue;
      g.beginPath(); g.arc(C + wX, C + wY, 3, 0, 6.2832); g.fill();
    }
    // 障碍物
    g.fillStyle = "rgba(170,160,130,0.55)";
    for (var k = 0; k < obstacles.length; k++) {
      var o = obstacles[k];
      var ox = (o.minX + o.maxX) / 2 - player.x, oz2 = (o.minZ + o.maxZ) / 2 - player.z;
      var s2 = clamp((o.maxX - o.minX) * scale * 0.4, 2, 6);
      g.fillRect(C + px(ox, oz2) * scale - s2 / 2, C + py(ox, oz2) * scale - s2 / 2, s2, s2);
    }
    var i, dx, dz, X2, Y2, dd;
    // 补给箱：黄点
    g.fillStyle = "#ffd94a";
    for (i = 0; i < crates.length; i++) {
      dx = crates[i].x - player.x; dz = crates[i].z - player.z;
      X2 = px(dx, dz) * scale; Y2 = py(dx, dz) * scale;
      if (X2 * X2 + Y2 * Y2 > R * R) continue;
      g.fillRect(C + X2 - 2, C + Y2 - 2, 4, 4);
    }
    // 队友：绿点
    g.fillStyle = "#7be06a";
    for (i = 0; i < bots.length; i++) {
      if (bots[i].infected) continue;
      dx = bots[i].x - player.x; dz = bots[i].z - player.z;
      X2 = px(dx, dz) * scale; Y2 = py(dx, dz) * scale;
      if (X2 * X2 + Y2 * Y2 > R * R) continue;
      g.beginPath(); g.arc(C + X2, C + Y2, 2.4, 0, 6.2832); g.fill();
    }
    // 僵尸：红点（母体紫色大点）
    for (i = 0; i < zombies.length; i++) {
      dx = zombies[i].x - player.x; dz = zombies[i].z - player.z;
      X2 = px(dx, dz) * scale; Y2 = py(dx, dz) * scale;
      if (X2 * X2 + Y2 * Y2 > R * R) continue;
      g.fillStyle = zombies[i].type === "brute" ? "#d86ae0" : "#e0483e";
      g.beginPath(); g.arc(C + X2, C + Y2, zombies[i].type === "brute" ? 3.4 : 2.2, 0, 6.2832); g.fill();
    }
    // 精英：橙色大点
    g.fillStyle = "#ff8a2a";
    for (i = 0; i < elites.length; i++) {
      dx = elites[i].x - player.x; dz = elites[i].z - player.z;
      X2 = px(dx, dz) * scale; Y2 = py(dx, dz) * scale;
      if (X2 * X2 + Y2 * Y2 > R * R) continue;
      g.beginPath(); g.arc(C + X2, C + Y2, 4.4, 0, 6.2832); g.fill();
    }
    // 玩家：中心朝向箭头
    g.fillStyle = "#eaf4e0";
    g.beginPath();
    g.moveTo(C, C - 6);
    g.lineTo(C - 4.2, C + 4.5);
    g.lineTo(C + 4.2, C + 4.5);
    g.closePath();
    g.fill();
    g.restore();
  }

  function syncFloaters() {
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      if (f.t <= 0) {
        if (f.el.style.display !== "none") f.el.style.display = "none";
        continue;
      }
      var rise = (1 - f.t / f.life) * 0.9;
      _proj.set(f.x, f.y + rise, f.z).project(camera);
      if (_proj.z > 1 || _proj.z < -1) { f.el.style.display = "none"; continue; }
      f.el.style.display = "block";
      f.el.style.transform = "translate(" + ((_proj.x * 0.5 + 0.5) * viewW).toFixed(1) + "px," + ((-_proj.y * 0.5 + 0.5) * viewH).toFixed(1) + "px) translate(-50%,-50%)";
      f.el.style.opacity = clamp(f.t / (f.life * 0.55), 0, 1);
    }
  }
  var _proj = new THREE.Vector3();

  // ---------- 输入 ----------
  var lockFailed = false; // 指针锁定被环境禁止（如 iframe 预览）时，退回鼠标直接移动转视角
  function enableLookFallback() {
    if (lockFailed || isTouch) return;
    lockFailed = true;
    setMsg("预览环境禁止鼠标锁定：移动鼠标直接转视角 · 左键射击 · Esc 暂停；建议右上角新标签页打开获得完整手感");
    // 兜底模式下隐藏系统指针，准星即"鼠标"
    if (!el.newTab) {
      var a = document.createElement("a");
      a.href = location.pathname; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "↗ 新标签页打开（指针锁定完整体验）";
      a.style.cssText = "position:absolute;right:10px;top:46px;z-index:40;color:#ffd97a;font-size:12px;background:rgba(0,0,0,0.45);padding:4px 9px;border-radius:5px;text-decoration:none;border:1px solid rgba(255,217,122,0.4);";
      stage.appendChild(a); el.newTab = a;
    }
  }
  function lockPointer() {
    if (isTouch || lockFailed) return;
    try {
      var p;
      if (canvas.requestPointerLock) {
        try { p = canvas.requestPointerLock({ unadjustedMovement: true }); } // 原生 1:1 手感
        catch (e1) { p = canvas.requestPointerLock(); } // 旧浏览器不支持选项参数
      }
      if (p && p.catch) p.catch(function (err) {
        var inIframe = true;
        try { inIframe = window.self !== window.top; } catch (e2) { inIframe = true; }
        // SecurityError/NotSupportedError：环境禁止（iframe 沙箱），降级；iframe 内的 NotAllowedError 同理
        if (err && (err.name === "SecurityError" || err.name === "NotSupportedError" || (inIframe && err.name === "NotAllowedError"))) enableLookFallback();
        // 其余 NotAllowedError 多为 Esc 后冷却期或缺少用户手势，不降级，下次点击重试
      });
    } catch (e) { enableLookFallback(); }
  }
  document.addEventListener("pointerlockerror", enableLookFallback);

  document.addEventListener("pointerlockchange", function () {
    var locked = document.pointerLockElement === canvas;
    if (locked) { hadLock = true; return; }
    if (hadLock && (state === "playing" || state === "intermission")) pauseGame();
  });
  document.addEventListener("mousemove", function (e) {
    var locked = document.pointerLockElement === canvas;
    if (!locked && !(lockFailed && (state === "playing" || state === "intermission") && el.overlay.hidden)) return;
    yaw -= (e.movementX || 0) * 0.0023;
    pitch = clamp(pitch - (e.movementY || 0) * 0.0023, -PITCH_LIM, PITCH_LIM);
  });
  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (state !== "playing" && state !== "intermission") return;
    if (!isTouch && document.pointerLockElement !== canvas && e.target === canvas) lockPointer();
    firing = true;
  });
  document.addEventListener("mouseup", function (e) {
    if (e.button === 0) firing = false;
  });
  stage.addEventListener("click", function () { // 战斗进行中点击战场任意处 = 重新锁定鼠标
    if (!isTouch && !lockFailed && (state === "playing" || state === "intermission") && document.pointerLockElement !== canvas) lockPointer();
  });
  stage.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  var viewMode = "fp"; // fp=第一人称 / tp=第三人称（V 键切换）
  document.addEventListener("keydown", function (e) {
    keys[e.code] = true;
    if (e.code === "KeyR") {
      if (state === "gameover") startGame();
      else if (state === "playing") startReload();
    } else if (e.code === "Space") {
      if (state === "playing" || state === "intermission") { jumpQueued = true; e.preventDefault(); }
    } else if (e.code === "KeyV") {
      if (state === "playing" || state === "intermission") {
        viewMode = viewMode === "fp" ? "tp" : "fp";
        setMsg(viewMode === "fp" ? "已切换：第一人称视角" : "已切换：第三人称视角");
      }
    } else if (e.code === "Escape") {
      if (lockFailed) pauseGame(); // 锁定模式靠 pointerlockchange 自动暂停
    } else if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3" || e.code === "Digit4") {
      if (state === "playing" || state === "intermission") switchWeapon(SLOT_KEYS[Number(e.code.slice(5)) - 1], false);
    }
  });
  document.addEventListener("keyup", function (e) { keys[e.code] = false; });
  window.addEventListener("blur", function () { keys = {}; firing = false; });

  el.ovBtn.addEventListener("click", function () {
    if (el.ovBtn.disabled) return;
    ac(); // AudioContext 需在用户手势中创建
    if (state === "paused") {
      resumeGame();
    } else {
      startGame();
      lockPointer();
    }
  });

  // ---------- 触屏：左摇杆移动 + 右侧拖动瞄准 + 开火/跳跃按钮 ----------
  var touchMove = null;
  var moveTouchId = null, lookTouchId = null;
  var moveOrigin = { x: 0, y: 0 }, lookLast = { x: 0, y: 0 };
  if (isTouch) {
    stage.addEventListener("touchstart", function (e) {
      if (state !== "playing" && state !== "intermission") return;
      var rect = stage.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var x = t.clientX - rect.left;
        if (x < rect.width * 0.45 && moveTouchId === null) {
          moveTouchId = t.identifier;
          moveOrigin.x = t.clientX; moveOrigin.y = t.clientY;
        } else if (x >= rect.width * 0.45 && lookTouchId === null) {
          lookTouchId = t.identifier;
          lookLast.x = t.clientX; lookLast.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    stage.addEventListener("touchmove", function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === moveTouchId) {
          var dx = clamp((t.clientX - moveOrigin.x) / 42, -1, 1);
          var dy = clamp((t.clientY - moveOrigin.y) / 42, -1, 1);
          touchMove = { x: dx, z: -dy };
          el.stickKnob.style.transform = "translate(" + (dx * 28) + "px," + (dy * 28) + "px)";
        } else if (t.identifier === lookTouchId) {
          yaw -= (t.clientX - lookLast.x) * 0.0042;
          pitch = clamp(pitch - (t.clientY - lookLast.y) * 0.0042, -PITCH_LIM, PITCH_LIM);
          lookLast.x = t.clientX; lookLast.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    var touchEnd = function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === moveTouchId) {
          moveTouchId = null;
          touchMove = null;
          el.stickKnob.style.transform = "";
        } else if (t.identifier === lookTouchId) {
          lookTouchId = null;
        }
      }
    };
    stage.addEventListener("touchend", touchEnd);
    stage.addEventListener("touchcancel", touchEnd);
    el.btnFire.addEventListener("touchstart", function (e) { firing = true; e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.btnFire.addEventListener("touchend", function (e) { firing = false; e.preventDefault(); }, { passive: false });
    el.btnJump.addEventListener("touchstart", function (e) { jumpQueued = true; e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.ovDesc.innerHTML = "明亮仓库里的第一人称生存射击。左侧虚拟摇杆移动，右侧拖动瞄准，🔥 开火，⬆️ 跳跃。<br>（建议使用桌面端获得完整体验）";
  }

  // ---------- 尺寸自适应 ----------
  function resize() {
    var w = canvas.clientWidth || stage.clientWidth || 960;
    var h = canvas.clientHeight || Math.round(w * 9 / 16);
    viewW = w; viewH = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (renderer) renderer.setSize(w, h, false);
  }
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") {
    try { new ResizeObserver(resize).observe(stage); } catch (e) {}
  }

  // ---------- 主循环 ----------
  var last = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    if (state === "playing" || state === "intermission") update(dt);
    if (player) {
      updateCamera(dt);
      updateGunRig();
    }
    syncHud();
    syncCursor();
    syncFloaters();
    drawRadar();
    el.touch.style.display = (isTouch && (state === "playing" || state === "intermission")) ? "block" : "none";
    if (renderer) renderer.render(scene, camera);
  }

  // ---------- 初始化 ----------
  buildHpSegs();
  buildSlots();
  reset();
  resize();
  requestAnimationFrame(frame);

  // ---------- 调试句柄（无头验证用） ----------
  window.__tps = {
    start: startGame,
    state: function () {
      return {
        state: state,
        wave: wave,
        score: score,
        zombies: zombies.length,
        elites: elites.length,
        bots: bots.length,
        hp: player ? player.hp : 0,
        weapon: player ? player.weapon : "none",
        gl: !!renderer
      };
    },
    step: function (sec) {
      // 同步快进：以固定 1/60 步长驱动逻辑（不依赖真实时钟）
      var n = Math.max(0, Math.floor((Number(sec) || 0) * 60));
      for (var i = 0; i < n; i++) update(1 / 60);
    },
    give: function (k) {
      if (k === "shotgun" || k === "gatling" || k === "sniper") grantWeapon(k);
      else if (k === "elite") spawnElite(); // 无头测试：直接召唤一只精英
    },
    eliteOrders: function () { return eliteLastOrders; }, // 最近一次收到的精英指令（无头测试用）
    eliteDebug: function () { // 精英内部状态（模式/冷却），仅调用时构造，不进热循环
      return elites.map(function (e) {
        return {
          id: e.id, mode: e.mode, pending: e.pending, hp: e.hp,
          x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10,
          cdSlam: Math.round(e.cdSlam * 10) / 10, cdCharge: Math.round(e.cdCharge * 10) / 10,
          cdSpit: Math.round(e.cdSpit * 10) / 10, cdRoar: Math.round(e.cdRoar * 10) / 10,
          cdSummon: Math.round(e.cdSummon * 10) / 10
        };
      });
    }
  };
})();
