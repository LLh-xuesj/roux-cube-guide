/*
 * site.js — 头部导航 + 首次引导 + 模式系统（基础/提高/全部）+ 配色设置 + favicon
 */
(function () {
  "use strict";
  const K = window.SchemeKit;

  const MODES = [["basic", "基础"], ["advance", "提高"], ["all", "全部"]];
  const PAGES = [
    ["index.html", "总览", null],
    ["basics.html", "基础教程", "basics"],
    ["fb.html", "① 左桥 FB", null],
    ["sb.html", "② 右桥 SB", null],
    ["cmll.html", "③ CMLL", null],
    ["lse.html", "④ LSE", null],
    ["trainer.html", "训练房", null],
  ];
  const here = location.pathname.split("/").pop() || "index.html";

  // ---------- 模式 ----------
  function getMode() {
    const m = localStorage.getItem("roux-mode");
    return MODES.some(([v]) => v === m) ? m : "all";
  }
  function setMode(m, save) {
    if (!MODES.some(([v]) => v === m)) return;
    if (save !== false) localStorage.setItem("roux-mode", m);
    document.body.dataset.mode = m;
    document.querySelectorAll(".mode-seg button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    refreshTrackNotice();
    document.dispatchEvent(new CustomEvent("modechange", { detail: { mode: m } }));
  }

  // ---------- 头部 ----------
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML =
    '<a class="logo" href="index.html">桥式<em>手册</em></a>' +
    "<nav>" + PAGES.map(([href, label, key]) =>
      '<a href="' + href + '"' + (here === href ? ' class="active"' : "") + (key ? ' data-nav="' + key + '"' : "") + ">" + label + "</a>"
    ).join("") + "</nav>" +
    '<div class="spacer"></div>' +
    '<div class="mode-seg" role="group" aria-label="内容模式">' +
    MODES.map(([v, label]) => '<button data-mode="' + v + '">' + label + "</button>").join("") +
    "</div>" +
    '<button class="scheme-btn" id="themeBtn" title="切换明暗">☀️</button>' +
    '<button class="scheme-btn" id="schemeBtn" title="魔方配色">🎨 配色</button>';
  document.body.prepend(header);
  header.querySelector(".mode-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setMode(b.dataset.mode);
  });

  // ---------- 隐藏章节提示条 ----------
  const notice = document.createElement("div");
  notice.className = "track-notice";
  notice.style.display = "none";
  const mainEl = document.querySelector("main");
  if (mainEl) mainEl.prepend(notice);
  function refreshTrackNotice() {
    const mode = document.body.dataset.mode || "all";
    const hideSel = mode === "basic" ? '[data-track="advance"]' : mode === "advance" ? '[data-track="basic"]' : null;
    if (!hideSel || !mainEl) { notice.style.display = "none"; return; }
    const n = mainEl.querySelectorAll(hideSel).length;
    if (!n) { notice.style.display = "none"; return; }
    const hiddenLabel = mode === "basic" ? "提高" : "基础";
    notice.innerHTML = "<span>当前为<b>" + (mode === "basic" ? "基础" : "提高") +
      "模式</b>，本页有 " + n + " 个「" + hiddenLabel + "」章节已隐藏。</span>";
    const btn = document.createElement("button");
    btn.textContent = "显示全部内容";
    btn.addEventListener("click", () => setMode("all"));
    notice.appendChild(btn);
    notice.style.display = "";
  }

  // ---------- 明暗主题 ----------
  function applyTheme(t, save) {
    if (t !== "light" && t !== "dark") t = "dark";
    if (save !== false) localStorage.setItem("roux-theme", t);
    document.documentElement.dataset.theme = t;
    const btn = document.getElementById("themeBtn");
    if (btn) {
      btn.textContent = t === "dark" ? "☀️" : "🌙";
      btn.title = t === "dark" ? "切换到浅色" : "切换到深色";
    }
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: t } }));
  }
  applyTheme(localStorage.getItem("roux-theme") === "light" ? "light" : "dark", false);
  document.getElementById("themeBtn").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });

  // ---------- 配色弹窗 ----------
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.id = "schemeModal";
  const COLORS = ["white", "yellow", "green", "blue", "red", "orange"];
  const optHtml = (sel) => COLORS.map((c) =>
    '<option value="' + c + '"' + (c === sel ? " selected" : "") + ">" + K.COLOR_ZH[c] + "</option>"
  ).join("");
  mask.innerHTML =
    '<div class="modal">' +
    "<h3>魔方配色</h3>" +
    '<p class="hint">选择与你手中魔方一致的配色（默认为标准配色：白顶 · 绿前 · 橙左）。' +
    "配色只影响本站图示的颜色，不影响任何公式。</p>" +
    '<div class="row"><span style="width:110px">左桥面 (L)</span><select id="scL">' + optHtml("orange") + "</select></div>" +
    '<div class="row"><span style="width:110px">前面 (F)</span><select id="scF">' + optHtml("green") + "</select></div>" +
    '<div class="row"><span style="width:110px">顶面 (U)</span><select id="scU">' + optHtml("white") + "</select></div>" +
    '<p class="hint" id="scMsg"></p>' +
    '<div style="text-align:right"><button class="big-btn" id="scApply">应用</button></div>' +
    "</div>";
  document.body.appendChild(mask);

  function currentLFU() {
    const s = K.getScheme();
    return { L: s[4], F: s[2], U: s[0] };
  }
  function syncSelects() {
    const cur = currentLFU();
    document.getElementById("scL").value = cur.L;
    document.getElementById("scF").value = cur.F;
    document.getElementById("scU").value = cur.U;
  }
  document.getElementById("schemeBtn").addEventListener("click", () => {
    syncSelects();
    document.getElementById("scMsg").textContent = "";
    mask.classList.add("open");
  });
  mask.addEventListener("click", (e) => { if (e.target === mask) mask.classList.remove("open"); });
  document.getElementById("scApply").addEventListener("click", () => {
    const L = document.getElementById("scL").value;
    const F = document.getElementById("scF").value;
    const U = document.getElementById("scU").value;
    if (K.setScheme(L, F, U)) {
      document.getElementById("scMsg").textContent = "已应用 ✓";
      setTimeout(() => mask.classList.remove("open"), 400);
    } else {
      document.getElementById("scMsg").textContent = "该组合不是标准配色（镜像方案不存在），请换一个顶面颜色。";
    }
  });

  // ---------- 首次访问引导 ----------
  const OB_KEY = "roux-onboarded";
  let obMask = null;
  function showOnboarding() {
    obMask = document.createElement("div");
    obMask.className = "ob-mask";
    const opts = [
      ["basic", "刚开始学桥式", "还没学会完整解法，或刚照着教程入门。从桥式思路与四步基础学起，进阶内容会先隐藏。"],
      ["advance", "已会解法，想提速", "能完整复原，目标是进入 30s 甚至 20s。直达 CMLL 42 式、无停顿 SB、LSE 优化。"],
      ["all", "全部教程都看", "基础 + 提高完整呈现，适合想系统过一遍的玩家。"],
    ];
    obMask.innerHTML =
      '<div class="ob-card">' +
      '<div class="ob-logo">' + ["red", "orange", "white", "blue"].map((c) => '<i style="background:' + K.COLOR_HEX[c] + '"></i>').join("") + "</div>" +
      "<h2>欢迎来到桥式手册</h2>" +
      '<p class="ob-sub">桥式（Roux）以更少的转动和更流畅的流程著称。为了给你合适的内容，先告诉我你的水平：</p>' +
      '<div class="ob-opts">' +
      opts.map(([m, t, d]) =>
        '<button class="ob-opt" data-mode="' + m + '"><span class="ob-tag">' + MODES.find((x) => x[0] === m)[1] + "模式</span><b>" + t + "</b><span>" + d + "</span></button>"
      ).join("") +
      "</div>" +
      '<p class="ob-foot">之后可随时用页头右上角的「基础 / 提高 / 全部」切换，🎨 配色里可改成你魔方的实际颜色。</p>' +
      "</div>";
    document.body.appendChild(obMask);
    requestAnimationFrame(() => obMask.classList.add("show"));
    obMask.addEventListener("click", (e) => {
      const b = e.target.closest(".ob-opt");
      if (!b) return;
      setMode(b.dataset.mode);
      localStorage.setItem(OB_KEY, "1");
      obMask.classList.remove("show");
      setTimeout(() => obMask.remove(), 350);
    });
  }
  setMode(getMode(), false);
  if (!localStorage.getItem(OB_KEY)) showOnboarding();
  window.RouxMode = { get: getMode, set: (m) => setMode(m) };

  // ---------- 动态 favicon（跟随配色） ----------
  function updateFavicon() {
    const s = K.getScheme();
    const hex = (i) => K.COLOR_HEX[s[i]];
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      [[4, 4], [34, 4], [4, 34], [34, 34]].map(([x, y], i) =>
        '<rect x="' + x + '" y="' + y + '" width="26" height="26" rx="7" fill="' + hex([0, 2, 4, 1][i]) + '"/>'
      ).join("") + "</svg>";
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }
  updateFavicon();
  document.addEventListener("schemechange", updateFavicon);

  // ---------- 页脚 ----------
  const footer = document.createElement("div");
  footer.className = "footer";
  footer.innerHTML =
    "桥式手册 · CMLL 数据来自 <a href='https://speedcubedb.com/a/3x3/CMLL' target='_blank' rel='noopener'>SpeedCubeDB</a>（2026-10）· 全部公式经本地引擎穷举验证 · " +
    "<a href='verify.html'>验证报告</a> · 计时推荐 <a href='https://cstimer.net/' target='_blank' rel='noopener'>csTimer</a>";
  document.body.appendChild(footer);
})();
