/**
 * 隐藏智能体新会话的推荐操作。
 *
 * 该功能是纯静态 CSS：不读配置、不订阅配置变化、不动 DOM。断言围绕「只压掉那一个容器」：
 * 选择器必须带**直接子元素**组合符并补一级父元素，既不误伤欢迎页里别的东西
 * （输入框、「未配置模型」提示块），也不用 `!important` 去跟面板的 flex 规则硬碰。
 */
import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";
import type {FeatureHost} from "../../src/core/types";
import definition from "../../src/features/hide-agent-welcome-examples";
import {mountHideAgentWelcomeExamples} from "../../src/features/hide-agent-welcome-examples/style";
import {
    configKeysOf,
    mountFeature,
} from "../helpers/feature-host";

/** 该功能注入的 `<style>` 是否唯一：重复挂载不该堆叠第二张。 */
const styleCount = (): number =>
    document.head.querySelectorAll('style[data-some-settings-style="hide-agent-welcome-examples"]').length;

/** 去掉注释再检查规则本体，避免命中注释里的同名文字。 */
const rulesOf = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("隐藏智能体新会话的推荐操作", () => {
    const mounted: {dispose: () => void;}[] = [];

    const mount = () => {
        const harness = mountFeature(definition);
        mounted.push(harness);
        return harness;
    };

    afterEach(() => {
        mounted.splice(0).forEach((harness) => harness.dispose());
    });

    it("声明：属于人工智能分类，两端都适用，只有一个默认关闭的开关", () => {
        expect(definition.category).toBe("ai");
        expect(definition.frontends).toBeUndefined();
        expect(configKeysOf(definition.settings)).toEqual(["enabled"]);
        expect(definition.settings[0]).toMatchObject({kind: "switch", key: "enabled", default: false});
    });

    it("只隐藏示例推荐容器：直接子元素 + 补一级父元素，且只有一条 display: none", () => {
        const css = rulesOf(mount().css());

        expect(css).toContain(".agent-welcome > .agent-welcome__examples {");
        // `>` 而不是后代选择器：推荐只在天生属于欢迎页那一层时才藏，
        // 别处的同名容器（例如对话中的引用块）不该跟着消失
        expect(css).toContain("> .agent-welcome__examples");
        expect(css.match(/display:\s*none/g)).toHaveLength(1);
        // 不给整个欢迎页设规则：那会把问候语、输入框一起压掉
        expect(css).not.toMatch(/\.agent-welcome\s*\{/);
        // 面板自己的 flex 规则靠特异性赢，不用 !important
        expect(css).not.toContain("!important");
    });

    it("挂载只注入样式，不改任何 DOM", () => {
        const before = document.body.innerHTML;

        mount();

        expect(document.body.innerHTML).toBe(before);
        expect(document.body.children).toHaveLength(0);
        expect(styleCount()).toBe(1);
    });

    it("静态 CSS 不订阅配置变化：广播保存不会重复注入", () => {
        const harness = mount();
        expect(harness.records.styles).toHaveLength(1);
        expect(harness.records.configListeners).toHaveLength(0);

        harness.config.enabled = false;
        harness.notifyConfigChange();

        // 没有监听器：CSS 与配置无关，开关只决定要不要挂载（由核心负责）
        expect(harness.records.styles).toHaveLength(1);
        expect(styleCount()).toBe(1);
    });

    it("重复挂载共用同一个 <style>，不会堆出第二张样式表", () => {
        mount();
        mount();

        expect(styleCount()).toBe(1);
    });

    it("mount 只调一次 addStyle，不碰其它宿主能力", () => {
        const styles: string[] = [];
        const host = {
            addStyle: (css: string) => {
                styles.push(css);
            },
        } as unknown as FeatureHost;

        expect(mountHideAgentWelcomeExamples(host)).toEqual({});
        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain("display: none");
    });

    it("dispose 之后 <head> 里的 <style> 被移除", () => {
        const harness = mount();
        expect(styleCount()).toBe(1);

        harness.dispose();

        expect(styleCount()).toBe(0);
        expect(harness.styleElement()).toBeNull();
    });

    it("dispose 幂等：重复卸载不会抛错", () => {
        const harness = mount();
        harness.dispose();
        expect(() => harness.dispose()).not.toThrow();
        expect(styleCount()).toBe(0);
    });
});
