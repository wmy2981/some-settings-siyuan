/**
 * 功能：智能体输入框回车即发送。
 *
 * 与思源默认相反的那一半（Ctrl/Cmd+Enter 从「发送」变成「换行」）会盖掉默认的
 * 「智能体发送」快捷键，这是这个功能的用意本身；快捷键设置本身不动，
 * 把它改成别的组合后那个组合照样能发送。
 */
import {defineFeature} from "../../core/types";
import {mountAgentEnterToSend} from "./enter";

export default defineFeature({
    id: "agent-enter-to-send",
    category: "function",
    name: "feature.agentEnterToSend.name",
    description: "feature.agentEnterToSend.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountAgentEnterToSend,
});
