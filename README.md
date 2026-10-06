# SillyTavern Immersive PWA v0.2.0

Android Chrome / WebAPK 沉浸式状态栏扩展。

## v0.2 做了什么

- 保持 SillyTavern 背景从屏幕最顶部开始绘制，状态栏继续透明穿透。
- 自动读取 `env(safe-area-inset-top)`。
- 将顶部安全区并入 SillyTavern 的 `--topBarBlockSize`，让聊天区、抽屉、弹窗等跟着向下收缩。
- 顶栏按钮自动避开时间 / Wi‑Fi / 电量区域，但顶栏背景和装饰仍可延伸到状态栏后面。
- 对把 `#sheld` 位置写死的重度美化做自动兜底，不正常时才额外下移，避免重复偏移。
- 默认在系统安全区下再留 `4px` 空隙。

## 使用前

Android Chrome 的 `chrome://flags` 中启用：

`Web App Short Edges Cutout Mode`

若存在 `Enabled (Standalone also enabled)`，选择它并重启 Chrome。

## 安装

把本仓库作为 SillyTavern 第三方扩展安装并刷新页面，然后在 Chrome 中“安装应用 / 添加到主屏幕”。

必须从桌面安装后的 PWA 图标进入，普通 Chrome 标签页不会启用这套布局。

## 顶部距离

默认额外留 4px：

```css
--st-immersive-extra-top: 4px;
```

想贴紧状态栏可在自定义 CSS 里覆盖：

```css
:root {
    --st-immersive-extra-top: 0px;
}
```

想再往下一点，例如 8px：

```css
:root {
    --st-immersive-extra-top: 8px;
}
```

## 说明

扩展不修改 SillyTavern 的背景图、角色、聊天、世界书或其他数据。PNG 仅是 PWA 桌面图标。
