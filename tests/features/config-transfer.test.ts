/**
 * 「插件配置导入导出」（config-transfer）。
 *
 * 这个功能只有两行动作按钮，没有任何挂载行为，所以全部断言都从 `onClick` 打开的
 * 那个弹窗往下看：弹窗里的控件形态、导出文档的形状、导入的每一类失败、以及
 * 「重新载入前端」这一步有没有被排上。
 *
 * 宿主 `Dialog` 的 `title` / `width` 在测试替身里没有落到 DOM 上，这里在文件内
 * 局部包了一层 `Dialog` 把构造参数记下来（只记录，不改行为），否则「标题用的是哪个
 * i18n key」「移动端 92vw」这两件用户可见的事就完全测不到。
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
import {parseImport} from "../../src/features/config-transfer/parse";
import {
    exportConfigs,
    importConfigs,
} from "../../src/features/config-transfer/transfer";
import zhCN from "../../src/i18n/zh-CN.json";
import {createActionContext} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/** 记录每一次 `new Dialog()` 的入参：标题与宽度只有这里能看到。 */
const dialogOptions: Record<string, unknown>[] = [];

vi.mock("siyuan", async (importOriginal) => {
    const actual = await importOriginal<Record<string, any>>();
    class SpyDialog extends actual.Dialog {
        constructor(options: Record<string, unknown> = {}) {
            super(options);
            dialogOptions.push(options);
        }
    }
    return {...actual, Dialog: SpyDialog};
});

const t = (key: string): string => (zhCN as Record<string, string>)[key] ?? key;

/** 用真实中文文案造动作行上下文，断言里就能看到用户实际读到的那句话。 */
const action = (options: Record<string, unknown> = {}) =>
    createActionContext({featureId: "config-transfer", i18n: t, ...options});

const dialogElement = (): HTMLElement | null => document.querySelector<HTMLElement>(".b3-dialog");

const exportField = (): HTMLElement | null => document.querySelector<HTMLElement>(".b3-dialog pre");

const importField = (): HTMLTextAreaElement | null =>
    document.querySelector<HTMLTextAreaElement>(".b3-dialog textarea");

const runButton = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>("[data-ss-run]")!;

const closeButton = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>("[data-ss-close]")!;

/** 动作行里那条异步链是 `void … .then()`，没有 Promise 交给我们等，只能自己排空微任务。 */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
    }
};

/**
 * 把 `window.setTimeout` 换成「只记录不调度」。
 *
 * jsdom 的 `window.location` 不可重定义（连 `reload` 都挂不上 spy），所以只能断言
 * 「排了一个 600ms 的重新载入」这件事本身：真去触发它只会得到 jsdom 的
 * 「Not implemented: navigation」噪声，什么也证明不了。
 */
const captureTimeouts = () => {
    const timers: {handler: TimerHandler; delay?: number;}[] = [];
    vi.spyOn(window, "setTimeout").mockImplementation(
        ((handler: TimerHandler, delay?: number) => {
            timers.push({handler, delay});
            return timers.length;
        }) as unknown as typeof window.setTimeout,
    );
    return timers;
};

beforeEach(() => {
    // 失败路径只通过 reportError 留下控制台记录
    setDetailedLogging(true);
});

afterEach(() => {
    setDetailedLogging(false);
    dialogOptions.length = 0;
});

