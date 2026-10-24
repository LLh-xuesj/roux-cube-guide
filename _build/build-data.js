/*
 * build-data.js — 从验证过的中间数据生成网站数据 JS
 * 运行: node build-data.js   （必须在 verify.cjs 全部通过之后）
 */
"use strict";
const C = require("./cube-core.js");
const fs = require("fs");

const OUT_DIR = "../assets/js/data";
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- CMLL ----------
const cmllCases = JSON.parse(fs.readFileSync("cmll_decoded.json", "utf8"));
const FAMILY_ORDER = ["Solved", "H", "Pi", "U", "T", "Sune", "Anti Sune", "L"];
const FAMILY_ZH = {
  Solved: "O（角朝上）",
  H: "H",
  Pi: "Pi",
  U: "U",
  T: "T",
  Sune: "Sune",
  "Anti Sune": "Anti Sune",
  L: "L",
};
const BATCH = { Solved: 1, H: 1, Sune: 2, "Anti Sune": 2, Pi: 3, T: 3, U: 3, L: 3 };

function cmllHints(place) {
  // place: 4 个 U 角的 {piece, up, side, sideDir}
  // 顶面 U 色数量
  let topCount = 0;
  const sideStickers = { F: [], B: [], L: [], R: [] }; // 各侧面上的两个 U 角贴纸（面索引）
  for (const key in place) {
    const [x, y, z] = key.split(",").map(Number);
    const s = place[key];
    if (s.up === 0) topCount++;
    if (z === 1) sideStickers.F.push(s.side);
    else sideStickers.B.push(s.side);
    if (x === 1) sideStickers.R.push(s.side);
    else sideStickers.L.push(s.side);
  }
  const bars = [];
  for (const f of ["L", "R", "F", "B"]) {
    const [a, b] = sideStickers[f];
    if (a === b) bars.push(f);
  }
  const FACES_ZH = { L: "左", R: "右", F: "前", B: "后" };
  const parts = [];
  parts.push("顶面 U 色 " + topCount + " 个");
  if (bars.length) parts.push(bars.map((f) => FACES_ZH[f] + "侧同色成对").join("、"));
  else parts.push("侧面无同色对");
  return { topCount, bars, text: parts.join("；") };
}

const cmllOut = [];
let idx = 0;
for (const fam of FAMILY_ORDER) {
  for (const c of cmllCases.filter((x) => x.subgroup === fam)) {
    idx++;
    cmllOut.push({
      id: idx,
      family: fam,
      familyZh: FAMILY_ZH[fam],
      name: c.name,
      batch: BATCH[fam],
      algs: c.algs,
      place: c.place,
      hints: cmllHints(c.place),
    });
  }
}
fs.writeFileSync(
  OUT_DIR + "/cmll-data.js",
  "/* CMLL 42 case 数据 — 来源 speedcubedb.com（2026-10 抓取），全部公式经引擎验证 */\nwindow.CMLL_DATA = " +
    JSON.stringify(cmllOut) + ";\n"
);
console.log("cmll-data.js:", cmllOut.length, "cases");

// ---------- LSE ----------
const tables = JSON.parse(fs.readFileSync("lse_tables.json", "utf8"));
// 导出 token 作用表（浏览器端 solver 用）
const tokenActs = {};
for (const t of ["U:1", "U:2", "U:3", "M:1", "M:2", "M:3"]) {
  const [base, q] = t.split(":");
  tokenActs[base + (q === "2" ? "2" : q === "3" ? "'" : "")] = LSE_TOKEN(base, Number(q));
}
function LSE_TOKEN(base, quarter) {
  // 与 verify.cjs 相同的实现
  const POSN = tables.__posn || ["UF", "UR", "UB", "UL", "DF", "DB"];
  const POSV = { UF: [0, 1, 1], UR: [1, 1, 0], UB: [0, 1, -1], UL: [-1, 1, 0], DF: [0, -1, 1], DB: [0, -1, -1] };
  function build(perm, flip) {
    const place = {};
    for (let i = 0; i < 6; i++) place[POSV[POSN[i]].join(",")] = { piece: POSV[POSN[perm[i]]].join(","), flip: !!flip[i] };
    const s = C.newSolved();
    C.setEdges(s, place);
    return s;
  }
  function read(state) {
    const ls = C.lseState(state);
    return { perm: POSN.map((n) => POSN.indexOf(ls[n].piece)), flip: POSN.map((n) => (ls[n].good ? 0 : 1)) };
  }
  const s0 = build([0, 1, 2, 3, 4, 5], [0, 0, 0, 0, 0, 0]);
  C.applyToken(s0, { base, quarter });
  const r0 = read(s0);
  const permMap = [];
  for (let i = 0; i < 6; i++) permMap[i] = r0.perm.indexOf(i);
  const s1 = build([0, 1, 2, 3, 4, 5], [1, 1, 1, 1, 1, 1]);
  C.applyToken(s1, { base, quarter });
  const r1 = read(s1);
  const flipDelta = [];
  for (let i = 0; i < 6; i++) {
    const dest = r1.perm.indexOf(i);
    flipDelta[i] = 1 - r1.flip[dest];
  }
  return {
    permMap,
    flipDelta,
    uDelta: base === "U" ? quarter % 4 : 0,
    mDelta: base === "M" ? quarter % 4 : 0,
  };
}

