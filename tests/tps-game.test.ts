// @ts-nocheck -- source-contract test reads browser scripts directly.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const game = readFileSync(new URL("../assets/js/tps-game.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../_pages/tps.md", import.meta.url), "utf8");
const gate = readFileSync(new URL("../assets/js/ai-gate.js", import.meta.url), "utf8");

describe("TPS game experience contract", () => {
  it("prepares AI inline before play and never requests a new session in eliteThink", () => {
    expect(game).toContain('getSession("elite", { mount: el.aiWidget })');
    const eliteThink = game.slice(game.indexOf("function eliteThink()"), game.indexOf("// ---------- 重置 / 流程"));
    expect(eliteThink).not.toContain("getSession(");
    expect(gate).toContain('dialog.className = inline ? "ai-gate-inline" : "ai-gate-dialog"');
  });

  it("keeps miss feedback subtle and applies double headshot damage", () => {
    expect(game).toContain('showCombatNote("又打偏了，你是人机吗", false)');
    expect(game).toContain("var HEADSHOT_MULT = 2");
    expect(game).toContain("wp.dmg * (hitArr[k].head ? HEADSHOT_MULT : 1)");
  });

  it("uses a larger arena, batched arrivals, and swept collision movement", () => {
    expect(game).toContain("var FIELD = 78");
    expect(game).toContain("function spawnZombieBurst()");
    expect(game).toContain("Math.min(6, 3 + Math.floor(wave / 3))");
    expect(game).toContain("Math.ceil(travel / 0.18)");
  });

  it("offers fullscreen pointer-lock immersion from the start screen", () => {
    expect(game).toContain("进入战场（全屏并锁定鼠标）");
    expect(page).toContain(".tps-stage:fullscreen");
    expect(game).toContain('stage.requestFullscreen({ navigationUI: "hide" })');
    expect(game).toContain("request.then(lockPointer).catch(lockPointer)");
  });
});
