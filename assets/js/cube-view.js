/*
 * cube-view.js — Canvas 魔方渲染（画家算法）+ 2D 展开图 + 公式播放器
 * 依赖: window.RouxCube (cube-core.js)
 *
 * 3D 部分用 2D canvas + 画家算法实现：每帧只画 54 个外壳面（背面剔除 + 深度排序），
 * 没有 CSS 3D 的层爆炸问题，转层动画流畅，且渲染被限制在画布内（不会溢出遮挡周边元素）。
 */
(function () {
  "use strict";
  const C = window.RouxCube;
  const D2R = Math.PI / 180;

  // ---------- 配色 ----------
  const COLOR_HEX = {
    white: "#f6f6f4", yellow: "#ffd500", green: "#00a04d",
    blue: "#0a5cd6", red: "#d3222a", orange: "#ff7a1a",
  };
  const COLOR_ZH = { white: "白", yellow: "黄", green: "绿", blue: "蓝", red: "红", orange: "橙" };
  let SCHEME = null; // 面索引 → 颜色名
  function getScheme() {
    if (SCHEME) return SCHEME;
    let L = "orange", F = "green", U = "white"; // 默认：标准配色（白顶绿前橙左）
    try {
      const s = JSON.parse(localStorage.getItem("roux-scheme") || "null");
      if (s) { L = s.L; F = s.F; U = s.U; }
    } catch (e) { /* ignore */ }
    const r = C.schemeFromLFU(L, F, U);
    SCHEME = r || C.schemeFromLFU("orange", "green", "white");
    return SCHEME;
  }
  function setScheme(L, F, U) {
    const r = C.schemeFromLFU(L, F, U);
    if (!r) return false;
    SCHEME = r;
    localStorage.setItem("roux-scheme", JSON.stringify({ L, F, U }));
    document.dispatchEvent(new CustomEvent("schemechange"));
    return true;
  }
  function faceColor(fi) { return COLOR_HEX[getScheme()[fi]]; }

  // ---------- 颜色明暗（带缓存） ----------
  const shadeCache = new Map();
  function shade(hex, k) {
    k = Math.max(0.35, Math.min(1.12, k));
    const key = hex + "|" + Math.round(k * 100);
    let v = shadeCache.get(key);
    if (v) return v;
    const r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    v = "rgb(" + Math.round(Math.min(255, r * k)) + "," + Math.round(Math.min(255, g * k)) + "," + Math.round(Math.min(255, b * k)) + ")";
    shadeCache.set(key, v);
    return v;
  }

  // ---------- 3×3 矩阵工具 ----------
  function mat3Mul(a, b) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      o[r * 3 + c] = s;
    }
    return o;
  }
  function matVec(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }
  // 数学系（x 右, y 上, z 朝观察者）绕轴旋转，右手正方向
  function rotXm(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotYm(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rotZm(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function axisRotAxis(axis, ang) {
    if (axis === 0) return rotXm(ang);
    if (axis === 1) return rotYm(ang);
    return rotZm(ang);
  }

  // 视图矩阵: 俯仰 -24°、偏航 -33° 时与旧版 CSS 视角一致（能看到 U/F/R 三面）
  function viewMatrix(pitchDeg, yawDeg) {
    return mat3Mul(rotXm(-pitchDeg * D2R), rotYm(yawDeg * D2R));
  }

  // ---------- 面几何（cubie 局部坐标, 单位=半格 0.5） ----------
  const NORM = C.FACE_NORMALS;
  // 动画参数：整条公式共用一条全局时间轴；90° 基础时长、180° 倍率、中层/宽层倍率。
  // 步与步首尾相接（无重叠），层内匀速 → 接缝处角速度连续，且永远刚性。
  const MOVE_BASE_MS = 300;
  const HALF_MULT = 1.5;
  const SLICE_MULT = 1.12;

  const FACE_QUADS = NORM.map((n) => {
    const a = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const others = [0, 1, 2].filter((x) => x !== a);
    const c = [];
    for (const u of [-0.5, 0.5]) for (const v of [-0.5, 0.5]) {
      const p = [0, 0, 0];
      p[a] = n[a] * 0.5;
      p[others[0]] = u; p[others[1]] = v;
      c.push(p);
    }
    // 环形顺序（0,1,3,2），否则路径自交成蝴蝶结
    return [c[0], c[1], c[3], c[2]];
  });
  // ---------- 主题（跟随 <html data-theme>，与 style.css 对应） ----------
  function themeNow() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }
  const THEME_PALETTE = {
    dark: { plastic: "#2b2f36", shadow: "rgba(0,0,0,0.5)", netGrayCmll: "#33363d", netGrayLse: "#2b2e34", netStroke: "rgba(255,255,255,0.16)" },
    light: { plastic: "#181b21", shadow: "rgba(24,28,40,0.16)", netGrayCmll: "#d8dbe0", netGrayLse: "#e2e4e8", netStroke: "rgba(0,0,0,0.35)" },
  };
  const LIGHT3 = (function () { const l = [-0.28, 0.52, 0.81], m = Math.hypot(l[0], l[1], l[2]); return l.map((x) => x / m); })();

  class CubeView {
    constructor(container, opts) {
      this.opts = Object.assign({ size: 220, speed: 1, controls: true, view: "default", autoReset: false }, opts);
      this.container = container;
      container.classList.add("cv-root");
      this.state = C.newSolved();
      this.queue = [];
      this.playing = false;
      this.yaw = -33; this.pitch = -24;
      // 连贯动画：plan = 整条公式的时间轴（每步 {tok,def,angle,dur,a0,applied,idx,R}），
      // active = 当前正在转的层。层内匀速、步间零间隙，只在整条公式首尾做全局缓动。
      this.plan = null;
      this.active = null;
      this.clock = 0;
      this._stepTarget = null;
      this._lastNow = null;
      this._raf = null;
      this._dirty = true;
      this.buildDOM();
      this.draw();
      document.addEventListener("schemechange", () => this.draw());
      document.addEventListener("themechange", () => this.draw());
    }
    buildDOM() {
      const size = this.opts.size;
      this.unit = size / 5.6;
      this.persp = this.unit * 12;
      this.scene = document.createElement("div");
      this.scene.className = "cv-scene";
      this.scene.style.width = size + "px";
      this.scene.style.height = size + "px";
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.canvas = document.createElement("canvas");
      this.canvas.className = "cv-canvas";
      this.canvas.width = Math.round(size * dpr);
      this.canvas.height = Math.round(size * dpr);
      this.canvas.style.width = size + "px";
      this.canvas.style.height = size + "px";
      this.ctx = this.canvas.getContext("2d");
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.scene.appendChild(this.canvas);
      this.container.appendChild(this.scene);
      // 控制条
      if (this.opts.controls) {
        const bar = document.createElement("div");
        bar.className = "cv-bar";
        bar.innerHTML =
          '<button class="cv-btn cv-play" title="播放/暂停">▶</button>' +
          '<button class="cv-btn cv-step" title="单步">⇥</button>' +
          '<button class="cv-btn cv-reset" title="复位">⟲</button>' +
          '<input class="cv-speed" type="range" min="0.3" max="3" step="0.1" value="' + this.opts.speed + '" title="速度">';
        this.container.appendChild(bar);
        bar.querySelector(".cv-play").addEventListener("click", () => this.togglePlay());
        bar.querySelector(".cv-step").addEventListener("click", () => this.stepOnce());
        bar.querySelector(".cv-reset").addEventListener("click", () => this.reset());
        bar.querySelector(".cv-speed").addEventListener("input", (e) => { this.opts.speed = +e.target.value; });
      }
      // 拖拽视角
      let dragging = false, lx = 0, ly = 0;
      this.canvas.addEventListener("pointerdown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; this.canvas.setPointerCapture(e.pointerId); });
      this.canvas.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        this.yaw += (e.clientX - lx) * 0.5;
        this.pitch -= (e.clientY - ly) * 0.5;
        this.pitch = Math.max(-85, Math.min(85, this.pitch));
        lx = e.clientX; ly = e.clientY;
        this.draw();
      });
      this.canvas.addEventListener("pointerup", () => { dragging = false; });
      this.canvas.addEventListener("pointercancel", () => { dragging = false; });
    }
    setState(state) {
      this.stopPlay();
      this.state = C.cloneState(state);
      this.queue = [];
      this.draw();
    }
    loadAlg(alg) { // 从复原态应用 alg 的逆 → 播放 alg 可复原
      this.setState(C.runAlg(C.invertAlg(alg)));
      this.pendingAlg = alg;
    }
    reset() {
      this.stopPlay();
      this.state = this.baseState ? C.cloneState(this.baseState) : C.newSolved();
      this.queue = [];
      this.draw();
    }
    setBase(state) {
      this.baseState = C.cloneState(state);
      this.setState(state);
    }
    playAlg(alg, opts) {
      // 以当前 baseState 为起点播放
      if (opts && opts.fromBase !== false && this.baseState) this.setState(this.baseState);
      const toks = C.parseAlg(alg);
      this.queue = toks.slice();
      this.pendingAlg = alg;
      this._startPlan(toks);
    }
    togglePlay() {
      if (this.playing) { this.playing = false; this._stepTarget = null; this.updatePlayBtn(); }
      else {
        if ((!this.plan || this._planDone()) && !this.queue.length && this.pendingAlg) this.playAlg(this.pendingAlg, { fromBase: true });
        else { this.playing = true; this.updatePlayBtn(); this._ensureLoop(); }
      }
    }
    stepOnce() {
      this.playing = false; this.updatePlayBtn();
      if (this.plan && !this._planDone()) {
        // 播放中途按 ⇥：只把当前这一步转完就停
        this._stepTarget = this.plan.moves.find((m) => !m.applied) || null;
        this.playing = true;
        this._ensureLoop();
        return;
      }
      if (!this.queue.length) return;
      this._startPlan([this.queue.shift()]);
    }
    stopPlay() { if (this._resetTimer) { clearTimeout(this._resetTimer); this._resetTimer = null; } this.playing = false; this.queue = []; this.plan = null; this.active = null; this.clock = 0; this.updatePlayBtn(); this.draw(); }
    updatePlayBtn() {
      const btn = this.container.querySelector(".cv-play");
      if (btn) btn.textContent = this.playing ? "⏸" : "▶";
    }
    // ---------- 连贯动画引擎（全局时间轴，层内匀速） ----------
    _startPlan(toks) {
      if (this._resetTimer) { clearTimeout(this._resetTimer); this._resetTimer = null; }
      const moves = [];
      let cum = 0, totalDur = 0;
      for (const tok of toks) {
        const def = C.MOVE_DEFS[tok.base];
        // 有效四分转 = def.quarter × tok.quarter（mod 4）——带撇步（U'/R'/r'…）的
        // 实际落盘方向由两者乘积决定，动画角度必须与引擎 applyToken 完全一致，
        // 否则该步走错方向，边界处会出现 180° 跳变（闪帧）。
        const qEff = (def.quarter * tok.quarter) % 4;
        // 半圈（qEff=2）的方向跟随该面的基准方向：U2 顺着 U 甩（从上看顺时针），
        // D2 顺着 D，R2 顺着 R……否则对着视频看半圈永远“反着转”。
        const angle = (qEff === 2
          ? (def.quarter === 3 ? -180 : 180)
          : (qEff === 3 ? -90 : qEff * 90)) * D2R;
        let dur = MOVE_BASE_MS;
        if (qEff === 2) dur *= HALF_MULT;
        if ("MESrludfb".indexOf(tok.base) >= 0) dur *= SLICE_MULT;
        moves.push({ tok, def, angle, dur, a0: cum, applied: false, idx: null, R: C.I3 });
        cum += Math.abs(angle);
        totalDur += dur;
      }
      this.plan = cum > 0 ? { moves, totalAngle: cum, totalDur } : null;
      this.active = null;
      this.clock = 0; // 每条新时间轴从零开始（否则旧 clock 会把进度直接顶满 → 闪现播完）
      this._stepTarget = null;
      this.playing = this.plan != null;
      this.updatePlayBtn();
      this._ensureLoop();
    }
    _planDone() { return !this.plan || this.plan.moves.every((m) => m.applied); }
    _ensureLoop() {
      if (this._raf == null) {
        this._lastNow = null;
        this._raf = requestAnimationFrame(this._frameBound || (this._frameBound = (now) => this._frame(now)));
      }
    }
    _frame(now) {
      this._raf = requestAnimationFrame((n) => this._frame(n)); // 先续约，结束时再取消
      const dt = Math.min(40, now - (this._lastNow == null ? now : this._lastNow));
      this._lastNow = now;
      const P = this.plan;
      if (this.playing && P) this.clock += dt * this.opts.speed;
      if (P) {
        // 全程匀速的“转角里程”：每步恒定角速度、步间零间隙（无全局缓动，
        // 否则长公式中段会明显加速；单帧追赶上限 40ms 缓解掉帧闪跳）
        const d = Math.max(0, Math.min(1, this.clock / P.totalDur)) * P.totalAngle;
        let cur = null;
        for (const m of P.moves) {
          const end = m.a0 + Math.abs(m.angle);
          if (!m.applied && d >= end - 1e-9) {
            m.applied = true;
            C.applyToken(this.state, m.tok);
            this.queue.shift();
            if (this.active && this.active.m === m) this.active = null;
          } else if (!m.applied && !m.idx && d > m.a0) {
            // 进入该步：以当前状态取层成员（严格无重叠，成员永远精确）
            m.idx = new Set();
            this.state.cubies.forEach((c, i) => { if (m.def.layer(c.pos)) m.idx.add(i); });
          }
          if (!m.applied && m.idx && d > m.a0) cur = m;
        }
        if (this._stepTarget && this._stepTarget.applied) {
          this._stepTarget = null;
          this.playing = false;
          this.updatePlayBtn();
        }
        if (cur) {
          const local = Math.max(0, Math.min(1, (d - cur.a0) / Math.abs(cur.angle)));
          this.active = { m: cur, idx: cur.idx, R: axisRotAxis(cur.def.axis, cur.angle * local) };
        } else this.active = null;
        this._dirty = true;
        if (this._planDone()) {
          this.plan = null;
          this.active = null;
          this.playing = false;
          this.updatePlayBtn();
          // 播完停留片刻后自动回到演示起点（baseState），方便反复观看
          if (this.opts.autoReset && this.baseState) {
            var self = this;
            this._resetTimer = setTimeout(function () {
              self._resetTimer = null;
              if (!self.playing && !self.plan) {
                self.state = C.cloneState(self.baseState);
                self.clock = 0;
                self._dirty = true;
                self.draw();
              }
            }, 800);
          }
        }
      }
      if (this.active || this._dirty) { this.draw(); this._dirty = false; }
      if (!(this.playing && this.plan)) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
    }
    // ---------- 画家算法绘制 ----------
    draw() {
      const ctx = this.ctx, S = this.opts.size;
      const unit = this.unit, cx = S / 2, cy = S * 0.5;
      const Mv = viewMatrix(this.pitch, this.yaw);
      ctx.clearRect(0, 0, S, S);

      // 地面软阴影（径向渐变，成本低）
      const pal = THEME_PALETTE[themeNow()];
      const shy = cy + unit * 2.05;
      const grad = ctx.createRadialGradient(cx, shy, 0, cx, shy, unit * 1.9);
      grad.addColorStop(0, pal.shadow);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save();
      ctx.translate(cx, shy); ctx.scale(1, 0.32); ctx.translate(-cx, -shy);
      ctx.fillStyle = grad;
      ctx.fillRect(cx - unit * 2, shy - unit * 2, unit * 4, unit * 4);
      ctx.restore();

      // 收集外壳面
      const faces = [];
      const act = this.active; // 同一时刻只有一层在转（无重叠），几何永远刚性
      for (let i = 0; i < this.state.cubies.length; i++) {
        const c = this.state.cubies[i];
        let oEff = c.o, pEff = c.pos;
        if (act && act.idx.has(i)) {
          oEff = mat3Mul(act.R, oEff);
          pEff = matVec(act.R, pEff);
        }
        for (let f = 0; f < 6; f++) {
          const n = NORM[f];
          // 外壳判定必须用世界法线 o·n（扭转后的角块局部朝向 ≠ 世界朝向）；
          // 动画中用静态 o 判定成员资格，绘制时才用 oEff，保证转层中的面不闪烁
          const nShell = matVec(c.o, n);
          if (c.pos[0] * nShell[0] + c.pos[1] * nShell[1] + c.pos[2] * nShell[2] !== 1) continue;
          const nW = matVec(oEff, n);
          const nV = matVec(Mv, nW);
          if (nV[2] <= 0.02) continue; // 背面剔除
          const pts = [];
          let zSum = 0;
          for (const lc of FACE_QUADS[f]) {
            const w = [
              oEff[0] * lc[0] + oEff[1] * lc[1] + oEff[2] * lc[2] + pEff[0],
              oEff[3] * lc[0] + oEff[4] * lc[1] + oEff[5] * lc[2] + pEff[1],
              oEff[6] * lc[0] + oEff[7] * lc[1] + oEff[8] * lc[2] + pEff[2],
            ];
            const v = matVec(Mv, w);
            const k = this.persp / (this.persp - v[2] * unit);
            pts.push([cx + v[0] * unit * k, cy - v[1] * unit * k]);
            zSum += v[2];
          }
          const hasSticker = c.home[0] * n[0] + c.home[1] * n[1] + c.home[2] * n[2] === 1;
          faces.push({
            z: zSum / 4,
            pts,
            plastic: shade(pal.plastic, 0.85 + 0.15 * Math.max(0, nV[2])),
            color: hasSticker ? shade(faceColor(f), 0.62 + 0.42 * Math.max(0, nV[0] * LIGHT3[0] + nV[1] * LIGHT3[1] + nV[2] * LIGHT3[2])) : null,
            sticker: hasSticker,
          });
        }
      }
      faces.sort((a, b) => a.z - b.z);

      // 绘制：先整面塑料底（形成贴纸间的黑缝），再画内缩贴纸
      for (const fc of faces) {
        const p = fc.pts;
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        ctx.lineTo(p[1][0], p[1][1]);
        ctx.lineTo(p[2][0], p[2][1]);
        ctx.lineTo(p[3][0], p[3][1]);
        ctx.closePath();
        ctx.lineJoin = "round";
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = fc.plastic;
        ctx.fillStyle = fc.plastic;
        ctx.stroke(); // 圆角 + 消除共面接缝
        ctx.fill();
        if (fc.sticker) {
          const midx = (p[0][0] + p[2][0]) / 2, midy = (p[0][1] + p[2][1]) / 2;
          const inset = 0.14;
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const x = p[i][0] + (midx - p[i][0]) * inset;
            const y = p[i][1] + (midy - p[i][1]) * inset;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.lineWidth = unit * 0.035;
          ctx.strokeStyle = fc.color;
          ctx.fillStyle = fc.color;
          ctx.stroke();
          ctx.fill();
        }
      }
    }
    render() { this.draw(); }
  }

  // ---------- 2D 展开图 ----------
  // mode: 'full' | 'cmll' (只角块着色) | 'lse' (棱+中心着色, 角块灰)
  // 已渲染的展开图会登记在册，配色/主题变化时自动重绘
  const NET_REGISTRY = new Map();
  function renderNet(el, state, opts) {
    NET_REGISTRY.set(el, { state, opts: opts || {} });
    renderNetNow(el, state, opts);
  }
  function rerenderNets() {
    NET_REGISTRY.forEach((rec, el) => {
      if (el.isConnected) renderNetNow(el, rec.state, rec.opts);
      else NET_REGISTRY.delete(el);
    });
  }
  document.addEventListener("themechange", rerenderNets);
  document.addEventListener("schemechange", rerenderNets);
  function renderNetNow(el, state, opts) {
    opts = opts || {};
    const mode = opts.mode || "full";
    const cell = opts.cell || 14;
    const pal = THEME_PALETTE[themeNow()];
    el.classList.add("net-root");
    el.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const gap = 1;
    const W = 4 * (3 * cell) + 5 * gap, H = 3 * (3 * cell) + 4 * gap;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", opts.width || W);
    const positions = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };
    const FI = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
    for (const fname in positions) {
      const [gx, gy] = positions[fname];
      const grid = C.faceGrid(state, FI[fname]);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const faceIdx = grid[r][c];
        const rect = document.createElementNS(NS, "rect");
        const x = gx * (3 * cell + gap) + gap + c * (cell + 0.5);
        const y = gy * (3 * cell + gap) + gap + r * (cell + 0.5);
        rect.setAttribute("x", x); rect.setAttribute("y", y);
        rect.setAttribute("width", cell); rect.setAttribute("height", cell);
        rect.setAttribute("rx", 2.5);
        let fill = faceColor(faceIdx);
        const isCorner = (r === 0 || r === 2) && (c === 0 || c === 2);
        const isCenter = r === 1 && c === 1;
        if (mode === "cmll" && !isCorner) fill = pal.netGrayCmll;
        if (mode === "lse" && isCorner) fill = pal.netGrayLse;
        rect.setAttribute("fill", fill);
        rect.setAttribute("stroke", pal.netStroke);
        rect.setAttribute("stroke-width", "0.5");
        svg.appendChild(rect);
      }
    }
    el.appendChild(svg);
  }

  window.CubeView = CubeView;
  window.renderNet = renderNet;
  window.SchemeKit = { getScheme, setScheme, COLOR_ZH, COLOR_HEX };
})();