// 浏览器端求解器逻辑（数据 + 代码都写入 lse-data.js）
const lseJs = `/* LSE 教学数据表 — 由 verify.cjs 穷举生成并全量验证 */
window.LSE_DATA = {
  POSN: ["UF","UR","UB","UL","DF","DB"],
  tokenActs: ${JSON.stringify(tokenActs)},
  eoTable: ${JSON.stringify(tables.eoTable)},
  ulurTable: ${JSON.stringify(tables.ulurTable)},
  c4Table: ${JSON.stringify(tables.c4Table)},
  /* 由打乱公式求状态: 返回 {perm, flip, u, m} */
  stateFromScramble(alg) {
    const D = this;
    let perm = [0,1,2,3,4,5], flip = [0,0,0,0,0,0], u = 0, m = 0;
    const toks = RouxCube.parseAlg(alg);
    for (const t of toks) {
      const key = t.base + (t.quarter === 1 ? "" : t.quarter === 2 ? "2" : "'");
      const a = D.tokenActs[key];
      if (!a) continue;
      const np = [], nf = [];
      for (let i = 0; i < 6; i++) { np[a.permMap[i]] = perm[i]; nf[a.permMap[i]] = flip[i] ^ a.flipDelta[i]; }
      perm = np; flip = nf;
      u = (u + a.uDelta) % 4; m = (m + a.mDelta) % 4;
    }
    return { perm, flip, u, m };
  },
  /* 应用一个 alg（tokenActs 层面） */
  applyAlg(state, alg) {
    const D = this;
    for (const t of RouxCube.parseAlg(alg)) {
      const key = t.base + (t.quarter === 1 ? "" : t.quarter === 2 ? "2" : "'");
      const a = D.tokenActs[key];
      if (!a) continue;
      const np = [], nf = [];
      for (let i = 0; i < 6; i++) { np[a.permMap[i]] = state.perm[i]; nf[a.permMap[i]] = state.flip[i] ^ a.flipDelta[i]; }
      state.perm = np; state.flip = nf;
      state.u = (state.u + a.uDelta) % 4; state.m = (state.m + a.mDelta) % 4;
    }
    return state;
  },
  /* 分步参考解: 返回 [{phase, alg}] 或 null */
  solve(state0) {
    const D = this;
    const st = { perm: state0.perm.slice(), flip: state0.flip.slice(), u: state0.u, m: state0.m };
    const phases = [];
    // 4a
    let bad = 0;
    for (let i = 0; i < 6; i++) if (st.flip[i]) bad |= 1 << i;
    const eo = D.eoTable.find((e) => e.bad.join(",") === D.POSN.filter((n, i) => (bad >> i) & 1).join(",") && e.m === st.m);
    if (!eo || eo.alg === null) return null;
    if (eo.alg) { phases.push({ phase: "4a", alg: eo.alg }); D.applyAlg(st, eo.alg); }
    if (!st.flip.every((f) => f === 0) || st.m !== 0) return null;
    // 4b: UL/UR 归位
    const ulPos = st.perm.indexOf(3), urPos = st.perm.indexOf(1);
    const b4 = D.ulurTable.find((e) => e.ul === D.POSN[ulPos] && e.ur === D.POSN[urPos] && e.u === st.u && e.m === st.m);
    if (!b4 || b4.alg === null) return null;
    if (b4.alg) { phases.push({ phase: "4b", alg: b4.alg }); D.applyAlg(st, b4.alg); }
    if (!(st.perm[3] === 3 && st.perm[1] === 1)) return null;
    // 4c
    const key = st.perm.map((i) => D.POSN[i]).join(",");
    const c4 = D.c4Table.find((e) => e.state.join(",") === key && e.m === st.m);
    if (!c4 || c4.alg === null) return null;
    if (c4.alg) { phases.push({ phase: "4c", alg: c4.alg }); D.applyAlg(st, c4.alg); }
    const ok = st.perm.join("") === "012345" && st.flip.every((f) => f === 0) && st.u === 0 && st.m === 0;
    return ok ? phases : null;
  }
};
`;
fs.writeFileSync(OUT_DIR + "/lse-data.js", lseJs);
console.log("lse-data.js written");

