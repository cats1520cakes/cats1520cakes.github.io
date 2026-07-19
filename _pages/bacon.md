---
layout: archive
title: "扔培根 · Bacon Toss"
permalink: /game/bacon/
author_profile: false
---

写论文写累了？来扔几片培根放松一下 🥓 → 🍳（[← 返回游戏厅](/game/)）

**玩法**：按住画布向后拖拽瞄准（会显示弹道预览），松手把培根甩进煎锅。落在锅中心触发 **PERFECT** 加分；风向和风力每一锅都会变（留意飘落的树叶🍃），连续命中有连击加成；每命中 5 锅升一级 —— 等级越高，锅越小、还会左右移动！键盘可用方向键瞄准、`Space` 发射；按 `R` 键或点按钮可重新开始。

<style>
#bacon-game { max-width: 940px; margin: 0.5em auto 0; }
.bg-hud { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; font-size: 14px; }
.bg-pill { background: rgba(255,255,255,0.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(217,72,59,0.16); border-radius: 999px; padding: 5px 15px; box-shadow: 0 1px 5px rgba(30,60,90,0.08); color: #4a5560; white-space: nowrap; }
.bg-pill b { color: #d9483b; font-variant-numeric: tabular-nums; }
@keyframes bgPop { 0% { transform: scale(1); } 40% { transform: scale(1.16); } 100% { transform: scale(1); } }
.bg-pill.bg-pop { animation: bgPop 0.35s ease; }
#bg-restart { margin-left: auto; padding: 6px 18px; border: none; border-radius: 999px; background: linear-gradient(135deg, #ff7a59, #d9483b); color: #fff; cursor: pointer; font-size: 14px; line-height: 1.6; box-shadow: 0 2px 8px rgba(217,72,59,0.35); transition: transform 0.15s ease, box-shadow 0.15s ease; }
#bg-restart:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(217,72,59,0.45); }
#bg-restart:active { transform: translateY(0); }
.bg-stage { border-radius: 18px; overflow: hidden; box-shadow: 0 12px 34px rgba(30,60,90,0.18), 0 2px 8px rgba(30,60,90,0.10); border: 1px solid rgba(255,255,255,0.65); }
#bacon-canvas { width: 100%; aspect-ratio: 16 / 9; display: block; touch-action: none; cursor: crosshair; outline: none; }
#bacon-canvas:focus-visible { box-shadow: inset 0 0 0 2px rgba(217,72,59,0.45); }
#bg-message { margin-top: 12px; min-height: 1.5em; font-size: 15px; color: #5a6b7a; text-align: center; }
</style>

<div id="bacon-game">
  <div class="bg-hud">
    <span class="bg-pill">🍳 得分 <b id="bg-score">0</b></span>
    <span class="bg-pill">🔥 连击 <b id="bg-streak">0</b></span>
    <span class="bg-pill">🏆 最佳 <b id="bg-best">0</b></span>
    <span class="bg-pill">🎚️ 等级 <b id="bg-level">1</b></span>
    <span class="bg-pill" id="bg-wind">🌬️ 风 <b>· 0</b> m/s</span>
    <button id="bg-restart" type="button">↻ 重新开始</button>
  </div>
  <div class="bg-stage">
    <canvas id="bacon-canvas" tabindex="0" aria-label="扔培根小游戏画布" aria-describedby="bg-message"></canvas>
  </div>
  <div id="bg-message" aria-live="polite">按住画布向后拖拽瞄准，松手扔出培根！🥓</div>
</div>

<script src="{{ '/assets/js/bacon-game.js' | relative_url }}" defer></script>
