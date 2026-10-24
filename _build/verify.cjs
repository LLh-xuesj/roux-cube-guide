/*
 * verify.cjs — 引擎与数据的自动化校验 + 教学数据表生成
 * 运行: node verify.cjs   （全部通过后生成 lse_tables.json / cmll_decoded.json）
 */
"use strict";
const C = require("./cube-core.js");
const fs = require("fs");

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passCount++; }
  else { failCount++; failures.push(name + (detail ? " — " + detail : "")); console.log("FAIL:", name, detail || ""); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

// ============ 1. 基础代数 ============
section("1. 转动代数健全性");
{
  const moves = ["U", "D", "L", "R", "F", "B", "M", "E", "S", "x", "y", "z", "u", "d", "l", "r", "f", "b"];
  const scramble = "R U r' F2 d L2 M' B' f z2 E u2 l' D";
  for (const mv of moves) {
    const s1 = C.runAlg(scramble + " " + mv + " " + mv + "'");
    check(mv + " " + mv + "' = 恒等", C.keyOf(C.runAlg(scramble)) === C.keyOf(s1));
  }
  const eq = (a, b) => C.keyOf(C.runAlg(scramble + " " + a)) === C.keyOf(C.runAlg(scramble + " " + b));
  check("x = R M' L'", eq("x", "R M' L'"));
  check("y = U E' D'", eq("y", "U E' D'"));
  check("z = F S B'", eq("z", "F S B'"));
  check("r = R M'", eq("r", "R M'"));
  check("u = U E'", eq("u", "U E'"));
  check("f = F S", eq("f", "F S"));
  { const s = C.runAlg("R"); check("R: DFR→UFR", C.cornerInfo(s)["1,1,1"].piece === "1,-1,1"); }
  {
    const s = C.runAlg("M2 U M2 U2 M2 U M2");
    const ci = C.cornerInfo(s);
    let cornersFixed = true;
    for (const k in ci) if (ci[k].piece !== k) cornersFixed = false;
    check("H-perm (M2 U M2 U2 M2 U M2) 保角", cornersFixed);
  }
}

// ============ 2. 真·EO 定义（单棱轨道）============
section("2. 坏棱规则（F/B 轴 EO, 单棱轨道法）");
// 规则候选: “好棱 ⟺ U/D 色贴纸朝 U/D 面”
// 真 EO: 好状态集 = <R,L,U,D,F2,B2> 单棱轨道。两者须在全部 12 棱位上一致。
{
  const G = ["R", "L", "U", "D", "F2", "B2"];
  const EDGE_HOMES = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if ([x, y, z].filter((v) => v !== 0).length === 2) EDGE_HOMES.push([x, y, z]);
  }
  function canonKey(home, pos, o) {
    const parts = [];
    for (let a = 0; a < 3; a++) {
      if (home[a] === 0) continue;
      const n = [0, 0, 0]; n[a] = home[a];
      const w = C.matVec(o, n);
      parts.push(a + ">" + w.join(","));
    }
    return parts.sort().join(";") + "@" + pos.join(",");
  }
  const LSE_SET = new Set(["0,1,1","1,1,0","0,1,-1","-1,1,0","0,-1,1","0,-1,-1"]);
  let mismatch = 0, lseMismatch = 0;
  for (const home of EDGE_HOMES) {
    const start = { pos: home.slice(), o: C.I3.slice() };
    const seen = new Set([canonKey(home, start.pos, start.o)]);
    const q = [start];
    while (q.length) {
      const st = q.shift();
      for (const mv of G) {
        const s = { cubies: [{ home: home.slice(), pos: st.pos.slice(), o: st.o.slice() }] };
        C.applyToken(s, { base: mv.replace("2", ""), quarter: mv.includes("2") ? 2 : 1 });
        const c = s.cubies[0];
        const k = canonKey(home, c.pos, c.o);
        if (!seen.has(k)) { seen.add(k); q.push({ pos: c.pos, o: c.o }); }
      }
    }
    for (const pos of EDGE_HOMES) {
      for (let flip = 0; flip < 2; flip++) {
        const s = C.newSolved();
        C.setEdges(s, { [pos.join(",")]: { piece: home.join(","), flip } });
        const c = C.cubieAt(s, pos);
        const nUD = [0, home[1], 0];
        const w = C.matVec(c.o, nUD);
        const ruleGood = Math.abs(w[1]) === 1;
        const inOrbit = seen.has(canonKey(home, c.pos, c.o));
        if (ruleGood !== inOrbit) {
          mismatch++;
          if (LSE_SET.has(pos.join(",")) && LSE_SET.has(home.join(","))) lseMismatch++;
          if (mismatch <= 8) console.log("  不一致:", JSON.stringify(home), "@", JSON.stringify(pos), "flip=", flip, "rule=", ruleGood, "orbit=", inOrbit);
        }
      }
    }
  }
  console.log("  全 12 棱位不一致总数(仅中层位有差异, 属正常):", mismatch);
  check("LSE 六棱子集上 规则(U/D贴纸朝UD=好) == 真 EO 轨道", lseMismatch === 0, lseMismatch + " 处不一致");
}