// ---------- 引擎复制 ----------
fs.copyFileSync("cube-core.js", "../assets/js/cube-core.js");
console.log("cube-core.js copied");

// ---------- 全量复核: 浏览器端同款 solver 逻辑在 Node 里跑一遍 ----------
{
  const POSN = ["UF", "UR", "UB", "UL", "DF", "DB"];
  // 重新加载写出的数据（模拟浏览器）
  const sandbox = { window: {}, RouxCube: C };
  global.window = sandbox.window;
  global.RouxCube = C;
  eval(fs.readFileSync(OUT_DIR + "/lse-data.js", "utf8"));
  const D = window.LSE_DATA;
  // 11520 合法出口态
  const legal = [];
  const permOf = (p) => { let s = 0; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (p[i] > p[j]) s ^= 1; return s; };
  for (let pi = 0; pi < 720; pi++) {
    const p = []; let x = pi; const avail = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < 6; i++) { const f = x % avail.length; x = (x - f) / avail.length; p.push(avail.splice(f, 1)[0]); }
    if (permOf(p) !== 0) continue;
    for (let fm = 0; fm < 64; fm++) {
      const flip = [0, 1, 2, 3, 4, 5].map((i) => (fm >> i) & 1);
      if (flip.reduce((a, b) => a + b, 0) % 2 !== 0) continue;
      legal.push({ perm: p.slice(), flip, u: 0, m: 0 });
    }
  }
  let ok = 0;
  for (const st of legal) {
    const phases = D.solve(st);
    if (phases) ok++;
  }
  console.log("Node 复核: 11520 出口态求解:", ok, "/ 11520");
  if (ok !== 11520) process.exit(1);
  // 随机 <U,M> 打乱 2000 例
  const rnd = (n) => Math.floor(Math.random() * n);
  const MOVES = ["U", "U'", "U2", "M", "M'", "M2"];
  let ok2 = 0;
  for (let t = 0; t < 2000; t++) {
    const scr = Array.from({ length: 14 }, () => MOVES[rnd(6)]).join(" ");
    const st = D.stateFromScramble(scr);
    const phases = D.solve(st);
    if (!phases) continue;
    // 应用验证
    const back = D.applyAlg({ perm: st.perm.slice(), flip: st.flip.slice(), u: st.u, m: st.m }, phases.map((p) => p.alg).join(" "));
    if (back.perm.join("") === "012345" && back.flip.every((f) => f === 0) && back.u === 0 && back.m === 0) ok2++;
    else { console.log("随机态失败:", scr); break; }
  }
  console.log("Node 复核: 随机打乱求解+应用验证:", ok2, "/ 2000");
  if (ok2 < 1990) process.exit(1);
}

