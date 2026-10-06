# SillyTavern Immersive PWA

Android Chrome / WebAPK 的沉浸式状态栏验证扩展。

## 目标

- 给 SillyTavern 页面注入 `viewport-fit=cover`
- 提供可安装 PWA manifest（`display: standalone`）
- 在支持 `Web App Short Edges Cutout Mode` 的 Chromium Android 上，让网页内容绘制到系统状态栏后方
- v0.1 不主动改动顶栏布局，只验证“是否真的穿透”

## 使用前

在 Android Chrome 的 `chrome://flags` 中启用：

`Web App Short Edges Cutout Mode`

若有 `Enabled (Standalone also enabled)`，选择它并重启 Chrome。

## 安装

将本仓库作为 SillyTavern 第三方扩展安装，刷新页面，然后在 Chrome 菜单中选择“安装应用 / 添加到主屏幕”。

从桌面图标打开后测试。

## 判断是否生效

在安装后的 PWA 中，浏览器 DevTools / 控制台执行：

```js
getComputedStyle(document.documentElement).getPropertyValue('--st-immersive-safe-top')
```

或者直接观察状态栏区域是否显示网页背景。

如果完全穿透但顶栏按钮跑到时间/电量下面，说明核心功能已成功，下一版只需要做 safe-area 布局适配。
