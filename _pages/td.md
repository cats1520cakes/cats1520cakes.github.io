---
layout: archive
title: "王国防线 · Tower Defense"
permalink: /game/td/
author_profile: false
---

双路进犯的明快风塔防：在红黄两路军团的汇合处布防，守住水晶基地 🏰（[← 返回游戏厅](/game/)）

**玩法**：点击绿色**建造牌**选择塔（🏹 箭塔 / 💣 炮塔 / ❄️ 冰塔），点击已建的塔可**升级**（3 级）或**出售**（返还 70%）。击杀得金币，漏怪扣生命（20 点，BOSS 扣 5）。撑过 10 波即胜利，之后可继续无尽模式冲分。

<style>
#td-game { max-width: 940px; margin: 0.5em auto 0; }
.td-hud { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; font-size: 14px; }
.td-pill { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.72); border: 1px solid rgba(110,160,90,0.25); border-radius: 999px; padding: 5px 15px; box-shadow: 0 1px 5px rgba(20,40,30,0.10); color: #44504a; white-space: nowrap; }
.td-pill b { color: #3d7a33; font-variant-numeric: tabular-nums; }
.td-stage { position: relative; border-radius: 18px; overflow: hidden; box-shadow: 0 12px 34px rgba(30,60,40,0.18); }
#td-canvas { width: 100%; aspect-ratio: 16/9; display: block; touch-action: none; cursor: pointer; background: #8fbf6a; outline: none; }
.td-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(18,34,24,0.55); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 6; transition: opacity 0.25s ease; }
.td-overlay[hidden] { display: none; }
.td-overlay__card { text-align: center; color: #eef5ec; max-width: 500px; padding: 24px; }
.td-overlay__card h2 { margin: 0 0 10px; font-size: 2rem; letter-spacing: 0.04em; color: #eef5ec; }
.td-overlay__card p { margin: 0 0 18px; font-size: 0.95rem; line-height: 1.9; opacity: 0.88; }
#td-overlay-btn, #td-overlay-btn2 { min-height: 44px; padding: 10px 30px; margin: 0 5px; border: none; border-radius: 999px; background: linear-gradient(135deg, #7bc96a, #3d7a33); color: #fff; font-size: 16px; cursor: pointer; box-shadow: 0 4px 14px rgba(61,122,51,0.45); transition: transform 0.15s ease, box-shadow 0.15s ease; }
#td-overlay-btn:hover, #td-overlay-btn2:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(61,122,51,0.55); }
#td-overlay-btn2 { background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.45); box-shadow: none; }
#td-overlay-btn2[hidden] { display: none; }
.td-panel { position: absolute; z-index: 5; min-width: 172px; background: rgba(255,255,255,0.96); border: 1px solid rgba(110,160,90,0.35); border-radius: 14px; padding: 10px; box-shadow: 0 10px 26px rgba(25,50,35,0.22); transform: translate(-50%, 16px); }
.td-panel--above { transform: translate(-50%, calc(-100% - 16px)); }
.td-panel__title { font-size: 13px; font-weight: 700; color: #3d4a40; text-align: center; margin-bottom: 6px; }
.td-panel__stats { font-size: 12px; color: #6a7a6e; text-align: center; margin: -2px 0 6px; }
.td-panel button { display: block; width: 100%; min-height: 40px; margin: 4px 0; border: 1px solid rgba(90,140,80,0.4); border-radius: 10px; background: #f4f9ef; color: #33463a; font-size: 14px; cursor: pointer; transition: background 0.12s ease; }
.td-panel button b { color: #3d7a33; }
.td-panel button:disabled { opacity: 0.45; cursor: not-allowed; }
.td-panel button:not(:disabled):hover { background: #e6f3dc; }
.td-panel button[data-sell] { background: #fdf3ec; border-color: rgba(190,120,70,0.4); }
#td-msg { margin-top: 12px; min-height: 1.5em; font-size: 15px; color: #5a6b62; text-align: center; }
#td-now-btn { min-height: 40px; margin-left: 10px; padding: 6px 18px; border: none; border-radius: 999px; background: linear-gradient(135deg, #ffd75e, #e8a91c); color: #5a3d00; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 3px 10px rgba(232,169,28,0.4); vertical-align: middle; }
#td-now-btn:hover { filter: brightness(1.05); }
#td-now-btn[hidden] { display: none; }
@media (max-width: 640px) {
  .td-hud { font-size: 12px; gap: 6px; margin-bottom: 8px; }
  .td-pill { padding: 4px 10px; gap: 4px; }
  .td-overlay__card h2 { font-size: 1.5rem; }
  .td-overlay__card p { font-size: 0.85rem; }
  #td-msg { font-size: 13px; }
  .td-panel { min-width: 150px; }
}
</style>

<div id="td-game">
  <div class="td-hud">
    <span class="td-pill">💰 金币 <b id="td-gold">180</b></span>
    <span class="td-pill">🌊 波次 <b id="td-wave">–</b></span>
    <span class="td-pill">❤️ 生命 <b id="td-lives">20</b></span>
    <span class="td-pill">💀 击杀 <b id="td-kills">0</b></span>
  </div>
  <div class="td-stage" id="td-stage">
    <canvas id="td-canvas" tabindex="0" aria-label="王国防线塔防游戏画布"></canvas>
    <div class="td-overlay" id="td-overlay">
      <div class="td-overlay__card">
        <h2 id="td-overlay-title">王国防线 · Tower Defense</h2>
        <p id="td-overlay-desc">红黄两路军团沿蜿蜒小径进犯，在桥头汇合后直扑水晶基地！<br>点击绿色建造牌布防：🏹 箭塔 70 · 💣 炮塔 110 · ❄️ 冰塔 90<br>守住 <b>10</b> 波即胜利，之后可继续无尽模式冲分。</p>
        <button id="td-overlay-btn" type="button">开始游戏</button>
        <button id="td-overlay-btn2" type="button" hidden>重新开始</button>
      </div>
    </div>
  </div>
  <div id="td-msg"><span id="td-msg-text">点击「开始游戏」布防防线。红方上路 · 黄方下路，两军将在桥头汇合！</span><button id="td-now-btn" type="button" hidden>⚡ 立即出怪 +15 💰</button></div>
</div>

<script src="{{ '/assets/js/td-game.js' | relative_url }}" defer></script>
