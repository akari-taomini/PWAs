# SillyTavern Immersive PWA v0.3.0

Android Chrome / WebAPK 沉浸式状态栏扩展。

## v0.3 修复

v0.2 通过扩大 `--topBarBlockSize` 和给 `#top-settings-holder` 增加顶部空间来避让状态栏。对带蕾丝、丝带、贴图的主题，这会把顶栏盒子本身拉高，导致底部装饰被推远，看起来像“蕾丝被吞掉、顶部只被拉长”。

v0.3 改成：

- 不再修改 `--topBarBlockSize`。
- 不再给 `#top-settings-holder` 增加 `padding-top`。
- `#top-bar` 作为完整成品整体向下移动，主题原本的高度、蕾丝、丝带和背景定位不变。
- `#sheld` 同步下移，并从底部扣除相同高度，避免超出屏幕。
- `#bg1 / #bg_custom` 保持从屏幕 y=0 开始，状态栏区域露出的应该是酒馆背景，而不是被拉长的顶栏底纹。

默认额外间距仍为 4px，可用：

```css
:root { --st-immersive-extra-top: 0px; }
```

改成贴紧状态栏。
