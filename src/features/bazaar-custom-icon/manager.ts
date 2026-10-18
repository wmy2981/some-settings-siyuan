/**
 * 「集市包自定义图标」的管理窗口。
 *
 * 入口是设置面板里的一行动作按钮，因此它不是在功能挂载时打开的：功能开关关着也能先配图标。
 * 列表来自内核的「已安装集市包」接口（插件 / 主题 / 图标 / 模板 / 组件五类），
 * 每个包都能选择本地图片、粘贴 base64，或恢复成集市包自带的图标。
 *
 * 改动立即生效，没有草稿：图标文件写进插件自己的 `icons/`，然后通知已经挂载的功能
 * 重新读一遍目录；集市列表下一次重绘时就会换成新图标。
 *
 * 保存图标会顺手打开本功能（它默认是关着的）：图标管理窗口是「动作行」，不受面板
 * 草稿的开关约束，用户既然已经配好了图标，就该立刻看到效果，而不是再去找一遍开关。
 * 打开动作立刻落盘，面板里的草稿也会同步，避免随后点「保存」把它覆盖回去。
 */
import {
    Dialog,
    fetchSyncPost,
    getFrontend,
    showMessage,
} from "siyuan";
import {reportError} from "../../core/error";
import {
    escapeHtml,
    isMobileFrontend,
} from "../../core/ui";
import {
    ICON_CHANGED_EVENT,
    imageFromBase64,
    imageFromFile,
    listIcons,
    readIconDataUrl,
    removeIcon,
    writeIcon,
    type IconFile,
    type IconImage,
} from "./icons";

type PackageType = "plugins" | "themes" | "icons" | "templates" | "widgets";

interface PackageTypeConfig {
    type: PackageType;
    api: string;
}

const PACKAGE_TYPES: PackageTypeConfig[] = [
    {type: "plugins", api: "/api/bazaar/getInstalledPlugin"},
    {type: "themes", api: "/api/bazaar/getInstalledTheme"},
    {type: "icons", api: "/api/bazaar/getInstalledIcon"},
    {type: "templates", api: "/api/bazaar/getInstalledTemplate"},
    {type: "widgets", api: "/api/bazaar/getInstalledWidget"},
];

interface InstalledPackage {
    type: PackageType;
    owner: string;
    name: string;
    label: string;
    iconURL: string;
}

interface KernelResponse {
    code?: number;
    msg?: string;
    data?: unknown;
}

interface IconManagerOptions {
    pluginName: string;
    i18n: (key: string) => string;
    /** 插件卸载时收掉这个窗口；函数返回取消注册的方法。 */
    onUnload: (listener: () => void) => () => void;
    /** 本功能此刻是否开着。 */
    isEnabled: () => boolean;
    /** 打开本功能（立即落盘并挂载）。 */
    enable: () => Promise<void>;
}

const CLASS = "ss-bazaar-icon-manager";

const CSS = `
.${CLASS}__tip {
    color: var(--b3-theme-on-surface);
    font-size: 12px;
    line-height: 18px;
    margin-bottom: 12px;
}

.${CLASS}__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.${CLASS}__row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: var(--b3-border-radius);
}

.${CLASS}__row:hover {
    background-color: var(--b3-list-hover);
}

/* 预览容器固定尺寸：原图标缺失、自定义图标加载失败时布局都不跳。 */
.${CLASS}__preview {
    align-items: center;
    background-color: var(--b3-theme-surface-lighter);
    border-radius: var(--b3-border-radius);
    color: var(--b3-theme-on-surface);
    display: flex;
    flex: 0 0 auto;
    height: 40px;
    justify-content: center;
    overflow: hidden;
    width: 40px;
}

.${CLASS}__preview img {
    height: 100%;
    object-fit: cover;
    width: 100%;
}

.${CLASS}__main {
    flex: 1;
    min-width: 0;
}

.${CLASS}__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.${CLASS}__meta {
    color: var(--b3-theme-on-surface);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.${CLASS}__state {
    color: var(--b3-theme-primary);
    flex: 0 0 auto;
    font-size: 12px;
}

.${CLASS}__actions {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
}

@media (max-width: 750px) {
    .${CLASS}__row {
        flex-wrap: wrap;
    }

    .${CLASS}__main {
        flex: 1 1 calc(100% - 60px);
    }

    .${CLASS}__actions {
        margin-inline-start: auto;
    }
}
`;

let openDialog: Dialog | undefined;

