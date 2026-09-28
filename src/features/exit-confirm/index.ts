/**
 * 功能：退出应用前弹窗确认。
 *
 * 覆盖主菜单的「退出应用」与"关闭窗口＝退出应用"时的关窗；关窗只关闭窗口
 * （最小化到托盘）时不弹窗，因为那时本来就不退出。从桌面托盘菜单退出也不问，
 * 判据见 confirm.ts。
 *
 * 「适用端」这个下拉就是它的开关：「禁用」即不运行；选了只在另一端的选项时，
 * 这一端根本不挂载，所以它没有独立的 enabled 开关。
 */
import {isMobile} from "../../core/frontend";
import {defineFeature} from "../../core/types";
import {mountExitConfirm} from "./confirm";

/** 当前前端是否在适用范围内；「禁用」不在。 */
const appliesHere = (config: Record<string, unknown>): boolean => {
    const scope = String(config.scope ?? "disabled");
    if (scope === "both") {
        return true;
    }
    return scope === (isMobile() ? "mobile" : "desktop");
};

export default defineFeature({
    id: "exit-confirm",
    category: "function",
    name: "feature.exitConfirm.name",
    description: "feature.exitConfirm.desc",
    isEnabled: appliesHere,
    settings: [
        {
            kind: "select",
            key: "scope",
            title: "exitConfirm.scope",
            default: "disabled",
            options: [
                {value: "disabled", label: "exitConfirm.scopeDisabled"},
                {value: "desktop", label: "exitConfirm.scopeDesktop"},
                {value: "mobile", label: "exitConfirm.scopeMobile"},
                {value: "both", label: "exitConfirm.scopeBoth"},
            ],
        },
    ],
    mount: mountExitConfirm,
});