// ============ 3. 六棱谜题（含 uMod）============
section("3. LSE 六棱群（含角块 AUF 追踪）");
const LSE = (() => {
  const POSN = ["UF", "UR", "UB", "UL", "DF", "DB"];
  const POSV = { UF: [0, 1, 1], UR: [1, 1, 0], UB: [0, 1, -1], UL: [-1, 1, 0], DF: [0, -1, 1], DB: [0, -1, -1] };

  function build(perm, flip) {
    const place = {};
    for (let i = 0; i < 6; i++) {
      place[POSV[POSN[i]].join(",")] = { piece: POSV[POSN[perm[i]]].join(","), flip: !!flip[i] };
    }
    const s = C.newSolved();
    C.setEdges(s, place);
    return s;
  }
  function read(state) {
    const ls = C.lseState(state);
    const perm = [], flip = [];
    for (let i = 0; i < 6; i++) {
      perm[i] = POSN.indexOf(ls[POSN[i]].piece);
      flip[i] = ls[POSN[i]].good ? 0 : 1;
    }
    return { perm, flip };
  }
  function tokenAction(base, quarter) {
    const permMap = new Array(6), flipDelta = new Array(6);
    {
      const s = build([0, 1, 2, 3, 4, 5], [0, 0, 0, 0, 0, 0]);
      C.applyToken(s, { base, quarter });
      const r = read(s);
      for (let i = 0; i < 6; i++) permMap[i] = r.perm.indexOf(i);
    }
    {
      const s = build([0, 1, 2, 3, 4, 5], [1, 1, 1, 1, 1, 1]);
      C.applyToken(s, { base, quarter });
      const r = read(s);
      for (let i = 0; i < 6; i++) {
        const dest = r.perm.indexOf(i);
        flipDelta[i] = 1 - r.flip[dest];
      }
    }
    const uDelta = base === "U" ? quarter % 4 : 0;
    // 中心环(U/D/F/B 中心)位置转动量: M 方向 +1 (U中心→F)
    const mDelta = base === "M" ? quarter % 4 : 0;
    return { permMap, flipDelta, uDelta, mDelta };
  }
  function algAction(alg) {
    const toks = C.parseAlg(alg).map((t) => tokenAction(t.base, t.quarter));
    let cur = [];
    for (let i = 0; i < 6; i++) cur[i] = { pos: i, flip: 0 };
    let u = 0, m = 0;
    for (const a of toks) {
      cur = cur.map((st) => ({ pos: a.permMap[st.pos], flip: st.flip ^ a.flipDelta[st.pos] }));
      u = (u + a.uDelta) % 4;
      m = (m + a.mDelta) % 4;
    }
    return { permMap: cur.map((s) => s.pos), flipDelta: cur.map((s) => s.flip), uDelta: u, mDelta: m };
  }
  function applyAction(state, act) {
    const perm = new Array(6), flip = new Array(6);
    for (let i = 0; i < 6; i++) {
      perm[act.permMap[i]] = state.perm[i];
      flip[act.permMap[i]] = state.flip[i] ^ act.flipDelta[i];
    }
    return { perm, flip, u: (state.u + act.uDelta) % 4, m: (state.m + act.mDelta) % 4 };
  }
  // 合法 CMLL 出口态: 角已解 ⟹ 棱排列偶排列 + 翻转和偶
  const legalInputs = (() => {
    const out = [];
    const permOf = (p) => { let s = 0; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (p[i] > p[j]) s ^= 1; return s; };
    for (let pi = 0; pi < 720; pi++) {
      const p = []; let x = pi; const avail = [0, 1, 2, 3, 4, 5];
      for (let i = 0; i < 6; i++) { const f = x % avail.length; x = (x - f) / avail.length; p.push(avail.splice(f, 1)[0]); }
      if (permOf(p) !== 0) continue;
      for (let fm = 0; fm < 64; fm++) {
        const flip = [0, 1, 2, 3, 4, 5].map((i) => (fm >> i) & 1);
        if (flip.reduce((a, b) => a + b, 0) % 2 !== 0) continue;
        out.push({ perm: p.slice(), flip, u: 0, m: 0 });
      }
    }
    return out;
  })();
  return { POSN, POSV, build, read, tokenAction, algAction, applyAction, legalInputs };
})();

