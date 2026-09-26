/**
 * 功能：禁用代码块语言自动记忆，新建代码块的语言总是为空。
 *
 * 思源把"上次用过的代码块语言"放在前端偏好 `local-codelang` 里：
 * 一个写入口（工具栏选语言）加四个读取口（段落转代码块、输入围栏、空段落转事务、
 * hint 插入代码块）。读的永远是 `window.siyuan.storage["local-codelang"]` 这个属性，
 * 所以把它换成一个"取值恒为空"的访问器就能一次性关掉全部四个读取口——
 * 语言从一开始就不会被拼进 markdown，不需要事后改 DOM，也不会出现
 * 「界面清空了但内核里还留着」的不一致。
 *
 * 没有任何官方扩展点能做到这件事：`code-language-change` 只在用户手动选语言时触发，
 * 而且是在写偏好之前发出的，拦不住新建路径。
 */
import {defineFeature} from "../../core/types";
import {mountCodeBlockLangEmpty} from "./codelang";

export default defineFeature({
    id: "code-block-lang-empty",
    category: "function",
    name: "feature.codeBlockLangEmpty.name",
    description: "feature.codeBlockLangEmpty.desc",
    settings: [
        {
            kind: "switch",
            key: "enabled",
            title: "common.enabled",
            default: false,
        },
    ],
    mount: mountCodeBlockLangEmpty,
});
