// sim-anim.cjs — 逐帧模拟 cube-view 的全局时间轴动画引擎，检查几何一致性
const C = require("./cube-core.js");

const D2R = Math.PI / 180;
const MOVE_BASE_MS = 210, HALF_MULT = 1.5, SLICE_MULT = 1.12;
const easeSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
function rotXm(a){const c=Math.cos(a),s=Math.sin(a);return [1,0,0,0,c,-s,0,s,c];}
function rotYm(a){const c=Math.cos(a),s=Math.sin(a);return [c,0,s,0,1,0,-s,0,c];}
function rotZm(a){const c=Math.cos(a),s=Math.sin(a);return [c,-s,0,s,c,0,0,0,1];}
function axisRotAxis(axis, ang){return axis===0?rotXm(ang):axis===1?rotYm(ang):rotZm(ang);}
function matVec(m,v){return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2], m[3]*v[0]+m[4]*v[1]+m[5]*v[2], m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];}
function mat3Mul(a,b){const o=new Array(9);for(let r=0;r<3;r++)for(let c=0;c<3;c++){let s=0;for(let k=0;k<3;k++)s+=a[r*3+k]*b[k*3+c];o[r*3+c]=s;}return o;}

function simulate(alg, dt = 16) {
  const state = C.newSolved();
  const toks = C.parseAlg(alg);
  const moves = [];
  let cum = 0, totalDur = 0;
  for (const tok of toks) {
    const def = C.MOVE_DEFS[tok.base];
    const angle = (function(){ var qE = (def.quarter * tok.quarter) % 4; return (qE === 2 ? (def.quarter === 3 ? -180 : 180) : (qE === 3 ? -90 : qE * 90)) * D2R; })();
    let dur = MOVE_BASE_MS;
    if ((def.quarter * tok.quarter) % 4 === 2) dur *= HALF_MULT;
    if ("MESrludfb".indexOf(tok.base) >= 0) dur *= SLICE_MULT;
    moves.push({ tok, def, angle, dur, a0: cum, applied: false, idx: null });
    cum += Math.abs(angle);
    totalDur += dur;
  }
  const plan = cum > 0 ? { moves, totalAngle: cum, totalDur } : null;
  let clock = 0, active = null;
  const problems = [];
  let frame = 0, guard = 0;
  while (plan && guard++ < 6000) {
    clock += dt; frame++;
    const d = Math.max(0, Math.min(1, clock / plan.totalDur)) * plan.totalAngle;
    let cur = null;
    for (const m of plan.moves) {
      const end = m.a0 + Math.abs(m.angle);
      if (!m.applied && d >= end - 1e-9) {
        m.applied = true;
        C.applyToken(state, m.tok);
        if (active && active.m === m) active = null;
      } else if (!m.applied && !m.idx && d > m.a0) {
        m.idx = new Set();
        state.cubies.forEach((c, i) => { if (m.def.layer(c.pos)) m.idx.add(i); });
      }
      if (!m.applied && m.idx && d > m.a0) cur = m;
    }
    if (cur) {
      const local = Math.max(0, Math.min(1, (d - cur.a0) / Math.abs(cur.angle)));
      active = { m: cur, idx: cur.idx, R: axisRotAxis(cur.def.axis, cur.angle * local) };
    } else active = null;
    // 几何一致性：绘制位置 = 单层旋转，必须互不重合且范围有限
    const seen = new Map();
    state.cubies.forEach((c, i) => {
      let pEff = c.pos;
      if (active && active.idx.has(i)) pEff = matVec(active.R, pEff);
      const key = pEff.map((x) => x.toFixed(3)).join(",");
      if (seen.has(key)) problems.push(`frame ${frame}: 两块同位 ${key}`);
      seen.set(key, true);
      for (const x of pEff) if (Math.abs(x) > 1.51) problems.push(`frame ${frame}: 块越界 ${key}`);
    });
    if (plan.moves.every((m) => m.applied)) break;
  }
  return { problems: problems.slice(0, 4), matchesEngine: C.keyOf(state) === C.keyOf(C.runAlg(alg)), frames: frame };
}

const ALGS = [
  "R U R' F'",
  "M2 U M2 U2 M2 U M2",
  "F R U' R' U' R U R' F' R U R' U'",
  "R U r F",
  "M' U M U2",
  "U R U' R' U R U2 R'",
  "x y z M E S r u f l d b",
];
let allOk = true;
for (const alg of ALGS) {
  const r = simulate(alg);
  const ok = r.problems.length === 0 && r.matchesEngine;
  if (!ok) allOk = false;
  console.log((ok ? "PASS" : "FAIL") + "  " + alg + "  " + JSON.stringify(r));
}
console.log(allOk ? "ALL PASS" : "HAS FAILURES");
