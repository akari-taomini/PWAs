(() => {
    const LOG = '[Immersive PWA]';

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
        // 真正的“穿透”来自 installed PWA + viewport-fit=cover，
        // 不是靠 theme-color 假装背景。
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

    function markDisplayMode() {
        const standalone = window.matchMedia('(display-mode: standalone)').matches;
        document.documentElement.classList.toggle('st-immersive-pwa-standalone', standalone);
        document.documentElement.classList.add('st-immersive-pwa-ready');
    }

    function init() {
        ensureViewportFitCover();
        ensurePwaManifest();
        ensureThemeColor();
        markDisplayMode();

        const displayMode = window.matchMedia('(display-mode: standalone)');
        displayMode.addEventListener?.('change', markDisplayMode);

        // 主题切换时刷新兜底色，不读取图片像素，不碰跨域 Canvas。
        const observer = new MutationObserver(() => {
            clearTimeout(window.__stImmersivePwaThemeTimer);
            window.__stImmersivePwaThemeTimer = setTimeout(ensureThemeColor, 120);
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style'],
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style'],
        });

        console.info(LOG, 'viewport-fit=cover 与 PWA manifest 已注入。');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
