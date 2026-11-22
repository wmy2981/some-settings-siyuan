/**
 * 智能体回车发送。
 *
 * 这个功能全部价值都在一条键盘事件上，所以断言必须落在**事件本身的效果**上：
 * 有没有 `preventDefault`（否则编辑器会自己插入换行）、有没有 `stopPropagation`
 * （否则宿主的发送快捷键照样会响）、发送按钮被点了没有。
 *
 * 几条容易写错的边界：
 * - 输入法组字期间（`isComposing` / `keyCode === 229`）这一下 Enter 是在确认候选词，
 *   **既不能发送也不能吞掉**，否则中文用户永远打不出字；
 * - 提示菜单（@ 引用 / 斜杠技能）展开时 Enter 是选中候选项，必须交回思源；
 * - `repeat` 每次都会走到 `preventDefault`，但只能发一次 —— 发送是异步的，
 *   按下与按钮禁用之间还有一段时间（docs/development.md 里反复强调的「异步期间按钮仍可点」）；
 * - `destroy()` 之后监听必须真的摘掉，否则设置里关掉功能、页面上 Enter 还在发消息。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {FeatureInstance} from "../../src/core/types";
import {mountAgentEnterToSend} from "../../src/features/agent-enter-to-send/enter";
import definition from "../../src/features/agent-enter-to-send/index";
import {mountFeature} from "../helpers/feature-host";

/** 造一套与宿主一致的智能体输入区：容器、输入框、发送按钮是三层关系。 */
const buildComposer = () => {
    const area = document.createElement("div");
    area.className = "agent-chat__input-area";
    const composer = document.createElement("div");
    composer.className = "agent-chat__composer-host";
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "Hello";
    composer.append(editable);
    const send = document.createElement("button");
    send.className = "agent-chat__send";
    send.type = "button";
    area.append(composer, send);
    document.body.append(area);

    const clicks = vi.fn();
    send.addEventListener("click", clicks);
    return {area, composer, editable, send, clicks};
};

/** 造一个 keydown；`repeat` / 修饰键都按真实事件填。 */
const keydown = (options: KeyboardEventInit = {}): KeyboardEvent =>
    new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...options,
    });

/** 组字事件在 jsdom 里不一定带得进去，keyCode 更是只读派生的，两个都按需补。 */
const withKeyCode = (event: KeyboardEvent, keyCode: number): KeyboardEvent => {
    Object.defineProperty(event, "keyCode", {value: keyCode});
    return event;
};

/** `document.execCommand` 在 jsdom 里不存在，换行那条路必须自己补桩。 */
const stubExecCommand = (result = true) => {
    const commands: string[] = [];
    const exec = vi.fn((command: string) => {
        commands.push(command);
        return result;
    });
    (document as unknown as {execCommand: (command: string) => boolean;}).execCommand = exec;
    return {commands, exec};
};

