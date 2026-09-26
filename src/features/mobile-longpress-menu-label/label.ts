/**
 * 长按菜单补文字的实现。
 *
 * 只处理我们加过标记的 `<span>`：同一个菜单里「更多」二级项自带的 `<span>`
 * 不能被我们当成自己的删除掉。
 *
 * 容器的 `innerHTML` 由内核每次重写，所以观察它的 childList 并按帧合并重扫。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 移动端长按选区的浮动菜单容器。 */
const CONTAINER_SELECTOR = ".protyle-util--mobile";
/** 我们自己补的文字标记。 */
const MARK = "ss-menu-label";
const RESCAN_INTERVAL_MS = 2000;

const wantedActions = (host: FeatureHost): string[] => {
    switch (String(host.config.mode ?? "off")) {
        case "both":
            return ["copy", "paste"];
        case "copy":
            return ["copy"];
        case "paste":
            return ["paste"];
        default:
            return [];
    }
};

export const mountLongpressMenuLabel = (host: FeatureHost): FeatureInstance => {
    const observed = new WeakSet<HTMLElement>();
    const observers: MutationObserver[] = [];
    let frame = 0;

    const apply = (container: HTMLElement) => {
        const actions = wantedActions(host);
        container.querySelectorAll<HTMLButtonElement>(".keyboard__action[data-action]").forEach((button) => {
            const mine = button.querySelector<HTMLElement>(`span[data-${MARK}]`);
            if (!actions.includes(button.dataset.action ?? "")) {
                mine?.remove();
                return;
            }
            if (mine) {
                return;
            }
            const text = button.getAttribute("aria-label")?.trim();
            if (!text) {
                return;
            }
            const label = document.createElement("span");
            label.setAttribute(`data-${MARK}`, "true");
            label.textContent = text;
            button.append(label);
        });
    };

    const scan = () => {
        document.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR).forEach((container) => {
            if (!observed.has(container)) {
                observed.add(container);
                const observer = new MutationObserver(schedule);
                observer.observe(container, {childList: true, subtree: true});
                observers.push(observer);
            }
            apply(container);
        });
    };

    function schedule() {
        if (frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            scan();
        });
    }

    scan();
    host.onConfigChange(schedule);
    host.addEventBus("loaded-protyle-static", scan);
    const timer = window.setInterval(scan, RESCAN_INTERVAL_MS);

    return {
        destroy: () => {
            window.clearInterval(timer);
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            observers.forEach((observer) => observer.disconnect());
            document.querySelectorAll<HTMLElement>(`span[data-${MARK}]`).forEach((label) => label.remove());
        },
    };
};