// ---------- FB/SB 演示场景 ----------
// 每个 demo: {name, note, scramble(从solved生成起点), alg, goal}
// goal: 'fb' 左桥完成 | 'sb' 右桥完成 | 'solved' 全复原
function checkDemo(d) {
  const s = C.newSolved();
  C.applyAlg(s, d.scramble);
  C.applyAlg(s, d.alg);
  if (d.goal === "solved") return C.isSolved(s);
  if (d.goal === "fb") {
    // 左桥 6 件: L心 DL FL BL DFL DBL
    const pieces = [[-1,0,0],[-1,-1,0],[-1,0,1],[-1,0,-1],[-1,-1,1],[-1,-1,-1]];
    return pieces.every((h) => {
      const c = C.cubieAt(s, h);
      return c && c.home.join(",") === h.join(",") && c.o.join(",") === C.I3.join(",");
    });
  }
  if (d.goal === "sb") {
    const pieces = [[1,0,0],[1,-1,0],[1,0,1],[1,0,-1],[1,-1,1],[1,-1,-1]];
    return pieces.every((h) => {
      const c = C.cubieAt(s, h);
      return c && c.home.join(",") === h.join(",") && c.o.join(",") === C.I3.join(",");
    });
  }
  return false;
}
function describeState(d) {
  // 起点态描述: 哪些桥件不在位
  const s = C.newSolved();
  C.applyAlg(s, d.scramble);
  const names = { "0,1,1": "UF", "1,1,0": "UR", "0,1,-1": "UB", "-1,1,0": "UL", "0,-1,1": "DF", "0,-1,-1": "DB", "1,0,1": "FR", "-1,0,1": "FL", "1,0,-1": "BR", "-1,0,-1": "BL", "1,-1,0": "DR", "-1,-1,0": "DL", "1,1,1": "UFR", "-1,1,1": "UFL", "1,1,-1": "UBR", "-1,1,-1": "UBL", "1,-1,1": "DFR", "-1,-1,1": "DFL", "1,-1,-1": "DBR", "-1,-1,-1": "DBL" };
  const out = [];
  const targets = d.goal === "sb"
    ? [[1,0,0],[1,-1,0],[1,0,1],[1,0,-1],[1,-1,1],[1,-1,-1]]
    : [[-1,0,0],[-1,-1,0],[-1,0,1],[-1,0,-1],[-1,-1,1],[-1,-1,-1]];
  for (const h of targets) {
    const c = C.cubieAt(s, h);
    const home = c.home.join(",");
    if (home !== h.join(",")) out.push(names[h.join(",")] + "槽←" + (names[home] || home));
  }
  return out.join("、") || "已完成";
}

const demoCandidates_raw = [
  // FB: 顶层棱插入 FL 槽（L U L' 类）
  { name: "FB·棱插入", note: "FL 棱在顶层，U 调整后用 L U L' 插入", scramble: "L U' L' U", alg: "U' L U L'", goal: "fb" },
  // FB: keyhole —— 角在 D 层用 D 转开插入
  { name: "FB·keyhole", note: "角块借 D 层空槽（DR）归位", scramble: "L D' L' U", alg: "U' L D L'", goal: "fb" },
  // FB: 角棱对同时
  { name: "FB·角棱对", note: "一对角棱同时插入", scramble: "L' U2 L U L' U' L", alg: "L' U' L U' L' U L", goal: "fb" },
  // SB: r 技法插入（无整体转体）
  { name: "SB·r 技法", note: "用 r 代替整体转体插入右桥", scramble: "R' U' R U r' U' r", alg: "r' U r U' R' U' R", goal: "sb" },
  // SB: 普通插入
  { name: "SB·棱插入", note: "FR 棱从顶层插入", scramble: "R U R' U'", alg: "U R U' R'", goal: "sb" },
];
const demos = [];
for (const d0 of demoCandidates_raw) {
  const d = { ...d0, scramble: C.invertAlg(d0.alg) };
  // 检查 scramble 后确实“未完成”，alg 后达成目标
  const s0 = C.newSolved(); C.applyAlg(s0, d.scramble);
  const done0 = checkDemo({ ...d, alg: "" });
  const done1 = checkDemo(d);
  if (!done0 && done1) {
    demos.push({ ...d, startDesc: describeState(d) });
    console.log("demo OK:", d.name, "|", describeState(d));
  } else {
    console.log("demo FAIL:", d.name, "起点已完成?", done0, "终点达成?", done1);
  }
}
fs.writeFileSync(
  OUT_DIR + "/demos-data.js",
  "/* FB/SB 技法演示场景 — 起点与解法均经引擎验证 */\nwindow.DEMOS_DATA = " + JSON.stringify(demos) + ";\n"
);
console.log("demos-data.js:", demos.length, "demos");
console.log("\nBUILD OK");