describe("agent send on Enter", () => {
    const instances: FeatureInstance[] = [];
    const mounted: {dispose: () => void;}[] = [];

    const mount = (): FeatureInstance => {
        const instance = mountAgentEnterToSend();
        instances.push(instance);
        return instance;
    };

    afterEach(() => {
        // 监听挂在 window 上，测试之间必须摘掉，否则后面的用例会被上一个实例一起响应
        mounted.splice(0).forEach((harness) => harness.dispose());
        instances.splice(0).forEach((instance) => instance.destroy?.());
        delete (document as unknown as Record<string, unknown>).execCommand;
    });

    it("declaration: both frontends apply, and the only setting is a switch that is off by default", () => {
        expect(definition.id).toBe("agent-enter-to-send");
        expect(definition.category).toEqual(["ai"]);
        expect(definition.enabled).toBe(true);
        expect(definition.name).toBe("feature.agentEnterToSend.title");
        expect(definition.frontends).toBeUndefined();
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
        expect(typeof definition.mount).toBe("function");
    });

    it("Enter sends: prevents the default action, isolates the host shortcut and clicks the send button once", () => {
        const {editable, clicks} = buildComposer();
        mount();
        const event = keydown();

        editable.dispatchEvent(event);

        // 不 preventDefault 的话编辑器会插入换行，消息就永远发不出去
        expect(event.defaultPrevented).toBe(true);
        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("intercepted in the window capture phase: the input's own keydown never sees it and the host send shortcut does not fire", () => {
        const {composer, editable, clicks} = buildComposer();
        const hostHandler = vi.fn();
        // 宿主的快捷键、编辑器的默认换行都挂在输入框自己身上（目标或冒泡阶段）
        composer.addEventListener("keydown", hostHandler);
        mount();

        editable.dispatchEvent(keydown());

        expect(hostHandler).not.toHaveBeenCalled();
        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("Shift+Enter is never intercepted: the editor inserts its own soft line break, repeated presses included", () => {
        const {editable, clicks} = buildComposer();
        mount();
        const event = keydown({shiftKey: true});

        editable.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("Ctrl+Enter and Cmd+Enter insert a line break and do not send", () => {
        const {commands} = stubExecCommand(true);
        const {editable, clicks} = buildComposer();
        mount();

        ["ctrl", "meta"].forEach((modifier) => {
            const event = keydown({[`${modifier}Key`]: true});
            editable.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(true);
        });

        // 合成事件插不进内容，只能走 execCommand；两次按键各插一次
        expect(commands).toEqual(["insertLineBreak", "insertLineBreak"]);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("insertParagraph is the fallback when insertLineBreak is unsupported, so the key still does something", () => {
        const {commands} = stubExecCommand(false);
        const {editable, clicks} = buildComposer();
        mount();

        editable.dispatchEvent(keydown({ctrlKey: true}));

        expect(commands).toEqual(["insertLineBreak", "insertParagraph"]);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("Ctrl+Shift+Enter is treated as Shift: neither a line break nor a send, so the editor keeps it", () => {
        const {exec} = stubExecCommand(true);
        const {editable, clicks} = buildComposer();
        mount();
        const event = keydown({ctrlKey: true, shiftKey: true});

        editable.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(exec).not.toHaveBeenCalled();
        expect(clicks).not.toHaveBeenCalled();
    });

    it("no send and no swallowing while the IME is composing: that Enter confirms a candidate", () => {
        const {editable, clicks} = buildComposer();
        mount();

        const composing = keydown({isComposing: true});
        editable.dispatchEvent(composing);
        // 部分输入法只给 229，不带 isComposing
        const legacy = withKeyCode(keydown(), 229);
        editable.dispatchEvent(legacy);

        expect(composing.defaultPrevented).toBe(false);
        expect(legacy.defaultPrevented).toBe(false);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("an event someone already prevented is left alone (coexisting with other plugins)", () => {
        const {editable, clicks} = buildComposer();
        // 先注册的捕获监听排在插件前面，模拟另一个更早加载的插件先吃掉这一下
        const earlier = (event: Event) => event.preventDefault();
        window.addEventListener("keydown", earlier, true);
        mount();

        editable.dispatchEvent(keydown());

        window.removeEventListener("keydown", earlier, true);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("Enter goes back to SiYuan while the hint menu is open (it picks a candidate), without sending or intercepting", () => {
        const {editable, clicks} = buildComposer();
        const hint = document.createElement("div");
        hint.className = "protyle-hint--agent-overlay";
        document.body.append(hint);
        mount();
        const event = keydown();

        editable.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("sending works as usual when the hint menu only carries fn__none (collapsed)", () => {
        const {editable, clicks} = buildComposer();
        const hidden = document.createElement("div");
        hidden.className = "protyle-hint--agent-overlay fn__none";
        document.body.append(hidden);
        mount();

        editable.dispatchEvent(keydown());

        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("several hint menus on the page: one open menu is enough to hand Enter back to SiYuan", () => {
        const {editable, clicks} = buildComposer();
        // 编辑已有消息的输入框也会挂同名的提示菜单，判据不能只看自己的那个
        const otherHidden = document.createElement("div");
        otherHidden.className = "protyle-hint--agent-overlay fn__none";
        const otherOpen = document.createElement("div");
        otherOpen.className = "protyle-hint--agent-overlay";
        document.body.append(otherHidden, otherOpen);
        mount();

        editable.dispatchEvent(keydown());

        expect(clicks).not.toHaveBeenCalled();
    });

    it("a detached hint menu does not count as open (an orphan left when the host swaps inputs)", () => {
        const {editable, clicks} = buildComposer();
        // 只 create 不 append：isConnected 为 false，不能被当成「菜单正开着」
        document.createElement("div").className = "protyle-hint--agent-overlay";
        mount();

        editable.dispatchEvent(keydown());

        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("repeat events from holding Enter are intercepted without sending again: the button is not disabled yet during the async send", () => {
        const {editable, clicks} = buildComposer();
        mount();
        const repeat = keydown({repeat: true});

        editable.dispatchEvent(repeat);

        expect(repeat.defaultPrevented).toBe(true);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("nothing happens while the send button is disabled: SiYuan alone decides whether sending is possible", () => {
        const {editable, send, clicks} = buildComposer();
        send.disabled = true;
        mount();

        editable.dispatchEvent(keydown());

        // disabled 的按钮不派发 click，插件不重复实现「流式 / 无模型 / 空输入」这些条件
        expect(clicks).not.toHaveBeenCalled();
    });

    it("Alt+Enter and non-Enter keys are not touched", () => {
        const {editable, clicks} = buildComposer();
        mount();

        const withAlt = keydown({altKey: true});
        editable.dispatchEvent(withAlt);
        const otherKey = keydown({key: "a"});
        editable.dispatchEvent(otherKey);

        expect(withAlt.defaultPrevented).toBe(false);
        expect(otherKey.defaultPrevented).toBe(false);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("only the new-message input is affected: the editor for an existing message is untouched", () => {
        const area = document.createElement("div");
        area.className = "agent-chat__input-area";
        const editor = document.createElement("div");
        editor.className = "agent-chat__edit-editor";
        const send = document.createElement("button");
        send.className = "agent-chat__send";
        const clicks = vi.fn();
        send.addEventListener("click", clicks);
        area.append(editor, send);
        document.body.append(area);
        mount();
        const event = keydown();

        editor.dispatchEvent(event);

        // 那里的回车是「重新生成回复」，顺手改掉太危险
        expect(event.defaultPrevented).toBe(false);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("Enter outside the input (the document editor, for example) is ignored", () => {
        const outside = document.createElement("div");
        document.body.append(outside);
        mount();
        const event = keydown();

        outside.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it("returns safely when the event target is not an element (dispatched on window, for example)", () => {
        mount();
        const event = keydown();

        expect(() => window.dispatchEvent(event)).not.toThrow();
        expect(event.defaultPrevented).toBe(false);
    });

    it("no error when the input has no send button, and Enter is still intercepted so the editor does not insert a line break", () => {
        const composer = document.createElement("div");
        composer.className = "agent-chat__composer-host";
        document.body.append(composer);
        mount();
        const event = keydown();

        expect(() => composer.dispatchEvent(event)).not.toThrow();
        expect(event.defaultPrevented).toBe(true);
    });

    it("no response after destroy, and a repeated destroy is safe", () => {
        const {editable, clicks} = buildComposer();
        const instance = mount();

        instance.destroy?.();
        instance.destroy?.();

        const event = keydown();
        editable.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("mount returns an instance with destroy (the interface the host unmounts through)", () => {
        const instance = mount();
        expect(typeof instance.destroy).toBe("function");
    });

    it("mounting twice installs two listeners, and unmounting one leaves the other working", () => {
        const {editable, clicks} = buildComposer();
        const first = mount();
        mount();

        first.destroy?.();
        editable.dispatchEvent(keydown());

        // 第二个实例还在，所以就算第一次卸载了，功能依旧生效
        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("disposing through the host unmount flow leaves no listener on window", () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        const {editable, clicks} = buildComposer();

        harness.dispose();
        editable.dispatchEvent(keydown());

        expect(clicks).not.toHaveBeenCalled();
    });
});