{
  const aU = LSE.tokenAction("U", 1), aM2 = LSE.tokenAction("M", 2), aM = LSE.tokenAction("M", 1);
  check("U 不翻棱", aU.flipDelta.every((d) => d === 0));
  check("M2 不翻棱", aM2.flipDelta.every((d) => d === 0));
  check("M 恰翻 4 棱", aM.flipDelta.filter((d) => d === 1).length === 4);
  check("合法 CMLL 出口态数 = 11520", LSE.legalInputs.length === 11520, String(LSE.legalInputs.length));
}

// ============ 4. LSE 三相求解器 ============
section("4. LSE 三相求解器（4a EO → 4b UL/UR → 4c）");
const TABLES = (() => {
  const aU = LSE.tokenAction("U", 1), aU2 = LSE.tokenAction("U", 2), aUi = LSE.tokenAction("U", 3);
  const aM = LSE.tokenAction("M", 1), aM2 = LSE.tokenAction("M", 2), aMi = LSE.tokenAction("M", 3);
  const stKey = (st) => st.perm.join("") + "|" + st.flip.join("") + "|" + st.u + "|" + st.m;

  // ---- 4a: 坏棱位置集合动力学 ----
  const ALGS_4A = ["M' U M", "M U' M'", "M' U' M", "M U M'", "M' U2 M", "M U2 M'", "U", "U2", "U'", "M' U M'", "M2", "M", "M'"];
  const acts4A = ALGS_4A.map((alg) => ({ alg, act: LSE.algAction(alg) }));
  const stepBad = (bad, act) => {
    let nb = 0;
    for (let i = 0; i < 6; i++) if (((bad >> i) & 1) ^ act.flipDelta[i]) nb |= 1 << act.permMap[i];
    return nb;
  };
  const inv = (alg) => C.invertAlg(alg);
  // BFS over (坏集, m): 目标 (0, 0) —— 4a 同时归零坏棱与中心偏转
  const parent4a = new Map(); parent4a.set("0|0", null);
  {
    const q = [{ b: 0, m: 0 }];
    while (q.length) {
      const { b, m } = q.shift();
      for (const g of acts4A) {
        const nb = stepBad(b, g.act);
        const nm = (m + g.act.mDelta) % 4;
        const k = nb + "|" + nm;
        if (!parent4a.has(k)) { parent4a.set(k, { from: b + "|" + m, gen: g.alg }); q.push({ b: nb, m: nm }); }
      }
    }
  }
  const solve4a = (state) => {
    let bad = 0;
    for (let i = 0; i < 6; i++) if (state.flip[i]) bad |= 1 << i;
    const startK = bad + "|" + (state.m || 0);
    if (!parent4a.has(startK)) return null;
    const seq = [];
    let cur = startK;
    while (cur !== "0|0") { const p = parent4a.get(cur); seq.push(inv(p.gen)); cur = p.from; }
    return seq;
  };

  // ---- 4b: UL/UR 归位 ----
  const b4b = new Map();
  {
    const isGoal = (p) => p[1] === 1 && p[3] === 3;
    const q = [];
    for (let pi = 0; pi < 720; pi++) {
      const p = []; let x = pi; const avail = [0, 1, 2, 3, 4, 5];
      for (let i = 0; i < 6; i++) { const f = x % avail.length; x = (x - f) / avail.length; p.push(avail.splice(f, 1)[0]); }
      if (!isGoal(p)) continue;
      const parG = (() => { let s = 0; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (p[i] > p[j]) s ^= 1; return s; })();
      if (parG !== 0) continue; // 4b 结束时 m 为偶 ⟹ 4c 输入环排列必为偶
      for (const m of [0, 2]) {
        const k = p.join("") + "|0|" + m;
        if (!b4b.has(k)) { b4b.set(k, { d: 0, move: null }); q.push({ perm: p, u: 0, m }); }
      }
    }
    const aMU2Mi = LSE.algAction("M' U2 M"); // 净翻转 0 的关键生成元
    const invGens = [
      { alg: "U", act: aUi }, { alg: "U2", act: aU2 }, { alg: "U'", act: aU }, { alg: "M2", act: aM2 },
      { alg: "M U2 M'", act: LSE.algAction("M U2 M'") }, { alg: "M' U2 M", act: aMU2Mi },
    ];
    while (q.length) {
      const st = q.shift();
      const d = b4b.get(st.perm.join("") + "|" + st.u + "|" + st.m).d;
      for (const g of invGens) {
        const ns = LSE.applyAction({ perm: st.perm, flip: [0, 0, 0, 0, 0, 0], u: st.u, m: st.m }, g.act);
        const k = ns.perm.join("") + "|" + ns.u + "|" + ns.m;
        if (!b4b.has(k)) { b4b.set(k, { d: d + 1, move: g.alg }); q.push({ perm: ns.perm, u: ns.u, m: ns.m }); }
      }
    }
  }
  const solve4b = (state) => {
    const seq = [];
    let cur = { perm: state.perm.slice(), flip: [0, 0, 0, 0, 0, 0], u: state.u, m: state.m };
    for (let guard = 0; guard < 24; guard++) {
      const e = b4b.get(cur.perm.join("") + "|" + cur.u + "|" + cur.m);
      if (!e) return null;
      if (e.d === 0) break;
      const gens = [{ alg: "U", act: aU }, { alg: "U2", act: aU2 }, { alg: "U'", act: aUi }, { alg: "M2", act: aM2 }, { alg: "M' U2 M", act: LSE.algAction("M' U2 M") }, { alg: "M U2 M'", act: LSE.algAction("M U2 M'") }];
      let moved = false;
      for (const g of gens) {
        const ns = LSE.applyAction(cur, g.act);
        const ne = b4b.get(ns.perm.join("") + "|" + ns.u + "|" + ns.m);
        if (ne && ne.d === e.d - 1) { seq.push(g.alg); cur = ns; moved = true; break; }
      }
      if (!moved) return null;
    }
    return seq;
  };

  // ---- 4c: 完全复原 ----
  const b4c = new Map();
  {
    const solved = { perm: [0, 1, 2, 3, 4, 5], flip: [0, 0, 0, 0, 0, 0], u: 0, m: 0 };
    b4c.set(stKey(solved), { d: 0, move: null });
    const q = [solved];
    const invGens = [
      { alg: "U", act: aUi }, { alg: "U2", act: aU2 }, { alg: "U'", act: aU },
      { alg: "M", act: aMi }, { alg: "M2", act: aM2 }, { alg: "M'", act: aM },
    ];
    while (q.length) {
      const st = q.shift();
      const d = b4c.get(stKey(st)).d;
      if (d >= 11) continue;
      for (const g of invGens) {
        const ns = LSE.applyAction(st, g.act);
        const k = stKey(ns);
        if (!b4c.has(k)) { b4c.set(k, { d: d + 1, move: g.alg }); q.push(ns); }
      }
    }
  }
  const solve4c = (state) => {
    const seq = [];
    let cur = { perm: state.perm.slice(), flip: state.flip.slice(), u: state.u, m: state.m };
    for (let guard = 0; guard < 30; guard++) {
      const e = b4c.get(stKey(cur));
      if (!e) return null;
      if (e.d === 0) break;
      const gens = [
        { alg: "U", act: aU }, { alg: "U2", act: aU2 }, { alg: "U'", act: aUi },
        { alg: "M", act: aM }, { alg: "M2", act: aM2 }, { alg: "M'", act: aMi },
      ];
      let moved = false;
      for (const g of gens) {
        const ns = LSE.applyAction(cur, g.act);
        const ne = b4c.get(stKey(ns));
        if (ne && ne.d === e.d - 1) { seq.push(g.alg); cur = ns; moved = true; break; }
      }
      if (!moved) return null;
    }
    return seq;
  };

  function solve(state) {
    let cur = { perm: state.perm.slice(), flip: state.flip.slice(), u: 0, m: 0 };
    const phases = [];
    const s4a = solve4a(cur);
    if (!s4a) return { error: "4a 无解" };
    phases.push(["4a", s4a]);
    for (const a of s4a) cur = LSE.applyAction(cur, LSE.algAction(a));
    if (!cur.flip.every((f) => f === 0)) return { error: "4a 后仍有坏棱" };
    const s4b = solve4b(cur);
    if (!s4b) return { error: "4b 无解" };
    phases.push(["4b", s4b]);
    for (const a of s4b) cur = LSE.applyAction(cur, LSE.algAction(a));
    if (!(cur.perm[1] === 1 && cur.perm[3] === 3)) return { error: "4b 后 UL/UR 未归位" };
    if (!cur.flip.every((f) => f === 0)) return { error: "4b 后出现坏棱" };
    const s4c = solve4c(cur);
    if (!s4c) return { error: "4c 无解" };
    phases.push(["4c", s4c]);
    for (const a of s4c) cur = LSE.applyAction(cur, LSE.algAction(a));
    const ok = cur.perm.join("") === "012345" && cur.flip.every((f) => f === 0) && cur.u === 0 && cur.m === 0;
    return { phases, ok };
  }

  let ok = 0; const failSamples = [];
  for (const st of LSE.legalInputs) {
    const r = solve(st);
    if (r && r.ok) ok++;
    else if (failSamples.length < 3) failSamples.push(JSON.stringify(st) + " → " + JSON.stringify(r));
  }
  check(`三相求解器解出全部 ${LSE.legalInputs.length} 个 CMLL 出口态`, ok === LSE.legalInputs.length,
    `${LSE.legalInputs.length - ok} 失败; ${failSamples.join(" ; ")}`);

  // 4a 教学表
  const eoTable = [];
  for (let bad = 0; bad < 64; bad++) {
    const bits = [0, 1, 2, 3, 4, 5].filter((i) => (bad >> i) & 1);
    if (bits.length % 2 !== 0) continue;
    for (let m = 0; m < 4; m++) {
      const seq = solve4a({ perm: [0, 1, 2, 3, 4, 5], flip: [0, 1, 2, 3, 4, 5].map((i) => (bad >> i) & 1), u: 0, m });
      eoTable.push({ bad: bits.map((i) => LSE.POSN[i]), m, alg: seq ? seq.join(" ") : null });
    }
  }
  // 4b 教学表: (UL件位置, UR件位置) -> 序列
  const ulurTable = [];
  for (let ulPos = 0; ulPos < 6; ulPos++) for (let urPos = 0; urPos < 6; urPos++) {
    if (ulPos === urPos) continue;
    const perm = new Array(6);
    perm[ulPos] = 3; perm[urPos] = 1;
    const used = new Set([3, 1]);
    let nxt = 0;
    for (let i = 0; i < 6; i++) if (perm[i] == null) { while (used.has(nxt)) nxt++; perm[i] = nxt; used.add(nxt); }
    const par = (() => { let s = 0; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (perm[i] > perm[j]) s ^= 1; return s; })();
    for (let u = 0; u < 4; u++) {
      // 同一 (ulPos,urPos) 类含两种排列奇偶; 查询态的 u 与其自身排列奇偶一致。
      // 为每个 u 选一个奇偶 ≡ u 的代表态求最短解。
      let p2 = perm.slice();
      if ((par % 2) !== (u % 2)) {
        // 交换两个非 UL/UR 槽的件以翻转奇偶 (取前两个非 1/3 的位置)
        const idxs = [0, 2, 4, 5].filter((i) => p2[i] !== 3 && p2[i] !== 1);
        const t = p2[idxs[0]]; p2[idxs[0]] = p2[idxs[1]]; p2[idxs[1]] = t;
      }
      const seq = solve4b({ perm: p2, flip: [0, 0, 0, 0, 0, 0], u, m: 0 });
      ulurTable.push({ ul: LSE.POSN[ulPos], ur: LSE.POSN[urPos], u, m: 0, alg: seq ? seq.join(" ") : null });
    }
  }
  // 4c 教学表: UL/UR 已好的偶排列
  const c4Table = [];
  {
    const perms = [];
    const slots = [0, 2, 4, 5];
    const rec = (arr, idx, cur) => {
      if (arr.length === 0) { perms.push(cur.slice()); return; }
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        cur[slots[idx]] = v;
        rec([...arr.slice(0, i), ...arr.slice(i + 1)], idx + 1, cur);
      }
    };
    rec([0, 2, 4, 5], 0, [null, 1, null, 3, null, null]);
    for (const p of perms) {
      const par = (() => { let s = 0; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (p[i] > p[j]) s ^= 1; return s; })();
      if (par !== 0) continue;
      for (const m of [0, 2]) {
        const seq = solve4c({ perm: p, flip: [0, 0, 0, 0, 0, 0], u: 0, m });
        c4Table.push({ state: p.map((i) => LSE.POSN[i]), u: 0, m, alg: seq ? seq.join(" ") : null });
      }
    }
  }
  return { solve, eoTable, ulurTable, c4Table };
})();

