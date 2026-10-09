(() => {
    'use strict';
    const VERSION = '0.6.0';
    const PANEL_RUNTIME_ID = 'st-immersive-pwa-panel-runtime';
    let panelGuard;
    const RUNTIME_ID = 'st-immersive-pwa-runtime';
    const PROBE_ID = 'st-immersive-pwa-safe-probe';
    const ACTIVE = 'st-immersive-pwa-standalone';
    const root = document.documentElement;
    let timer = 0;
    let applying = false;
    let runtime;
    let lastReport = '';
    const SETTINGS_KEY = 'st-immersive-pwa-device-v1';
    let settings = { top: null, qr: true, panels: true };
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        if (saved) settings = {
            top: typeof saved.top === 'number' && Number.isFinite(saved.top) ? Math.max(0, Math.min(120, saved.top)) : null,
            qr: saved.qr !== false,
            panels: saved.panels !== false,
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
            <label><input data-role="panels" type="checkbox"> 大型扩展面板自动避让顶栏</label>
            <small>自动值为 0 且顶部仍重叠时，使用可调整的兜底高度。32px 是估计值。</small>
            <output data-role="status" aria-live="polite"></output>`;
        host.append(panel);
        const mode = panel.querySelector('[data-role="mode"]');
        const input = panel.querySelector('[data-role="top"]');
        const manual = panel.querySelector('[data-role="manual"]');
        const qr = panel.querySelector('[data-role="qr"]');
        const panels = panel.querySelector('[data-role="panels"]');
        mode.value = settings.top === null ? 'auto' : 'manual';
        input.value = String(settings.top ?? 32);
        manual.hidden = settings.top === null;
        qr.checked = settings.qr;
        panels.checked = settings.panels;
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
        panels.addEventListener('change', () => { settings.panels = panels.checked; saveSettings(); });
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

    function createPanelGuard() {
        const ID = 'st-immersive-pwa-panel-runtime';
        const TOKEN = 'data-st-pwa-panel-token';
        const CORE = '#sheld, #chat, #form_sheld, #send_form, #qr--bar, #qr--popout, #top-bar, #top-settings-holder, #bg1, #bg_custom, #extensions_settings, #extensions_settings2, .drawer-content, #character_popup, #world_popup, #floatingPrompt, #cfgConfig, #logprobsViewer';
        const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME']);
        const custom = new Set();
        const excluded = new Set();
        const pool = new Map();
        const branches = new Set();
        const pending = new Set();
        let serial = 0, timer = 0, enabled = false, boundary = 0, count = 0;
        let style;
        const pixels = s => /^\s*(?:-?\d+(?:\.\d*)?|-?\.\d+)px\s*$/.test(s) ? parseFloat(s) : NaN;
        const isCore = el => Boolean(el.closest(CORE));
        const observer = new MutationObserver(records => {
            for (const r of records) {
                if (r.type === 'childList') {
                    for (const node of r.addedNodes) {
                        if (node.nodeType !== 1 || isCore(node) || pending.size >= 64) continue;
                        // Body roots are always inspected. Inside an extension,
                        // avoid scanning every newly rendered table row/message.
                        if (r.target === document.body || node.id || node.hasAttribute('role')
                            || /panel|modal|dialog|overlay/i.test(node.className || '')
                            || node.style?.position === 'fixed') pending.add(node);
                    }
                } else if (!isCore(r.target) && pending.size < 64) pending.add(r.target);
            }
            // Removed candidates must also be released; no polling is needed.
            if (pending.size || records.some(r => r.removedNodes?.length)) schedule();
        });

        function schedule() {
            if (!enabled || timer) return;
            timer = setTimeout(repair, 80);
        }

        function matchesAny(el, list) {
            for (const selector of list) if (el.matches(selector)) return true;
            return false;
        }

        function inspect(el, depth = 2) {
            if (el.nodeType !== 1 || SKIP_TAGS.has(el.tagName) || isCore(el)) return;
            if (getComputedStyle(el).position === 'fixed') {
                if (!pool.has(el)) pool.set(el, { token: null });
            }
            if (depth > 0) for (const child of el.children) inspect(child, depth - 1);
        }

        function attachBranch(el) {
            if (branches.has(el) || SKIP_TAGS.has(el.tagName) || isCore(el)) return;
            // Do not subscribe to a wrapper containing the chat/application tree.
            // Known/registered panels are still found independently below.
            if (el.querySelector('#sheld, #chat')) return;
            branches.add(el);
            observer.observe(el, { subtree: true, childList: true, attributes: true,
                attributeFilter: ['class', 'style', 'hidden', 'open', 'data-st-pwa-avoid-header'] });
            inspect(el);
        }

        function collect() {
            if ([...branches].some(el => !el.isConnected)) {
                observer.disconnect();
                observer.observe(document.body, { childList: true });
                for (const el of branches) {
                    if (!el.isConnected) { branches.delete(el); continue; }
                    observer.observe(el, { subtree: true, childList: true, attributes: true,
                        attributeFilter: ['class', 'style', 'hidden', 'open', 'data-st-pwa-avoid-header'] });
                }
            }
            for (const el of document.body.children) attachBranch(el);
            for (const el of pending) inspect(el);
            pending.clear();
            const anima = document.getElementById('anima-overlay');
            if (anima) {
                inspect(anima, 0);
                // Also works when the extension mounts inside a larger app wrapper.
                if (!branches.has(anima)) {
                    branches.add(anima);
                    observer.observe(anima, { subtree: true, childList: true, attributes: true,
                        attributeFilter: ['class', 'style', 'hidden'] });
                }
            }
            for (const selector of custom) for (const el of document.querySelectorAll(selector)) {
                inspect(el, 0);
                if (!branches.has(el)) {
                    branches.add(el);
                    observer.observe(el, { subtree: true, childList: true, attributes: true,
                        attributeFilter: ['class', 'style', 'hidden', 'open'] });
                }
            }
            for (const [el, entry] of pool) if (!el.isConnected) {
                if (entry.token) el.removeAttribute(TOKEN);
                pool.delete(el);
            }
        }

        function isViewportFixed(el) {
            // Transforms/filters/contain can make fixed descendants use a local
            // containing block. Do not treat those coordinates as viewport pixels.
            for (let p = el.parentElement; p; p = p.parentElement) {
                const s = getComputedStyle(p);
                if ([s.transform, s.perspective, s.filter, s.backdropFilter].some(v => v && v !== 'none')
                    || /(?:layout|paint|strict|content)/.test(s.contain || '')
                    || /(?:transform|perspective|filter)/.test(s.willChange || '')
                    || (s.contentVisibility && s.contentVisibility !== 'visible')) return false;
            }
            return true;
        }

        function plan(el, entry, floor, viewportBottom) {
            if (isCore(el) || matchesAny(el, excluded)
                || el.closest('[data-st-pwa-avoid-header="off"]')) return null;
            if (el === document.body || el === document.documentElement
                || el.querySelector('#sheld, #chat')) return null;
            const cs = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility !== 'visible'
                || parseFloat(cs.opacity) === 0 || box.width <= 0 || box.height <= 0
                || !isViewportFixed(el) || (cs.transform && cs.transform !== 'none')) return null;
            const explicit = el.id === 'anima-overlay' || matchesAny(el, custom)
                || el.getAttribute('data-st-pwa-avoid-header') === 'panel';
            if (!explicit) {
                if (el.tagName === 'DIALOG' || el.closest('.draggable, [data-draggable="true"]')
                    || box.width < window.innerWidth * 0.7 || box.height < window.innerHeight * 0.55) return null;
                // Large overlays are not necessarily panels. Require an actual
                // title/toolbar at their own top, not a centered modal/backdrop.
                const heading = el.querySelector(':scope > header, :scope > [role="toolbar"], :scope > [class*="header"], :scope > [class*="toolbar"], :scope > div > header, :scope > div > [role="toolbar"], :scope > div > [class*="header"], :scope > div > [class*="toolbar"]');
                if (!heading) return null;
                const hb = heading.getBoundingClientRect();
                if (hb.height <= 0 || hb.top < box.top - 1 || hb.top > box.top + 32) return null;
                if (!el.querySelector('button, [role="button"], input, select, textarea, .interactable, [tabindex]')) return null;
            }
            // An already-safe panel is untouched, including its height constraints.
            const shift = Math.max(0, floor - box.top);
            if (shift <= 0.5) return null;
            const top = pixels(cs.top), height = pixels(cs.height);
            if (!Number.isFinite(top) || !Number.isFinite(height)) return null;
            const extra = Math.max(0, box.height - height); // content-box padding/borders
            const wanted = Math.max(0, Math.min(height - shift, viewportBottom - floor - extra));
            const min = pixels(cs.minHeight), max = pixels(cs.maxHeight);
            const declarations = [`top: ${top + shift}px !important`, `height: ${wanted}px !important`];
            // Unresolved intrinsic/percentage minimums cannot safely be converted.
            if (!Number.isFinite(min) && cs.minHeight !== 'auto') return null;
            if (Number.isFinite(min) && min > wanted) declarations.push(`min-height: ${Math.max(0, Math.min(min - shift, wanted))}px !important`);
            declarations.push(`max-height: ${Number.isFinite(max) ? Math.max(0, Math.min(max - shift, wanted)) : wanted}px !important`);
            return { el, entry, declarations,
                localModal: el.id === 'anima-overlay'
                    && cs.backdropFilter && cs.backdropFilter !== 'none' };
        }

        function repair() {
            timer = 0;
            if (!enabled || !document.body) return;
            collect();
            if (!style) {
                style = document.createElement('style');
                style.id = ID;
                document.head.append(style);
            }
            const vv = window.visualViewport;
            const zoomed = vv && Math.abs(vv.scale - 1) > 0.01;
            const bottom = Math.max(0, Math.min(window.innerHeight,
                !zoomed && vv ? vv.offsetTop + vv.height : window.innerHeight));
            // Do not move panels around while the user pinch-zooms.
            if (zoomed || boundary >= bottom) {
                if (style.textContent) style.textContent = '';
                count = 0;
                return;
            }
            const sheet = style.sheet;
            if (!sheet) return;
            const wasDisabled = sheet.disabled;
            let plans;
            try {
                // CSSStyleSheet.disabled is supported; no DOM mutation is emitted
                // during baseline measurement and no author declarations are edited.
                sheet.disabled = true;
                plans = [...pool].map(([el, entry]) => plan(el, entry, boundary, bottom)).filter(Boolean);
            } finally { sheet.disabled = wasDisabled; }
            const live = new Set(plans.map(p => p.el));
            for (const [el, entry] of pool) if (!live.has(el) && entry.token) {
                el.removeAttribute(TOKEN);
                entry.token = null;
            }
            const rules = [`html.${ACTIVE} { --st-immersive-panel-top: ${boundary}px; --st-immersive-panel-height: ${Math.max(0, bottom - boundary)}px; }`];
            for (const p of plans) {
                if (!p.entry.token) p.entry.token = `p${++serial}`;
                if (p.el.getAttribute(TOKEN) !== p.entry.token) p.el.setAttribute(TOKEN, p.entry.token);
                const sel = `html.${ACTIVE} body [${TOKEN}="${p.entry.token}"]`;
                rules.push(`${sel} { ${p.declarations.join('; ')}; }`);
                // Anima's backdrop-filter makes its nested fixed modal local to
                // this panel. Its hardcoded 100vh must follow the resized parent.
                if (p.localModal) rules.push(`${sel} > .anima-modal { width: 100% !important; height: 100% !important; }`);
            }
            const css = rules.join('\n');
            if (style.textContent !== css) style.textContent = css;
            count = plans.length;
        }

        function detach() {
            clearTimeout(timer); timer = 0;
            observer.disconnect(); branches.clear(); pending.clear();
            for (const [el, entry] of pool) if (entry.token) el.removeAttribute(TOKEN);
            pool.clear(); count = 0;
            if (style?.textContent) style.textContent = '';
            window.removeEventListener('resize', schedule);
            window.visualViewport?.removeEventListener('resize', schedule);
            window.visualViewport?.removeEventListener('scroll', schedule);
            document.removeEventListener('transitionend', schedule, true);
        }

        const api = {
            update(on, top) {
                boundary = Math.max(0, Number(top) || 0);
                const next = Boolean(on && boundary > 0);
                if (next !== enabled) {
                    enabled = next;
                    if (!next) { detach(); return; }
                    observer.observe(document.body, { childList: true });
                    window.addEventListener('resize', schedule, { passive: true });
                    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
                    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
                    document.addEventListener('transitionend', schedule, true);
                }
                schedule();
            },
            register(selector) {
                document.querySelector(selector); // Validate before retaining it.
                custom.add(selector); schedule();
                return () => { custom.delete(selector); schedule(); };
            },
            exclude(selector) {
                document.querySelector(selector);
                excluded.add(selector); schedule();
                return () => { excluded.delete(selector); schedule(); };
            },
            info: () => ({ enabled, boundary, adjusted: count }),
            stop() { enabled = false; detach(); style?.remove(); style = null; },
        };
        return api;
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
                panelGuard?.update(false, 0);
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
            // Measure the real header bottom after the original layout rules apply.
            const visibleHeaderBottoms = headers.map(h => {
                const cs = getComputedStyle(h.el);
                const box = h.el.getBoundingClientRect();
                return cs.display !== 'none' && cs.visibility !== 'hidden' && box.height > 0
                    && box.bottom < window.innerHeight * 0.5 ? box.bottom : 0;
            });
            const floor = Math.max(target, ...visibleHeaderBottoms);
            if (settings.panels && target > 0 && !panelGuard) {
                panelGuard = createPanelGuard();
                window.__stImmersivePwaPanels = panelGuard;
            }
            panelGuard?.update(settings.panels && target > 0, floor);
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
            const owned = node => node === runtime || runtime.contains(node)
                || node.id === PANEL_RUNTIME_ID || node.parentElement?.id === PANEL_RUNTIME_ID;
            if (records.some(r => !owned(r.target)
                && (r.target.nodeType === Node.TEXT_NODE || r.target.matches?.('style,link')
                || [...r.addedNodes, ...r.removedNodes].some(n => !owned(n) && n.matches?.('style,link'))))) scheduleRefresh();
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
