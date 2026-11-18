/**
 * `core/style.ts`：功能自带 CSS 的注入与撤销。
 *
 * 「同一个功能只留一份样式表、内容随配置重写」是这一层的核心约定：
 * 每次配置变更都会重新生成 CSS，堆叠就会旧规则继续生效。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import {
    addStyle,
    removeStylesOf,
} from "../../src/core/style";

const ATTR = "data-some-settings-style";
const stylesOf = (
    owner: string,
): HTMLStyleElement[] => [...document.head.querySelectorAll<HTMLStyleElement>(`style[${ATTR}="${owner}"]`)];

describe("addStyle", () => {
    it("appends a stylesheet tagged with the owner to head", () => {
        addStyle("demo", ".a{color:red}");
        const styles = stylesOf("demo");
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toBe(".a{color:red}");
    });

    it("blank CSS creates no element and returns an idempotent no-op undo function", () => {
        const remove = addStyle("demo", "   \n\t ");
        expect(stylesOf("demo")).toHaveLength(0);
        expect(() => {
            remove();
            remove();
        }).not.toThrow();
    });

    it("calling again for the same owner only updates the content instead of stacking stylesheets", () => {
        const remove = addStyle("demo", ".a{color:red}");
        addStyle("demo", ".a{color:blue}");
        const styles = stylesOf("demo");
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toBe(".a{color:blue}");
        remove();
        expect(stylesOf("demo")).toHaveLength(0);
    });

    it("different features get their own stylesheets", () => {
        addStyle("alpha", ".a{}");
        addStyle("beta", ".b{}");
        expect(stylesOf("alpha")).toHaveLength(1);
        expect(stylesOf("beta")).toHaveLength(1);
    });

    it("an existing stylesheet in the page is reused instead of injected again", () => {
        // 模拟「模块缓存是空的，但上次插件实例留下的样式表还在页面里」
        const existing = document.createElement("style");
        existing.setAttribute(ATTR, "demo");
        existing.textContent = ".a{color:red}";
        document.head.append(existing);

        addStyle("demo", ".a{color:blue}");
        const styles = stylesOf("demo");
        expect(styles).toHaveLength(1);
        expect(styles[0]).toBe(existing);
        expect(styles[0].textContent).toBe(".a{color:blue}");
    });

    it("leftover stylesheets of the same owner collapse to the last one, which is rewritten", () => {
        const first = document.createElement("style");
        first.setAttribute(ATTR, "demo");
        first.textContent = ".a{color:red}";
        const last = document.createElement("style");
        last.setAttribute(ATTR, "demo");
        last.textContent = ".a{color:green}";
        document.head.append(first, last);

        addStyle("demo", ".a{color:blue}");
        const styles = stylesOf("demo");
        expect(styles).toHaveLength(1);
        expect(styles[0]).toBe(last);
        expect(styles[0].textContent).toBe(".a{color:blue}");
    });

    it("injecting again after the host clears head creates a new stylesheet", () => {
        addStyle("demo", ".a{color:red}");
        document.head.innerHTML = "";
        addStyle("demo", ".a{color:blue}");
        const styles = stylesOf("demo");
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toBe(".a{color:blue}");
    });

    it("the undo function can be called repeatedly", () => {
        const remove = addStyle("demo", ".a{}");
        remove();
        expect(() => remove()).not.toThrow();
        expect(stylesOf("demo")).toHaveLength(0);
    });
});

describe("removeStylesOf", () => {
    it("removes every leftover stylesheet of that feature without touching others", () => {
        addStyle("alpha", ".a{}");
        addStyle("alpha", ".a{}");
        addStyle("beta", ".b{}");
        removeStylesOf("alpha");
        expect(stylesOf("alpha")).toHaveLength(0);
        expect(stylesOf("beta")).toHaveLength(1);
    });

    it("does not throw when nothing is left", () => {
        expect(() => removeStylesOf("ghost")).not.toThrow();
    });
});
