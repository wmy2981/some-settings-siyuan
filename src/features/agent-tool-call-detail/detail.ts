/**
 * 工具调用细节的装配：被动读取会话存档与实时事件流 + 对账界面上的思考卡片。
 *
 * 数据源各管一段：实时流（`live.ts`）让参数在工具一开始执行时就出现，存档（`session.ts`）
 * 在写回后接管，把结果与整轮的权威数据补齐。两边都只是被动读取面板自己发出的响应。
 *
 * 卸载顺序与装配顺序相反：先停对账（它会把注入的节点与 `title` 清干净），
 * 再放开两个响应观察，最后没有人再引用这两份索引。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {
    createAnnotator,
    DETAIL_CSS,
} from "./annotate";
import {createLiveSteps} from "./live";
import {createSessionIndex} from "./session";

export const mountAgentToolCallDetail = (host: FeatureHost): FeatureInstance => {
    host.addStyle(DETAIL_CSS);

    const index = createSessionIndex();
    const live = createLiveSteps();
    const stopObserving = index.observe();
    const stopTapping = live.observe();
    const annotator = createAnnotator({
        stepsOf: (entryID) => index.stepsOf(entryID),
        live,
        labels: {
            args: host.i18n("agentToolDetail.args"),
            result: host.i18n("agentToolDetail.result"),
            noArgs: host.i18n("agentToolDetail.noArgs"),
        },
    });
    // 两边都是异步到的（存档写回、事件流读到下一批），到了就重扫一遍已渲染的卡片
    const unsubscribe = index.subscribe(() => annotator.schedule());
    const unsubscribeLive = live.subscribe(() => annotator.schedule());

    return {
        destroy: () => {
            unsubscribeLive();
            unsubscribe();
            annotator.destroy();
            stopTapping();
            stopObserving();
        },
    };
};
