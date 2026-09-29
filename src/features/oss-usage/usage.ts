/**
 * 功能：在思源的 S3 存储配置页给阿里云 OSS 的桶加一个「使用数据」入口。
 *
 * 位置与可见性：按钮插在 S3 表单自己的动作区里（与「清空云端存储数据」「导入 / 导出」
 * 同一行），只有**已保存的** Endpoint 落在阿里云域名下时才出现 —— 查询用的也是这份已保存的
 * 凭据，两边同源才不会出现「按钮在、查的是另一套配置」。内核的这份表单在切换服务商、
 * 导入配置、设置搜索时都会被整体重写，所以按钮靠一个 MutationObserver 重新插回去（幂等）。
 *
 * 数据来源是阿里云 OSS 的 GetBucketStat（`GET /?stat`）：返回桶的存储量、对象数、
 * 未完成分片数与各存储类型的明细。签名照抄官方浏览器 SDK（ali-oss）的 V1 方案：
 *
 *   待签字符串 = 方法 \n Content-MD5 \n Content-Type \n Date \n 规范化 x-oss-* 头 \n 规范化资源
 *
 * 两处必须按 SDK 的写法来，不能凭直觉改：
 * 1. **浏览器不允许设置 `Date` 请求头**（fetch 的 forbidden header），所以时间用
 *    `x-oss-date` 传：待签字符串的 Date 那一格填它的值，同时它本身作为一个 x-oss-* 头
 *    再出现一次（官方 SDK 的 buildCanonicalString 就是这个顺序）；
 * 2. 规范化资源是 `/<bucket>/?stat`，虚拟主机风格与 path 风格**都是这一个**
 *    （子资源按字典序排列，无值时不带 `=`）。
 *
 * 请求由渲染进程直接发出（与 DeepSeek 余额那条路一样），因此受同源策略约束：
 * 桌面客户端关掉了 web security，直连不会被拦；移动端 / 浏览器 / 连接远程内核时需要在桶上
 * 配 CORS 规则，否则跨域预检就被拒。那一种失败在这里明确提示，不装作"没有数据"。
 */
import {Dialog} from "siyuan";
import {guardSilent} from "../../core/error";
import {isMobile} from "../../core/frontend";
import type {
    FeatureHost,
    FeatureInstance,
} from "../../core/types";
import {escapeHtml} from "../../core/ui";

/** 内核那份 S3 表单的容器，以及它末尾动作区里我们那个按钮的标记。 */
const PROVIDER_CONFIG_ID = "syncProviderConfig";
const BUTTON_ATTR = "data-ss-oss-usage";
/** 我们自己的类名前缀：弹窗里的行与值都靠它，不碰内核的行样式。 */
const CLASS = "ss-oss-usage";
/** 只认阿里云 OSS 的域名后缀。 */
const ALIYUN_SUFFIX = "aliyuncs.com";
/** 内核给 S3 配的超时字段范围（秒），这里照着夹一次。 */
const MIN_TIMEOUT_SECONDS = 7;
const MAX_TIMEOUT_SECONDS = 300;
const DEFAULT_TIMEOUT_SECONDS = 30;
/** 存储量的换算单位，1024 进制，与阿里云控制台一致。 */
const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

const DIALOG_CSS = `
.${CLASS}__head {
    color: var(--b3-theme-on-surface);
    font-size: 12px;
    line-height: 16px;
    word-break: break-all;
}
.${CLASS}__row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--b3-border-color);
}
.${CLASS}__row:last-child {
    border-bottom: 0;
}
.${CLASS}__key {
    flex: 0 0 auto;
    min-width: 7rem;
    color: var(--b3-theme-on-surface);
}
.${CLASS}__value {
    flex: 1;
    min-width: 0;
    word-break: break-all;
    -webkit-user-select: text;
    user-select: text;
}
.${CLASS}__error {
    color: var(--b3-theme-error);
    word-break: break-all;
    -webkit-user-select: text;
    user-select: text;
}
.${CLASS}__tip {
    margin-top: 8px;
    color: var(--b3-theme-on-surface);
    font-size: 12px;
    line-height: 18px;
}
`;

