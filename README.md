# SillyTavern Immersive PWA v0.5.0

针对 v0.4 截图中顶栏仍与状态栏重叠，以及输入时 QR 不展开的反馈修订。最新“草草莓莓.json”的 CSS 与上一份相同。

## 安装

覆盖原 SillyTavern/public/scripts/extensions/third-party/SillyTavern-Immersive-PWA/ 中的同名文件，刷新酒馆，再关闭、重开 PWA。不要同时安装多个版本。不需要重新导入美化。

## 顶部避让

v0.4 在安全区读数为 0 时不会下移。新截图能确认未下移，但没有设备日志，不能仅凭图片断言读数确实是 0。

本版优先使用系统安全区；Android 竖屏 PWA 报 0 时，使用 32 个 CSS 像素作为可调的估计值。在扩展设置 → 沉浸式 PWA · 0.5.0，可手动指定 0–120px，设置会在本设备保存。仍重叠就调大，空隙偏宽就调小。横屏不自动使用兜底值。

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

已核对美化 QR 规则、酒馆对应版本的 QR 插入位置，完成 JS 语法、JSON、压缩包检查。浏览器运行文件下载失败，未完成渲染或手机实测。QR 失效的唯一原因尚未通过设备运行数据确认；本版提供针对展开与空间不足的兼容。

源码依据：SillyTavern 1.19.0 / 06bde939f 的 public/index.html、style.css、css/backgrounds.css、css/mobile-styles.css、scripts/extensions/quick-reply/src/ui/ButtonUi.js。
本包不包含“草草莓莓”的主题或素材。
