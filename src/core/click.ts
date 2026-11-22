/**
 * 按钮的「单次执行」守卫。
 *
 * 面板里的按钮大多会「先做一段异步准备，再打开一个弹窗」：导出配置要先把全部功能的
 * 配置读出来，导入要等 `importMany` 落盘并读回校验，清除配置要先问一次。这段时间里
 * 按钮仍然可点，连点几下就会把同一段流程跑好几遍 —— 表现为「过了一会儿一下子冒出
 * 好几个弹窗」，或者同一批配置被导入两遍。
 *
 * 所以面板里的点击一律走这里：从按下到这次执行结束，按钮保持 disabled，重复点击
 * 既不会派发、也过不了函数内的兜底判断；执行结束（成功、失败都一样）再放开。
 * 只读 / 发布模式下按钮在标记里就是 disabled，浏览器不会给它派发 click，因此不会走到这里。
 *
 * 同一个动作在面板里可能同时有多份：功能属于多个页签时，每个页签各渲染一份同样的按钮。
 * 所以「在途」按动作记、每一份都禁掉 —— 只禁被点的那一颗，切个页签就能再点一次。
 */
import {reportError} from "./error";

/**
 * 此刻正在执行的动作，键与面板里的 `data-ss-button` 值同义。
 *
 * 守卫按「动作」记，而不是按「按钮」记：同一个动作在面板里可能同时有多份 ——
 * 功能声明了多个分类时，每个页签各渲染一份同样的按钮，用户完全可以点了一边再切页签点另一边。
 */
const running = new Set<string>();

/** 同一次动作的全部分身：文档里带同一个 `data-ss-button` 的按钮（没有元数据时只有自己）。 */
const copiesOf = (button: HTMLButtonElement, scope: string): HTMLButtonElement[] => {
    const copies = [...(button.ownerDocument?.querySelectorAll<HTMLButtonElement>("[data-ss-button]") ?? [])]
        .filter((item) => item.dataset.ssButton === scope);
    return copies.includes(button) ? copies : [button, ...copies];
};

/**
 * 绑定一次「执行期间不可再点」的点击。
 *
 * @param button 被点击的按钮，执行期间由这里负责禁用与恢复
 * @param scope 出错时上报的作用域，与 `guardAsync` 的 scope 同义；同一个 scope 的按钮算同一个动作
 * @param run 点击要做的事；返回 Promise 时一直禁用到它落定
 */
export const bindPendingClick = (button: HTMLButtonElement, scope: string, run: () => unknown): void => {
    button.addEventListener("click", () => {
        // disabled 的按钮本来就不会派发 click；这里再判一次，挡住脚本 dispatchEvent 绕过来的点击
        if (button.disabled || running.has(scope)) {
            return;
        }
        // 同一动作的每一份都禁掉：只禁被点的那一颗，切个页签就能再点一次
        const copies = copiesOf(button, scope);
        const disabledBefore = copies.map((copy) => copy.disabled);
        running.add(scope);
        const release = (): void => {
            running.delete(scope);
            copies.forEach((copy, index) => {
                copy.disabled = disabledBefore[index];
            });
        };
        copies.forEach((copy) => {
            copy.disabled = true;
        });
        let result: unknown;
        try {
            result = run();
        } catch (error) {
            release();
            reportError(scope, error);
            return;
        }
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
            // 失败由调用方（通常已经包了 guardAsync）上报过，这里只负责把按钮放回去
            void Promise.resolve(result).then(release, (error: unknown) => {
                release();
                reportError(scope, error);
            });
            return;
        }
        release();
    });
};
