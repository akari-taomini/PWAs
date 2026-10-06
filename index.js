(() => {
    const LOG = '[Immersive PWA]';
    const SAFE_PROBE_ID = 'st-immersive-pwa-safe-probe';
    const RUNTIME_STYLE_ID = 'st-immersive-pwa-runtime';

    let refreshTimer = 0;
    let applying = false;

    function getExtensionBaseUrl() {
        const scripts = Array.from(document.scripts);
        const self = scripts.find((script) =>
            script.src && script.src.includes('/SillyTavern-Immersive-PWA/index.js')
        );

        if (self) return new URL('./', self.src);
        return new URL('/scripts/extensions/third-party/SillyTavern-Immersive-PWA/', location.origin);
    }

    function ensureViewportFitCover() {
        let meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            document.head.appendChild(meta);
        }

        const parts = (meta.content || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .filter((part) => !/^viewport-fit\s*=/i.test(part));

        if (!parts.some((part) => /^width\s*=/i.test(part))) parts.unshift('width=device-width');
        if (!parts.some((part) => /^initial-scale\s*=/i.test(part))) parts.push('initial-scale=1');
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

        const rootStyle = getComputedStyle(document.documentElement);
        const candidates = [
            rootStyle.getPropertyValue('--SmartThemeBlurTintColor').trim(),
            rootStyle.getPropertyValue('--SmartThemeChatTintColor').trim(),
            rootStyle.getPropertyValue('--SmartThemeBodyColor').trim(),
        ].filter(Boolean);

        if (candidates.length) meta.content = candidates[0];
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches;
    }

    function markDisplayMode() {
        const standalone = isStandalone();
        document.documentElement.classList.toggle('st-immersive-pwa-standalone', standalone);
        document.documentElement.classList.add('st-immersive-pwa-ready');

        if (!standalone) clearRuntimeLayout();
    }

    function ensureProbe() {
        let probe = document.getElementById(SAFE_PROBE_ID);
        if (!probe) {
            probe = document.createElement('div');
            probe.id = SAFE_PROBE_ID;
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
        const probe = ensureProbe();
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

    function clearRuntimeLayout() {
        const root = document.documentElement;
        root.style.removeProperty('--st-immersive-safe-top-px');
        root.style.removeProperty('--st-immersive-sheld-base-height');
        root.style.removeProperty('--st-immersive-sheld-base-max-height');

        const runtime = document.getElementById(RUNTIME_STYLE_ID);
        if (runtime) runtime.textContent = '';
    }

    function measureBaseSheld() {
        const sheld = document.getElementById('sheld');
        if (!sheld) return null;

        // 临时关闭本扩展对 #sheld 的最终覆盖，读取当前美化真实尺寸。
        const runtime = getRuntimeStyle();
        const old = runtime.textContent;
        runtime.textContent = `
html.st-immersive-pwa-standalone #sheld {
    translate: none !important;
    height: revert !important;
    max-height: revert !important;
}`;

        // 强制一次 style/layout flush。
        const cs = getComputedStyle(sheld);
        const rect = sheld.getBoundingClientRect();
        const height = rect.height || parseFloat(cs.height) || 0;
        const maxHeightRaw = parseFloat(cs.maxHeight);
        const maxHeight = Number.isFinite(maxHeightRaw) && maxHeightRaw > 0 ? maxHeightRaw : height;

        runtime.textContent = old;

        return {
            height: Math.max(0, height),
            maxHeight: Math.max(0, maxHeight),
        };
    }

    function applyImmersiveLayout() {
        if (applying) return;
        applying = true;

        try {
            if (!isStandalone() || !document.body) {
                clearRuntimeLayout();
                return;
            }

            const root = document.documentElement;
            const safeTop = measureSafeTopPx();
            const base = measureBaseSheld();

            root.style.setProperty('--st-immersive-safe-top-px', `${safeTop}px`);

            if (base && base.height > 0) {
                root.style.setProperty('--st-immersive-sheld-base-height', `${base.height}px`);
                root.style.setProperty('--st-immersive-sheld-base-max-height', `${base.maxHeight}px`);
            }

            console.info(
                LOG,
                `v0.3 安全区：safeTop=${safeTop}px, sheld=${base?.height ?? 0}px；顶栏整体下移，不再拉长美化。`
            );
        } finally {
            applying = false;
        }
    }

    function scheduleRefresh(delay = 100) {
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

        const observer = new MutationObserver((mutations) => {
            if (applying) return;
            const relevant = mutations.some((m) => {
                if (m.target === document.documentElement && m.attributeName === 'style') return false;
                return true;
            });
            if (relevant) scheduleRefresh(140);
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style'],
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style'],
        });

        window.addEventListener('resize', () => scheduleRefresh(120), { passive: true });
        window.visualViewport?.addEventListener('resize', () => scheduleRefresh(120), { passive: true });

        console.info(LOG, 'v0.3 已启用：保留美化顶栏原尺寸与蕾丝，背景继续穿透状态栏。');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
