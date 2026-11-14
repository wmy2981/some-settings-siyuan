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
    it("往 head 追加一份带 owner 标记的样式表", () => {
        addStyle("demo", ".a{color:red}");
        const styles = stylesOf("demo");
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toBe(".a{color:red}");
    });

    it("空白 CSS 不建元素，返回幂等的空撤销函数", () => {
        const remove = addStyle("demo", "   \n\t ");
        expect(stylesOf("demo")).toHaveLength(0);
        expect(() => {
            remove();
            remove();
        }).not.toThrow();
    });

    it("同一个 owner 重复调用只更新内容，不堆叠样式表", () => {
        const remove = addStyle("demo", ".a{color:red}");
        addStyle("demo", ".a{color:blue}");
        const styles = stylesOf("demo");
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toBe(".a{color:blue}");
        remove();
        expect(stylesOf("demo")).toHaveLength(0);
    });

    it("不同功能各有自己的样式表", () => {
        addStyle("alpha", ".a{}");
        addStyle("beta", ".b{}");
        expect(stylesOf("alpha")).toHaveLength(1);
        expect(stylesOf("beta")).toHaveLength(1);
    });

    it("页面里已有同一份样式表时复用，不重复注入", () => {
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

    it("页面里残留多份同一 owner 的样式表时只留最后一份并改写它", () => {
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

    it("宿主清掉 head 之后重新注入会新建一份样式表", () => {
        addStyle("demo", ".a{color:red}");
        document.head.innerHTML = "";
        addStyle("demo", ".a{color:blue}");
        const styles = stylesOf("demo");
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toBe(".a{color:blue}");
    });

    it("撤销函数可以安全调用多次", () => {
        const remove = addStyle("demo", ".a{}");
        remove();
        expect(() => remove()).not.toThrow();
        expect(stylesOf("demo")).toHaveLength(0);
    });
});

describe("removeStylesOf", () => {
    it("清掉该功能残留的全部样式表，别的功能不受影响", () => {
        addStyle("alpha", ".a{}");
        addStyle("alpha", ".a{}");
        addStyle("beta", ".b{}");
        removeStylesOf("alpha");
        expect(stylesOf("alpha")).toHaveLength(0);
        expect(stylesOf("beta")).toHaveLength(1);
    });

    it("没有残留时也不报错", () => {
        expect(() => removeStylesOf("ghost")).not.toThrow();
    });
});
