/**
 * 用思源原生菜单替换下拉弹层的实现。
 *
 * 拦截点选在 `pointerdown` 与 `mousedown` 的捕获阶段：前者覆盖触摸，
 * 后者覆盖外接鼠标；两者都会默认被浏览器用来展开原生弹层，因此都要 preventDefault。
 * 一次点击可能先派发 pointerdown 再派发 mousedown，用一个时间戳去重，
 * 避免弹出两个菜单。
 *
 * 还要在捕获阶段吞掉这次点击的 `click`：内核的全局 click 处理器见到"点在菜单外面"
 * 就会把所有菜单关掉，菜单会变成"闪一下就消失"。
 */
import {Menu} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 只接管思源自己的下拉控件，原生 select（例如文件上传里的）不动。 */
const SELECT_SELECTOR = "select.b3-select";
/** 同一根手指会同时产生 pointerdown 与 mousedown，这段时间内只处理一次。 */
const DEDUPE_MS = 300;

export const mountMobileSelectNative = (host: FeatureHost): FeatureInstance => {
    let lastOpenedAt = 0;
    let menu: Menu | undefined;

    const openMenu = (select: HTMLSelectElement) => {
        const now = Date.now();
        if (now - lastOpenedAt < DEDUPE_MS) {
            return;
        }
        lastOpenedAt = now;
        menu?.close();

        const next = new Menu();
        menu = next;
        Array.from(select.options).forEach((option) => {
            next.addItem({
                label: option.textContent || option.value,
                checked: option.value === select.value,
                click: () => {
                    if (select.value === option.value) {
                        return;
                    }
                    select.value = option.value;
                    // 内核与其它插件都监听 change，这里必须补发，否则设置不会生效
                    select.dispatchEvent(new Event("input", {bubbles: true}));
                    select.dispatchEvent(new Event("change", {bubbles: true}));
                },
            });
        });

        const rect = select.getBoundingClientRect();
        next.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width});
        host.log(`已用原生菜单接管下拉（${select.options.length} 项）`);
    };

    const intercept = (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !target.matches(SELECT_SELECTOR) || target.disabled) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        openMenu(target);
    };

    /**
     * 点按之后浏览器还会补一次 `click`，而内核的全局 click 处理器会关掉所有菜单
     * （`window.siyuan.menus.menu.remove()`）—— 于是菜单"闪一下就没了"。
     * 手指在控件上滑动不会产生 click，所以只有滑动时菜单能留住。
     * 这里把落在下拉控件上的 click 一并吞掉，菜单才能像原生弹层一样留着。
     */
    const interceptClick = (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !target.matches(SELECT_SELECTOR) || target.disabled) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    document.addEventListener("pointerdown", intercept, true);
    document.addEventListener("mousedown", intercept, true);
    document.addEventListener("click", interceptClick, true);

    return {
        destroy: () => {
            document.removeEventListener("pointerdown", intercept, true);
            document.removeEventListener("mousedown", intercept, true);
            document.removeEventListener("click", interceptClick, true);
            menu?.close();
            menu = undefined;
        },
    };
};
