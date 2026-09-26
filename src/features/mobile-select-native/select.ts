/**
 * 用思源原生菜单替换下拉弹层的实现。
 *
 * 打开时机是这里最关键的一处：内核的菜单在移动端是**底部弹层**，弹层自带一层遮罩
 * （`#commonMenuScrim`），遮罩自己的 click 处理器会把弹层关掉，内核 window 上的
 * click 处理器也会。如果在下拉控件 pointerdown 的瞬间就把菜单弹出来，这次点击的
 * "尾巴"（浏览器随后补发的 mousedown / mouseup / click）会落在刚出现的遮罩上，
 * 菜单就会「闪一下就消失」；而手指在控件上滑动不会产生 click，所以现象就成了
 * 「只有滑动能用、点按不行」。
 *
 * 因此分两步：
 * 1. pointerdown / mousedown / touchstart 只负责 preventDefault 挡住浏览器自己的
 *    原生弹层（原生 select 就是在这时候展开的），并把这次手势记下来；
 * 2. pointerup / mouseup / touchend 才真正打开菜单 —— 此时手势已经结束；
 *    另外在弹出后的一小段窗口内，把落在遮罩上的 click 一并吞掉，
 *    免得被内核「点菜单外面就关掉」的逻辑关走。
 */
import {Menu} from "siyuan";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

/** 只接管思源自己的下拉控件，原生 select（例如文件上传里的）不动。 */
const SELECT_SELECTOR = "select.b3-select";
/** 同一根手指会同时产生 pointer / touch / mouse 多套事件，这段时间内只处理一次。 */
const DEDUPE_MS = 300;
/** 菜单弹出后，这次点击的兼容事件尾巴还可能继续派发；这段窗口内要吞掉遮罩上的 click。 */
const TAIL_MS = 700;
/** 手指移动超过这个距离就不再当作"点选"，那是滚动。 */
const TAP_SLOP_PX = 12;
/** 移动端菜单的遮罩。 */
const SCRIM_SELECTOR = "#commonMenuScrim, .b3-menu__scrim";

interface Pending {
    select: HTMLSelectElement;
    x: number;
    y: number;
}

const pointOf = (event: Event): {x: number; y: number;} | undefined => {
    const pointer = event as PointerEvent & {changedTouches?: TouchList;};
    if (typeof pointer.clientX === "number") {
        return {x: pointer.clientX, y: pointer.clientY};
    }
    const touch = pointer.changedTouches?.[0];
    return touch ? {x: touch.clientX, y: touch.clientY} : undefined;
};

export const mountMobileSelectNative = (host: FeatureHost): FeatureInstance => {
    let lastOpenedAt = 0;
    let menu: Menu | undefined;
    let pending: Pending | undefined;

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

    const selectOf = (event: Event): HTMLSelectElement | undefined => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !target.matches(SELECT_SELECTOR) || target.disabled) {
            return undefined;
        }
        return target;
    };

    /** 按下：挡住浏览器默认弹层，菜单留到这次手势结束时再开。 */
    const onDown = (event: Event) => {
        const select = selectOf(event);
        if (!select) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const point = pointOf(event);
        pending = {select, x: point?.x ?? 0, y: point?.y ?? 0};
    };

    /** 抬起：手势已经结束，此刻弹出菜单不会再被这次点击的尾巴关掉。 */
    const onUp = (event: Event) => {
        const current = pending;
        if (!current) {
            return;
        }
        pending = undefined;
        const point = pointOf(event);
        if (point && Math.abs(point.x - current.x) + Math.abs(point.y - current.y) > TAP_SLOP_PX) {
            // 手指划走了，那是在滚动 / 拖选，不是点选
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        openMenu(current.select);
    };

    const onCancel = () => {
        pending = undefined;
    };

    const onClick = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        if (target instanceof HTMLSelectElement && target.matches(SELECT_SELECTOR) && !target.disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        // 触发菜单的那一下点击，尾巴会落到弹层的遮罩上；只在这个窗口内吞掉它
        if (menu && Date.now() - lastOpenedAt < TAIL_MS && target.closest(SCRIM_SELECTOR)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, {capture: true, passive: false});
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("mouseup", onUp, true);
    document.addEventListener("touchend", onUp, {capture: true, passive: false});
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("touchcancel", onCancel, true);
    document.addEventListener("click", onClick, true);

    return {
        destroy: () => {
            document.removeEventListener("pointerdown", onDown, true);
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("touchstart", onDown, true);
            document.removeEventListener("pointerup", onUp, true);
            document.removeEventListener("mouseup", onUp, true);
            document.removeEventListener("touchend", onUp, true);
            document.removeEventListener("pointercancel", onCancel, true);
            document.removeEventListener("touchcancel", onCancel, true);
            document.removeEventListener("click", onClick, true);
            menu?.close();
            menu = undefined;
        },
    };
};
