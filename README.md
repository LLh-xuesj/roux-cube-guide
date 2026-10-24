# 桥式魔方手册

桥式（Roux）魔方学习网站：基础教程 + 进阶提速，适合从入门到 sub-20 的全阶段玩家。纯静态站点，无需构建，**双击 `index.html` 即可使用**（或 `python -m http.server` / 任意静态服务器）。

## 页面一览

| 页面 | 内容 | 模式 |
| --- | --- | --- |
| `index.html` | 总览：学习路线图、训练方法总则、外部资源、数据来源 | 全部 |
| `basics.html` | 基础教程：桥式是什么、四步总览（3D 演示）、推荐视频课、新手路线 | 基础 |
| `fb.html` | ① 左桥 FB：基础说明 + 15 秒观察规划、效率目标、keyhole 等技法（3D 演示） | 基础 + 提高 |
| `sb.html` | ② 右桥 SB：基础说明 + 无停顿、r 技法、收尾预瞄 CMLL（3D 演示） | 基础 + 提高 |
| `cmll.html` | ③ CMLL：新手两步法说明 + 识别系统 + 全 42 式图库（展开图 + 3D + 公式） | 基础 + 提高 |
| `lse.html` | ④ LSE：4a/4b/4c 三步的识别与交互式查找表（3D 演示） | 全部 |
| `trainer.html` | 训练房：CMLL 识别训练、LSE 分步训练（含参考解）；整把计时外链 csTimer | 全部 |
| `verify.html` | 数据验证报告：所有数据的来源与机械验证说明 | 页脚入口 |

## 模式系统（基础 / 提高 / 全部）

- 首次访问会弹出引导，选择「刚开始学桥式 / 已会解法想提速 / 全部都要」；
- 页头右上角可随时切换；选择存在 `localStorage`（键 `roux-mode`）；
- 页面内容用 `data-track="basic|advance"` 标记，非全部模式下自动隐藏不匹配章节，并在页顶给出「显示全部内容」提示条。

## 交互功能

- **3D 魔方**：Canvas 2D 画家算法渲染（背面剔除 + 深度排序 + Lambert 光照），拖动转视角，▶ 播放 / ⇥ 单步 / ⟲ 复位，速度可调；转层动画位置与朝向一起真实旋转。
- **2D 展开图**：CMLL 模式只显示角块贴纸、LSE 模式弱化角块，与识别需求匹配。
- **配色**：右上角 🎨。默认标准配色（白顶 · 绿前 · 橙左），可改为任意标准配色（镜像组合会被拒绝）；favicon 跟随配色。

## 数据与验证（重要）

- CMLL 42 式抓取自 SpeedCubeDB（2026-10-24），并与其自带 setup 公式逐一对照（42/42 吻合）。
- 全部 164 条 CMLL 公式、LSE 全部查找表（4a/4b/4c）均在本地引擎上穷举验证：
  - LSE 求解器覆盖全部 11520 个合法状态（含角块 AUF 与中心偏转追踪）；
  - 网站实际使用的求解逻辑另经 2000 个随机打乱复核。
- 复现方式：`node _build/verify.cjs`（需 Node.js，无其它依赖）。
- 详细声明见站内 `verify.html`。

## 目录结构

```
index.html / basics.html / fb.html / sb.html / cmll.html / lse.html / trainer.html / verify.html
assets/
  css/style.css          样式（Apple 风格 · 深色）
  js/cube-core.js        魔方引擎（几何法生成转动，浏览器/Node 通用）
  js/cube-view.js        Canvas 3D 魔方 + 展开图 + 播放器
  js/site.js             导航 / 首次引导 / 模式系统 / 配色
  js/data/cmll-data.js   CMLL 42 式（已验证）
  js/data/lse-data.js    LSE 查找表 + 求解器（已验证）
  js/data/demos-data.js  FB/SB 技法演示场景（已验证）
_build/                  构建与验证工具（Node 脚本 + 原始数据）
```

## 外部资源

- 视频课（B 站 · 随风又见面了）：[桥式入门教程](https://www.bilibili.com/video/BV1At411n7ec/)（52 分钟）· [桥式基础教程](https://www.bilibili.com/video/BV1Ut411u7fX/)（2 小时 14 分）——在 `basics.html` 内可直接播放。
- 计时：[csTimer](https://cstimer.net/)。
- Roux 官方教程：[grrroux.free.fr](http://grrroux.free.fr/method/Step_1.html)。
