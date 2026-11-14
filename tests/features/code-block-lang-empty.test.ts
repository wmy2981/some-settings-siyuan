/**
 * 代码块语言不记忆（code-block-lang-empty）。
 *
 * 实现不是「拦截某个入口」，而是把 `window.siyuan.storage["local-codelang"]` 换成一个
 * 取值恒为空的访问器：内核有四个读取口全都读这个属性，顶掉它等于一次性关掉全部四路。
 *
 * 三条约束决定了这里要断言什么：
 * - 必须有 **setter**：内核在严格模式的模块里会给它赋值，只定义 getter 会抛 TypeError，
 *   直接把「创建代码块」那条流程打断。
 * - 必须**幂等重贴**：`window.siyuan.storage` 会在启动阶段被整体替换，插件与它谁先谁后不固定。
 * - 卸载要**还原**成挂载前的样子：原本有值就还回去，原本没有就删掉。
 *
 * 注意 `savedDescriptor` 是模块级状态，`tests/setup.ts` 不会复位它，所以每条用例都必须
 * 走到卸载，否则会污染后面的用例。
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {setDetailedLogging} from "../../src/core/log";
import definition from "../../src/features/code-block-lang-empty/index";
import type {HostHarness} from "../helpers/feature-host";
import {mountFeature} from "../helpers/feature-host";

const KEY = "local-codelang";

const mounted: HostHarness[] = [];

const storageOf = (): {siyuan?: {storage?: Record<string, unknown>;};} =>
    window as unknown as {siyuan?: {storage?: Record<string, unknown>;};};

/** 直接换掉 `window.siyuan.storage`：内核启动时就是这么整块替换的。 */
const setStorage = (storage?: Record<string, unknown>): Record<string, unknown> => {
    const siyuan = storageOf().siyuan as {storage?: Record<string, unknown>;};
    if (storage === undefined) {
        delete siyuan.storage;
        return {};
    }
    siyuan.storage = storage;
    return storage;
};

const mount = (): HostHarness => {
    const harness = mountFeature(definition);
    mounted.push(harness);
    return harness;
};

const descriptorOf = (storage: Record<string, unknown>): PropertyDescriptor | undefined =>
    Object.getOwnPropertyDescriptor(storage, KEY);

beforeEach(() => {
    mounted.length = 0;
    // 顶不动属性时只留一条日志，详细日志要显式打开才看得到
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
    mounted.splice(0).forEach((harness) => harness.dispose());
    vi.useRealTimers();
});

