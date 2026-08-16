# Bot Mark 机制规格(复刻用)

> 本文档描述机制与功能性常量(形状名、色值、状态名、数值行为),不复制其代码。
> 配套证据:`fragments/` 对应编号文件。

## 1. 组合模型

```
mark = shape × color (+ face) × state-driven animation
默认分配:hash(agentId) → {shape ∈ 8 exposed, color ∈ 10 buckets}
用户覆盖:avatarShape / avatarColor 单独可选
自定义头像存在时:{color: gray, shape: blob}
```

## 2. 形状

暴露 8 种(哈希分配池):`blob`(默认)、`pebble`、`squircle`、`tablet`、`wedge`、`hex`、
`cloud`、`teardrop`。
代码内另有 11 种未开放形状(共 19):`bean`、`egg`、`capsule`、`cylinder`、`gem`、`crystal`、
`shield`、`dome`、`arch`、`leaf`、`squircle`(gem 变体)。

实现方式:每个形状 = 参数化几何生成器(顶点表/多边形圆角/贝塞尔/圆簇),坐标系 100×100,
中心 50,50。**不是 SVG 素材**。每形状可带:
- `face` 偏移微调(如 wedge 的左眼 DX=-6,因形状重心偏移);
- `solid` 区域表(形状内哪些列允许放眼睛/装饰);
- `tiltScale`(圆柱等形状的倾斜衰减);
- `turnAt(p)` 转向函数(多边形按边数在 turn 参数下缩放,模拟 3D 转体)。

## 3. 颜色(11 色)

| id | hex |
|---|---|
| black | #000000(仅默认/手选,哈希池排除) |
| brown | #936439 |
| red | #FF263C |
| orange | #FF6700 |
| yellow | #FF9800 |
| green | #00C972 |
| cyan | #00BCA6 |
| blue | #1084FE |
| violet | #9159FE |
| magenta | #FF309B |
| gray | #777777(自定义头像 bot 的回落色) |

哈希池 = 上述去掉 black 后的 10 色,分 **30 个桶**(某些色多桶,概率不均等),
`kot[hash % ...]` 取色。亮/暗主题各渲染一组渐变(`inkGradient.light/dark`,同色 from→to)。

## 4. id → 外观 的哈希

```
h = FNV-1a 变体(id 字符串)
h = mix(h) 两轮 avalanche(imul + 位移),防相邻 id 成簇
color = colorTable[h → 30 桶].id ?? "black"
shape = SHAPES[h % SHAPES.length] ?? "blob"
```

复刻提示:任何稳定的字符串哈希 + 取模即可,关键是**同 id 永远同外观** + 分布均匀;
两轮混淆是他们防"用户批量建 bot 时颜色扎堆"的细节,可选。

## 5. 状态机(39 状态,4 组)

| 组 | 状态 |
|---|---|
| Lifecycle(7) | sleeping, waking, idle, listening, thinking, searching, working |
| Reactions(16) | excited, surprised, suspicious, angry, drowsy, happy, curious, confused, bored, proud, shy, sad, laughing, scared, playful, celebrate |
| Agent morphs(3) | orbit, radar, progress |
| Product lifecycle(13) | spawning, humming, loading, dictating, writing, sending, receiving, uploading, notifying, alerting, dragging, bouncing, powering-down |

驱动:每个状态 = 24 个基础**动作片段**(clip)的组合(2–6 个,有序),循环周期 **1500ms**。
一次性状态:`progress` 2500ms、`spawning` 2000ms(播完回 idle)。

动作片段本体是 SVG 演员池动画:7 个 ring(圆环)、7 个 part(粒子)、3 个 glyph(字形),
body path + 眼睛 + badge 组合播放(见 fragments/07 的 refs 结构)。眼睛拓扑可单/双(uniformEyes)。

## 6. 姿态与交互层

组件 props(行为规格):

| prop | 行为 |
|---|---|
| `state` | 上表 39 状态之一,默认 idle |
| `shape` / `size` | 形状与尺寸 |
| `gazeTarget` | {x,y} 屏幕坐标;眼睛看向它。全局 pointermove + rect 命中计算驱动(默认=鼠标) |
| `emphasis` | 强调态(视觉加重) |
| `spinSignal` | 自增整数;每次变化触发一次 spin |
| `pose` | {turn, tilt, roll, scale} 三轴姿态 + 缩放 |
| `poseHome` | 回正姿态(动画回落目标) |
| `eyeTopology` / `uniformEyes` / `eyeScale` / `faceTune` | 眼睛形态微调 |
| `badgeColor` | 角标颜色,默认 var(--gb-badge, #1d9bf0) |
| `paused` | 暂停动画 |
| `inkGradient` | 亮暗渐变覆盖 |

ref 命令式 API:`spin(ms?)`、`bounce()`、`burst()`。
bounce 预设四级(高度 h px / 时长 d s):48/0.5、28/0.382、14/0.27、6/0.177(衰减弹性)。

CSS 挂点:类名 `sand-grok-bot-mark`,镜像变体 `--mirror`(群聊成员/复制体区分);
`data-grok-state` 属性随状态更新(测试与样式钩子)。

## 7. 动画引擎与无障碍

- 引擎:motion(framer-motion 12.x);CSS 内 70 组 keyframes,大量 transform/opacity 驱动;
- **prefers-reduced-motion 6 处检查**:系统降级时停用循环动画;
- 性能习惯:演员(眼睛/粒子)全部 display:none 起步,按需点亮;流式文本不触发 mark 重渲。

## 8. 持久化模型

- `profile.json`:avatarColor / avatarShape 可选字段;
- 自定义头像:avatarDataUrl(base64 或文件)+ avatarVersion 缓存失效;
- 远程成员 id 形如 `sand-remote:<ownerAuthId>/<agentId>`,URL 编码,同样参与外观哈希
  (在主人设备上算出相同结果 → 两端渲染一致)。

## 9. 复刻路线建议(MVP → 完整)

1. **MVP**:8 形状 × 10 色的静态 SVG 生成 + id 哈希分配 + idle/thinking/working 三状态
   (CSS keyframes 循环即可,不需要引擎);
2. **v2**:眼睛 + gazeTarget(pointermove 跟随)+ turn/tilt/roll 姿态;
3. **v3**:动作片段库(自设计 8–12 个片段足够)+ 状态→片段组合表 + ref API;
4. **v4**:一次性状态(spawning/progress)、mirror 变体、reduced-motion 降级。

每一步的验收口径:同 id 同外观、状态切换无跳帧(姿态插值)、reduced-motion 下静止。
