(() => {
    'use strict';
    const VERSION = '0.5.1';
    const RUNTIME_ID = 'st-immersive-pwa-runtime';
    const PROBE_ID = 'st-immersive-pwa-safe-probe';
    const ACTIVE = 'st-immersive-pwa-standalone';
    const root = document.documentElement;
    let timer = 0;
    let applying = false;
    let runtime;
    let lastReport = '';
    const SETTINGS_KEY = 'st-immersive-pwa-device-v1';
    let settings = { top: null, qr: true };
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        if (saved) settings = {
            top: typeof saved.top === 'number' && Number.isFinite(saved.top) ? Math.max(0, Math.min(120, saved.top)) : null,
            qr: saved.qr !== false,
        };
    } catch { /* Storage may be disabled. Session controls still work. */ }
    let composerEngaged = false;
    let qrTheme = false;
    const observedHeaders = new WeakSet();
    const headerObserver = new ResizeObserver(() => scheduleRefresh());

    function extensionBase() {
        const script = [...document.scripts].find(s => /\/SillyTavern-Immersive-PWA\/index\.js(?:[?#]|$)/.test(s.src));
        return new URL('./', script?.src || new URL('/scripts/extensions/third-party/SillyTavern-Immersive-PWA/index.js', location.origin));
    }

    function ensurePwa() {
        let viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement('meta');
            viewport.name = 'viewport';
            document.head.append(viewport);
        }
        const parts = viewport.content.split(',').map(x => x.trim()).filter(Boolean)
            .filter(x => !/^viewport-fit\s*=/i.test(x));
        if (!parts.some(x => /^width\s*=/i.test(x))) parts.unshift('width=device-width');
        if (!parts.some(x => /^initial-scale\s*=/i.test(x))) parts.push('initial-scale=1');
        viewport.content = [...parts, 'viewport-fit=cover'].join(', ');

        // Reuse the native manifest link so the browser sees one effective manifest.
        let manifest = document.querySelector('link[rel="manifest"]');
        if (!manifest) {
            manifest = document.createElement('link');
            manifest.rel = 'manifest';
            document.head.append(manifest);
        }
        manifest.dataset.stImmersivePwa = '1';
        manifest.href = new URL('pwa.webmanifest', extensionBase()).href;
    }

    function isStandalone() {
        return ['standalone', 'fullscreen', 'minimal-ui'].some(mode => matchMedia(`(display-mode: ${mode})`).matches) || navigator.standalone === true;
    }

    // Keep v0.3's browser chrome color behavior. This metadata is not a page
    // background and is never used to paint a replacement safe-area strip.
    function syncThemeColor() {
        const cs = getComputedStyle(root);
        const color = ['--SmartThemeBlurTintColor', '--SmartThemeChatTintColor', '--SmartThemeBodyColor']
            .map(name => cs.getPropertyValue(name).trim()).find(Boolean);
        if (!color) return;
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.append(meta);
        }
        if (meta.content !== color) meta.content = color;
    }

    function safeTop() {
        let probe = document.getElementById(PROBE_ID);
        if (!probe) {
            probe = document.createElement('div');
            probe.id = PROBE_ID;
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;visibility:hidden;pointer-events:none;';
            document.body.append(probe);
        }
        probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
        probe.style.paddingBottom = 'max(0px, var(--st-immersive-extra-top, 0px))';
        const system = parseFloat(getComputedStyle(probe).paddingTop) || 0;
        const extra = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
        const custom = getComputedStyle(root).getPropertyValue('--st-immersive-safe-top').trim();
        let chosen = system;
        let source = '系统';
        if (settings.top !== null) {
            chosen = settings.top;
            source = '手动';
        } else if (custom) {
            probe.style.paddingTop = `max(0px, ${custom})`;
            chosen = parseFloat(getComputedStyle(probe).paddingTop) || 0;
            source = '自定义 CSS';
        } else if (system === 0 && /Android/i.test(navigator.userAgent)
            && screen.orientation?.type?.startsWith('portrait') !== false
            && (screen.orientation?.type || screen.height >= screen.width)) {
            // Some Android edge-to-edge/WebAPK configurations report zero despite
            // overlaying the status bar. This is an adjustable estimate, NOT a measurement.
            chosen = 32;
            source = 'Android 兜底';
        }
        return { system, target: chosen + extra, source };
    }

    function saveSettings() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* session only */ }
        scheduleRefresh();
    }

    function ensureSettings() {
        if (document.getElementById('st-immersive-pwa-settings')) return;
        const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!host) return;
        const panel = document.createElement('details');
        panel.id = 'st-immersive-pwa-settings';
        panel.innerHTML = `<summary>沉浸式 PWA · ${VERSION}</summary>
            <label>顶部避让 <select data-role="mode"><option value="auto">自动（Android 零值时用 32px）</option><option value="manual">手动指定</option></select></label>
            <label data-role="manual">避让高度（CSS 像素）<input data-role="top" type="number" min="0" max="120" step="1" inputmode="numeric"></label>
            <label><input data-role="qr" type="checkbox"> 修复美化的输入区 QR 展开</label>
            <small>自动值为 0 且顶部仍重叠时，使用可调整的兜底高度。32px 是估计值。</small>
            <output data-role="status" aria-live="polite"></output>`;
        host.append(panel);
        const mode = panel.querySelector('[data-role="mode"]');
        const input = panel.querySelector('[data-role="top"]');
        const manual = panel.querySelector('[data-role="manual"]');
        const qr = panel.querySelector('[data-role="qr"]');
        mode.value = settings.top === null ? 'auto' : 'manual';
        input.value = String(settings.top ?? 32);
        manual.hidden = settings.top === null;
        qr.checked = settings.qr;
        mode.addEventListener('change', () => {
            settings.top = mode.value === 'auto' ? null : Math.max(0, Math.min(120, Number(input.value) || 0));
            manual.hidden = settings.top === null;
            saveSettings();
        });
        input.addEventListener('change', () => {
            settings.top = Math.max(0, Math.min(120, Number(input.value) || 0));
            input.value = String(settings.top);
            saveSettings();
        });
        qr.addEventListener('change', () => { settings.qr = qr.checked; saveSettings(); });
    }

    function updateQrFocus() {
        const inside = document.activeElement?.closest?.('#send_form, #qr--bar');
        root.classList.toggle('st-immersive-pwa-qr-open', Boolean(inside || composerEngaged));
    }

    function updateQrTheme() {
        const css = document.getElementById('customCSS')?.value || '';
        // Apply only to a theme that explicitly uses this hidden-until-focus QR rule.
        qrTheme = /#send_form:focus-within\s+#qr--bar/.test(css);
        root.classList.toggle('st-immersive-pwa-focus-qr', settings.qr && qrTheme);
        updateQrFocus();
    }

    function snapshot(el) {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        // Copy values: CSSStyleDeclaration is live and will change on re-enabling our sheet.
        return {
            el, rect, position: cs.position,
            top: Number.isFinite(parseFloat(cs.top)) ? parseFloat(cs.top)
                : cs.position === 'relative' ? 0 : el.offsetTop,
            height: parseFloat(cs.height), maxHeight: parseFloat(cs.maxHeight),
            minHeight: /^\s*(?:\d+(?:\.\d*)?|\.\d+)px\s*$/.test(cs.minHeight) ? parseFloat(cs.minHeight) : NaN,
            marginTop: parseFloat(cs.marginTop) || 0,
        };
    }

    function selector(el) {
        return `html.${ACTIVE} #${CSS.escape(el.id)}`;
    }

    function refresh() {
        if (applying || !document.body) return;
        applying = true;
        try {
            syncThemeColor();
            ensureSettings();
            updateQrTheme();
            const active = isStandalone();
            root.classList.toggle(ACTIVE, active);
            if (!active) {
                runtime.textContent = '';
                const status = document.querySelector('#st-immersive-pwa-settings [data-role="status"]');
                if (status) status.textContent = '普通浏览器窗口：未启用沉浸布局。';
                return;
            }
            // Remove only our computed rules in this synchronous task, then measure.
            // No dependence on HTMLStyleElement.disabled support, no author-style revert.
            runtime.textContent = '';
            const headers = ['top-bar', 'top-settings-holder']
                .map(id => document.getElementById(id)).filter(Boolean).map(snapshot);
            for (const { el } of headers) {
                if (!observedHeaders.has(el)) {
                    observedHeaders.add(el);
                    headerObserver.observe(el);
                }
            }
            const safe = safeTop();
            const target = safe.target;
            const baseTop = headers.length ? Math.min(...headers.map(h => h.rect.top)) : 0;
            // Themes already respecting the inset must not receive a second inset.
            const delta = Math.max(0, target - baseTop);
            const rules = [];
            if (delta > 0) {
                // These are siblings. Moving only #top-bar leaves buttons/lace at y=0.
                // Use top, not translate/transform: fixed drawer descendants must keep
                // their viewport containing block and full-screen dimensions.
                for (const h of headers) {
                    if (h.position !== 'static') rules.push(`${selector(h.el)} { top: ${h.top + delta}px !important; }`);
                }
                const sheld = document.getElementById('sheld');
                if (sheld && !document.body.classList.contains('waifuMode')) {
                    const s = snapshot(sheld);
                    const declarations = [`top: ${s.top + delta}px !important`];
                    if (Number.isFinite(s.height)) {
                        declarations.push(`height: ${Math.max(0, s.height - delta)}px !important`);
                        // Adjust only a measured pixel minimum that blocks the same
                        // height reduction. Preserve every non-blocking theme minimum.
                        if (Number.isFinite(s.minHeight) && s.minHeight > Math.max(0, s.height - delta)) {
                            declarations.push(`min-height: ${Math.max(0, s.minHeight - delta)}px !important`);
                        }
                    }
                    if (Number.isFinite(s.maxHeight)) declarations.push(`max-height: ${Math.max(0, s.maxHeight - delta)}px !important`);
                    rules.push(`${selector(sheld)} { ${declarations.join(';')}; }`);
                }
                // Absolute drawers inside the moved holder already follow their parent.
                // Fixed drawers do not. Move those once and cap their lower edge.
                const panels = document.querySelectorAll('.drawer-content[id], #character_popup, #world_popup, #floatingPrompt, #cfgConfig, #logprobsViewer');
                const holder = document.getElementById('top-settings-holder');
                for (const panel of panels) {
                    const s = snapshot(panel);
                    const insideHolder = holder?.contains(panel);
                    const followsHolder = insideHolder && s.position === 'absolute';
                    const mustMove = s.position === 'fixed' || (!insideHolder && s.position === 'absolute');
                    if (!followsHolder && !mustMove) continue;
                    const declarations = [];
                    if (mustMove) declarations.push(`top: ${s.top + delta}px !important`);
                    // Keep the theme's existing bottom clearance when max-height is finite.
                    const cap = Number.isFinite(s.maxHeight) ? `${Math.max(0, s.maxHeight - delta)}px` : '100dvh';
                    const viewportTop = followsHolder
                        ? s.top + (headers.find(h => h.el === holder)?.rect.top || 0) + delta + s.marginTop
                        : s.top + delta + s.marginTop;
                    declarations.push(`max-height: min(${cap}, max(0px, calc(100dvh - ${Math.max(0, viewportTop)}px))) !important`);
                    rules.push(`${selector(panel)} { ${declarations.join(';')}; }`);
                }
            }
            const css = rules.join('\n');
            if (runtime.textContent !== css) runtime.textContent = css;
            const report = `系统 ${safe.system.toFixed(1)}px；使用 ${target.toFixed(1)}px（${safe.source}）；下移 ${delta.toFixed(1)}px`;
            const status = document.querySelector('#st-immersive-pwa-settings [data-role="status"]');
            if (status) status.textContent = `${report}。QR：${document.getElementById('qr--bar') ? '按钮条已加载' : document.getElementById('qr--popout') ? '独立窗口模式' : '按钮条未加载'}。`;
            root.dataset.stImmersivePwaShift = String(delta);
            if (report !== lastReport) {
                console.info(`[Immersive PWA ${VERSION}] ${report}; background=#bg1; headers=#top-bar + #top-settings-holder`);
                lastReport = report;
            }
        } finally {
            applying = false;
        }
    }

    function scheduleRefresh() {
        clearTimeout(timer);
        timer = setTimeout(refresh, 100);
    }

    function init() {
        if (document.getElementById(RUNTIME_ID)?.dataset.version === VERSION) return;
        ensurePwa();
        runtime = document.getElementById(RUNTIME_ID) || document.createElement('style');
        runtime.id = RUNTIME_ID;
        runtime.dataset.version = VERSION;
        runtime.textContent = '';
        runtime.disabled = false;
        document.head.append(runtime);
        refresh();
        // Narrow observers: no scanning chat text, no polling or continuous layout loop.
        const attributes = new MutationObserver(scheduleRefresh);
        attributes.observe(root, { attributes: true, attributeFilter: ['style'] });
        attributes.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
        const headObserver = new MutationObserver(records => {
            if (records.some(r => r.target !== runtime && !runtime.contains(r.target)
                && (r.target.nodeType === Node.TEXT_NODE || r.target.matches?.('style,link')
                || [...r.addedNodes, ...r.removedNodes].some(n => n !== runtime && n.matches?.('style,link'))))) scheduleRefresh();
        });
        headObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'media'] });
        document.head.addEventListener('load', e => { if (e.target.matches?.('link[rel="stylesheet"]')) scheduleRefresh(); }, true);
        document.addEventListener('input', e => { if (e.target.id === 'customCSS') scheduleRefresh(); }, { passive: true });
        document.addEventListener('change', scheduleRefresh, { passive: true });
        document.addEventListener('focusin', e => {
            composerEngaged = Boolean(e.target.closest?.('#send_form, #qr--bar'));
            updateQrFocus();
        }, { passive: true });
        document.addEventListener('focusout', () => requestAnimationFrame(updateQrFocus), { passive: true });
        document.addEventListener('pointerdown', e => {
            composerEngaged = Boolean(e.target.closest?.('#send_form, #qr--bar'));
            // An outside tap can precede blur, so close without reading the old focus.
            root.classList.toggle('st-immersive-pwa-qr-open', composerEngaged);
        }, { passive: true });
        matchMedia('(display-mode: standalone)').addEventListener('change', scheduleRefresh);
        window.addEventListener('resize', scheduleRefresh, { passive: true });
        window.addEventListener('pageshow', scheduleRefresh, { passive: true });
        window.visualViewport?.addEventListener('resize', scheduleRefresh, { passive: true });
        document.fonts?.ready.then(scheduleRefresh);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
