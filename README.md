# SillyTavern Immersive PWA v0.6.0


v0.6.0 增加大型扩展面板的通用顶栏避让，并保留 v0.5.1 的主容器最低高度修复。不修改美化 JSON、第三方扩展文件或其内联样式。

## 大型扩展面板通用避让

在 PWA 模式、顶部避让量大于 0 时生效。默认开启，可在扩展设置中关闭「大型扩展面板自动避让顶栏」；关闭后立即恢复面板原来的定位。

- 以当前系统避让高度与可见酒馆顶栏的实际底边为边界，面板标题和关闭按钮留在此边界下方。
- 仅处理真正撞到边界的大型 fixed 面板。通过尺寸、顶部标题/工具栏与交互控件识别，已留出空间的面板不改。
- 面板移到安全位置时等量缩短高度；必要时调整阻止缩短的最低高度，避免底边一起掉下去。键盘出现时，以可视区域下沿限制该面板的高度；不会定位酒馆输入框。
- 排除聊天树、输入区、背景、QR、原生抽屉、小悬浮球、拖动窗口与普通居中弹窗遮罩。测量时暂停自身 CSSStyleSheet，不清空作者样式，重复刷新不累积偏移。
- 监听扩展面板的插入和显隐、屏幕与可视区域尺寸变化；不使用轮询，不观察聊天树。自身样式更新不会触发插件自身的顶栏刷新循环。

### 已核对的扩展

Anima 的后端仓库 `Ellinav/anima-rag` 不包含界面 CSS。已在配套前端 [Ellinav/Anima-Memory-System](https://github.com/Ellinav/Anima-Memory-System) 核对 `style.css` 与 `index.js`：主界面为 `#anima-overlay`，固定在 top:0，height:100vh，带 60px 标题栏。此版登记该面板，并让其 backdrop-filter 内的固定模态层跟随缩短后的父容器高度，保留标题、颜色与按钮功能。

飞书链接 https://gcn02iwpisfi.feishu.cn/wiki/Ga4uwBXpaimRfrkQnMtcbKvGnVd 未能获取正文，因此尚未确认它对应的扩展及选择器。满足通用识别条件的面板可自动处理，但不能据此宣称已核对该飞书扩展。

### 通用接口（给扩展作者或少见情况）

不用每次写新的适配脚本，可给主文档中的 fixed 面板标记 `data-st-pwa-avoid-header="panel"`；可用 `data-st-pwa-avoid-header="off"` 排除自身及其后代。也可以在本插件已启用面板避让后登记固定面板的选择器：

```js
const unregister = window.__stImmersivePwaPanels.register('#your-panel');
// unregister(); // 撤销登记
// const undoExclude = window.__stImmersivePwaPanels.exclude('#your-panel');
console.log(window.__stImmersivePwaPanels.info());
```

插件同时提供 `--st-immersive-panel-top` 和 `--st-immersive-panel-height` CSS 变量，供主动适配的扩展使用。单独登记也不会移动整个聊天应用容器。

### 边界

跨域 iframe、Shadow DOM、特殊变换形成的局部 fixed 容器、绝对定位面板、无法解析的百分比/内在最低高度，以及内联 !important 覆盖本插件规则的情况，不属于自动通吃范围。原生居中弹窗和小悬浮窗保持原逻辑。捏合缩放时暂停面板规则。此版尽量覆盖常见写死 top:0 的大型面板，不能保证未来任意扩展都自动兼容。

### 保留的底栏修复

部分主题给 #sheld 设置了较大的 min-height，并将 #form_sheld 用 absolute + bottom:0 定位。顶部避让缩短主容器时，只有测得的像素最低高度阻止等量缩短，才将这条最低高度也减少同样的避让量。未阻止缩短的最低高度保持原规则。背景与 QR 样式文件保持 v0.5.1 原样。已经在用的背景/毛球兼容脚本可先保留。


## 安装

覆盖原 SillyTavern/public/scripts/extensions/third-party/SillyTavern-Immersive-PWA/ 中的同名文件，刷新酒馆，再关闭、重开 PWA。不要同时安装多个版本。不需要重新导入美化。

## 顶部避让

v0.4 在安全区读数为 0 时不会下移。新截图能确认未下移，但没有设备日志，不能仅凭图片断言读数确实是 0。

本版优先使用系统安全区；Android 竖屏 PWA 报 0 时，使用 32 个 CSS 像素作为可调的估计值。在扩展设置 → 沉浸式 PWA · 0.6.0，可手动指定 0–120px，设置会在本设备保存。仍重叠就调大，空隙偏宽就调小。横屏不自动使用兜底值。

设置页显示系统读数、采用高度、计算的下移量。兼容 standalone、fullscreen、minimal-ui。测量时同步清空自身规则后再写回，不依赖 style.disabled 属性，也不使用 revert 清除主题样式。

保留双层顶栏处理：#top-bar 与 #top-settings-holder 一起移动，保持高度和蕾丝；#sheld 移动并减少同等高度。#bg1 真背景从屏幕顶端铺开，不使用假图片或纯色填充条。

## QR 展开兼容

主题将 #qr--bar 默认设为 max-height:0，输入区 focus-within 时才展开。本版仅对含这种规则的主题应用兼容：
- 点击、聚焦输入区时允许现有 QR 条展开，触摸 QR 时保持可操作。
- 输入容器不被挤扁，聊天区可以缩小，为键盘和 QR 留出空间。
- 按钮过多时条内可滚动；点击别处且输入区失焦后恢复主题折叠。
- 该兼容可在扩展设置关闭。

不执行 QR，不更改脚本或启用状态，不强行退出独立窗口。如果设置页显示“按钮条未加载”，需要结合 QR 配置继续判断；本扩展不会创建未启用的 QR 按钮。

## 可选 CSS

自动模式仍兼容 :root { --st-immersive-safe-top: 32px; }；设置页手动高度优先。
额外间距可用 :root { --st-immersive-extra-top: 2px; }，会与采用高度相加。

## 核验范围

已完成 JS 语法、JSON、压缩包检查；30 项面板离线回归模型检查与 31 项原布局回归模型检查通过。涉及 Anima 原尺寸、最低高度冲突、重复刷新不重复写样式、隐藏/打开/动态插入、可视区域缩小与恢复、横屏、已避让面板、普通浏览器与零避让量、关闭恢复、小悬浮球、原生抽屉、遮罩、拖动窗口、局部 fixed 容器、聊天排除及独立登记/排除。

离线模型验证不等同于浏览器渲染或手机实测；未访问用户手机、未启动其酒馆、未推送 GitHub。

源码依据：SillyTavern 1.19.0 / 06bde939f 的 public/index.html、style.css、css/backgrounds.css、css/mobile-styles.css、scripts/extensions/quick-reply/src/ui/ButtonUi.js。
本包不包含“草草莓莓”的主题或素材。
