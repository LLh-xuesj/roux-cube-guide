/*
 * test-autoreset.cjs — autoReset（播完自动复位）端到端验证
 * Node 桩 DOM + 手动 rAF 泵 + 真实 setTimeout，直接跑 cube-view.js 的真引擎。
 * 覆盖：
 *   1) cmll.html 路径：42 case 全部 —— newSolved+setCorners → setBase → playAlg(主公式)
 *      → 播完终态应为复原态；800ms 后应自动回到 case 打乱态
 *   2) basics.html 路径：base=invert(alg) 的 9+3 条
 *   3) lse.html 路径：loadAlg（要求 baseState 一并落盘）
 *   4) 竞态：播放中重播 / 800ms 停留期内重播，都应正常播完并复位
 */
const fs = require("fs");
const path = require("path");

const C = require(path.join(__dirname, "..", "assets", "js", "cube-core.js"));
global.RouxCube = C; // cube-view.js 顶部读 window.RouxCube

// ---------- 桩 DOM ----------
function makeEl(tag) {
  const el = {
    tag, style: {}, children: [], dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(ch) { el.children.push(ch); return ch; },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, setPointerCapture() {},
    querySelector(sel) { el._qs = el._qs || {}; return el._qs[sel] || (el._qs[sel] = makeEl("div")); },
    querySelectorAll() { return []; },
  };
  if (tag === "canvas") {
    const noop = () => {};
    el.getContext = () => new Proxy({ canvas: el }, {
      get(t, p) {
        if (p === "createRadialGradient") return () => ({ addColorStop() {} });
        if (p in t) return t[p];
        return noop;
      },
      set(t, p, v) { t[p] = v; return true; },
    });
  }
  return el;
}
const docListeners = {};
global.document = {
  documentElement: { dataset: { theme: "dark" } },
  createElement: makeEl,
  createElementNS: (_ns, tag) => makeEl(tag),
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener() {},
  dispatchEvent(ev) { (docListeners[ev.type] || []).forEach((f) => f(ev)); },
};
global.CustomEvent = class { constructor(type) { this.type = type; } };
global.window = global;
global.self = global;
global.devicePixelRatio = 1;

// rAF 泵：手动推进 16ms/帧
let rafSeq = 0;
const rafMap = new Map();
global.requestAnimationFrame = (cb) => { rafMap.set(++rafSeq, cb); return rafSeq; };
global.cancelAnimationFrame = (id) => { rafMap.delete(id); };

// 加载真 cube-view.js（IIFE）
(0, eval)(fs.readFileSync(path.join(__dirname, "..", "assets", "js", "cube-view.js"), "utf8"));
const CubeView = global.CubeView;

// ---------- 测试辅助 ----------
let simNow = 1000;
function pump(maxFrames) {
  for (let i = 0; i < maxFrames && rafMap.size; i++) {
    const cbs = [...rafMap.values()];
    rafMap.clear();
    simNow += 16;
    for (const cb of cbs) cb(simNow);
  }
}
function pumpUntilDone(view, maxFrames = 3000) {
  pump(maxFrames);
  return !view.plan && !view.playing;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (st) => JSON.stringify(st.cubies);
const isSolvedState = (st) => snap(st) === snap(C.newSolved());
// CMLL 只管角：8 个角贴全部回位即算复原（棱由 LSE 管，乱是正常）
const cornersSolved = (st) => {
  for (let f = 0; f < 6; f++) {
    const g = C.faceGrid(st, f);
    for (const [r, c] of [[0, 0], [0, 2], [2, 0], [2, 2]]) if (g[r][c] !== f) return false;
  }
  return true;
};
const sameState = (a, b) => snap(a) === snap(b);

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("FAIL " + name + (extra ? "  " + extra : "")); }
}

async function playAndExpectReset(view, label, { corners = false } = {}) {
  view.playAlg(view.pendingAlg);
  const done = pumpUntilDone(view);
  if (!done) { check(label + " 播放收敛", false, "plan 未在帧预算内结束"); return false; }
  const endOk = corners ? cornersSolved(view.state) : isSolvedState(view.state);
  check(label + (corners ? " 播完=角复原" : " 播完=复原态"), endOk);
  await sleep(950); // autoReset 定时 800ms
  const back = !view.playing && !view.plan && sameState(view.state, view.baseState);
  check(label + " 播完自动复位", back);
  return back;
}

