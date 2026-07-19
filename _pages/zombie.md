---
layout: archive
title: "生化模式 · Zombie Mode"
permalink: /game/zombie/
author_profile: false
---

俯视角生存射击：带领 3 名幸存者抵御一波波尸潮 🧟（[← 返回游戏厅](/game/)）

**玩法**：<span class="zb-kbd-only">`WASD` / 方向键移动，鼠标瞄准，**按住左键射击**，`R` 换弹。</span><span class="zb-touch-only">左半屏按住拖出**虚拟摇杆**移动，右半屏按住瞄准射击。</span>队友由 **DeepSeek AI 指挥官**实时驱动（走位 + 战术喊话，掉线自动切回本地战术），但**被僵尸咬到的队友会变异成僵尸**——优先救他们！每肃清一波获得补给（弹药 / 医疗），**击杀母体必掉重武器箱**（💥 霰弹枪 / 🌀 加特林 / 🎯 巴雷特狙击，子弹打光自动切回步枪）。每 3 波出现**母体**（高血量重击）。你的血量归零即被感染，游戏结束。

<style>
#zombie-game { max-width: 940px; margin: 0.5em auto 0; }
.zb-hud { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; font-size: 14px; }
.zb-pill { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(110,160,90,0.25); border-radius: 999px; padding: 5px 15px; box-shadow: 0 1px 5px rgba(20,40,30,0.10); color: #44504a; white-space: nowrap; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.zb-pill b { color: #3d7a33; font-variant-numeric: tabular-nums; }
.zb-pill.zb-special { border-color: rgba(245,163,1,0.65); box-shadow: 0 1px 10px rgba(245,163,1,0.30); }
.zb-pill.zb-special b { color: #e8930c; }
.zb-hpbar { width: 84px; height: 8px; border-radius: 99px; background: rgba(0,0,0,0.12); overflow: hidden; }
#zb-hp-fill { display: block; height: 100%; width: 100%; border-radius: 99px; background: #5fbf6e; transition: width 0.15s ease; }
#zb-hp-fill.zb-low { background: #d9483b; }
.zb-stage { position: relative; border-radius: 18px; overflow: hidden; box-shadow: 0 12px 34px rgba(10,25,18,0.28), 0 2px 8px rgba(10,25,18,0.14); border: 1px solid rgba(255,255,255,0.10); }
#zb-canvas { width: 100%; aspect-ratio: 16 / 9; display: block; touch-action: none; cursor: crosshair; outline: none; background: #171a20; }
.zb-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(10,14,18,0.62); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); transition: opacity 0.25s ease; }
.zb-overlay[hidden] { display: none; }
.zb-overlay__card { text-align: center; color: #e8efe9; max-width: 480px; padding: 24px; }
.zb-overlay__card h2 { margin: 0 0 10px; font-size: 2rem; letter-spacing: 0.06em; color: #e8efe9; }
.zb-overlay__card p { margin: 0 0 18px; font-size: 0.95rem; line-height: 1.8; opacity: 0.85; }
#zb-overlay-btn { padding: 10px 34px; border: none; border-radius: 999px; background: linear-gradient(135deg, #7bc96a, #3d7a33); color: #fff; font-size: 16px; cursor: pointer; box-shadow: 0 4px 14px rgba(61,122,51,0.45); transition: transform 0.15s ease, box-shadow 0.15s ease; }
#zb-overlay-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(61,122,51,0.55); }
#zb-msg { margin-top: 12px; min-height: 1.5em; font-size: 15px; color: #5a6b62; text-align: center; }
/* 设备自适应：触屏设备显示触屏说明，隐藏键鼠说明 */
.zb-touch-only { display: none; }
@media (pointer: coarse) {
  .zb-kbd-only { display: none; }
  .zb-touch-only { display: inline; }
}
/* 手机端 HUD 紧凑化 */
@media (max-width: 640px) {
  .zb-hud { font-size: 12px; gap: 6px; margin-bottom: 8px; }
  .zb-pill { padding: 4px 10px; gap: 4px; }
  .zb-hpbar { width: 56px; }
  .zb-overlay__card h2 { font-size: 1.5rem; }
  .zb-overlay__card p { font-size: 0.85rem; }
  #zb-msg { font-size: 13px; }
}
</style>

<div id="zombie-game">
  <div class="zb-hud">
    <span class="zb-pill">❤️ <span class="zb-hpbar"><span id="zb-hp-fill"></span></span> <b id="zb-hp-text">100</b></span>
    <span class="zb-pill" id="zb-weapon-pill"><span id="zb-wname">🔫 步枪</span> <b id="zb-ammo">30 / 90</b></span>
    <span class="zb-pill">🌊 波次 <b id="zb-wave">–</b></span>
    <span class="zb-pill">💀 得分 <b id="zb-score">0</b></span>
    <span class="zb-pill">🧑‍🤝‍🧑 幸存者 <b id="zb-alive">4</b></span>
    <span class="zb-pill">🧠 <b id="zb-ai">本地战术</b></span>
  </div>
  <div class="zb-stage">
    <canvas id="zb-canvas" tabindex="0" aria-label="生化模式游戏画布"></canvas>
    <div class="zb-overlay" id="zb-overlay">
      <div class="zb-overlay__card">
        <h2 id="zb-overlay-title">生化模式</h2>
        <p id="zb-overlay-desc">尸潮将至。带领你的幸存者小队守住阵地——注意，被咬的队友会变成它们。击杀母体必掉重武器箱。<br><span class="zb-kbd-only">WASD 移动 · 鼠标瞄准 · 按住射击 · R 换弹</span><span class="zb-touch-only">左摇杆移动 · 右侧按住瞄准射击</span></p>
        <button id="zb-overlay-btn" type="button">开始游戏</button>
      </div>
    </div>
  </div>
  <div id="zb-msg" aria-live="polite">点击「开始游戏」进入战场。</div>
</div>

<script src="{{ '/assets/js/ai-gate.js' | relative_url }}" defer></script>
<script src="{{ '/assets/js/zombie-game.js' | relative_url }}" defer></script>