describe("插件配置导入导出", () => {
    describe("parseImport（纯函数）", () => {
        it("完整导出文档：取 features 字段", () => {
            const parsed = parseImport(JSON.stringify({
                plugin: "some-settings-siyuan",
                version: 1,
                features: {alpha: {enabled: true}},
            }));
            expect(parsed).toEqual({kind: "ok", features: {alpha: {enabled: true}}});
        });

        it("裸映射：没有 features 字段时整份对象就是配置集合", () => {
            // 用户从别处抄一段「只有功能 id」的 JSON 也要能导入
            expect(parseImport('{"alpha":{"enabled":true},"beta":{}}'))
                .toEqual({kind: "ok", features: {alpha: {enabled: true}, beta: {}}});
        });

        it("features 里的条目不再校验：解析层只判定容器，值由 ConfigStore 归一化", () => {
            // 这里若顺手校验每一项，就会与 core/config 的规则变成两份，
            // 迟早出现「解析说不行、保存说行」的分歧
            expect(parseImport('{"features":{"alpha":1}}'))
                .toEqual({kind: "ok", features: {alpha: 1}});
        });

        it("空 features 也是合法文档（导出过、但一个配置文件都没有）", () => {
            expect(parseImport('{"features":{}}')).toEqual({kind: "ok", features: {}});
        });

        it("空对象不是配置集合：既没有 features 也没有任何条目", () => {
            // 空映射若判成 ok，用户粘 `{}` 会得到「已导入 0 个」的成功提示
            expect(parseImport("{}")).toEqual({kind: "error", reason: "shape"});
        });

        it.each([
            ["数组", "[]"],
            ["字符串", '"alpha"'],
            ["数字", "42"],
            ["布尔", "true"],
            ["null", "null"],
        ])("根节点是%s时报结构错误，而不是当成配置集合", (_label, text) => {
            expect(parseImport(text)).toEqual({kind: "error", reason: "shape"});
        });

        it.each([
            ["截断的对象", "{"],
            ["空文本", ""],
            ["尾部逗号", '{"alpha":{}},'],
            ["不是 JSON 的说明文字", "这是我从别处复制的配置"],
        ])("%s被判成 JSON 语法错误（与结构错误分开提示）", (_label, text) => {
            // 两种错误给用户的建议完全不同：语法错要重新复制，结构错要换一份文档
            expect(parseImport(text)).toEqual({kind: "error", reason: "json"});
        });

        it("裸映射里混进非对象值就整份拒绝", () => {
            // 典型误粘贴：把 `{"plugin":"…","version":1}` 这种头部当成配置写进去
            expect(parseImport('{"alpha":{},"plugin":"some-settings-siyuan"}'))
                .toEqual({kind: "error", reason: "shape"});
        });

        it("条目的值是数组或 null 时也不算配置对象", () => {
            expect(parseImport('{"alpha":[]}')).toEqual({kind: "error", reason: "shape"});
            expect(parseImport('{"alpha":null}')).toEqual({kind: "error", reason: "shape"});
        });

        it.each([
            ["数组", "[]"],
            ["null", "null"],
            ["字符串", '"alpha"'],
            ["数字", "1"],
        ])("features 是%s时回落到裸映射判定，最终仍是结构错误", (_label, features) => {
            // features 不合规时不能直接 ok（会拿到 undefined 往下走），
            // 也不能直接报 json 错（语法本身是对的）
            expect(parseImport(`{"features":${features}}`))
                .toEqual({kind: "error", reason: "shape"});
        });

        it("features 与头部字段共存时只取 features", () => {
            const parsed = parseImport('{"plugin":"p","version":9,"features":{"alpha":{"enabled":true}}}');
            expect(parsed).toEqual({kind: "ok", features: {alpha: {enabled: true}}});
        });

        it("容忍首尾空白与换行（用户从文本框里复制时常带）", () => {
            expect(parseImport('\n  {"alpha":{"enabled":true}}\n  '))
                .toEqual({kind: "ok", features: {alpha: {enabled: true}}});
        });
    });

    describe("导出", () => {
        it("弹窗里是只读的 <pre>，不是 <textarea>", async () => {
            // 移动端「能不能编辑」决定软键盘会不会顶上来：只读表单控件同样会弹键盘，
            // 所以这里必须不是表单控件
            const {context, calls} = action({exportConfigs: async () => ({alpha: {enabled: true}})});
            await exportConfigs(context);

            expect(dialogElement()).not.toBeNull();
            expect(exportField()).not.toBeNull();
            expect(importField()).toBeNull();
            expect(calls.export).toBe(1);
        });

        it("导出内容是一份带标记与版本号的、缩进两格的完整文档", async () => {
            const features = {alpha: {enabled: true}, retired: {interval: 5}};
            const {context} = action({exportConfigs: async () => features});
            await exportConfigs(context);

            const text = exportField()!.textContent ?? "";
            expect(JSON.parse(text)).toEqual({
                plugin: "some-settings-siyuan",
                version: 1,
                features,
            });
            // 缩进两格是为了让人也能读；同时断言「不是压成一行」
            expect(text).toContain('\n  "plugin": "some-settings-siyuan"');
            expect(text.split("\n").length).toBeGreaterThan(5);
        });

        it("一个配置文件都没有时导出 features: {}（而不是省略字段）", async () => {
            const {context} = action({exportConfigs: async () => ({})});
            await exportConfigs(context);

            expect(JSON.parse(exportField()!.textContent ?? "")).toEqual({
                plugin: "some-settings-siyuan",
                version: 1,
                features: {},
            });
        });

        it("桌面端 640px、移动端 92vw，标题取导出那个 key", async () => {
            const {context} = action({exportConfigs: async () => ({})});
            await exportConfigs(context);
            expect(dialogOptions[0].width).toBe("640px");
            expect(dialogOptions[0].title).toBe(zhCN["feature.configTransfer.exportTitle"]);

            document.body.innerHTML = "";
            dialogOptions.length = 0;
            mockState.frontend = "mobile";
            const mobile = action({exportConfigs: async () => ({})});
            await exportConfigs(mobile.context);
            expect(dialogOptions[0].width).toBe("92vw");
        });

        it("说明文字按 HTML 转义后插入（文案来自 i18n，仍不可当标记用）", async () => {
            const {context} = createActionContext({
                featureId: "config-transfer",
                i18n: (key) => key === "feature.configTransfer.exportTip" ? "<b>提示</b>" : key,
                exportConfigs: async () => ({}),
            });
            await exportConfigs(context);

            const tip = document.querySelector(".b3-dialog .b3-label__text")!;
            expect(tip.textContent).toBe("<b>提示</b>");
            expect(tip.querySelector("b")).toBeNull();
        });

        it("弹窗提前预热图层：容器带预热类，样式表落在 head 里", async () => {
            // 不预热的话移动端入场会闪一帧旧画面（见 core/layer.ts）
            const {context} = action({exportConfigs: async () => ({})});
            await exportConfigs(context);

            expect(dialogElement()!.querySelector(".b3-dialog__container")!.classList.contains("some-settings-layer"))
                .toBe(true);
            expect(document.getElementById("some-settings-layer-local-css")).not.toBeNull();
        });

        it("复制成功：提示已复制、带 3 秒超时，弹窗保持打开", async () => {
            const copied: string[] = [];
            // jsdom 没有 navigator.clipboard，也不实现 execCommand，这里只把兜底那条路
            // 变成成功，并顺手记下真正被放进 textarea 的文本
            (document as unknown as {execCommand: (cmd: string) => boolean;}).execCommand = (cmd: string) => {
                copied.push(document.querySelector<HTMLTextAreaElement>("body > textarea")!.value);
                return cmd === "copy";
            };
            const {context} = action({exportConfigs: async () => ({alpha: {enabled: true}})});
            await exportConfigs(context);
            const expected = exportField()!.textContent;

            runButton().click();
            await flush();

            expect(copied).toEqual([expected]);
            expect(mockState.messages.at(-1)).toEqual({
                text: zhCN["feature.configTransfer.copied"],
                timeout: 3000,
                type: undefined,
            });
            // 「复制完不关窗」：用户可能还要自己在框里选一段
            expect(dialogElement()).not.toBeNull();
        });

        it("复制失败：提示手动复制，弹窗同样留在原地", async () => {
            (document as unknown as {execCommand: () => boolean;}).execCommand = () => false;
            const {context} = action({exportConfigs: async () => ({})});
            await exportConfigs(context);

            runButton().click();
            await flush();

            expect(mockState.messages.at(-1)!.text).toBe(zhCN["feature.configTransfer.copyFailed"]);
            expect(dialogElement()).not.toBeNull();
        });

        it("关闭按钮销毁弹窗", async () => {
            const {context} = action({exportConfigs: async () => ({})});
            await exportConfigs(context);

            closeButton().click();

            expect(dialogElement()).toBeNull();
        });
    });

    describe("导入", () => {
        it("弹窗里是可编辑的 <textarea>，初始为空、关掉拼写检查", () => {
            // 初始为空是刻意的：粘贴位置要留给用户，不能预填上一份内容
            const {context} = action();
            importConfigs(context);

            expect(importField()).not.toBeNull();
            expect(importField()!.value).toBe("");
            expect(importField()!.getAttribute("spellcheck")).toBe("false");
            expect(exportField()).toBeNull();
            expect(dialogOptions[0].title).toBe(zhCN["feature.configTransfer.importTitle"]);
        });

        it.each([
            ["语法错误", "not json", "feature.configTransfer.invalidJson"],
            ["结构错误", "[1,2,3]", "feature.configTransfer.invalidShape"],
        ])("%s：提示对应文案、不调用导入、弹窗保持打开", async (_label, text, key) => {
            const {context, calls} = action();
            importConfigs(context);
            importField()!.value = text;

            runButton().click();
            await flush();

            expect(calls.import).toEqual([]);
            expect(mockState.messages.at(-1)).toEqual({text: zhCN[key], timeout: 4000, type: "error"});
            expect(dialogElement()).not.toBeNull();
        });

        it("合法文档：把 features 交给 core，提示条数，并排一次 600ms 后的重新载入", async () => {
            const timers = captureTimeouts();
            const {context, calls} = action({
                importConfigs: async () => ({applied: ["alpha", "beta"], skipped: ["weird"]}),
            });
            importConfigs(context);
            importField()!.value = '{"features":{"alpha":{"enabled":true}}}';

            runButton().click();
            await flush();

            expect(calls.import).toEqual([{alpha: {enabled: true}}]);
            expect(mockState.messages.at(-1)!.text)
                .toBe("已导入 2 个配置文件，忽略 1 个无法识别的条目");
            // 导入后必须重新载入：面板手里的草稿是导入前的值，用户再点保存会把旧值写回去
            expect(timers.map((timer) => timer.delay)).toEqual([600]);
            expect(typeof timers[0].handler).toBe("function");
            // 成功时 run 返回 true，弹窗收掉
            expect(dialogElement()).toBeNull();
        });

        it("裸映射也能导入，写回的是整份对象", async () => {
            captureTimeouts();
            const {context, calls} = action({importConfigs: async () => ({applied: ["alpha"], skipped: []})});
            importConfigs(context);
            importField()!.value = '{"alpha":{"enabled":true}}';

            runButton().click();
            await flush();

            expect(calls.import).toEqual([{alpha: {enabled: true}}]);
            expect(mockState.messages.at(-1)!.text).toBe("已导入 1 个配置文件，忽略 0 个无法识别的条目");
        });

        it("写盘被拒：错误交给 reportError，弹窗保持打开、不排重新载入", async () => {
            // 校验失败或读回不一致时必须让用户看见原因并停在原地改，
            // 而不是装作导入成功、过一会儿又把页面刷掉
            const timers = captureTimeouts();
            const failure = new Error("writer rejected");
            const {context} = action({importConfigs: async () => Promise.reject(failure)});
            importConfigs(context);
            importField()!.value = '{"alpha":{"enabled":true}}';

            runButton().click();
            await flush();

            expect(console.error).toHaveBeenCalledWith(expect.stringContaining("config-transfer.import"));
            // reportError 同时会给用户一条错误提示
            expect(mockState.messages.at(-1)!.text).toContain("writer rejected");
            expect(mockState.messages.at(-1)!.type).toBe("error");
            expect(dialogElement()).not.toBeNull();
            expect(timers).toEqual([]);
        });

        it("导入前可以在框里改内容，点导入时读的是此刻的 value", async () => {
            // 判据是 `textarea.value` 而不是初始 JSON，否则用户改了也没用
            captureTimeouts();
            const {context, calls} = action({importConfigs: async () => ({applied: [], skipped: []})});
            importConfigs(context);
            importField()!.value = '{"stale":{}}';
            importField()!.value = '{"fresh":{}}';

            runButton().click();
            await flush();

            expect(calls.import).toEqual([{fresh: {}}]);
        });

        it("关闭按钮销毁弹窗，不触发任何导入", () => {
            const {context, calls} = action();
            importConfigs(context);

            closeButton().click();

            expect(dialogElement()).toBeNull();
            expect(calls.import).toEqual([]);
        });
    });

    describe("声明", () => {
        it("永不挂载：两行动作按钮之外没有运行期行为", async () => {
            const {default: definition} = await import("../../src/features/config-transfer/index");
            expect(definition.mount).toBeUndefined();
            expect(definition.isEnabled!({})).toBe(false);
            expect(definition.settings.map((field) => field.kind)).toEqual(["button", "button"]);
            expect(definition.settings.map((field) => field.key)).toEqual(["export", "import"]);
        });
    });
});