(async function main() {
  // ---- 1) cmll.html 路径：42 case 主公式 ----
  (0, eval)(fs.readFileSync(path.join(__dirname, "..", "assets", "js", "data", "cmll-data.js"), "utf8"));
  const DATA = global.CMLL_DATA;
  check("cmll-data 载入", DATA.length === 42, "42 case");
  for (const c of DATA) {
    const st = C.newSolved();
    C.setCorners(st, c.place);
    const view = new CubeView(makeEl("div"), { size: 128, controls: false, speed: 1, autoReset: true });
    view.setBase(st);
    view.pendingAlg = c.algs[0];
    await playAndExpectReset(view, "#" + c.id + " " + c.name, { corners: true });
  }

  // ---- 2) basics.html 路径：base = invert(alg) ----
  const BASICS = [
    "R U R' U R U2 R'", "R U2' R' U' R U' R'", "(R U2 R' U') (R U R' U') R U' R'",
    "F (R U R' U') F'", "(R U R' U') (R' F R F')", "F' (r U R' U') r' F R", "F (R U R' U')2 F'",
    "(R U R' F') (R U R' U') R' F R2 U'",
    "F (R U' R' U') (R U R' F') (R U R' U') (R' F R F')",
    "U' M' U M'", "M2 U2 M2 U2", "M' U2 M2 U2 M'",
  ];
  for (const alg of BASICS) {
    const view = new CubeView(makeEl("div"), { size: 150, controls: false, autoReset: true });
    view.setBase(C.runAlg(C.invertAlg(alg)));
    view.pendingAlg = alg;
    await playAndExpectReset(view, "basics " + alg);
  }

  // ---- 3) lse.html 路径：loadAlg（baseState 应一并落盘）----
  const lv = new CubeView(makeEl("div"), { size: 230, autoReset: true });
  lv.loadAlg("M' U2 M2 U2 M'");
  check("loadAlg 落盘 baseState", !!lv.baseState && sameState(lv.baseState, C.runAlg(C.invertAlg("M' U2 M2 U2 M'"))));
  lv.pendingAlg = "M' U2 M2 U2 M'";
  await playAndExpectReset(lv, "loadAlg 路径");
  check("播完 ▶ 变 ↻ 重播态", lv.container.querySelector(".cv-play").textContent === "↻",
    "textContent=" + JSON.stringify(lv.container.querySelector(".cv-play").textContent));

  // ---- 4) 竞态：播放中重播 / 停留期内重播 ----
  const rv = new CubeView(makeEl("div"), { size: 150, controls: false, autoReset: true });
  rv.setBase(C.runAlg(C.invertAlg("R U R' U R U2 R'")));
  rv.pendingAlg = "R U R' U R U2 R'";
  rv.playAlg(rv.pendingAlg);
  pump(30); // 播到约一半
  rv.playAlg(rv.pendingAlg); // 中途重播
  await playAndExpectResetFinal(rv, "播放中重播");

  const rv2 = new CubeView(makeEl("div"), { size: 150, controls: false, autoReset: true });
  rv2.setBase(C.runAlg(C.invertAlg("R U R' U R U2 R'")));
  rv2.pendingAlg = "R U R' U R U2 R'";
  rv2.playAlg(rv2.pendingAlg);
  pumpUntilDone(rv2);
  await sleep(300); // 800ms 停留期内
  rv2.playAlg(rv2.pendingAlg); // 停留期内重播（旧 resetTimer 应被清掉）
  await playAndExpectResetFinal(rv2, "停留期内重播");

  async function playAndExpectResetFinal(view, label) {
    const done = pumpUntilDone(view);
    check(label + " 播放收敛", done);
    if (!done) return;
    await sleep(950);
    check(label + " 播完自动复位", !view.playing && !view.plan && sameState(view.state, view.baseState));
  }

  console.log("\n" + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
