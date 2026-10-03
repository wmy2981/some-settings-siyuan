/**
 * 工具调用细节的装配：被动读取会话存档 + 对账界面上的思考卡片。
 *
 * 两半各自独立，靠一个订阅接起来：存档那边每读到一份新数据就通知这边重扫一遍。
 * 卸载顺序与装配顺序相反：先停对账（它会把注入的节点与 `title` 清干净），
 * 再放开 `fetch`，最后没有人再引用存档索引。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {
    createAnnotator,
    DETAIL_CSS,
} from "./annotate";
import {createSessionIndex} from "./session";

export const mountAgentToolCallDetail = (host: FeatureHost): FeatureInstance => {
    host.addStyle(DETAIL_CSS);

    const index = createSessionIndex();
    const stopObserving = index.observe();
    const annotator = createAnnotator({
        stepsOf: (entryID) => index.stepsOf(entryID),
        labels: {
            args: host.i18n("agentToolDetail.args"),
            result: host.i18n("agentToolDetail.result"),
            noArgs: host.i18n("agentToolDetail.noArgs"),
        },
    });
    // 存档是异步到的（载入会话、写回存档），到了就重扫一遍已渲染的卡片
    const unsubscribe = index.subscribe(() => annotator.schedule());

    return {
        destroy: () => {
            unsubscribe();
            annotator.destroy();
            stopObserving();
        },
    };
};
