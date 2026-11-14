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
 */
import {reportError} from "./error";

/**
 * 绑定一次「执行期间不可再点」的点击。
 *
 * @param button 被点击的按钮，执行期间由这里负责禁用与恢复
 * @param scope 出错时上报的作用域，与 `guardAsync` 的 scope 同义
 * @param run 点击要做的事；返回 Promise 时一直禁用到它落定
 */
export const bindPendingClick = (button: HTMLButtonElement, scope: string, run: () => unknown): void => {
    button.addEventListener("click", () => {
        // disabled 的按钮本来就不会派发 click；这里再判一次，挡住脚本 dispatchEvent 绕过来的点击
        if (button.disabled) {
            return;
        }
        button.disabled = true;
        const release = (): void => {
            button.disabled = false;
        };
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