// ============ 5. CMLL 数据校验 ============
section("5. CMLL：jcube 解码 + setup 对照 + 公式验证");
{
  const cases = JSON.parse(fs.readFileSync(__dirname + "/cmll_raw.json", "utf8"));
  check("case 数 = 42", cases.length === 42, String(cases.length));
  const MAPS = [
    { name: "L=r/R=o", y: 0, w: 3, g: 2, b: 5, r: 4, o: 1 },
    { name: "L=o/R=r", y: 0, w: 3, g: 2, b: 5, r: 1, o: 4 },
  ];
  function decodeCaseFull(c, map) {
    const j = c.jcube;
    const col = (ch) => (ch === "l" ? null : map[ch]);
    const defs = [
      { pos: [1, 1, 1], u: j.us[8], f: j.uf[2], r: j.ur[0] },
      { pos: [-1, 1, 1], u: j.us[6], f: j.uf[0], r: j.ul[2] },
      { pos: [1, 1, -1], u: j.us[2], f: j.ub[0], r: j.ur[2] },
      { pos: [-1, 1, -1], u: j.us[0], f: j.ub[2], r: j.ul[0] },
    ];
    const place = {};
    for (const d of defs) {
      const fU = col(d.u), fF = col(d.f), fR = col(d.r);
      if (fU == null || fF == null || fR == null) return null;
      let piece = null;
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        const faces = [y === 1 ? 0 : 3, x === 1 ? 1 : 4, z === 1 ? 2 : 5].sort((a, b) => a - b).join("");
        if (faces === [fU, fF, fR].sort((a, b) => a - b).join("")) piece = [x, y, z].join(",");
      }
      if (!piece) return null;
      place[d.pos.join(",")] = { piece, up: fU, side: fF, sideDir: d.pos[2] === 1 ? [0, 0, 1] : [0, 0, -1] };
    }
    return place;
  }
  function cornerStateKey(state) {
    const ci = C.cornerInfo(state);
    return ["1,1,1", "-1,1,1", "1,1,-1", "-1,1,-1"].map((k) => {
      const c = ci[k];
      return c.piece + ":" + c.up + ":" + c.front + ":" + c.back;
    }).join("|");
  }
  function cornersSolved(state) {
    const ci = C.cornerInfo(state);
    for (const k in ci) {
      const [x, y, z] = k.split(",").map(Number);
      const c = ci[k];
      if (c.piece !== k) return false;
      if (c.up !== (y === 1 ? 0 : -1)) return false;
      if (c.down !== (y === -1 ? 3 : -1)) return false;
      if (c.right !== (x === 1 ? 1 : -1)) return false;
      if (c.left !== (x === -1 ? 4 : -1)) return false;
      if (c.front !== (z === 1 ? 2 : -1)) return false;
      if (c.back !== (z === -1 ? 5 : -1)) return false;
    }
    return true;
  }
  let bestMap = null;
  for (const map of MAPS) {
    let okCount = 0;
    for (const c of cases) {
      try {
        const place = decodeCaseFull(c, map);
        if (!place) continue;
        if (cornerStateKey(C.runAlg(c.setup)) === cornerStateKey(C.setCorners(C.newSolved(), place))) okCount++;
      } catch (e) { /* ignore */ }
    }
    console.log(`  映射 ${map.name}: setup 对照 ${okCount}/42`);
    if (!bestMap || okCount > bestMap.ok) bestMap = { ...map, ok: okCount };
  }
  check("颜色映射 L=r/R=o 下 42 个 setup 全部吻合", bestMap.ok === 42, `最佳 ${bestMap.name}: ${bestMap.ok}/42`);

  if (bestMap.ok === 42) {
    const map = bestMap;
    // 每条公式尝试 原样 / 后缀AUF / 前缀AUF, 只保留能精确复原图中状态的写法
    const AUFS = ["", "U", "U2", "U'"];
    let totalKept = 0, totalDropped = 0;
    for (const c of cases) {
      c.place = decodeCaseFull(c, map);
      const verified = [];
      for (const alg of c.algs) {
        let fixed = null;
        const centersHome = (st) => [[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].every((p) => {
          const cc = C.cubieAt(st, p);
          return cc && cc.home[0] === p[0] && cc.home[1] === p[1] && cc.home[2] === p[2];
        });
        for (const post of AUFS) {
          const s = C.setCorners(C.newSolved(), c.place);
          C.applyAlg(s, alg + (post ? " " + post : ""));
          if (cornersSolved(s) && C.blocksSolved(s) && centersHome(s)) { fixed = alg + (post ? " " + post : ""); break; }
        }
        if (!fixed) {
          for (const pre of AUFS.slice(1)) {
            const s = C.setCorners(C.newSolved(), c.place);
            C.applyAlg(s, pre + " " + alg);
            if (cornersSolved(s) && C.blocksSolved(s) && centersHome(s)) { fixed = pre + " " + alg; break; }
          }
        }
        if (fixed) { verified.push(fixed); totalKept++; } else { totalDropped++; }
      }
      c.algs = verified;
    }
    const emptyCases = cases.filter((c) => c.algs.length === 0);
    check("每个 case 至少保留 1 条已验证公式", emptyCases.length === 0, JSON.stringify(emptyCases.map((c) => c.name)));
    check("被丢弃的公式 ≤ 6", totalDropped <= 6, String(totalDropped));
    // 终验: 所有保留公式逐条复验
    const reFail = [];
    for (const c of cases) for (const alg of c.algs) {
      const s = C.setCorners(C.newSolved(), c.place);
      C.applyAlg(s, alg);
      if (!cornersSolved(s) || !C.blocksSolved(s)) reFail.push(c.name + " ← " + alg);
    }
    check(`全部 ${totalKept} 条保留公式精确复原对应 case 且不破坏桥`, reFail.length === 0,
      reFail.length + " 条失败: " + reFail.slice(0, 3).join(" ; "));
    fs.writeFileSync(__dirname + "/cmll_decoded.json", JSON.stringify(cases, null, 1));
    console.log("  保留公式:", totalKept, "丢弃:", totalDropped, "已写出 cmll_decoded.json");
  }
}