describe("代码块语言不记忆", () => {
    it("挂载后语言恒为空，且给内核准备了一个什么都不做的 setter", () => {
        const storage = setStorage({[KEY]: "python"});
        mount();

        // 四个读取口读到的都是这个 getter 的结果
        expect(storage[KEY]).toBe("");

        // 严格模式里赋值必须不抛：内核 enter.ts / index.ts 都会直接写这个 key，
        // 只定义 getter 会抛 TypeError，把创建代码块的流程打断
        expect(() => {
            storage[KEY] = "javascript";
        }).not.toThrow();
        expect(storage[KEY]).toBe("");

        const descriptor = descriptorOf(storage);
        // configurable 必须为 true：内核会 delete 这个 key，卸载时也要还原
        expect(descriptor?.configurable).toBe(true);
        // enumerable 保持原生数据属性的样子，避免别处遍历 storage 时少一个键
        expect(descriptor?.enumerable).toBe(true);
        expect(typeof descriptor?.get).toBe("function");
        expect(typeof descriptor?.set).toBe("function");
    });

    it("卸载后把挂载前的值原样还回去", () => {
        const storage = setStorage({[KEY]: "python"});
        const harness = mount();
        expect(storage[KEY]).toBe("");

        harness.dispose();

        expect(storage[KEY]).toBe("python");
        const descriptor = descriptorOf(storage);
        expect(descriptor?.get).toBeUndefined();
        expect(descriptor?.value).toBe("python");
        expect(descriptor?.writable).toBe(true);
    });

    it("原本没有这个 key 时，卸载后是彻底删掉而不是留一个空串", () => {
        const storage = setStorage({});
        const harness = mount();
        expect(KEY in storage).toBe(true);

        harness.dispose();

        // 留一个 `""` 会让内核以为「上次用的是空语言」也是用户的选择，
        // 与「从来没有过这个偏好」不是一回事
        expect(KEY in storage).toBe(false);
        expect(descriptorOf(storage)).toBeUndefined();
    });

    it("重复补贴（事件总线）不会让还原值变成空串", () => {
        const storage = setStorage({[KEY]: "python"});
        const harness = mount();

        // 每次补贴都从「已打补丁」早退，否则第二次会把描述符里的原始值记丢；
        // 记丢之后卸载只能删 key，用户的偏好就没了。
        harness.emitBus("ws-main");
        harness.emitBus("loaded-protyle-static");
        harness.emitBus("ws-main");

        expect(storage[KEY]).toBe("");
        harness.dispose();
        expect(storage[KEY]).toBe("python");
    });

    it("只注册 ws-main 与 loaded-protyle-static 两条总线（都发生在创建代码块之前）", () => {
        setStorage({});
        const harness = mount();

        expect(harness.records.bus.map((item) => item.type)).toEqual(["ws-main", "loaded-protyle-static"]);
    });

    it("storage 还不存在时挂载不抛，等它出现后由总线补贴生效", () => {
        setStorage(undefined);

        // 插件加载与内核初始化谁先谁后并不固定，这一顺序在真实启动里很常见
        expect(() => mount()).not.toThrow();

        const storage = setStorage({[KEY]: "python"});
        expect(storage[KEY]).toBe("python");

        mounted[0].emitBus("ws-main");
        expect(storage[KEY]).toBe("");
    });

    it("storage 被整体替换后，2 秒的兜底定时器会重新贴一次", () => {
        vi.useFakeTimers();
        setStorage({[KEY]: "python"});
        mount();

        // 内核启动阶段的 `getLocalStorage()` 就是这个动作
        const replaced = setStorage({[KEY]: "python"});
        expect(replaced[KEY]).toBe("python");

        vi.advanceTimersByTime(2000);

        expect(replaced[KEY]).toBe("");
    });

    it("destroy 会清掉兜底定时器，卸载后再换 storage 也不会被重新贴", () => {
        vi.useFakeTimers();
        setStorage({[KEY]: "python"});
        const harness = mount();
        harness.dispose();

        const replaced = setStorage({[KEY]: "go"});
        vi.advanceTimersByTime(6000);

        // 定时器没清掉的话，卸载之后这个偏好会被重新顶掉，且再也还原不回来
        expect(replaced[KEY]).toBe("go");
        expect(descriptorOf(replaced)?.get).toBeUndefined();
    });

    it("顶不动（属性不可配置）时只记一条日志，不冒泡到插件入口", () => {
        const storage = setStorage({});
        Object.defineProperty(storage, KEY, {value: "rust", enumerable: true, configurable: false});

        let harness: HostHarness | undefined;
        expect(() => {
            harness = mount();
        }).not.toThrow();

        // 已有值不受影响：这里失败的只是「不记忆」这个功能，不能连带影响语言本身
        expect(storage[KEY]).toBe("rust");
        expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
        expect(String(vi.mocked(console.warn).mock.calls[0][0])).toContain("failed to override local-codelang");

        // 失败之后卸载仍要干净退场
        expect(() => harness?.dispose()).not.toThrow();
        expect(storage[KEY]).toBe("rust");
        mounted.length = 0;
    });

    it("destroy 幂等：重复卸载不抛，也不会把还原后的值再改一遍", () => {
        const storage = setStorage({[KEY]: "python"});
        const harness = mount();
        const instance = harness.instance as {destroy: () => void;};

        harness.dispose();
        expect(() => instance.destroy()).not.toThrow();
        expect(storage[KEY]).toBe("python");
    });

    it("声明：编辑器分类、默认关闭、只带一个 enabled 开关", () => {
        expect(definition.id).toBe("code-block-lang-empty");
        expect(definition.category).toBe("editor");
        expect(definition.enabled).toBe(true);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
    });
});