/** 已保存的 S3 配置里，这次查询真正需要的几项。 */
interface OssTarget {
    bucket: string;
    protocol: string;
    host: string;
    pathStyle: boolean;
    accessKey: string;
    secretKey: string;
    timeoutSeconds: number;
}

/** 各存储类型的明细：label 是 i18n key。 */
interface StorageClass {
    label: string;
    storage: number;
    objectCount: number;
}

interface BucketStat {
    storage: number;
    objectCount: number;
    multipartUploadCount: number;
    /** 统计时间（Unix 秒）；接口没有返回时为 0。 */
    lastModifiedTime: number;
    classes: StorageClass[];
}

/**
 * 一次查询的结果：成功带 `stat`，失败带 `message`。
 *
 * 刻意不用「`ok: true` / `ok: false`」那种判别式联合：本工程的 tsconfig 关掉了
 * `strictNullChecks`，布尔字面量在那里会被放宽成 `boolean`，判别式联合就再也收窄不了。
 */
interface StatResult {
    stat?: BucketStat;
    /** 失败原因。 */
    message?: string;
    /** 请求没能发出去（网络不通或跨域被拦），而不是服务端明确报错。 */
    network?: boolean;
}

const readS3Config = (): Record<string, unknown> | undefined => {
    const s3 = window.siyuan?.config?.sync?.s3 as unknown as Record<string, unknown> | undefined;
    return s3 && typeof s3 === "object" ? s3 : undefined;
};

const textOf = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/**
 * 把 Endpoint 里那台主机取出来。
 *
 * 用户在设置里通常填 `https://oss-cn-hangzhou.aliyuncs.com`，但只填域名（不带协议）也常见，
 * 这里补一个 https:// 再解析。路径、查询串一律丢掉：GetBucketStat 打的是桶根。
 */
const hostOf = (endpoint: string): URL | undefined => {
    if (!endpoint) {
        return undefined;
    }
    const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint) ? [endpoint] : [`https://${endpoint}`];
    for (const candidate of candidates) {
        try {
            const url = new URL(candidate);
            if (url.hostname) {
                return url;
            }
        } catch {
            // 换下一个写法
        }
    }
    return undefined;
};

const isAliyun = (endpoint: string): boolean => {
    const url = hostOf(endpoint);
    return Boolean(url && url.hostname.toLowerCase().endsWith(ALIYUN_SUFFIX));
};

/** 现在该不该显示按钮：已保存的 Endpoint 落在阿里云域名下才显示。 */
const isAliyunTarget = (): boolean => isAliyun(textOf(readS3Config()?.endpoint));

const timeoutSecondsOf = (value: unknown): number => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) {
        return DEFAULT_TIMEOUT_SECONDS;
    }
    return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, Math.round(seconds)));
};

/** 组装这次查询要用的目标；配置不完整时返回缺哪几项（用来提示用户先去填）。 */
const resolveTarget = (): {target?: OssTarget; missing: string[];} => {
    const config = readS3Config();
    const url = hostOf(textOf(config?.endpoint));
    const bucket = textOf(config?.bucket);
    const accessKey = textOf(config?.accessKey);
    const secretKey = textOf(config?.secretKey);
    const missing: string[] = [];
    if (!url) {
        missing.push("Endpoint");
    }
    if (!bucket) {
        missing.push("Bucket");
    }
    if (!accessKey) {
        missing.push("Access Key");
    }
    if (!secretKey) {
        missing.push("Secret Key");
    }
    if (!url || missing.length > 0) {
        return {missing};
    }
    return {
        missing,
        target: {
            bucket,
            protocol: url.protocol,
            host: url.host,
            // 配置里的布尔值：内核存的是 true / false
            pathStyle: config?.pathStyle === true || config?.pathStyle === "true",
            accessKey,
            secretKey,
            timeoutSeconds: timeoutSecondsOf(config?.timeout),
        },
    };
};

/** 这次查询打的地址：虚拟主机风格把桶放进域名，path 风格放进路径。 */
const statUrlOf = (target: OssTarget): string =>
    target.pathStyle ?
        `${target.protocol}//${target.host}/${target.bucket}/?stat` :
        `${target.protocol}//${target.bucket}.${target.host}/?stat`;