// ============ 6. LSE 教学表导出 ============
section("6. 导出 LSE 教学表");
{
  fs.writeFileSync(__dirname + "/lse_tables.json", JSON.stringify(TABLES, null, 1));
  console.log("  4a 表:", TABLES.eoTable.length, "项; 4b 表:", TABLES.ulurTable.length, "项; 4c 表:", TABLES.c4Table.length, "项");
  console.log("  4a 样例:", JSON.stringify(TABLES.eoTable.slice(0, 8)));
  console.log("  4c 表:", JSON.stringify(TABLES.c4Table));
  const bad4b = TABLES.ulurTable.filter((e) => e.alg === null);
  check("4b 表全部有解", bad4b.length === 0, JSON.stringify(bad4b.slice(0, 2)));
  const bad4c = TABLES.c4Table.filter((e) => e.alg === null);
  check("4c 表全部有解", bad4c.length === 0, JSON.stringify(bad4c.slice(0, 2)));
}

// ============ 7. 默认配色方案合法性 ============
section("7. 配色方案");
{
  const s1 = C.schemeFromLFU("white", "red", "blue");
  check("默认方案 L白 F红 U蓝 合法(标准方案的旋转)", !!s1, JSON.stringify(s1));
  const s2 = C.schemeFromLFU("white", "red", "green");
  check("L白 F红 U绿 非法(镜像)", s2 === null);
  const scdb = C.schemeFromLFU("red", "green", "yellow");
  check("speedcubedb 方案 U黄 F绿 L红 合法", !!scdb, JSON.stringify(scdb));
}

console.log(`\n========== 结果: ${passCount} 通过 / ${failCount} 失败 ==========`);
if (failures.length) { console.log("失败项:"); failures.forEach((f) => console.log(" - " + f)); process.exit(1); }
