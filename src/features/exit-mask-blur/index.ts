/**
 * 界面：退出应用遮罩始终模糊。
 *
 * 退出应用时思源先弹一个等待遮罩（`#exitProgress .b3-dialog__scrim--progress`），
 * 它带一段独有的 5 秒缓入动画：模糊从 0 逐渐增加到 8px。退出通常一两秒就完成，
 * 用户看到的基本是「没有模糊」，与重建索引、清理数据等进度遮罩的毛玻璃观感不一致。
 *
 * 本功能只停掉那段动画，让遮罩直接使用宿主给所有进度遮罩写好的同一份底色与模糊：
 * 深色模式的底色、减少透明度 / 强制颜色模式下的无模糊回退都留在宿主手里。
 */
import {defineFeature} from "../../core/types";
import {mountExitMaskBlur} from "./style";

export default defineFeature({
    id: "exit-mask-blur",
    category: "appearance",
    enabled: true,
    name: "feature.exitMaskBlur.title",
    description: "feature.exitMaskBlur.description",
    // 这段渐入动画自 3.8.10 起才有：更早的思源本来就是立即模糊，这份补丁无事可做，
    // 所以下限取它出现的那一版，更早的思源不再加载它的配置、面板里也不再出现这一项。
    // 3.8.11-alpha.6 是唯一例外：上游临时把动画整段移除、随后又恢复，那里本功能是无操作。
    minAppVersion: "3.8.10",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountExitMaskBlur,
});
