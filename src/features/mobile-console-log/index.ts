/**
 * 开发：移动端的控制台日志查看器。
 *
 * 只在移动端出现——手机上没有开发者控制台，出了问题只能靠猜。
 * 这个功能从插件加载起就把 `console` 的输出收进一个环形缓冲，
 * 设置面板里点一下按钮就能在弹窗里看到完整日志。
 *
 * 入口是设置面板里的一行动作按钮（`kind: "button"`），
 * 所以这个功能在面板上就是一行「打开控制台日志」，没有可保存的取值。
 */
import {defineFeature} from "../../core/types";
import {
    mountConsoleLog,
    openConsoleLog,
} from "./console";

export default defineFeature({
    id: "mobile-console-log",
    category: "dev",
    name: "feature.mobileConsoleLog.name",
    description: "feature.mobileConsoleLog.desc",
    frontends: ["mobile"],
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
        {
            kind: "number",
            key: "capacity",
            title: "mobileConsoleLog.capacity",
            description: "mobileConsoleLog.capacityTip",
            default: 2000,
            min: 200,
            max: 20000,
            step: 100,
            unit: "mobileConsoleLog.entries",
        },
        {
            kind: "button",
            key: "open",
            title: "mobileConsoleLog.open",
            description: "mobileConsoleLog.openTip",
            label: "mobileConsoleLog.openLabel",
            onClick: openConsoleLog,
        },
    ],
    mount: mountConsoleLog,
});
