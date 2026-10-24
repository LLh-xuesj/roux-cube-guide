/*
 * cube-core.js — 桥式学习站魔方引擎（纯逻辑，无 DOM）
 * 几何法生成：所有转动都是坐标旋转，杜绝手抄转发表出错。
 * 坐标系: x: R=+1 / L=-1, y: U=+1 / D=-1, z: F=+1 / B=-1
 * 面索引: 0=U 1=R 2=F 3=D 4=L 5=B
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.RouxCube = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- 向量 / 矩阵（3x3 整数，行主序 [xx,xy,xz,yx,yy,yz,zx,zy,zz]） ----------
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function matVec(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }
  function matMul(a, b) {
    // a*b：先 b 后 a
    const out = new Array(9);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
        out[r * 3 + c] = s;
      }
    return out;
  }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  // 绕单位轴 axis 转 turns 次 90°（右手方向，即绕 +axis 的正向）
  function axisRot(axis, quarter) {
    // quarter: 1=+90°(右手), 2=180°, 3=-90°
    const q = ((quarter % 4) + 4) % 4;
    let m = I3.slice();
    const B = [ // 基本旋转（+90° 绕轴）
      [0, 0, -1, 0, 1, 0, 1, 0, 0],   // x: y→z, z→-y  —— 不对，重新推：见下
    ];
    // 绕 +x +90°（右手）：y→z, z→-y
    const RX = [1, 0, 0, 0, 0, -1, 0, 1, 0];
    // 验证: RX·(0,1,0) = (0,0,1) ✓ ; RX·(0,0,1) = (0,-1,0) ✓
    const RY = [0, 0, 1, 0, 1, 0, -1, 0, 0];
    // 绕 +y +90°: z→x, x→-z : RY·(0,0,1)=(1,0,0) ✓ ; RY·(1,0,0)=(0,0,-1) ✓
    const RZ = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    // 绕 +z +90°: x→y, y→-x : RZ·(1,0,0)=(0,1,0) ✓ ; RZ·(0,1,0)=(-1,0,0) ✓
    const base = axis === 0 ? RX : axis === 1 ? RY : RZ;
    for (let i = 0; i < q; i++) m = matMul(base, m);
    return m;
  }

  // ---------- 面定义 ----------
  // 面索引: 0=U 1=R 2=F 3=D 4=L 5=B
  const FACE_NORMALS = [
    [0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1],
  ];
  const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
  const FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  function faceOfNormal(n) {
    for (let f = 0; f < 6; f++) {
      const N = FACE_NORMALS[f];
      if (N[0] === n[0] && N[1] === n[1] && N[2] === n[2]) return f;
    }
    return -1;
  }

  // ---------- 转动定义 ----------
  // 每个转动: { axis: 0|1|2, quarter: 1|2|3 (+90° 的个数), layer: (p)=>bool, name }
  // 面转动（顺时针 = 从面外侧看）：R=rotX(-90)=quarter 3, L=quarter 1,
  // U=rotY(-90)=3, D=1, F=rotZ(-90)=3, B=1（见文件头推导）
  const MOVE_DEFS = {
    R: { axis: 0, quarter: 3, layer: (p) => p[0] === 1 },
    L: { axis: 0, quarter: 1, layer: (p) => p[0] === -1 },
    U: { axis: 1, quarter: 3, layer: (p) => p[1] === 1 },
    D: { axis: 1, quarter: 1, layer: (p) => p[1] === -1 },
    F: { axis: 2, quarter: 3, layer: (p) => p[2] === 1 },
    B: { axis: 2, quarter: 1, layer: (p) => p[2] === -1 },
    M: { axis: 0, quarter: 1, layer: (p) => p[0] === 0 },  // 随 L
    E: { axis: 1, quarter: 1, layer: (p) => p[1] === 0 },  // 随 D
    S: { axis: 2, quarter: 3, layer: (p) => p[2] === 0 },  // 随 F
    x: { axis: 0, quarter: 3, layer: () => true },          // 整体随 R
    y: { axis: 1, quarter: 3, layer: () => true },          // 整体随 U
    z: { axis: 2, quarter: 3, layer: () => true },          // 整体随 F
    r: { axis: 0, quarter: 3, layer: (p) => p[0] >= 0 },    // R+M'
    l: { axis: 0, quarter: 1, layer: (p) => p[0] <= 0 },    // L+M
    u: { axis: 1, quarter: 3, layer: (p) => p[1] >= 0 },    // U+E'
    d: { axis: 1, quarter: 1, layer: (p) => p[1] <= 0 },    // D+E
    f: { axis: 2, quarter: 3, layer: (p) => p[2] >= 0 },    // F+S
    b: { axis: 2, quarter: 1, layer: (p) => p[2] <= 0 },    // B+S'
  };

  // ---------- 公式解析 ----------
  // 支持: U D L R F B M E S x y z u d l r f b + w 后缀 + ' 与 2（含 R2' 写法）
  function parseAlg(str) {
    // 展开 "(...)N" 重复记号（如 (R U R' U')2 → 该括号内容重复两遍）；支持嵌套
    let expanded = str;
    for (let pass = 0; pass < 5 && expanded.indexOf('(') >= 0; pass++) {
            const next = expanded.replace(/\(([^()]*)\)\s*(\d+)/g, (_, inner, n) => {
        const piece = inner.trim();
        const rep = new Array(+n).fill(piece).join(' ');
        return rep;
      });
      if (next === expanded) break;
      expanded = next;
    }
    const tokens = [];
    const re = /([A-Za-z]+)(w)?([0-9]+)?(['′ʼ]?)/g;
    let m;
    while ((m = re.exec(expanded))) {
      if (!m[1]) continue;
      let base = m[1];
      if (m[2]) base = base.toLowerCase(); // Rw -> r
      if (!(base in MOVE_DEFS)) throw new Error("未知转动: " + m[0] + " in [" + expanded + "]");
      let quarter = m[3] === "2" ? 2 : 1;
      if (m[4] === "'" || m[4] === "′" || m[4] === "ʼ") quarter = (4 - quarter) % 4;
      if (quarter === 0) continue; // 转四次=不动
      tokens.push({ base, quarter });
    }
    return tokens;
  }

  // ---------- 状态 ----------
  // cubie: { home:[x,y,z], pos:[x,y,z], o:3x3 }
  // 贴纸: home 分量非 0 的每个轴对应一个面法向（home 方向）。
  function newSolved() {
    const cubies = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          cubies.push({ home: [x, y, z], pos: [x, y, z], o: I3.slice() });
        }
    return { cubies };
  }
  function cloneState(s) {
    return {
      cubies: s.cubies.map((c) => ({ home: c.home.slice(), pos: c.pos.slice(), o: c.o.slice() })),
    };
  }
  function keyOf(state) {
    return state.cubies
      .map((c) => c.pos.join("") + ":" + c.o.join(""))
      .sort()
      .join("|");
  }

  function applyToken(state, tok) {
    const def = MOVE_DEFS[tok.base];
    const rot = axisRot(def.axis, def.quarter * tok.quarter);
    for (const c of state.cubies) {
      if (!def.layer(c.pos)) continue;
      c.pos = matVec(rot, c.pos);
      c.o = matMul(rot, c.o);
    }
    return state;
  }
  function applyAlg(state, alg) {
    for (const tok of parseAlg(alg)) applyToken(state, tok);
    return state;
  }
  function runAlg(alg) {
    return applyAlg(newSolved(), alg);
  }
  function invertAlg(str) {
    const toks = parseAlg(str).reverse();
    return toks
      .map((t) => {
        const inv = (4 - t.quarter) % 4;
        if (inv === 0) return "";
        return t.base + (inv === 1 ? "" : inv === 2 ? "2" : "'");
      })
      .filter(Boolean)
      .join(" ");
  }

  // ---------- 查询 ----------
  function cubieAt(state, pos) {
    for (const c of state.cubies) {
      if (c.pos[0] === pos[0] && c.pos[1] === pos[1] && c.pos[2] === pos[2]) return c;
    }
    return null;
  }
  // 某 cubie 朝 worldDir 的贴纸的“颜色”，颜色用其所属面索引表示
  function stickerFace(cubie, worldDir) {
    for (let a = 0; a < 3; a++) {
      if (cubie.home[a] === 0) continue;
      const n = [0, 0, 0];
      n[a] = cubie.home[a];
      const w = matVec(cubie.o, n);
      if (w[0] === worldDir[0] && w[1] === worldDir[1] && w[2] === worldDir[2]) {
        return faceOfNormal(n);
      }
    }
    return -1;
  }
  // 3x3 面网格：faceIdx 的行/列视角——从该面外侧看，行自上而下、列自左而右
  function faceGrid(state, faceIdx) {
    const N = FACE_NORMALS[faceIdx];
    // 视图的“上”和“右”方向
    let up, right;
    const axis = N[0] !== 0 ? 0 : N[1] !== 0 ? 1 : 2;
    const sign = N[axis];
    if (faceIdx === 0) { up = [0, 0, -1]; right = [1, 0, 0]; }        // U: 上=B, 右=R
    else if (faceIdx === 3) { up = [0, 0, 1]; right = [1, 0, 0]; }    // D: 上=F, 右=R
    else if (faceIdx === 2) { up = [0, 1, 0]; right = [1, 0, 0]; }    // F: 上=U, 右=R
    else if (faceIdx === 5) { up = [0, 1, 0]; right = [-1, 0, 0]; }   // B: 上=U, 右=L
    else if (faceIdx === 1) { up = [0, 1, 0]; right = [0, 0, -1]; }   // R: 上=U, 右=B
    else { up = [0, 1, 0]; right = [0, 0, 1]; }                        // L: 上=U, 右=F
    const grid = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 3; c++) {
        // 面中心 + (r-1)*up + (c-1)*right
        const rr = r - 1, cc = c - 1;
        const pos = [
          N[0] + up[0] * rr + right[0] * cc,
          N[1] + up[1] * rr + right[1] * cc,
          N[2] + up[2] * rr + right[2] * cc,
        ];
        const cub = cubieAt(state, pos);
        row.push(cub ? stickerFace(cub, N) : -1);
      }
      grid.push(row);
    }
    return grid;
  }

  function isSolved(state) {
    for (const c of state.cubies) {
      for (let a = 0; a < 3; a++) {
        if (c.home[a] === 0) continue;
        const n = [0, 0, 0];
        n[a] = c.home[a];
        if (stickerFace(c, n) !== faceOfNormal(n)) return false;
      }
    }
    return true;
  }

  // 桥（左 1x2x3 + 右 1x2x3）是否完好：12 个块件归位且方向正确
  const BLOCK_HOMES = [
    [ -1, -1,  1], [ 1, -1,  1], [ -1, -1, -1], [ 1, -1, -1], // DFL DFR DBL DBR 角
    [ 0, -1,  1], [ 0, -1, -1],                               // DF DB —— 不属于桥！
  ];
  // 左桥件: L 心(=0,0,-1?? L 心 home=(-1,0,0)), DL(-1,-1,0), FL(-1,0,1), BL(-1,0,-1), DFL, DBL
  // 右桥件: R 心(1,0,0), DR(1,-1,0), FR(1,0,1), BR(1,0,-1), DFR, DBR
  const BLOCK_PIECES = [
    [-1, 0, 0], [1, 0, 0],               // L R 中心
    [-1, -1, 0], [-1, 0, 1], [-1, 0, -1], // DL FL BL
    [1, -1, 0], [1, 0, 1], [1, 0, -1],    // DR FR BR
    [-1, -1, 1], [-1, -1, -1],            // DFL DBL
    [1, -1, 1], [1, -1, -1],              // DFR DBR
  ];
  function blocksSolved(state) {
    for (const h of BLOCK_PIECES) {
      const c = cubieAt(state, h);
      if (!c) return false;
      if (c.home[0] !== h[0] || c.home[1] !== h[1] || c.home[2] !== h[2]) return false;
      for (let i = 0; i < 9; i++) if (c.o[i] !== I3[i]) return false;
    }
    return true;
  }

  // 角块信息：8 个角位: {pieceKey, upFace, frontFace(=z+ 方向贴纸面), ...}
  function cornerInfo(state) {
    const out = {};
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const c = cubieAt(state, [x, y, z]);
      const key = [x, y, z].join(",");
      out[key] = {
        piece: c.home.join(","),
        up: stickerFace(c, [0, 1, 0]),
        down: stickerFace(c, [0, -1, 0]),
        front: stickerFace(c, [0, 0, 1]),
        back: stickerFace(c, [0, 0, -1]),
        right: stickerFace(c, [1, 0, 0]),
        left: stickerFace(c, [-1, 0, 0]),
      };
    }
    return out;
  }

  // 设置角块状态（用于 CMLL case 构造）:
  // place: { posKey: { piece: homeKey, up: faceIdx, side: faceIdx, sideDir:[x,y,z] } }
  // 含义: 该角位上放着 piece；piece 的 up 面颜色贴纸朝 tU(=位置的外侧 U/D 方向)；
  //       piece 的 side 面颜色贴纸朝 sideDir。
  function setCorners(state, place) {
    for (const posKey in place) {
      const pos = posKey.split(",").map(Number);
      const spec = place[posKey];
      const home = spec.piece.split(",").map(Number);
      const c = cubieAt(state, pos);
      c.home = home.slice();
      c.pos = pos.slice();
      // 约束: spec.up 面色贴纸朝位置外侧 U/D 方向; spec.side 面色贴纸朝 sideDir;
      // 第三张贴纸朝位置剩下的那个面（由位置唯一决定，保证几何合法）。
      const nU = FACE_NORMALS[spec.up];
      const nS = FACE_NORMALS[spec.side];
      const axU = nU[0] !== 0 ? 0 : nU[1] !== 0 ? 1 : 2;
      const axS = nS[0] !== 0 ? 0 : nS[1] !== 0 ? 1 : 2;
      if (axU === axS) throw new Error("姿态约束两轴相同");
      const tU = [0, pos[1], 0];
      const tS = spec.sideDir.slice();
      // 第三张贴纸: home 上剩余的轴 axT；其目标面 = 位置三面中未被 tU(axis1)、tS 占用的那个
      const axT = [0, 1, 2].find((a) => a !== axU && a !== axS);
      const remAxis = spec.sideDir[0] !== 0 ? 2 : 0;
      const tT = [0, 0, 0];
      tT[remAxis] = pos[remAxis];
      // o 的列: column_a = home[a] * t_a（o·n = t，n = home[a]·e_a）
      const col = [null, null, null];
      col[axU] = [tU[0] * home[axU], tU[1] * home[axU], tU[2] * home[axU]];
      col[axS] = [tS[0] * home[axS], tS[1] * home[axS], tS[2] * home[axS]];
      col[axT] = [tT[0] * home[axT], tT[1] * home[axT], tT[2] * home[axT]];
      // det 断言 = +1
      const det =
        col[0][0] * (col[1][1] * col[2][2] - col[1][2] * col[2][1]) -
        col[0][1] * (col[1][0] * col[2][2] - col[1][2] * col[2][0]) +
        col[0][2] * (col[1][0] * col[2][1] - col[1][1] * col[2][0]);
      if (det !== 1) throw new Error("角块姿态不可实现 (det=" + det + ") @ " + posKey);
      c.o = [
        col[0][0], col[1][0], col[2][0],
        col[0][1], col[1][1], col[2][1],
        col[0][2], col[1][2], col[2][2],
      ];
    }
    return state;
  }

  // 设置棱块（用于 LSE 状态构造）: place: { posKey: {piece, flip:bool} }
  // flip=false 表示“好棱”（U/D 色贴纸朝 U/D 面）……注意：该规则待 verify 验证！
  function setEdges(state, place) {
    for (const posKey in place) {
      const pos = posKey.split(",").map(Number);
      const spec = place[posKey];
      const home = spec.piece.split(",").map(Number);
      const c = cubieAt(state, pos);
      c.home = home.slice();
      c.pos = pos.slice();
      // 棱的两个 home 法向轴
      const axes = [0, 1, 2].filter((a) => home[a] !== 0);
      const posAxes = [0, 1, 2].filter((a) => pos[a] !== 0);
      const o = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      if (!spec.flip) {
        // home 法向 a → 同号的世界方向（保持“贴纸属于哪个半边”一致）
        // U/D 色贴纸 = home 中 y 分量对应的法向；它应朝 U/D
        for (let i = 0; i < 2; i++) {
          const a = axes[i], b = posAxes[i];
          const sgn = home[a] * pos[b] > 0 ? 1 : -1;
          o[b][a] = sgn;
        }
      } else {
        // 交换两个法向的映射（翻转）
        for (let i = 0; i < 2; i++) {
          const a = axes[i], b = posAxes[1 - i];
          const sgn = home[a] * pos[b] > 0 ? 1 : -1;
          o[b][a] = sgn;
        }
      }
      c.o = [o[0][0], o[0][1], o[0][2], o[1][0], o[1][1], o[1][2], o[2][0], o[2][1], o[2][2]];
    }
    return state;
  }

  // LSE 相关：六个棱位与六件棱
  const LSE_POS = { UF: [0, 1, 1], UR: [1, 1, 0], UB: [0, 1, -1], UL: [-1, 1, 0], DF: [0, -1, 1], DB: [0, -1, -1] };
  const LSE_PIECES = { UF: [0, 1, 1], UR: [1, 1, 0], UB: [0, 1, -1], UL: [-1, 1, 0], DF: [0, -1, 1], DB: [0, -1, -1] };
  function posKeyOf(p) { return p.join(""); }
  function lseState(state) {
    // 读出 6 棱: { piece: "UF", flip: bool }
    const out = {};
    for (const name in LSE_POS) {
      const c = cubieAt(state, LSE_POS[name]);
      const home = c.home;
      let pieceName = null;
      for (const n in LSE_PIECES) {
        const h = LSE_PIECES[n];
        if (h[0] === home[0] && h[1] === home[1] && h[2] === home[2]) pieceName = n;
      }
      // flip/good: U/D 色贴纸是否朝 U/D 面（此规则由 verify.cjs 穷举验证）
      const worldUp = [0, LSE_POS[name][1] >= 1 ? 1 : -1, 0];
      const fUp = stickerFace(c, worldUp);
      const isUDSticker = (f) => f === 0 || f === 3; // U 或 D 面
      out[name] = { piece: pieceName, good: isUDSticker(fUp) };
    }
    return out;
  }

  // ---------- 方案（配色） ----------
  // standard 面颜色（面索引→颜色名），默认西方案
  const STANDARD_SCHEME = ["white", "red", "green", "yellow", "orange", "blue"]; // U R F D L B
  // 24 个整立方旋转（axis, quarter）序列生成所有旋转矩阵
  function allRotations() {
    const seen = new Map();
    const stack = [I3.slice()];
    seen.set(I3.join(""), I3.slice());
    while (stack.length) {
      const m = stack.pop();
      for (let a = 0; a < 3; a++)
        for (let q = 1; q <= 3; q++) {
          const r = matMul(axisRot(a, q), m);
          const k = r.join("");
          if (!seen.has(k)) { seen.set(k, r); stack.push(r); }
        }
    }
    return [...seen.values()];
  }
  // 给定 L、F、U 颜色（颜色名），求整个面配色（用 standard 的颜色集合）
  function schemeFromLFU(cL, cF, cU) {
    const idx = (c) => STANDARD_SCHEME.indexOf(c);
    const opp = (c) => STANDARD_SCHEME[(idx(c) + 3) % 6];
    // 目标: 面索引→颜色: L=cL, R=opp(cL), F=cF, B=opp(cF), U=cU, D=opp(cU)
    const target = [cU, opp(cL), cF, opp(cU), cL, opp(cF)];
    for (const rot of allRotations()) {
      // 旋转把 standard 的面 f 贴纸带到面 rot? 面法向 n → rot·n
      const mapped = new Array(6);
      let ok = true;
      for (let f = 0; f < 6; f++) {
        const nf = matVec(rot, FACE_NORMALS[f]);
        const nfIdx = faceOfNormal(nf);
        mapped[nfIdx] = STANDARD_SCHEME[f];
      }
      for (let f = 0; f < 6; f++) if (mapped[f] !== target[f]) { ok = false; break; }
      if (ok) return target;
    }
    return null; // 无效（镜像）
  }

  return {
    I3, matVec, matMul, cross, axisRot,
    FACE_NORMALS, FACE_NAMES, FACE_INDEX,
    MOVE_DEFS, parseAlg, applyAlg, applyToken, invertAlg, runAlg,
    newSolved, cloneState, keyOf, cubieAt, stickerFace, faceGrid, isSolved,
    blocksSolved, cornerInfo, setCorners, setEdges,
    LSE_POS, LSE_PIECES, lseState,
    STANDARD_SCHEME, schemeFromLFU, allRotations,
  };
});
