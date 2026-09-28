/**
 * 功能：退出应用前弹窗确认。
 *
 * 覆盖主菜单的「退出应用」、桌面托盘右键的退出，以及"关闭窗口＝退出应用"时的关窗；
 * 关窗只关闭窗口（最小化到托盘）时不弹窗，因为那时本来就不退出。
 */
import {defineFeature} from "../../core/types";
import {mountExitConfirm} from "./confirm";

export default defineFeature({
    id: "exit-confirm",
    category: "function",
    name: "feature.exitConfirm.name",
    description: "feature.exitConfirm.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountExitConfirm,
});
