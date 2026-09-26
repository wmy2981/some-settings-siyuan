/**
 * 长按菜单补文字的实现。
 *
 * 只处理我们加过标记的 `<span>`：同一个菜单里「更多」二级项自带的 `<span>`
 * 不能被我们当成自己的删除掉。
 *
 * 内核的 `.keyboard__action` 是按"里面只有一个图标"排的（`svg` 是左浮动，
 * 按钮宽度就由这个浮动盒子撑开），所以补文字必须同时改按钮的排版，
 * 否则文字会挤到浮动图标右边、把整条工具栏撑乱。
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
const MARK_ATTR = `data-${MARK}`;
const RESCAN_INTERVAL_MS = 2000;

const LABEL_CSS = `
/* 补过文字的按钮改成"上图下字"的一列，总高与原生图标按钮一致（48px） */
.keyboard__action[${MARK_ATTR}] {
    box-sizing: border-box;
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.keyboard__action[${MARK_ATTR}] > svg {
    width: 18px;
    height: 18px;
    padding: 6px 7px;
    margin: 2px 3px 0;
}

.keyboard__action[${MARK_ATTR}] > span[${MARK_ATTR}] {
    padding: 0 4px 4px;
    color: var(--b3-theme-on-surface-light);
    font-size: 10px;
    line-height: 12px;
}
`;

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
    host.addStyle(LABEL_CSS);

    const observed = new WeakSet<HTMLElement>();
    const observers: MutationObserver[] = [];
    let frame = 0;

    const apply = (container: HTMLElement) => {
        const actions = wantedActions(host);
        container.querySelectorAll<HTMLButtonElement>(".keyboard__action[data-action]").forEach((button) => {
            const mine = button.querySelector<HTMLElement>(`span[${MARK_ATTR}]`);
            if (!actions.includes(button.dataset.action ?? "")) {
                mine?.remove();
                button.removeAttribute(MARK_ATTR);
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
            label.setAttribute(MARK_ATTR, "true");
            label.textContent = text;
            button.append(label);
            button.setAttribute(MARK_ATTR, "true");
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
            document.querySelectorAll<HTMLElement>(`span[${MARK_ATTR}]`).forEach((label) => label.remove());
            document.querySelectorAll<HTMLElement>(`.keyboard__action[${MARK_ATTR}]`).forEach((button) =>
                button.removeAttribute(MARK_ATTR)
            );
        },
    };
};
