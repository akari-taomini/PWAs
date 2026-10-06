(() => {
    const LOG = '[Immersive PWA]';
    const RUNTIME_STYLE_ID = 'st-immersive-pwa-runtime';
    const SAFE_PROBE_ID = 'st-immersive-pwa-safe-probe';
    const TOPBAR_PROBE_ID = 'st-immersive-pwa-topbar-probe';

    let refreshTimer = 0;

    function getExtensionBaseUrl() {
        const scripts = Array.from(document.scripts);
        const self = scripts.find((script) =>
            script.src && script.src.includes('/SillyTavern-Immersive-PWA/index.js')
        );

        if (self) {
            return new URL('./', self.src);
        }

        return new URL('/scripts/extensions/third-party/SillyTavern-Immersive-PWA/', location.origin);
    }

    function ensureViewportFitCover() {
        let meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            document.head.appendChild(meta);
        }

        const raw = meta.content || '';
        const parts = raw
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .filter((part) => !/^viewport-fit\s*=/i.test(part));

        if (!parts.some((part) => /^width\s*=/i.test(part))) {
            parts.unshift('width=device-width');
        }
        if (!parts.some((part) => /^initial-scale\s*=/i.test(part))) {
            parts.push('initial-scale=1');
        }

        parts.push('viewport-fit=cover');
        meta.content = parts.join(', ');
    }

    function ensurePwaManifest() {
        let link = document.querySelector('link[rel="manifest"][data-st-immersive-pwa]');
        if (!link) {
            link = document.createElement('link');
            link.rel = 'manifest';
            link.dataset.stImmersivePwa = '1';
            document.head.appendChild(link);
        }

        link.href = new URL('pwa.webmanifest', getExtensionBaseUrl()).href;
    }

    function ensureThemeColor() {
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }

        // 这里只用于系统图标/启动过渡的兜底色。
        // 真正的“穿透”来自 installed PWA + viewport-fit=cover。
        const root = getComputedStyle(document.documentElement);
        const candidates = [
            root.getPropertyValue('--SmartThemeBlurTintColor').trim(),
            root.getPropertyValue('--SmartThemeChatTintColor').trim(),
            root.getPropertyValue('--SmartThemeBodyColor').trim(),
        ].filter(Boolean);

        if (candidates.length) {
            meta.content = candidates[0];
        }
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches;
    }

    function markDisplayMode() {
        const standalone = isStandalone();
        document.documentElement.classList.toggle('st-immersive-pwa-standalone', standalone);
        document.documentElement.classList.add('st-immersive-pwa-ready');

        if (!standalone) {
            clearRuntimeLayout();
        }
    }

    function ensureProbe(id) {
        let probe = document.getElementById(id);
        if (!probe) {
            probe = document.createElement('div');
            probe.id = id;
            probe.setAttribute('aria-hidden', 'true');
            Object.assign(probe.style, {
                position: 'fixed',
                left: '-99999px',
                top: '0',
                visibility: 'hidden',
                pointerEvents: 'none',
                boxSizing: 'border-box',
                width: '1px',
                zIndex: '-2147483648',
            });
            document.body.appendChild(probe);
        }
        return probe;
    }

    function measureSafeTopPx() {
        const probe = ensureProbe(SAFE_PROBE_ID);
        probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
        const value = parseFloat(getComputedStyle(probe).paddingTop);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }

    function getRuntimeStyle() {
        let style = document.getElementById(RUNTIME_STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = RUNTIME_STYLE_ID;
            document.head.appendChild(style);
        }
        return style;
    }

    function measureBaseTopBarPx(runtimeStyle) {
        // 暂时关掉我们自己的覆盖，读取当前美化真正设置的 topBarBlockSize。
        const oldText = runtimeStyle.textContent;
        runtimeStyle.textContent = '';

        const probe = ensureProbe(TOPBAR_PROBE_ID);
        probe.style.height = 'var(--topBarBlockSize, 0px)';
        const value = parseFloat(getComputedStyle(probe).height);

        runtimeStyle.textContent = oldText;
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function clearRuntimeLayout() {
        const runtimeStyle = document.getElementById(RUNTIME_STYLE_ID);
        if (runtimeStyle) runtimeStyle.textContent = '';

        const root = document.documentElement;
        root.style.removeProperty('--st-immersive-safe-top-px');
        root.classList.remove('st-immersive-force-sheld');
    }

    function applyImmersiveLayout() {
        if (!isStandalone() || !document.body) {
            clearRuntimeLayout();
            return;
        }

        const root = document.documentElement;
        const runtimeStyle = getRuntimeStyle();
        const safeTop = measureSafeTopPx();
        const baseTopBar = measureBaseTopBarPx(runtimeStyle);

        root.style.setProperty('--st-immersive-safe-top-px', `${safeTop}px`);

        // 把安全区直接并入 ST 自己的 topBarBlockSize。
        // 这样 #sheld、抽屉、弹窗、toast 等依赖这个变量的布局会一起缩下去，
        // 而不是每个美化逐个打补丁。
        if (baseTopBar > 0) {
            runtimeStyle.textContent = `
html.st-immersive-pwa-standalone {
    --st-immersive-base-topbar: ${baseTopBar}px;
    --topBarBlockSize: calc(
        var(--st-immersive-base-topbar)
        + var(--st-immersive-safe-top-px)
        + var(--st-immersive-extra-top)
    ) !important;
}`;
        } else {
            runtimeStyle.textContent = '';
        }

        // 兜底检测：某些重度美化把 #sheld 的 top 写死成 0/固定值，
        // 完全不吃 topBarBlockSize。只有确实没移动时才额外 translate。
        root.classList.remove('st-immersive-force-sheld');
        const sheld = document.getElementById('sheld');

        if (sheld && safeTop > 0) {
            requestAnimationFrame(() => {
                const sheldTop = sheld.getBoundingClientRect().top;
                const expectedMin = Math.max(0, baseTopBar + safeTop * 0.5);

                if (baseTopBar > 0 && sheldTop < expectedMin) {
                    root.classList.add('st-immersive-force-sheld');
                    console.info(LOG, '检测到美化写死 #sheld 定位，已启用安全区兜底。');
                }
            });
        }

        console.info(
            LOG,
            `安全区适配：safeTop=${safeTop}px, baseTopBar=${baseTopBar}px`
        );
    }

    function scheduleRefresh(delay = 80) {
        clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
            ensureThemeColor();
            applyImmersiveLayout();
        }, delay);
    }

    function init() {
        ensureViewportFitCover();
        ensurePwaManifest();
        ensureThemeColor();
        markDisplayMode();
        applyImmersiveLayout();

        const displayMode = window.matchMedia('(display-mode: standalone)');
        displayMode.addEventListener?.('change', () => {
            markDisplayMode();
            scheduleRefresh(30);
        });

        // 切主题、切美化、改移动 UI 后重新读取当前 topBarBlockSize。
        const observer = new MutationObserver(() => scheduleRefresh(120));

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style'],
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style'],
        });

        // 屏幕旋转、PWA 尺寸变化时安全区可能改变。
        window.addEventListener('resize', () => scheduleRefresh(100), { passive: true });
        window.visualViewport?.addEventListener('resize', () => scheduleRefresh(100), { passive: true });

        console.info(LOG, 'v0.2 已启用：背景保持穿透，酒馆 UI 自动避让 Android 顶部安全区。');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