/** V1 签名的待签字符串；顺序与官方 SDK 一致，见文件头第 1、2 条。 */
const stringToSignOf = (date: string, bucket: string): string =>
    ["GET", "", "", date, `x-oss-date:${date}`, `/${bucket}/?stat`].join("\n");

const base64Of = (buffer: ArrayBuffer): string => {
    let binary = "";
    new Uint8Array(buffer).forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
};

/**
 * OSS 的 V1 签名：HMAC-SHA1 后 base64，放在 `Authorization: OSS <AK>:<sig>`。
 * 拿不到 Web Crypto 时返回 undefined（个别旧 WebView 没有它），由调用方提示。
 */
const signatureOf = async (secretKey: string, stringToSign: string): Promise<string | undefined> => {
    const subtle: SubtleCrypto | undefined = (globalThis.crypto as Crypto | undefined)?.subtle;
    if (!subtle) {
        return undefined;
    }
    const encoder = new TextEncoder();
    const key = await subtle.importKey("raw", encoder.encode(secretKey), {name: "HMAC", hash: "SHA-1"}, false, [
        "sign",
    ]);
    return base64Of(await subtle.sign("HMAC", key, encoder.encode(stringToSign)));
};

/** OSS 出错时返回 `<Error><Code>…</Code><Message>…</Message></Error>`，有就带上。 */
const errorMessageOf = (xml: string): string => {
    try {
        const document_ = new DOMParser().parseFromString(xml, "application/xml");
        const code = document_.querySelector("Error > Code")?.textContent?.trim() ?? "";
        const message = document_.querySelector("Error > Message")?.textContent?.trim() ?? "";
        return [code, message].filter(Boolean).join(": ");
    } catch {
        return "";
    }
};

const numberIn = (document_: Document, path: string): number => {
    const raw = document_.querySelector(path)?.textContent?.trim() ?? "";
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : 0;
};

/**
 * 解析 `BucketStat`。
 *
 * 各存储类型取的是「计费口径」的那个 Storage 字段（低频 / 归档类会按最小计费单元向上取整，
 * 所以它可能大于实际字节数）：阿里云控制台默认展示的也是这一列，用户对得上号。
 */
const parseStat = (xml: string): BucketStat => {
    const document_ = new DOMParser().parseFromString(xml, "application/xml");
    if (document_.querySelector("parsererror")) {
        throw new Error("unexpected response body");
    }
    const classes: StorageClass[] = [
        {
            label: "ossUsage.standard",
            storage: numberIn(document_, "BucketStat > StandardStorage"),
            objectCount: numberIn(document_, "BucketStat > StandardObjectCount"),
        },
        {
            label: "ossUsage.ia",
            storage: numberIn(document_, "BucketStat > InfrequentAccessStorage"),
            objectCount: numberIn(document_, "BucketStat > InfrequentAccessObjectCount"),
        },
        {
            label: "ossUsage.archive",
            storage: numberIn(document_, "BucketStat > ArchiveStorage"),
            objectCount: numberIn(document_, "BucketStat > ArchiveObjectCount"),
        },
        {
            label: "ossUsage.coldArchive",
            storage: numberIn(document_, "BucketStat > ColdArchiveStorage"),
            objectCount: numberIn(document_, "BucketStat > ColdArchiveObjectCount"),
        },
        {
            label: "ossUsage.deepColdArchive",
            storage: numberIn(document_, "BucketStat > DeepColdArchiveStorage"),
            objectCount: numberIn(document_, "BucketStat > DeepColdArchiveObjectCount"),
        },
    ];
    return {
        storage: numberIn(document_, "BucketStat > Storage"),
        objectCount: numberIn(document_, "BucketStat > ObjectCount"),
        multipartUploadCount: numberIn(document_, "BucketStat > MultipartUploadCount"),
        lastModifiedTime: numberIn(document_, "BucketStat > LastModifiedTime"),
        // 全是 0 的类型不占位置，只留有数据的
        classes: classes.filter((item) => item.storage > 0 || item.objectCount > 0),
    };
};

