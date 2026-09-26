/**
 * 功能：与内核断开连接的面板上加一个「立即重连」按钮。
 *
 * 断连面板是内核自己创建的 `#errorLog` 弹窗（id 挂在外层 wrapper 上），
 * 内核的原生重连是 WebSocket `onclose` 里"每 3 秒一次、无上限"的自我重试，
 * 用户唯一能做的就是等。
 *
 * 插件只往这个弹窗里加一个按钮，不改它原有的任何节点：
 * 「安全退出」按钮照旧在原位，我们只是多给一条路。
 */
import {defineFeature} from "../../core/types";
import {mountReconnectButton} from "./button";

export default defineFeature({
    id: "kernel-reconnect-button",
    category: "function",
    name: "feature.kernelReconnectButton.name",
    description: "feature.kernelReconnectButton.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountReconnectButton,
});
