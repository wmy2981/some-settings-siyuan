/**
 * 代码块语言不记忆的实现。
 *
 * 做法：把 `window.siyuan.storage["local-codelang"]` 换成一个访问器属性，
 * getter 恒返回空串、setter 什么都不做。
 *
 * 为什么必须带 setter：内核在严格模式的模块里会给这个属性赋值
 * （`enter.ts` 把当前语言写回偏好、`index.ts` 在收到偏好推送时写内存），
 * 只定义 getter 的话赋值会抛 TypeError，直接打断代码块创建流程。
 *
 * 为什么必须幂等重贴：`window.siyuan.storage` 这个对象在启动阶段会被整体替换
 * （`getLocalStorage()` 里 `window.siyuan.storage = response.data`），
 * 而插件加载与它谁先谁后并不固定；此外内核在某些推送里会 `delete` 掉这个 key。
 * 所以除了挂载时贴一次，还在几个廉价时机补贴：ws-main 推送、文档加载完成，
 * 以及一个 2 秒的低频兜底。每次补贴只做一次属性描述符读取，没有可感知的开销。
 *
 * 卸载时把属性恢复成挂载前的样子（原本有值就还回原值，原本没有就删掉）。
 */
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";

const STORAGE_KEY = "local-codelang";

/** 兜底补贴间隔。只读一次属性描述符，开销可以忽略。 */
const REAPPLY_INTERVAL_MS = 2000;

interface StorageHost {
    siyuan?: {
        storage?: Record<string, unknown>;
    };
}

const storageOf = (): Record<string, unknown> | undefined =>
    (window as unknown as StorageHost).siyuan?.storage;

/** 挂载前该属性的原始描述符，用于卸载时还原。 */
let savedDescriptor: PropertyDescriptor | undefined;

const blankGetter = (): string => "";

const isPatched = (storage: Record<string, unknown>): boolean => {
    const descriptor = Object.getOwnPropertyDescriptor(storage, STORAGE_KEY);
    return Boolean(descriptor && descriptor.get === blankGetter);
};

const apply = (): void => {
    const storage = storageOf();
    if (!storage || isPatched(storage)) {
        return;
    }
    if (!savedDescriptor) {
        savedDescriptor = Object.getOwnPropertyDescriptor(storage, STORAGE_KEY);
    }
    try {
        Object.defineProperty(storage, STORAGE_KEY, {
            configurable: true,
            enumerable: true,
            get: blankGetter,
            set: () => undefined,
        });
    } catch (error) {
        console.warn("[some-settings-siyuan][code-block-lang-empty] 覆盖 local-codelang 失败", error);
    }
};

const restore = (): void => {
    const storage = storageOf();
    if (!storage || !isPatched(storage)) {
        savedDescriptor = undefined;
        return;
    }
    try {
        if (savedDescriptor) {
            Object.defineProperty(storage, STORAGE_KEY, savedDescriptor);
        } else {
            delete storage[STORAGE_KEY];
        }
    } catch (error) {
        console.warn("[some-settings-siyuan][code-block-lang-empty] 还原 local-codelang 失败", error);
    }
    savedDescriptor = undefined;
};

export const mountCodeBlockLangEmpty = (host: FeatureHost): FeatureInstance => {
    apply();

    // ws-main 覆盖绝大多数内核推送（包括其它窗口同步过来的偏好变更），
    // loaded-protyle-static 覆盖打开文档的时机，两者都在"马上要创建代码块"之前。
    host.addEventBus("ws-main", () => apply());
    host.addEventBus("loaded-protyle-static", () => apply());

    const timer = window.setInterval(apply, REAPPLY_INTERVAL_MS);

    return {
        destroy: () => {
            window.clearInterval(timer);
            restore();
        },
    };
};