const fetchStat = async (target: OssTarget, signal: AbortSignal): Promise<StatResult> => {
    const date = new Date().toUTCString();
    const signature = await signatureOf(target.secretKey, stringToSignOf(date, target.bucket));
    if (!signature) {
        return {message: "Web Crypto is unavailable"};
    }
    let response: Response;
    try {
        response = await fetch(statUrlOf(target), {
            method: "GET",
            headers: {
                "x-oss-date": date,
                Authorization: `OSS ${target.accessKey}:${signature}`,
            },
            signal,
        });
    } catch (error) {
        // 请求没能发出去：网络不通、跨域被拦、地址不对都落在这里（fetch 一律抛 TypeError）
        return {message: error instanceof Error ? error.message : String(error), network: true};
    }
    const body = await response.text();
    if (!response.ok) {
        return {message: errorMessageOf(body) || `HTTP ${response.status}`};
    }
    try {
        return {stat: parseStat(body)};
    } catch (error) {
        return {message: error instanceof Error ? error.message : String(error)};
    }
};

/** 存储量按 1024 进制换算；`B` 那一档不加多余的小数。 */
const formatSize = (bytes: number): string => {
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${unit === 0 ? value : value.toFixed(2)} ${SIZE_UNITS[unit]}`;
};

export const mountOssUsage = (host: FeatureHost): FeatureInstance => {
    host.addStyle(DIALOG_CSS);

    const t = (key: string): string => host.i18n(key);
    let button: HTMLButtonElement | undefined;
    let frame = 0;
    let destroyed = false;
    let controller: AbortController | undefined;
    let timeoutId = 0;
    let dialog: Dialog | undefined;
    let observer: MutationObserver | undefined;

    /** 用户此刻看得见的那份 S3 表单（内核会整体重写它，所以每次都重新查）。 */
    const formOf = (): HTMLElement | undefined => document.getElementById(PROVIDER_CONFIG_ID) ?? undefined;

    /**
     * 动作区：表单里最后那个「装着按钮的 .b3-label--inner」。
     *
     * 不直接取 `lastElementChild`：内核将来在表单末尾补一行说明就会让我们插错地方；
     * 「靠后 + 里面已经有按钮」两个条件同时成立才是那个动作区，找不到就退回最后一行。
     */
    const actionRowOf = (form: HTMLElement): HTMLElement | undefined => {
        const rows = Array.from(form.querySelectorAll<HTMLElement>(".b3-label--inner"));
        return rows.filter((row) => row.querySelector("button")).pop() ?? rows.pop();
    };

    const removeButton = () => {
        guardSilent("oss-usage.remove", () => button?.remove());
        button = undefined;
        document.querySelectorAll<HTMLElement>(`[${BUTTON_ATTR}]`).forEach((element) => element.remove());
    };

    /** 幂等地把按钮放进动作区；条件不满足时收掉它。 */
    const apply = () => {
        if (destroyed) {
            return;
        }
        const form = formOf();
        const action = form ? actionRowOf(form) : undefined;
        if (!form || !action || !isAliyunTarget()) {
            removeButton();
            return;
        }
        if (button?.isConnected && button.parentElement === action) {
            return;
        }
        removeButton();
        button = document.createElement("button");
        button.type = "button";
        button.className = "b3-button b3-button--outline fn__size200";
        button.setAttribute(BUTTON_ATTR, "true");
        button.innerHTML = `<svg><use xlink:href="#iconCloud"></use></svg>${escapeHtml(t("ossUsage.button"))}`;
        button.addEventListener("click", () => openUsage());
        action.append(button);
    };

    const schedule = () => {
        if (destroyed || frame) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            apply();
        });
    };

    /** 桶 · Endpoint 这一行：只在弹窗内容里渲染一次，body 里不要再放（否则会重复一行）。 */
    const headHtml = (target: OssTarget): string =>
        `<div class="${CLASS}__head">${escapeHtml(`${target.bucket} · ${target.host}`)}</div>`;

    const renderStat = (body: HTMLElement, stat: BucketStat) => {
        const rows: string[] = [];
        const row = (key: string, value: string) =>
            rows.push(
                `<div class="${CLASS}__row"><span class="${CLASS}__key">${escapeHtml(key)}</span>` +
                    `<span class="${CLASS}__value">${escapeHtml(value)}</span></div>`,
            );
        row(t("ossUsage.total"), `${formatSize(stat.storage)}（${stat.storage} B）`);
        row(t("ossUsage.objectCount"), `${stat.objectCount} ${t("ossUsage.objects")}`);
        row(t("ossUsage.multipart"), `${stat.multipartUploadCount} ${t("ossUsage.objects")}`);
        stat.classes.forEach((item) => {
            row(t(item.label), `${formatSize(item.storage)} · ${item.objectCount} ${t("ossUsage.objects")}`);
        });
        if (stat.lastModifiedTime > 0) {
            row(t("ossUsage.statTime"), new Date(stat.lastModifiedTime * 1000).toLocaleString());
        }
        body.innerHTML = rows.join("");
    };

    const renderFailure = (body: HTMLElement, result: StatResult) => {
        // 请求没能发出去时多给一句：这种情况多半是跨域被拦，而不是凭据不对
        const tip = result.network ?
            `<div class="${CLASS}__tip">${escapeHtml(t("ossUsage.corsHint"))}</div>` :
            "";
        body.innerHTML = `<div class="${CLASS}__row">` +
            `<span class="${CLASS}__key">${escapeHtml(t("ossUsage.failed"))}</span>` +
            `<span class="${CLASS}__error">${escapeHtml(result.message ?? "")}</span></div>${tip}`;
        host.log(`GetBucketStat failed: ${result.message ?? "unknown"}`);
    };

    const stopRequest = () => {
        window.clearTimeout(timeoutId);
        timeoutId = 0;
        guardSilent("oss-usage.abort", () => controller?.abort());
        controller = undefined;
    };

    /**
     * 打开「使用数据」窗口：先把窗口和「正在查询」摆出来，结果回来再填进去
     * （桶很大时接口要几秒，先给反馈比先等结果好）。
     */
    const openUsage = () => {
        const {target, missing} = resolveTarget();
        if (!target) {
            host.showMessage(t("ossUsage.missingConfig").replace("{fields}", missing.join(" / ")));
            return;
        }
        dialog?.destroy();
        dialog = new Dialog({
            title: t("ossUsage.title"),
            width: isMobile() ? "92vw" : "520px",
            content: `<div class="b3-dialog__content">
    ${headHtml(target)}
    <div class="${CLASS}__body">${escapeHtml(t("ossUsage.loading"))}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" type="button" data-ss-close>${escapeHtml(t("common.close"))}</button>
</div>`,
            destroyCallback: () => {
                dialog = undefined;
                stopRequest();
            },
        });
        const current = dialog;
        current.element.querySelector<HTMLButtonElement>("[data-ss-close]")?.addEventListener("click", () => {
            current.destroy();
        });
        const body = current.element.querySelector<HTMLElement>(`.${CLASS}__body`);
        if (!body) {
            return;
        }
        controller = new AbortController();
        const signal = controller.signal;
        timeoutId = window.setTimeout(() => stopRequest(), target.timeoutSeconds * 1000);
        void fetchStat(target, signal).then((result) => {
            window.clearTimeout(timeoutId);
            timeoutId = 0;
            // 窗口可能已经被关掉、或者又打开了一个新的
            if (dialog !== current) {
                return;
            }
            if (result.stat) {
                renderStat(body, result.stat);
            } else {
                renderFailure(body, result);
            }
        });
    };

    // 内核随时可能整体重写这份表单（切换服务商、导入配置、设置搜索都会），
    // 所以盯的是整个 body，命中就重新插一次；回调按帧合并，一次只查一个 id。
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {childList: true, subtree: true});
    // Endpoint 是输入框：改完（内核在 change 里保存配置）要重新判定该不该显示按钮
    document.addEventListener("change", schedule, true);
    apply();

    return {
        destroy: () => {
            if (destroyed) {
                return;
            }
            destroyed = true;
            if (frame) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            }
            guardSilent("oss-usage.observer", () => observer?.disconnect());
            observer = undefined;
            document.removeEventListener("change", schedule, true);
            stopRequest();
            guardSilent("oss-usage.dialog", () => dialog?.destroy());
            dialog = undefined;
            removeButton();
        },
    };
};
