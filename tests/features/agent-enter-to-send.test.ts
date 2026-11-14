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
    editable.textContent = "你好";
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

describe("智能体回车发送", () => {
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

    it("声明：桌面与移动端都适用，只有默认关闭的开关", () => {
        expect(definition.id).toBe("agent-enter-to-send");
        expect(definition.category).toBe("ai");
        expect(definition.enabled).toBe(true);
        expect(definition.name).toBe("feature.agentEnterToSend.title");
        expect(definition.frontends).toBeUndefined();
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
        expect(typeof definition.mount).toBe("function");
    });

    it("Enter 发送：拦住默认行为、隔断宿主快捷键，只点一次发送按钮", () => {
        const {editable, clicks} = buildComposer();
        mount();
        const event = keydown();

        editable.dispatchEvent(event);

        // 不 preventDefault 的话编辑器会插入换行，消息就永远发不出去
        expect(event.defaultPrevented).toBe(true);
        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("在 window 捕获阶段拦下：输入框自身的 keydown 收不到这一下，宿主的发送快捷键不会跟着响", () => {
        const {composer, editable, clicks} = buildComposer();
        const hostHandler = vi.fn();
        // 宿主的快捷键、编辑器的默认换行都挂在输入框自己身上（目标或冒泡阶段）
        composer.addEventListener("keydown", hostHandler);
        mount();

        editable.dispatchEvent(keydown());

        expect(hostHandler).not.toHaveBeenCalled();
        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("Shift+Enter 一次都不拦：编辑器自己插软换行，长按连按都照旧", () => {
        const {editable, clicks} = buildComposer();
        mount();
        const event = keydown({shiftKey: true});

        editable.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("Ctrl+Enter 与 Cmd+Enter 变成换行，不发送", () => {
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

    it("insertLineBreak 不被支持时退回 insertParagraph，这一下键仍然有意义", () => {
        const {commands} = stubExecCommand(false);
        const {editable, clicks} = buildComposer();
        mount();

        editable.dispatchEvent(keydown({ctrlKey: true}));

        expect(commands).toEqual(["insertLineBreak", "insertParagraph"]);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("Ctrl+Shift+Enter 按 Shift 处理：既不换行也不发送，留给编辑器", () => {
        const {exec} = stubExecCommand(true);
        const {editable, clicks} = buildComposer();
        mount();
        const event = keydown({ctrlKey: true, shiftKey: true});

        editable.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(exec).not.toHaveBeenCalled();
        expect(clicks).not.toHaveBeenCalled();
    });

    it("输入法组字期间不发送、也不吞事件：这一下 Enter 是在确认候选词", () => {
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

    it("已经有人 preventDefault 的事件不再处理（与别的插件共存）", () => {
        const {editable, clicks} = buildComposer();
        // 先注册的捕获监听排在插件前面，模拟另一个更早加载的插件先吃掉这一下
        const earlier = (event: Event) => event.preventDefault();
        window.addEventListener("keydown", earlier, true);
        mount();

        editable.dispatchEvent(keydown());

        window.removeEventListener("keydown", earlier, true);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("提示菜单展开时 Enter 交回思源（选中候选项），不发送也不拦", () => {
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

    it("提示菜单只是挂着 fn__none（已收起）时照常发送", () => {
        const {editable, clicks} = buildComposer();
        const hidden = document.createElement("div");
        hidden.className = "protyle-hint--agent-overlay fn__none";
        document.body.append(hidden);
        mount();

        editable.dispatchEvent(keydown());

        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("同页面多处提示菜单：只要有一个展开就交回思源", () => {
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

    it("脱离文档的提示菜单不算展开（宿主换输入框时留下的孤儿节点）", () => {
        const {editable, clicks} = buildComposer();
        // 只 create 不 append：isConnected 为 false，不能被当成「菜单正开着」
        document.createElement("div").className = "protyle-hint--agent-overlay";
        mount();

        editable.dispatchEvent(keydown());

        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("长按 Enter 的重复事件只拦住、不再发送：异步发送期间按钮还没禁用", () => {
        const {editable, clicks} = buildComposer();
        mount();
        const repeat = keydown({repeat: true});

        editable.dispatchEvent(repeat);

        expect(repeat.defaultPrevented).toBe(true);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("发送按钮是 disabled 时什么都不发生：能不能发完全交给思源判断", () => {
        const {editable, send, clicks} = buildComposer();
        send.disabled = true;
        mount();

        editable.dispatchEvent(keydown());

        // disabled 的按钮不派发 click，插件不重复实现「流式 / 无模型 / 空输入」这些条件
        expect(clicks).not.toHaveBeenCalled();
    });

    it("Alt+Enter 与非 Enter 键都不介入", () => {
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

    it("只作用于新消息输入框：编辑已有消息的输入框不动", () => {
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

    it("在输入框外按 Enter（例如正文编辑器）不处理", () => {
        const outside = document.createElement("div");
        document.body.append(outside);
        mount();
        const event = keydown();

        outside.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it("事件目标不是元素（例如派发到 window）时安全返回", () => {
        mount();
        const event = keydown();

        expect(() => window.dispatchEvent(event)).not.toThrow();
        expect(event.defaultPrevented).toBe(false);
    });

    it("输入框里没有发送按钮时不报错，仍然拦住 Enter 以免编辑器插入换行", () => {
        const composer = document.createElement("div");
        composer.className = "agent-chat__composer-host";
        document.body.append(composer);
        mount();
        const event = keydown();

        expect(() => composer.dispatchEvent(event)).not.toThrow();
        expect(event.defaultPrevented).toBe(true);
    });

    it("destroy 之后不再响应，重复 destroy 也安全", () => {
        const {editable, clicks} = buildComposer();
        const instance = mount();

        instance.destroy?.();
        instance.destroy?.();

        const event = keydown();
        editable.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(clicks).not.toHaveBeenCalled();
    });

    it("mount 返回带 destroy 的实例（宿主按这个接口卸载）", () => {
        const instance = mount();
        expect(typeof instance.destroy).toBe("function");
    });

    it("挂载两次会各挂一条监听，卸载其中一次不影响另一次", () => {
        const {editable, clicks} = buildComposer();
        const first = mount();
        mount();

        first.destroy?.();
        editable.dispatchEvent(keydown());

        // 第二个实例还在，所以就算第一次卸载了，功能依旧生效
        expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("按宿主卸载流程 dispose 后 window 上不留监听", () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        const {editable, clicks} = buildComposer();

        harness.dispose();
        editable.dispatchEvent(keydown());

        expect(clicks).not.toHaveBeenCalled();
    });
});
