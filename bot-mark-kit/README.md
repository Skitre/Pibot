# Bot Mark Kit —— Grok Bot 标志/头像系统研究包

> 来源:Grok_Bot_0.16.0_Setup.exe 渲染层 bundle(`index-DVUCYGay.js`,无 source map,以下均为对
> 压缩代码的静态分析结论)。打包日期 2026-08-16。

## ⚠️ 使用边界

- `SPEC.md` 里的常量与机制描述(形状名、色值、状态名、分配规则)属于功能性规格,可自由用于
  自己的实现;但请用自己的代码、自己的几何参数写,不要逐值照抄美术表达。

## 目录

```
bot-mark-kit/
├── README.md            ← 本文件
├── SPEC.md              ← 机制规格:形状/颜色/状态/姿态,复刻就照它写
├── fragments/           ← 从 index-DVUCYGay.js 按锚点切出的 9 段原始压缩代码(仅研究)
│   01-shape-definitions.js    19 个参数化形状生成器 + 每形状面部微调
│   02-hash-and-assignment.js  id→颜色/形状 的哈希分配
│   03-color-palette.js        11 色调色板
│   04-state-machine.js        状态分组表(39 状态)
│   05-state-clip-mapping.js   状态→动作片段组合 + 时长
│   06-mark-component.js       姿态组件(state/gaze/pose/ref API)
│   07-mark-jsx-factory.js     SVG 结构(7 ring + 7 part + 3 glyph 演员池)
│   08-gaze-tracking.js        指针追踪喂 gazeTarget
│   09-avatar-model.js         头像持久化模型(自定义图/远程 id)
├── assets/              ← 预设头像(ada/cerf/dijkstra/liskov/matsumoto)、三色样例、应用图标
└── tools/               ← inspect-mark*.cjs 分析脚本,可对原 bundle 重跑验证
```

## 快速理解(一分钟版)

1. 每个 bot 的标志 = **形状 × 颜色**,由 agent id 经 FNV 哈希(带 avalanche 混淆)取模分配,
   亦可用户手选;有自定义头像时回落 gray + blob;
2. 形状是**参数化几何**(多边形顶点/贝塞尔/圆角化),非美术素材;每形状带面部偏移微调;
3. 标志是**有状态的生物**:39 个状态(生命周期 7 / 情绪 16 / 形态变换 3 / 产品动作 13),
   每个状态映射到 24 个基础动作片段的某个组合,1.5s 循环;
4. 姿态层支持 turn/tilt/roll/scale 三轴 + poseHome、眼睛 gazeTarget 追随指针、
   命令式 ref API:spin()/bounce()/burst();
5. 动画引擎:motion(framer-motion 12),尊重 prefers-reduced-motion。

复刻从 `SPEC.md` 开始;验证分析结论用 `tools/` 里的脚本重跑。
