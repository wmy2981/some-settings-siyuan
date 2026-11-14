/**
 * 桌面端 F12 开关开发者工具。
 *
 * 实现是一条挂在 `document` 上的**捕获阶段** keydown：命中 F12 就发内核自己的 IPC 命令。
 * 这里要守住的是「触发条件」——不带修饰键、不是按键重复（按住不放会把工具窗口反复开关）；
 * 以及「卸载后彻底不响应」，因为这是全局监听，漏拆会留在整个页面生命周期里。
 * jsdom 里没有 Electron，所以 `window.require` 由用例自己装（见每个用例的注释）。
 */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import definition from "../../src/features/devtools-hotkey";
import {mountDevtoolsHotkey} from "../../src/features/devtools-hotkey/hotkey";
import {
    mountFeature,
    noopLogger,
} from "../helpers/feature-host";

interface WindowWithRequire {
    require?: (key: string) => unknown;
}

/** 装一个桌面端才有的 `window.require`；jsdom 没有，用例里按 Electron 的形状伪造。 */
const installRequire = (factory: (key: string) => unknown): void => {
    Object.defineProperty(window, "require", {value: factory, configurable: true, writable: true});
};

/** 装一套能用的 Electron：`require("electron").ipcRenderer.send` 是我们要断言的那条路。 */
const installElectron = (): ReturnType<typeof vi.fn> => {
    const send = vi.fn();
    installRequire((key: string) => (key === "electron" ? {ipcRenderer: {send}} : undefined));
    return send;
};

/** 派发一次 keydown，返回「默认行为是否被取消」。 */
const press = (init: KeyboardEventInit): boolean =>
    document.dispatchEvent(new KeyboardEvent("keydown", {cancelable: true, ...init}));

describe("桌面端 F12 开关开发者工具", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
        // window.require 是全局的，用例之间不清掉会互相串味
        delete (window as unknown as WindowWithRequire).require;
    });

    it("声明里只在桌面端交出，开关默认关闭", () => {
        expect(definition.frontends).toEqual(["desktop"]);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });

    it("没有 window.require（浏览器 / 移动端）时静默不做事，只留一条日志", () => {
        const harness = mount();

        // mount 返回 void 就代表没有监听可拆，属于「什么都不做」
        expect(harness.instance).toBeUndefined();
        expect(harness.records.logs).toHaveLength(1);
        expect(harness.records.logs[0][0]).toContain("F12 is left to the browser");
        // 没有监听，按下去也不该抛错（F12 归浏览器自己）
        expect(press({key: "F12"})).toBe(true);
    });

    it("require 抛错或拿不到 ipcRenderer.send 时同样静默退场", () => {
        installRequire(() => {
            throw new Error("no electron here");
        });
        expect(mount().records.logs).toHaveLength(1);
        mounted.splice(0).forEach((harness) => harness.dispose());

        installRequire(() => ({ipcRenderer: {}}));
        expect(mount().records.logs).toHaveLength(1);

        installRequire(() => undefined);
        expect(mount().records.logs).toHaveLength(1);
    });

    it("按 F12 发送内核的 toggleDevTools 命令并取消默认行为", () => {
        const send = installElectron();
        const harness = mount();

        expect(press({key: "F12", code: "F12"})).toBe(false);

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith("siyuan-cmd", "toggleDevTools");
        expect(harness.records.logs).toHaveLength(0);
    });

    it("只认 code 也认：key 不是 F12 但 code 是 F12 依然触发", () => {
        const send = installElectron();
        mount();

        expect(press({key: "Unidentified", code: "F12"})).toBe(false);
        expect(send).toHaveBeenCalledWith("siyuan-cmd", "toggleDevTools");
    });

    it("按住不放（repeat）不重复发，也不吃掉这一次按键", () => {
        const send = installElectron();
        mount();

        expect(press({key: "F12", repeat: true})).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });

    it("带 Ctrl / Meta / Alt / Shift 的一律不接管（留给宿主与系统的快捷键）", () => {
        const send = installElectron();
        mount();

        [{"ctrlKey": true}, {"metaKey": true}, {"altKey": true}, {"shiftKey": true}].forEach((modifier) => {
            expect(press({key: "F12", ...modifier})).toBe(true);
        });
        expect(send).not.toHaveBeenCalled();
    });

    it("只给 key 不给 code（内嵌浏览器常见）时也认 F12", () => {
        const send = installElectron();
        mount();

        expect(press({key: "F12"})).toBe(false);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("其它按键完全不碰", () => {
        const send = installElectron();
        mount();

        expect(press({key: "F1", code: "F1"})).toBe(true);
        expect(press({key: "Enter", code: "Enter"})).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });

    it("监听挂在捕获阶段：比元素自己的冒泡监听先执行", () => {
        const send = installElectron();
        mount();
        const order: string[] = [];
        send.mockImplementation(() => order.push("ipc"));
        const target = document.createElement("div");
        target.addEventListener("keydown", () => order.push("bubble"));
        document.body.append(target);

        target.dispatchEvent(new KeyboardEvent("keydown", {key: "F12", bubbles: true, cancelable: true}));

        // 挂在 document 冒泡期的实现在这里会排在 "bubble" 之后
        expect(order).toEqual(["ipc", "bubble"]);
    });

    it("连按多次就发多次（本功能不做去重，开与关都靠内核自己判断）", () => {
        const send = installElectron();
        mount();

        press({key: "F12"});
        press({key: "F12"});

        expect(send).toHaveBeenCalledTimes(2);
    });

    it("dispose 之后不再响应，且重复 dispose 不抛错", () => {
        const send = installElectron();
        const harness = mount();

        harness.dispose();
        harness.dispose();

        expect(press({key: "F12"})).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });

    it("mount 只在装得上 Electron 时返回可拆的实例", () => {
        installElectron();
        const host = {
            config: {},
            log: noopLogger,
        } as unknown as Parameters<typeof mountDevtoolsHotkey>[0];

        const instance = mountDevtoolsHotkey(host);
        expect(instance).toBeDefined();
        expect(typeof instance?.destroy).toBe("function");
        instance?.destroy();
    });
});
