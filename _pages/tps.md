---
layout: archive
title: "生死狙击 · 变异战 3D"
permalink: /game/tps/
author_profile: false
---

第一人称射击（FPS）：明亮工业仓库里的变异体围剿战（[← 返回游戏厅](/game/)）

**玩法**：`WASD` 移动，`Shift` 疾跑，`Space` 跳跃（可跳上矮箱），鼠标视角，**按住左键射击**，`R` 换弹，`1~4` 切枪，`V` 切换第一/第三人称，`Esc` 暂停。开局前一次性完成 AI 验证，进入战斗后不再弹窗；桌面端默认进入全屏并锁定鼠标。**立体战场**：斜坡、高台和风洞组成扩展仓库，尸潮会成批降临并提前预警。爆头造成双倍伤害。规则同 2D 版：队友被咬会变异，击杀母体必掉重武器（💥霰弹枪/🌀加特林/🎯巴雷特）。手机端提供虚拟摇杆 + 拖动瞄准。

<style>
#tps-game { max-width: 1120px; margin: 0.5em auto 0; }
.tps-stage { position: relative; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 34px rgba(20,25,15,0.30), 0 2px 8px rgba(20,25,15,0.16); border: 1px solid rgba(60,70,40,0.35); }
#tps-canvas { width: 100%; aspect-ratio: 16 / 9; display: block; outline: none; cursor: crosshair; background: #8f887a; touch-action: none; }
.tps-stage:fullscreen { width: 100vw; height: 100vh; max-width: none; border: 0; border-radius: 0; background: #080b09; }
.tps-stage:fullscreen #tps-canvas { width: 100%; height: 100%; aspect-ratio: auto; }
.tps-stage:fullscreen .tps-hud { position: fixed; }
/* ---------- HUD 覆盖层（生死狙击页游布局） ---------- */
.tps-hud { position: absolute; inset: 0; pointer-events: none; font-family: inherit; user-select: none; -webkit-user-select: none; }
/* 左上：圆形雷达 + 模式名 */
.tps-radar-wrap { position: absolute; top: 12px; left: 12px; }
#tps-radar { width: 124px; height: 124px; border-radius: 50%; border: 2px solid rgba(200,220,170,0.45); box-shadow: 0 2px 10px rgba(0,0,0,0.35), inset 0 0 18px rgba(0,0,0,0.4); display: block; }
.tps-mode { margin-top: 5px; text-align: center; color: #ffd97a; font-weight: 700; font-size: 15px; letter-spacing: 0.3em; text-shadow: 0 1px 4px rgba(0,0,0,0.7); }
/* 顶部中央：波次 / 计时 / 得分 */
.tps-topbar { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); display: flex; align-items: stretch; background: rgba(14,19,14,0.58); border: 1px solid rgba(200,220,170,0.4); border-radius: 6px; color: #dfe8d0; font-size: 14px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.3); white-space: nowrap; }
.tps-topbar > span { padding: 5px 14px; display: inline-flex; align-items: center; gap: 5px; }
.tps-topbar > span + span { border-left: 1px solid rgba(200,220,170,0.25); }
.tps-topbar b { color: #ffd97a; font-variant-numeric: tabular-nums; }
.tps-topbar .tps-topbar__mid b { font-size: 16px; color: #fff; }
/* 右上：击杀信息滚动 */
.tps-feed { position: absolute; top: 12px; right: 14px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; max-width: 46%; }
.tps-feed__item { background: rgba(14,19,14,0.62); border: 1px solid rgba(200,220,170,0.32); border-left: 3px solid #c0392b; color: #e6eedd; font-size: 12.5px; padding: 3px 10px; border-radius: 4px; white-space: nowrap; animation: tpsFeed 4s ease forwards; }
.tps-feed__item b { color: #ffd97a; }
.tps-feed__item.tps-feed--green { border-left-color: #4da332; }
@keyframes tpsFeed { 0% { opacity: 0; transform: translateX(24px); } 7% { opacity: 1; transform: none; } 82% { opacity: 1; } 100% { opacity: 0; } }
/* 左下：头像 + HP 段条 */
.tps-vitals { position: absolute; left: 14px; bottom: 14px; display: flex; align-items: center; gap: 9px; background: rgba(14,19,14,0.55); border: 1px solid rgba(200,220,170,0.35); border-radius: 8px; padding: 8px 12px 8px 8px; }
.tps-portrait { width: 46px; height: 46px; border-radius: 6px; border: 1px solid rgba(255,217,122,0.5); background: linear-gradient(160deg, #33402a, #1c2416); display: flex; align-items: center; justify-content: center; font-size: 27px; box-shadow: inset 0 0 10px rgba(0,0,0,0.4); }
.tps-vitals__name { font-size: 12px; color: #b9c6ac; margin-bottom: 4px; letter-spacing: 0.08em; }
.tps-vitals__name b { color: #ffd97a; }
.tps-hpsegs { display: flex; gap: 2px; width: 158px; }
.tps-hpsegs span { flex: 1; height: 11px; background: rgba(0,0,0,0.5); border: 1px solid rgba(120,200,90,0.30); transform: skewX(-12deg); }
.tps-hpsegs span.on { background: linear-gradient(180deg, #8fe06a, #4da332); box-shadow: 0 0 4px rgba(120,220,80,0.5); }
.tps-hpsegs.low span.on { background: linear-gradient(180deg, #ff8a6a, #d9382b); border-color: rgba(255,120,90,0.5); }
/* 右下：武器 + 大号斜体弹药 */
.tps-weaponbox { position: absolute; right: 16px; bottom: 14px; text-align: right; background: rgba(14,19,14,0.55); border: 1px solid rgba(200,220,170,0.35); border-radius: 8px; padding: 7px 13px; }
.tps-weaponbox__name { font-size: 13px; color: #b9c6ac; letter-spacing: 0.05em; }
.tps-weaponbox__ammo { line-height: 1.05; }
.tps-weaponbox__ammo b { font-size: 34px; font-style: italic; font-weight: 800; color: #ffffff; text-shadow: 0 2px 6px rgba(0,0,0,0.65); font-variant-numeric: tabular-nums; }
.tps-weaponbox__ammo span { color: #cfd8c8; font-size: 15px; font-variant-numeric: tabular-nums; }
.tps-weaponbox__slots { display: flex; gap: 4px; justify-content: flex-end; margin-top: 5px; }
.tps-slot { width: 26px; height: 26px; border: 1px solid rgba(200,220,170,0.35); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 13px; opacity: 0.22; background: rgba(10,14,10,0.55); position: relative; }
.tps-slot.owned { opacity: 1; }
.tps-slot.active { border-color: #ffd97a; box-shadow: 0 0 7px rgba(255,217,122,0.55); }
.tps-slot em { position: absolute; top: -7px; left: -4px; font-size: 9px; color: #ffd97a; font-style: normal; text-shadow: 0 1px 2px #000; }
/* 中央准星（开火扩散） */
.tps-cross { position: absolute; left: 50%; top: 50%; width: 0; height: 0; --g: 5px; }
.tps-cross i { position: absolute; background: rgba(235,245,230,0.95); box-shadow: 0 0 3px rgba(0,0,0,0.9); }
.tps-cross i:nth-child(1) { left: -1px; top: calc(-1 * var(--g) - 9px); width: 2px; height: 9px; }
.tps-cross i:nth-child(2) { left: -1px; top: var(--g); width: 2px; height: 9px; }
.tps-cross i:nth-child(3) { top: -1px; left: calc(-1 * var(--g) - 9px); height: 2px; width: 9px; }
.tps-cross i:nth-child(4) { top: -1px; left: var(--g); height: 2px; width: 9px; }
.tps-cross s { position: absolute; left: -1.5px; top: -1.5px; width: 3px; height: 3px; background: rgba(235,245,230,0.95); border-radius: 50%; }
/* 击杀奖牌（红金，照页游"斩"奖牌感） */
.tps-medal { position: absolute; left: 50%; top: 55%; transform: translate(-50%,-50%); font-size: 46px; font-weight: 900; font-style: italic; letter-spacing: 0.08em; color: #ff3b2e; -webkit-text-stroke: 1.5px #7a0e08; text-shadow: 0 0 4px #ffd700, 0 3px 10px rgba(0,0,0,0.7), 0 0 26px rgba(255,80,40,0.55); opacity: 0; pointer-events: none; white-space: nowrap; }
.tps-medal.show { animation: tpsMedal 0.95s ease-out; }
.tps-medal.gold { color: #ffd94a; -webkit-text-stroke-color: #7a5a08; text-shadow: 0 0 4px #fff2b0, 0 3px 10px rgba(0,0,0,0.7), 0 0 26px rgba(255,210,60,0.6); }
@keyframes tpsMedal { 0% { opacity: 0; transform: translate(-50%,-50%) scale(2.4); } 16% { opacity: 1; transform: translate(-50%,-50%) scale(1); } 72% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%,-58%) scale(0.94); } }
/* 波次横幅 */
.tps-banner { position: absolute; top: 20%; left: 0; right: 0; text-align: center; font-size: 2rem; font-weight: 800; letter-spacing: 0.1em; color: #ffd97a; text-shadow: 0 2px 14px rgba(0,0,0,0.8); opacity: 0; pointer-events: none; }
.tps-combat-note { position: absolute; left: 50%; bottom: 21%; transform: translateX(-50%); min-height: 1.4em; padding: 4px 11px; border-radius: 999px; background: rgba(10,14,10,0.48); color: #dce5d6; font-size: 13px; letter-spacing: 0.04em; text-shadow: 0 1px 3px #000; opacity: 0; transition: opacity 0.14s ease; pointer-events: none; white-space: nowrap; }
.tps-combat-note.show { opacity: 0.82; }
.tps-combat-note.headshot { color: #ffd35c; background: rgba(70,38,8,0.62); }
/* 受伤红晕 */
.tps-hurt { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, transparent 48%, rgba(190,25,25,0.6)); opacity: 0; }
/* 飘字 */
.tps-floater { position: absolute; left: 0; top: 0; pointer-events: none; font-weight: 700; font-size: 15px; text-shadow: 0 1px 4px rgba(0,0,0,0.85); white-space: nowrap; display: none; }
/* 触屏控件 */
.tps-touch { position: absolute; inset: 0; display: none; }
.tps-stick { position: absolute; left: 26px; bottom: 88px; width: 104px; height: 104px; border-radius: 50%; border: 2px solid rgba(230,240,220,0.35); background: rgba(20,26,18,0.3); }
.tps-stick__knob { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: rgba(230,240,220,0.45); }
.tps-tbtn { position: absolute; width: 62px; height: 62px; border-radius: 50%; border: 2px solid rgba(230,240,220,0.4); background: rgba(20,26,18,0.4); color: #fff; font-size: 24px; pointer-events: auto; }
#tps-btn-fire { right: 26px; bottom: 128px; background: rgba(160,40,30,0.5); }
#tps-btn-jump { right: 104px; bottom: 66px; }
/* 遮罩 */
.tps-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(12,15,10,0.66); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); transition: opacity 0.25s ease; pointer-events: auto; }
.tps-overlay[hidden] { display: none; }
.tps-overlay__card { text-align: center; color: #eef2e6; max-width: 490px; padding: 24px; }
.tps-overlay__card h2 { margin: 0 0 10px; font-size: 2rem; letter-spacing: 0.06em; color: #eef2e6; }
.tps-overlay__card p { margin: 0 0 18px; font-size: 0.95rem; line-height: 1.8; opacity: 0.85; }
#tps-overlay-btn { padding: 10px 34px; border: none; border-radius: 999px; background: linear-gradient(135deg, #7bc96a, #3d7a33); color: #fff; font-size: 16px; cursor: pointer; box-shadow: 0 4px 14px rgba(61,122,51,0.45); transition: transform 0.15s ease, box-shadow 0.15s ease; }
#tps-overlay-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(61,122,51,0.55); }
#tps-overlay-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }
.tps-ai-preflight { min-height: 0; margin: 0 auto 14px; }
.tps-ai-preflight__status { margin: 0 0 10px !important; color: #b9c6ac; font-size: 0.82rem !important; line-height: 1.45 !important; }
.tps-ai-preflight__status.ready { color: #9fe18c; }
.tps-ai-preflight .ai-gate-inline { display: block; }
.tps-ai-preflight .ai-gate-card { width: min(100%, 420px); margin: 0 auto; padding: 14px; border-color: rgba(255,217,122,0.35); border-radius: 12px; background: rgba(17,24,18,0.92); color: #eef2e6; box-shadow: none; text-align: left; }
.tps-ai-preflight .ai-gate-card h2 { font-size: 1rem; color: #ffd97a; }
.tps-ai-preflight .ai-gate-card p { font-size: 0.8rem; }
.tps-ai-preflight .ai-gate-card button { color: #eef2e6; border-color: rgba(200,220,170,0.42); }
.tps-record { margin: 12px 0 0 !important; font-size: 0.82rem !important; color: #ffd97a; opacity: 0.9 !important; min-height: 1.2em; }
#tps-msg { margin-top: 12px; min-height: 1.5em; font-size: 15px; color: #5a6b62; text-align: center; }
/* 手机端紧凑化 */
@media (max-width: 640px) {
  #tps-radar { width: 84px; height: 84px; }
  .tps-mode { font-size: 12px; }
  .tps-topbar { font-size: 12px; }
  .tps-topbar > span { padding: 4px 8px; }
  .tps-vitals { padding: 5px 8px 5px 5px; }
  .tps-portrait { width: 34px; height: 34px; font-size: 20px; }
  .tps-hpsegs { width: 108px; }
  .tps-weaponbox__ammo b { font-size: 24px; }
  .tps-banner { font-size: 1.4rem; }
  .tps-medal { font-size: 32px; }
  #tps-msg { font-size: 13px; }
}
</style>

<div id="tps-game">
  <div class="tps-stage">
    <canvas id="tps-canvas" tabindex="0" aria-label="生死狙击变异战游戏画布"></canvas>
    <div class="tps-hud">
      <div class="tps-radar-wrap">
        <canvas id="tps-radar" width="140" height="140"></canvas>
        <div class="tps-mode">变异战</div>
      </div>
      <div class="tps-topbar">
        <span>🌊 第 <b id="tps-top-wave">–</b> 波</span>
        <span class="tps-topbar__mid"><b id="tps-top-time">00:00</b></span>
        <span>🧟 剩余 <b id="tps-top-left">–</b></span>
        <span>💀 <b id="tps-top-score">0</b></span>
      </div>
      <div class="tps-feed" id="tps-feed"></div>
      <div class="tps-vitals">
        <div class="tps-portrait">🪖</div>
        <div>
          <div class="tps-vitals__name">人类幸存者 ×<b id="tps-alive">4</b></div>
          <div class="tps-hpsegs" id="tps-hp-segs"></div>
        </div>
      </div>
      <div class="tps-weaponbox">
        <div class="tps-weaponbox__name" id="tps-wname">🔫 M4 步枪</div>
        <div class="tps-weaponbox__ammo"><b id="tps-ammo-mag">30</b><span> / </span><span id="tps-ammo-res">90</span></div>
        <div class="tps-weaponbox__slots" id="tps-slots"></div>
      </div>
      <div class="tps-cross" id="tps-cross"><i></i><i></i><i></i><i></i><s></s></div>
      <div class="tps-medal" id="tps-medal"></div>
      <div class="tps-banner" id="tps-banner"></div>
      <div class="tps-combat-note" id="tps-combat-note" aria-live="polite"></div>
      <div class="tps-hurt" id="tps-hurt"></div>
      <div class="tps-touch" id="tps-touch">
        <div class="tps-stick" id="tps-stick"><div class="tps-stick__knob" id="tps-stick-knob"></div></div>
        <button class="tps-tbtn" id="tps-btn-fire" type="button">🔥</button>
        <button class="tps-tbtn" id="tps-btn-jump" type="button">⬆️</button>
      </div>
      <div class="tps-overlay" id="tps-overlay">
        <div class="tps-overlay__card">
          <h2 id="tps-overlay-title">生死狙击 · 变异战</h2>
          <p id="tps-overlay-desc">扩展仓库里的第一人称生存射击。尸潮成批降临并提前预警；爆头造成双倍伤害。队友会保持阵型、规避近身威胁并寻找射击位置。<br><b>开局前完成一次 AI 验证；进入战斗后不再弹窗。桌面端全屏并锁定鼠标，Esc 释放并暂停。</b><br>WASD 移动 · Shift 疾跑 · Space 跳跃 · 按住左键射击 · R 换弹 · 1~4 切枪 · V 切换视角</p>
          <div class="tps-ai-preflight" id="tps-ai-preflight">
            <p class="tps-ai-preflight__status" id="tps-ai-status">AI 精英指挥将在开局前准备；也可选择本地 AI，不影响游戏。</p>
            <div id="tps-ai-widget"></div>
          </div>
          <button id="tps-overlay-btn" type="button">准备战场</button>
          <p class="tps-record" id="tps-record"></p>
        </div>
      </div>
    </div>
  </div>
  <div id="tps-msg" aria-live="polite">点击「进入战场」锁定鼠标（指针即准星），Esc 释放暂停。</div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="{{ '/assets/js/ai-gate.js' | relative_url }}" defer></script>
<script src="{{ '/assets/js/tps-game.js' | relative_url }}" defer></script>
