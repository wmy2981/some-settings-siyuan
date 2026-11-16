/**
 * 退出遮罩始终模糊的实现：一段 CSS。
 *
 * 宿主给退出遮罩挂的是一段 5 秒动画（`animation: exit-progress-blur 5s ease-in-out`），
 * 动画期间 `backdrop-filter` 从 blur(0) 走到 blur(8px)，会压过元素自身的静态声明。
 * 这里只把动画停掉，静态的 `blur(8px) saturate(105%)` 就立刻生效 —— 与重建索引、
 * 清理数据这些进度遮罩完全一致。
 *
 * 选择器多一级 `body`：宿主那条是 `#exitProgress .b3-dialog__scrim--progress`，
 * 同特异性只靠「后注入」取胜并不可靠（主题样式表可能在插件之后再追加）。
 * 不写 `!important`，也不重写 `backdrop-filter`：减少透明度 / 强制颜色模式下的
 * 无模糊回退由宿主的媒体查询负责，覆盖掉就等于把无障碍回退一起废了。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const CSS = `/* 退出遮罩不做渐入，始终使用与其它进度遮罩相同的高斯模糊 */
body #exitProgress .b3-dialog__scrim--progress {
    animation: none;
}
`;

export const mountExitMaskBlur = (host: FeatureHost): FeatureInstance => {
    host.addStyle(CSS);
    host.log.info("mounted: the exit mask stays blurred from the start");

    return {
        destroy: () => {
            host.log.info("unmounted: the exit mask fades its blur in again");
        },
    };
};
