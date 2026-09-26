/**
 * 隐藏移动端侧面板导航项的实现。
 *
 * 复检由 `#sidebar` / `#sidebarRight` 的变动驱动（插件 dock 是运行时插进页签条的，
 * 内核也会自己切换 `fn__none`），另外在配置变更后立刻重算一次。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 面板里页签的容器，插件 dock 也是插在这里。 */
const PANEL_IDS = ["sidebar", "sidebarRight"];
/** 我们自己加上的隐藏类由这个标记区分，避免动到内核自己的显隐。 */
const MARK = "ss-hidden-item";

const tokensOf = (host: FeatureHost): Set<string> => {
    const raw = String(host.config.items ?? "");
    return new Set(
        raw.split(/[,，\s]+/)
            .map((token) => token.trim().toLowerCase())
            .filter(Boolean),
    );
};

export const mountHideSidebarItems = (host: FeatureHost): FeatureInstance => {
    let frame = 0;
    /** 我们主动隐藏过的元素，恢复时只动这些。 */
    const hidden = new WeakSet<HTMLElement>();

    const apply = () => {
        const wanted = tokensOf(host);
        PANEL_IDS.forEach((panelId) => {
            const panel = document.getElementById(panelId);
            if (!panel) {
                return;
            }
            panel.querySelectorAll<HTMLElement>("[data-type$='-tab'], [data-mobile-plugin-dock-tab]").forEach((element) => {
                const type = (element.dataset.type ?? "").replace(/^sidebar-/, "").replace(/-tab$/, "").toLowerCase();
                const dock = (element.dataset.mobilePluginDockTab ?? "").toLowerCase();
                const hide = (Boolean(type) && wanted.has(type)) || (Boolean(dock) && wanted.has(dock));
                if (hide) {
                    if (!element.classList.contains(MARK)) {
                        element.classList.add(MARK, "fn__none");
                        hidden.add(element);
                    }
                    return;
                }
                if (hidden.has(element)) {
                    hidden.delete(element);
                    element.classList.remove(MARK);
                    element.classList.remove("fn__none");
                }
            });
        });
    };

    // 页签的增删与显隐都是突变，用 rAF 合并一次，避免一个批次里反复全量扫描
    const schedule = () => {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            apply();
        });
    };

    apply();
    host.onConfigChange(schedule);

    const observers: MutationObserver[] = [];
    PANEL_IDS.forEach((panelId) => {
        const panel = document.getElementById(panelId);
        if (!panel) {
            return;
        }
        const observer = new MutationObserver(schedule);
        observer.observe(panel, {childList: true, subtree: true, attributeFilter: ["class"]});
        observers.push(observer);
    });

    return {
        destroy: () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            observers.forEach((observer) => observer.disconnect());
            // 卸载时把我们的标记摘干净，内核自己的 fn__none 原样保留
            document.querySelectorAll<HTMLElement>(`.${MARK}`).forEach((element) => {
                element.classList.remove(MARK, "fn__none");
            });
        },
    };
};