/** 打开管理窗口。同一个前端只保留一个，重复点按钮就把旧窗口收掉再开一个。 */
export const openIconManager = (options: IconManagerOptions): void => {
    openDialog?.destroy();

    const {pluginName, i18n: t} = options;
    let dialog: Dialog | undefined;
    let offUnload: (() => void) | undefined;
    let packages: InstalledPackage[] = [];
    let icons: IconFile[] = [];
    let dataUrls = new Map<string, string>();
    let pending: {owner: string; name: string;} | undefined;
    let loading = true;
    let failed = false;

    const iconOf = (pkg: InstalledPackage): IconFile | undefined =>
        icons.find((icon) => icon.owner === pkg.owner && icon.name === pkg.name);

    const notifyChanged = (): void => {
        document.dispatchEvent(new CustomEvent(ICON_CHANGED_EVENT));
    };

    const reloadIcons = async (): Promise<void> => {
        icons = await listIcons(pluginName);
        const loaded = await Promise.all(icons.map(async (icon) => {
            try {
                return [icon.fileName, await readIconDataUrl(icon)] as const;
            } catch (error) {
                // 一张读不出来不该让整个窗口打不开，退回原图标即可
                console.warn(`[some-settings-siyuan] cannot read custom icon ${icon.fileName}`, error);
                return undefined;
            }
        }));
        dataUrls = new Map(loaded.filter((item): item is readonly [string, string] => Boolean(item)));
    };

    const previewSrc = (pkg: InstalledPackage, icon: IconFile | undefined): string => {
        if (icon) {
            return dataUrls.get(icon.fileName) || pkg.iconURL;
        }
        return pkg.iconURL;
    };

    const rowHtml = (pkg: InstalledPackage): string => {
        const icon = iconOf(pkg);
        const src = previewSrc(pkg, icon);
        const typeLabel = t(`bazaarIcon.type.${pkg.type}`);
        const preview = src ?
            `<img src="${escapeHtml(src)}" alt="" loading="lazy">` :
            '<svg><use xlink:href="#iconBazaar"></use></svg>';
        return `<div class="${CLASS}__row" data-owner="${escapeHtml(pkg.owner)}" data-name="${escapeHtml(pkg.name)}">
    <span class="${CLASS}__preview">${preview}</span>
    <div class="${CLASS}__main">
        <div class="${CLASS}__title">${escapeHtml(pkg.label)}</div>
        <div class="${CLASS}__meta">${escapeHtml(`${pkg.owner}/${pkg.name} · ${typeLabel}`)}</div>
    </div>
    <span class="${CLASS}__state">${icon ? escapeHtml(t("bazaarIcon.customized")) : ""}</span>
    <div class="${CLASS}__actions">
        <button class="b3-button b3-button--outline b3-button--small" type="button" data-action="pick">${
            escapeHtml(t("bazaarIcon.pick"))
        }</button>
        <button class="b3-button b3-button--text b3-button--small" type="button" data-action="base64">${
            escapeHtml(t("bazaarIcon.base64"))
        }</button>
        ${
            icon ?
                `<button class="b3-button b3-button--text b3-button--small" type="button" data-action="reset">${
                    escapeHtml(t("bazaarIcon.reset"))
                }</button>` :
                ""
        }
    </div>
</div>`;
    };

    const render = (): void => {
        const list = dialog?.element.querySelector<HTMLElement>("[data-list]");
        if (!list) {
            return;
        }
        if (loading) {
            list.innerHTML = `<div class="${CLASS}__tip">${escapeHtml(t("bazaarIcon.loading"))}</div>`;
            return;
        }
        if (failed) {
            list.innerHTML = `<div class="${CLASS}__tip">${escapeHtml(t("bazaarIcon.failed"))}
    <button class="b3-button b3-button--outline b3-button--small" type="button" data-retry>${
                escapeHtml(t("bazaarIcon.retry"))
            }</button></div>`;
            return;
        }
        if (packages.length === 0) {
            list.innerHTML = `<div class="${CLASS}__tip">${escapeHtml(t("bazaarIcon.empty"))}</div>`;
            return;
        }
        list.innerHTML = packages.map(rowHtml).join("");
    };

    const fetchPackages = async (): Promise<InstalledPackage[]> => {
        const results = await Promise.all(PACKAGE_TYPES.map(async (config) => {
            const response: KernelResponse = await fetchSyncPost(
                config.api,
                {frontend: getFrontend(), keyword: ""},
                undefined,
                false,
            );
            if (response.code !== 0) {
                throw new Error(
                    `${config.api}: code ${String(response.code)}${response.msg ? `: ${response.msg}` : ""}`,
                );
            }
            const items = (response.data as {packages?: unknown;} | undefined)?.packages;
            if (!Array.isArray(items)) {
                return [] as InstalledPackage[];
            }
            return items.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
                .filter((item) => !item.invalidReason)
                .map<InstalledPackage | undefined>((item) => {
                    const owner = typeof item.author === "string" ? item.author.trim() : "";
                    const name = typeof item.name === "string" ? item.name.trim() : "";
                    if (!owner || !name) {
                        return undefined;
                    }
                    return {
                        type: config.type,
                        owner,
                        name,
                        label: typeof item.preferredName === "string" && item.preferredName ?
                            item.preferredName :
                            name,
                        iconURL: typeof item.iconURL === "string" ? item.iconURL : "",
                    };
                })
                .filter((item): item is InstalledPackage => Boolean(item));
        }));
        const order = new Map(PACKAGE_TYPES.map((config, index) => [config.type, index]));
        return results.flat().sort((left, right) =>
            (order.get(left.type) ?? 0) - (order.get(right.type) ?? 0) ||
            left.label.localeCompare(right.label)
        );
    };

    const reload = async (): Promise<void> => {
        loading = true;
        failed = false;
        render();
        try {
            const [nextPackages] = await Promise.all([fetchPackages(), reloadIcons()]);
            packages = nextPackages;
        } catch (error) {
            reportError("bazaar-custom-icon.list", error);
            packages = [];
            failed = true;
        } finally {
            loading = false;
            render();
        }
    };

    const save = async (
        owner: string,
        name: string,
        image: IconImage,
    ): Promise<void> => {
        try {
            await writeIcon(pluginName, owner, name, image);
            await reloadIcons();
            render();
            // 功能默认关着：光把文件写进去，集市列表不会发生任何变化。保存图标本身就是
            // 「我要用它」的表达，所以这里直接打开功能，并让提示把这件事说清楚。
            let enabledNow = false;
            if (!options.isEnabled()) {
                await options.enable();
                enabledNow = true;
            }
            notifyChanged();
            showMessage(t(enabledNow ? "bazaarIcon.savedAndEnabled" : "bazaarIcon.saved"), 3000);
        } catch (error) {
            reportError("bazaar-custom-icon.save", error);
        }
    };

    const reset = async (owner: string, name: string): Promise<void> => {
        const matches = icons.filter((icon) => icon.owner === owner && icon.name === name);
        try {
            for (const icon of matches) {
                await removeIcon(icon);
            }
            await reloadIcons();
            render();
            notifyChanged();
            showMessage(t("bazaarIcon.removed"), 2000);
        } catch (error) {
            reportError("bazaar-custom-icon.reset", error);
        }
    };

    const openBase64Dialog = (owner: string, name: string): void => {
        let nested: Dialog | undefined;
        nested = new Dialog({
            title: t("bazaarIcon.base64Title"),
            content: `<div class="b3-dialog__content">
    <style>${CSS}</style>
    <div class="${CLASS}__tip">${escapeHtml(t("bazaarIcon.base64Tip"))}</div>
    <textarea class="b3-text-field fn__block" data-text spellcheck="false" rows="6"
        placeholder="${escapeHtml(t("bazaarIcon.base64Placeholder"))}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" type="button" data-cancel>${
                escapeHtml(t("bazaarIcon.cancel"))
            }</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" type="button" data-confirm>${escapeHtml(t("bazaarIcon.confirm"))}</button>
</div>`,
            width: isMobileFrontend() ? "92vw" : "520px",
            destroyCallback: () => {
                nested = undefined;
            },
        });
        const element = nested.element;
        element.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => nested?.destroy());
        element.querySelector<HTMLButtonElement>("[data-confirm]")?.addEventListener("click", () => {
            const text = element.querySelector<HTMLTextAreaElement>("[data-text]")?.value ?? "";
            try {
                const image = imageFromBase64(text);
                nested?.destroy();
                void save(owner, name, image);
            } catch (error) {
                reportError("bazaar-custom-icon.base64", error, false);
                showMessage(t("bazaarIcon.invalid"), 5000, "error");
            }
        });
        element.querySelector<HTMLTextAreaElement>("[data-text]")?.focus();
    };

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.svg";
    input.className = "fn__none";
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        const target = pending;
        input.value = "";
        pending = undefined;
        if (!file || !target) {
            return;
        }
        void imageFromFile(file).then((image) => save(target.owner, target.name, image)).catch((error: unknown) => {
            reportError("bazaar-custom-icon.pick", error, false);
            showMessage(t("bazaarIcon.invalid"), 5000, "error");
        });
    });

    dialog = new Dialog({
        title: t("bazaarIcon.title"),
        content: `<div class="b3-dialog__content">
    <style>${CSS}</style>
    <div class="${CLASS}__tip">${escapeHtml(t("bazaarIcon.tip"))}</div>
    <div class="${CLASS}__list" data-list></div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" type="button" data-close>${escapeHtml(t("bazaarIcon.close"))}</button>
</div>`,
        width: isMobileFrontend() ? "92vw" : "720px",
        height: "82vh",
        destroyCallback: () => {
            offUnload?.();
            offUnload = undefined;
            dialog = undefined;
            openDialog = undefined;
            input.remove();
        },
    });
    openDialog = dialog;
    offUnload = options.onUnload(() => dialog?.destroy());
    dialog.element.append(input);

    dialog.element.querySelector<HTMLButtonElement>("[data-close]")?.addEventListener("click", () => dialog?.destroy());

    // 行内按钮用事件委托：列表每次保存后都会整块重绘，逐行绑事件会留下悬空监听
    dialog.element.querySelector<HTMLElement>("[data-list]")?.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action], [data-retry]");
        if (!button) {
            return;
        }
        if (button.dataset.retry !== undefined) {
            void reload();
            return;
        }
        const row = button.closest<HTMLElement>(`.${CLASS}__row`);
        const owner = row?.dataset.owner;
        const name = row?.dataset.name;
        if (!owner || !name) {
            return;
        }
        const action = button.dataset.action;
        if (action === "pick") {
            pending = {owner, name};
            input.value = "";
            input.click();
        } else if (action === "base64") {
            openBase64Dialog(owner, name);
        } else if (action === "reset") {
            void reset(owner, name);
        }
    });

    render();
    void reload();
};
