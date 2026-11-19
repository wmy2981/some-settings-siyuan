// @vitest-environment node
/**
 * `core/patch.ts`：用户级声明补丁。
 *
 * 两件事必须分开验证：
 * - **覆盖语义**：每个字段单独生效，省略沿用源码声明，`null` 解除限制，空数组表示两端都不适用；
 * - **整份回退**：任何一处不合法都让整份补丁不生效，不留下「一半套用了补丁」的中间状态，
 *   而且失败只换来一条提示，绝不影响插件启动。
 */
import type {Plugin} from "siyuan";
import {
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {setDetailedLogging} from "../../src/core/log";
import {
    applyPatch,
    loadPatch,
    PATCH_STORAGE_NAME,
    reportPatch,
} from "../../src/core/patch";
import type {PatchLocale} from "../../src/core/patch";
import type {FeatureDefinition} from "../../src/core/types";

const settings = [{kind: "switch", key: "enabled", title: "common.enabled", default: false}] as const;

const featureOf = (id: string, extra: Partial<FeatureDefinition> = {}): FeatureDefinition => ({
    id,
    category: "editor",
    name: `feature.${id}.title`,
    enabled: true,
    settings: [...settings],
    ...extra,
});

/** 一份最小注册表：两个可用功能，外加一个开发者已经撤下的功能。 */
const DEFINITIONS: FeatureDefinition[] = [
    featureOf("alpha"),
    featureOf("beta", {frontends: ["desktop"], minAppVersion: "3.8.0", maxAppVersion: "3.9.0"}),
    featureOf("retired", {enabled: false}),
];

/** 宿主此刻的界面语言与它加载的那份文案：补丁的 i18n 段按它挑语言、按它认键。 */
const LOCALE: PatchLocale = {
    lang: "en",
    messages: {
        "feature.alpha.title": "Alpha",
        "feature.alpha.description": "The alpha feature",
        "feature.beta.title": "Beta",
    },
};

const apply = (text: string, locale: PatchLocale = LOCALE): ReturnType<typeof applyPatch> =>
    applyPatch(DEFINITIONS, text, locale);

const patchedView = (text: string): FeatureDefinition[] => {
    const outcome = apply(text);
    if (outcome.kind !== "applied") {
        throw new Error(`expected the patch to be applied, got ${outcome.kind}: ${outcome.detail}`);
    }
    return outcome.features;
};

const detailOf = (text: string): string => {
    const outcome = apply(text);
    if (outcome.kind !== "failed") {
        throw new Error(`expected the patch to be rejected, got ${outcome.kind}`);
    }
    return outcome.detail;
};

const byId = (features: FeatureDefinition[], id: string): FeatureDefinition => {
    const found = features.find((feature) => feature.id === id);
    if (!found) {
        throw new Error(`${id} is missing from the view`);
    }
    return found;
};

describe("applyPatch: nothing to override", () => {
    it("an empty or comment-only file overrides nothing", () => {
        expect(apply("").kind).toBe("none");
        expect(apply("# nothing here\n").kind).toBe("none");
    });

    it("an empty features mapping overrides nothing", () => {
        expect(apply("features: {}\n").kind).toBe("none");
        expect(apply("features:\n").kind).toBe("none");
    });
});

describe("applyPatch: overriding", () => {
    it("counts the overridden features and builds a full view", () => {
        const outcome = apply("features:\n  alpha:\n    enabled: false\n");
        expect(outcome.kind).toBe("applied");
        expect(outcome.kind === "applied" && outcome.count).toBe(1);
        expect(patchedView("features:\n  alpha:\n    enabled: false\n")).toHaveLength(DEFINITIONS.length);
    });

    it("leaves the source declarations untouched and reuses them for unpatched features", () => {
        const view = patchedView("features:\n  alpha:\n    enabled: false\n");
        // 源码声明一个字段都没变（尤其是那个补丁没点名的 beta 与 retired）
        expect(DEFINITIONS[0].enabled).toBe(true);
        expect(DEFINITIONS[0].fromPatch).toBeUndefined();
        // 没被补丁改过的功能原样引用，不必复制
        expect(byId(view, "beta")).toBe(DEFINITIONS[1]);
        expect(byId(view, "alpha")).not.toBe(DEFINITIONS[0]);
    });

    it("disables a feature and marks the reason as the user's", () => {
        const alpha = byId(patchedView("features:\n  alpha:\n    enabled: false\n"), "alpha");
        expect(alpha.enabled).toBe(false);
        expect(alpha.fromPatch).toEqual({enabled: false});
    });

    it("re-enables a feature the developer turned off", () => {
        const retired = byId(patchedView("features:\n  retired:\n    enabled: true\n"), "retired");
        expect(retired.enabled).toBe(true);
        // 补丁把它打开了：不再是「已被开发者禁用」
        expect(retired.fromPatch).toEqual({enabled: true});
    });

    it("moves a feature to another category", () => {
        const alpha = byId(patchedView("features:\n  alpha:\n    category: ai\n"), "alpha");
        expect(alpha.category).toBe("ai");
    });

    it("overrides the frontends, including the empty list that applies nowhere", () => {
        expect(byId(patchedView("features:\n  beta:\n    frontends: [mobile]\n"), "beta").frontends)
            .toEqual(["mobile"]);
        expect(byId(patchedView("features:\n  beta:\n    frontends: []\n"), "beta").frontends).toEqual([]);
        // 块状列表是同一个意思
        expect(byId(patchedView("features:\n  beta:\n    frontends:\n      - mobile\n"), "beta").frontends)
            .toEqual(["mobile"]);
    });

    it("removes the frontend restriction with null", () => {
        expect(byId(patchedView("features:\n  beta:\n    frontends: null\n"), "beta").frontends).toBeUndefined();
    });

    it("sets and removes both version bounds", () => {
        const beta = byId(patchedView('features:\n  beta:\n    minAppVersion: "3.8.7"\n'), "beta");
        expect(beta.minAppVersion).toBe("3.8.7");
        // 没写的字段保持源码声明
        expect(beta.maxAppVersion).toBe("3.9.0");
        const cleared = byId(
            patchedView("features:\n  beta:\n    minAppVersion: null\n    maxAppVersion:\n"),
            "beta",
        );
        expect(cleared.minAppVersion).toBeUndefined();
        expect(cleared.maxAppVersion).toBeUndefined();
    });

    it("applies overrides to several features at once", () => {
        const view = patchedView(
            "features:\n  alpha:\n    enabled: false\n    category: doc-tree\n  beta:\n    maxAppVersion: null\n",
        );
        expect(byId(view, "alpha").category).toBe("doc-tree");
        expect(byId(view, "alpha").enabled).toBe(false);
        expect(byId(view, "beta").maxAppVersion).toBeUndefined();
    });
});

describe("applyPatch: i18n overrides", () => {
    it("overrides a translation of the current language", () => {
        const outcome = apply('i18n:\n  en:\n    feature.alpha.title: "Alpha patched"\n');
        expect(outcome.kind).toBe("applied");
        expect(outcome.kind === "applied" && outcome.translations).toEqual({"feature.alpha.title": "Alpha patched"});
        expect(outcome.kind === "applied" && outcome.count).toBe(0);
        // 只改文案：声明视图里的功能原样引用，没有复制也没有动过
        expect(outcome.kind === "applied" && outcome.features[0]).toBe(DEFINITIONS[0]);
    });

    it("applies only the section of the current language", () => {
        const outcome = apply(
            'i18n:\n  en:\n    feature.alpha.title: "Alpha en"\n  zh-CN:\n    feature.alpha.title: "Alpha zh"\n',
        );
        expect(outcome.kind === "applied" && outcome.translations).toEqual({"feature.alpha.title": "Alpha en"});
    });

    it("accepts the legacy underscore spelling of the language code", () => {
        const outcome = apply('i18n:\n  zh_CN:\n    feature.alpha.title: "Alpha zh"\n', {
            lang: "zh-CN",
            messages: LOCALE.messages,
        });
        expect(outcome.kind === "applied" && outcome.translations).toEqual({"feature.alpha.title": "Alpha zh"});
    });

    it("keeps values verbatim, so the code that uses them still fills in the {…} placeholders", () => {
        const outcome = apply('i18n:\n  en:\n    feature.alpha.description: "Only available on {platform}"\n');
        expect(outcome.kind === "applied" && outcome.translations["feature.alpha.description"])
            .toBe("Only available on {platform}");
    });

    it("rejects an i18n section that is not a mapping", () => {
        expect(detailOf("i18n: [en]\n")).toContain("must map language codes");
        expect(detailOf("i18n:\n  en: nope\n")).toContain("must map translation keys");
    });

    it("rejects a value that is not a string", () => {
        expect(detailOf("i18n:\n  en:\n    feature.alpha.title: true\n")).toContain("must be a string");
    });

    it("applies feature overrides and translations in the same file", () => {
        const outcome = apply(
            'features:\n  alpha:\n    enabled: false\ni18n:\n  en:\n    feature.alpha.title: "Alpha"\n',
        );
        expect(outcome.kind).toBe("applied");
        expect(outcome.kind === "applied" && outcome.count).toBe(1);
        expect(outcome.kind === "applied" && outcome.features[0].enabled).toBe(false);
        expect(outcome.kind === "applied" && outcome.translations).toEqual({"feature.alpha.title": "Alpha"});
    });

    it("an i18n-only patch leaves every declaration untouched", () => {
        const outcome = apply('i18n:\n  en:\n    feature.alpha.title: "A"\n');
        expect(outcome.kind === "applied" && outcome.features.every((feature, index) => feature === DEFINITIONS[index]))
            .toBe(true);
    });

    it("a section for another language overrides nothing", () => {
        expect(apply('i18n:\n  zh-TW:\n    feature.alpha.title: "A"\n').kind).toBe("none");
    });
});

describe("applyPatch: unknown entries are skipped", () => {
    it("skips an unknown feature id but still applies the other entries", () => {
        const outcome = apply("features:\n  nosuch:\n    enabled: false\n  alpha:\n    enabled: false\n");
        expect(outcome.kind).toBe("applied");
        expect(outcome.kind === "applied" && outcome.count).toBe(1);
        expect(outcome.kind === "applied" && outcome.features[0].enabled).toBe(false);
        // 被跳过的 id 只记下来给日志用
        expect(outcome.kind === "applied" && outcome.ignored.features).toEqual(["nosuch"]);
    });

    it("skips an unknown i18n key but still applies the other translations", () => {
        const outcome = apply('i18n:\n  en:\n    nosuch.key: "x"\n    feature.alpha.title: "Alpha"\n');
        expect(outcome.kind).toBe("applied");
        expect(outcome.kind === "applied" && outcome.translations).toEqual({"feature.alpha.title": "Alpha"});
        expect(outcome.kind === "applied" && outcome.ignored.translations).toEqual(["nosuch.key"]);
    });

    it("does not validate the body of an unknown feature id", () => {
        // id 不存在时整条跳过：里面写成什么都不会连累别的条目
        const outcome = apply("features:\n  nosuch: false\n  alpha:\n    enabled: false\n");
        expect(outcome.kind).toBe("applied");
        expect(outcome.kind === "applied" && outcome.count).toBe(1);
    });

    it("a patch that only names unknown entries overrides nothing", () => {
        expect(apply("features:\n  nosuch:\n    enabled: false\n").kind).toBe("none");
        expect(apply('i18n:\n  en:\n    nosuch.key: "x"\n').kind).toBe("none");
    });

    it("a known entry with a bad value still invalidates the whole file", () => {
        // 跳过只针对「找不到对象」；找到了却写错，仍旧整份作废
        expect(detailOf('features:\n  alpha:\n    enabled: "false"\n')).toContain("must be true or false");
    });
});

describe("applyPatch: the whole file is rejected", () => {
    it("a YAML syntax error", () => {
        expect(detailOf("features: [oops\n")).toContain("must end with");
    });

    it("an unknown top-level key", () => {
        expect(detailOf("feature: {}\n")).toContain("unknown top-level key");
    });

    it("a features value that is not a mapping", () => {
        expect(detailOf("features: [alpha]\n")).toContain("must map feature ids to overrides");
    });

    it("an entry that is not a mapping", () => {
        expect(detailOf("features:\n  alpha: false\n")).toContain("must map its fields");
    });

    it("an unknown field", () => {
        expect(detailOf("features:\n  alpha:\n    settings: []\n")).toContain("unknown field");
    });

    it("a field of the wrong type", () => {
        expect(detailOf('features:\n  alpha:\n    enabled: "false"\n')).toContain("must be true or false");
        expect(detailOf("features:\n  alpha:\n    category: 3\n")).toContain("category must be one of");
        expect(detailOf("features:\n  alpha:\n    frontends: desktop\n")).toContain("must be a list");
        expect(detailOf("features:\n  alpha:\n    minAppVersion: 3.8\n")).toContain("must be a version");
    });

    it("an unknown category", () => {
        expect(detailOf("features:\n  alpha:\n    category: nowhere\n")).toContain("category must be one of");
    });

    it("an unknown or duplicated frontend", () => {
        expect(detailOf("features:\n  alpha:\n    frontends: [tablet]\n")).toContain(
            "may only contain desktop / mobile",
        );
        expect(detailOf("features:\n  alpha:\n    frontends: [desktop, desktop]\n")).toContain("twice");
    });

    it("an empty range declared by the patch itself", () => {
        expect(detailOf('features:\n  alpha:\n    minAppVersion: "3.9.0"\n    maxAppVersion: "3.8.0"\n'))
            .toContain("above maxAppVersion");
    });

    it("an empty range produced together with the source declaration", () => {
        // beta 源码下限是 3.8.0：补丁把上限压到 3.7.0 就是一个空区间
        expect(detailOf('features:\n  beta:\n    maxAppVersion: "3.7.0"\n')).toContain("above maxAppVersion");
        // 而解除下限之后，同一份补丁就合法了
        expect(
            apply(
                'features:\n  beta:\n    minAppVersion: null\n    maxAppVersion: "3.7.0"\n',
            ).kind,
        ).toBe("applied");
    });

    it("one bad entry invalidates the good ones too", () => {
        const outcome = applyPatch(
            DEFINITIONS,
            "features:\n  alpha:\n    enabled: false\n  beta:\n    category: nowhere\n",
        );
        expect(outcome.kind).toBe("failed");
        // 没有任何「部分视图」交出去：调用方只能整份退回源码声明
        expect(outcome).not.toHaveProperty("features");
    });
});

describe("loadPatch", () => {
    /** 宿主播件：只实现 loadPatch 用到的 loadData。 */
    const hostWith = (read: () => Promise<unknown>): Plugin =>
        ({
            name: "some-settings-siyuan",
            loadData: vi.fn(read),
        }) as unknown as Plugin;

    it("reads the patch file from the plugin storage by its fixed name", async () => {
        const loadData = vi.fn(async () => "features:\n  alpha:\n    enabled: false\n");
        const host = {name: "some-settings-siyuan", loadData} as unknown as Plugin;
        const outcome = await loadPatch(host, DEFINITIONS);
        expect(loadData).toHaveBeenCalledWith(PATCH_STORAGE_NAME);
        expect(PATCH_STORAGE_NAME).toBe(".patch.yml");
        expect(outcome.kind).toBe("applied");
    });

    it("writes the translations into the i18n object the host already loaded", async () => {
        const i18n: Record<string, unknown> = {"feature.alpha.title": "Alpha"};
        const host = {
            name: "some-settings-siyuan",
            i18n,
            loadData: vi.fn(async () => 'i18n:\n  en:\n    feature.alpha.title: "Patched"\n'),
        } as unknown as Plugin;
        const outcome = await loadPatch(host, DEFINITIONS);
        expect(outcome.kind).toBe("applied");
        expect(i18n["feature.alpha.title"]).toBe("Patched");
    });

    it("a missing file is a normal state, not an error", async () => {
        // 宿主对不存在的文件兑现空串
        await expect(loadPatch(hostWith(async () => ""), DEFINITIONS)).resolves.toMatchObject({kind: "none"});
        await expect(loadPatch(hostWith(async () => undefined), DEFINITIONS)).resolves.toMatchObject({kind: "none"});
    });

    it("a read failure becomes a failure outcome instead of an exception", async () => {
        const outcome = await loadPatch(
            hostWith(async () => {
                throw new Error("io error");
            }),
            DEFINITIONS,
        );
        expect(outcome).toMatchObject({kind: "failed"});
        expect(outcome.kind === "failed" && outcome.detail).toContain("io error");
    });

    it("a file that is not plain text is rejected", async () => {
        expect(await loadPatch(hostWith(async () => ({features: {}})), DEFINITIONS))
            .toMatchObject({kind: "failed"});
    });

    it("does not log by itself: it runs before any feature has mounted", async () => {
        // 详细日志是「日志输出」功能挂载时打开的，读补丁那一刻它还没挂 —— 在这里打日志等于不写
        setDetailedLogging(true);
        const warn = vi.mocked(console.warn);
        const info = vi.mocked(console.log);
        warn.mockClear();
        info.mockClear();
        try {
            await loadPatch(hostWith(async () => "features:\n  nosuch:\n    enabled: false\n"), DEFINITIONS);
        } finally {
            setDetailedLogging(false);
        }
        expect(warn).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
    });
});

describe("reportPatch", () => {
    const withLogging = (run: () => void): void => {
        setDetailedLogging(true);
        try {
            run();
        } finally {
            setDetailedLogging(false);
        }
    };

    it("warns about a failure without echoing the file content", () => {
        const warn = vi.mocked(console.warn);
        warn.mockClear();
        withLogging(() => reportPatch({kind: "failed", detail: 'line 3: unknown field "settings"'}));
        expect(warn).toHaveBeenCalledTimes(1);
        const line = String(warn.mock.calls[0][0]);
        expect(line).toContain("unknown field");
        expect(line).toContain(PATCH_STORAGE_NAME);
    });

    it("stays quiet while detailed logging is off", () => {
        const warn = vi.mocked(console.warn);
        const info = vi.mocked(console.log);
        warn.mockClear();
        info.mockClear();
        reportPatch({kind: "failed", detail: "boom"});
        reportPatch({
            kind: "applied",
            features: [],
            count: 2,
            translations: {},
            ignored: {features: [], translations: []},
        });
        reportPatch({kind: "none", detail: "missing"});
        expect(warn).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
    });

    it("names the entries it skipped so a typo can be traced", () => {
        const info = vi.mocked(console.log);
        info.mockClear();
        withLogging(() => {
            reportPatch({
                kind: "applied",
                features: [],
                count: 0,
                translations: {},
                ignored: {features: ["nosuch"], translations: ["nosuch.key"]},
            });
            reportPatch({
                kind: "none",
                detail: "the patch overrides nothing",
                ignored: {features: ["nosuch"], translations: []},
            });
        });
        expect(String(info.mock.calls[1][0])).toContain("skipped unknown feature id(s): nosuch");
        expect(String(info.mock.calls[2][0])).toContain("skipped unknown i18n key(s): nosuch.key");
        expect(String(info.mock.calls[4][0])).toContain("skipped unknown feature id(s): nosuch");
    });

    it("logs the applied count and the no-patch case at INFO level", () => {
        const info = vi.mocked(console.log);
        info.mockClear();
        withLogging(() => {
            reportPatch({
                kind: "applied",
                features: [],
                count: 2,
                translations: {},
                ignored: {features: [], translations: []},
            });
            reportPatch({kind: "none", detail: "missing"});
        });
        expect(info).toHaveBeenCalledTimes(2);
        expect(String(info.mock.calls[0][0])).toContain("applied");
        expect(String(info.mock.calls[1][0])).toContain("no feature declaration is patched");
    });
});
