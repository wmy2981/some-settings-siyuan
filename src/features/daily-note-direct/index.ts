/**
 * 功能：创建日记时不弹询问，直接写进设置里指定好的笔记本。
 *
 * 思源自己的「创建日记」在笔记本不唯一时会先弹一个选择弹窗
 * （`#sidebar`/顶栏的日记入口 → `openDailyNote`），只有唯一笔记本或
 * 「沿用上次笔记本」时才会直接创建。
 *
 * 这里不重写创建逻辑，也不去猜思源的内部函数：弹窗出现的瞬间，
 * 把它的下拉框设成配置的笔记本并替用户点一下「确定」，
 * 创建仍然是思源自己那条 `/api/filetree/createDailyNote` 通路。
 *
 * 弹窗由 MutationObserver 在同一个任务里发现（观察器的回调是微任务，
 * 浏览器还没绘制），所以用户不会看到弹窗闪一下。
 */
import {defineFeature} from "../../core/types";
import {
    dailyNoteNotebookOptions,
    mountDailyNoteDirect,
} from "./direct";

export default defineFeature({
    id: "daily-note-direct",
    category: "function",
    name: "feature.dailyNoteDirect.name",
    description: "feature.dailyNoteDirect.desc",
    settings: [
        {
            kind: "select",
            key: "notebook",
            title: "dailyNoteDirect.notebook",
            description: "dailyNoteDirect.notebookTip",
            default: "",
            optionsProvider: dailyNoteNotebookOptions,
        },
    ],
    mount: mountDailyNoteDirect,
});
