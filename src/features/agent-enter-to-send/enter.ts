/**
 * 功能：智能体输入框里 Enter 直接发送，换行改用 Ctrl/Cmd+Enter 与 Shift+Enter。
 *
 * 思源的默认约定正好相反：「设置 - 快捷键 - 通用 - 智能体发送」默认是 ⌘↩
 * （Windows / Linux 上即 Ctrl+Enter），于是 Enter 在输入框里只是普通换行 ——
 * 与绝大多数聊天窗口的习惯相反，发一句话要按两次键。这里把两者对调。
 *
 * 三条实现约束：
 * - **必须抢在思源之前**：输入框自己的 keydown 挂在编辑区的**捕获阶段**，
 *   同元素同阶段按注册先后执行，而插件注册得更晚，所以这里挂 window 的捕获阶段
 *   （祖先捕获先于目标捕获），才能先把 Ctrl+Enter 从「发送」改成「换行」。
 * - **发送只按面板自己的发送按钮**：按钮的 click 与快捷键走的是同一个 sendMessage()，
 *   而按钮在流式中、无模型、输入为空、正在上传时都带 `disabled`（`disabled` 的按钮不派发 click），
 *   所以点它等于把「能不能发」完全交给思源判断，插件不重复实现一遍这些条件。
 * - **换行不能用合成事件**：浏览器只对真实按键执行默认编辑动作，合成出来的 keydown
 *   插不进任何东西，所以走 `execCommand("insertLineBreak")` —— 它产生的 inputType
 *   与 Shift+Enter 完全一致，编辑器的输入处理认得它。
 *
 * 只作用于**新消息**输入框（`.agent-chat__composer-host`）。编辑已有消息的输入框
 * （`.agent-chat__edit-editor`）不动：那里的回车是「重新生成回复」，顺手改掉太危险。
 * 桌面端与移动端共用同一个输入框实现，两端都适用。
 */
import type {FeatureInstance} from "../../core/types";

/** 新消息输入框。编辑已有消息的输入框是另一个类名，刻意不认。 */
const COMPOSER_SELECTOR = ".agent-chat__composer-host";
/** 面板自己的发送按钮。 */
const SEND_SELECTOR = ".agent-chat__send";
/** 输入框的容器：发送按钮与输入框是同一个容器里的兄弟节点。 */
const AREA_SELECTOR = ".agent-chat__input-area";
/** 输入提示菜单（@ 引用、/ 技能）：展开时它会去掉这个类。 */
const HINT_SELECTOR = ".protyle-hint--agent-overlay";
const HIDDEN_CLASS = "fn__none";

/** 输入法组字中：这一下 Enter 是在确认候选词，不是发送。 */
const isComposing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === 229;

/**
 * 提示菜单此刻是否展开。
 *
 * 菜单元素由编辑器挂到 `document.body` 上，不在输入框子树里，也没有指回编辑器的引用，
 * 所以只能按类名找。同一页面里同时开着的输入框（新消息、编辑消息）都用这个类名，
 * 因此判据是「有任意一个展开就交回思源」—— 漏判的代价只是 Enter 没发送，
 * 而误判的代价是发送打断候选词选择，两害相权取前者。
 */
const isHintOpen = (): boolean => {
    const hints = document.querySelectorAll<HTMLElement>(HINT_SELECTOR);
    for (let i = 0; i < hints.length; i++) {
        if (hints[i].isConnected && !hints[i].classList.contains(HIDDEN_CLASS)) {
            return true;
        }
    }
    return false;
};

/**
 * 插一个软换行，与 Shift+Enter 等效。
 *
 * 见文件头：合成事件插不进内容，只能调 execCommand。`insertLineBreak` 不被支持时
 * 退回 `insertParagraph`（与直接按 Enter 等效），至少让这一下键有意义。
 */
const insertLineBreak = () => {
    if (document.execCommand("insertLineBreak")) {
        return;
    }
    document.execCommand("insertParagraph");
};

/**
 * 这个功能不需要宿主提供任何东西（不注入样式、不落配置、不订阅），所以不接 FeatureHost 参数。
 */
export const mountAgentEnterToSend = (): FeatureInstance => {
    const onKeydown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" || event.altKey || isComposing(event) || event.defaultPrevented) {
            return;
        }
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const composer = target.closest<HTMLElement>(COMPOSER_SELECTOR);
        if (!composer) {
            return;
        }
        // Shift+Enter 本来就是编辑器的软换行，正是要的行为：一次都不拦，长按连按也都照旧
        if (event.shiftKey) {
            return;
        }
        // 提示菜单展开时 Enter 是选中候选项，交回思源自己处理
        if (isHintOpen()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        // 长按 Enter 的重复事件不再处理：发送是异步的，这中间按钮还没禁用，
        // 每一下都点一次会把同一条消息发出去两次
        if (event.repeat) {
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            insertLineBreak();
            return;
        }
        // 是否可点由思源自己判断（流式 / 无模型 / 空输入 / 上传中都会带 disabled）
        composer.closest<HTMLElement>(AREA_SELECTOR)?.querySelector<HTMLElement>(SEND_SELECTOR)?.click();
    };

    window.addEventListener("keydown", onKeydown, true);

    return {
        destroy: () => window.removeEventListener("keydown", onKeydown, true),
    };
};
