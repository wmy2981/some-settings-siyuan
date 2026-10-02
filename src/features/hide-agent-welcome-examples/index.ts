/**
 * 界面：隐藏智能体面板新会话里的示例推荐。
 *
 * 那几条推荐（`.agent-welcome__example`）点一下就把自己的文字当成一条用户消息发出去并立刻
 * 开始请求，本身没有任何二次确认；它们又正好排在问候语下面、面板正中的位置，很容易误触。
 *
 * 推荐只出现在还没开始对话的欢迎页里（容器 `.agent-welcome__examples`），与输入框、
 * 「未配置模型」提示块都不共用同一个容器，所以只压掉这一个容器即可。
 * 移动端智能体面板复用同一套渲染与类名，两端都适用。
 */
import {defineFeature} from "../../core/types";
import {mountHideAgentWelcomeExamples} from "./style";

export default defineFeature({
    id: "hide-agent-welcome-examples",
    category: "ui",
    name: "feature.hideAgentWelcomeExamples.name",
    description: "feature.hideAgentWelcomeExamples.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountHideAgentWelcomeExamples,
});
