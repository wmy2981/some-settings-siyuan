/**
 * 阿里云 OSS 存储桶使用数据（oss-usage）。
 *
 * 这个功能对外只有「按钮 + 弹窗」两个面，但里面有三块必须守死的东西：
 * 1. **入口条件**：只有 S3（provider === 2）且**已保存**的 Endpoint 落在阿里云域名下才插按钮，
 *    位置在设置页那行同步服务的操作列里，不插进 S3 配置弹窗。
 * 2. **请求**：交给内核转发；V1 签名、`x-oss-date`、`/<bucket>/?stat` 规范化资源、显式
 *    Content-Type 与超时夹取都必须与官方 SDK 一致（写错就是整片签名错误）。
 * 3. **渲染**：字节按 1024 进制换算、各存储类型明细只留有数据的、统计时间缺失就不显示那一行、
 *    失败要区分「服务端明确报错」与「请求根本没送出去」。
 */
import {createHmac} from "node:crypto";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import definition from "../../src/features/oss-usage/index";
import {mountOssUsage} from "../../src/features/oss-usage/usage";
import {mountFeature} from "../helpers/feature-host";
import type {HostHarness} from "../helpers/feature-host";
import {mockState} from "../mocks/siyuan";

/** 与 `src/i18n/zh-CN.json` 里 ossUsage 段的文案一致，方便断言真实呈现的文字。 */
const messages: Record<string, string> = {
    "feature.ossUsage.button": "使用数据",
    "feature.ossUsage.dialogTitle": "存储桶使用数据",
    "feature.ossUsage.loading": "正在查询…",
    "feature.ossUsage.total": "总存储量",
    "feature.ossUsage.objectCount": "对象数",
    "feature.ossUsage.objects": "个",
    "feature.ossUsage.multipart": "未完成的分片上传",
    "feature.ossUsage.standard": "标准存储",
    "feature.ossUsage.ia": "低频访问",
    "feature.ossUsage.archive": "归档",
    "feature.ossUsage.coldArchive": "冷归档",
    "feature.ossUsage.deepColdArchive": "深度冷归档",
    "feature.ossUsage.statTime": "统计时间",
    "feature.ossUsage.failed": "查询失败",
    "feature.ossUsage.networkTip": "请求由内核代为发出，但它没能送出去：请检查网络连接与 Endpoint 是否正确。",
    "feature.ossUsage.missingConfig": "S3 配置不完整，请先在下面填好并保存这几项：{fields}",
    "common.close": "关闭",
};
const i18n = (key: string): string => messages[key] ?? key;

const ALIYUN_ENDPOINT = "https://oss-cn-hangzhou.aliyuncs.com";

const defaultS3 = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
    endpoint: ALIYUN_ENDPOINT,
    bucket: "my-bucket",
    accessKey: "AK",
    secretKey: "SK",
    pathStyle: false,
    timeout: 30,
    ...patch,
});

/** 设置页里那行同步服务：操作列是 `.fn__size200`，里面竖排「配置 / 导入 / 导出」。 */
const settingsRowHtml = (): string =>
    `<div id="syncProviderConfigRow">
    <div class="fn__size200">
        <button type="button">配置</button>
        <div class="fn__hr"></div>
        <button type="button">导入</button>
        <div class="fn__hr"></div>
        <button type="button">导出</button>
    </div>
</div>
<div id="syncProviderConfig">
    <div class="b3-label--inner"><button type="button">测试连接</button></div>
</div>`;

const mounted: HostHarness[] = [];

interface MountOptions {
    s3?: Record<string, unknown>;
    provider?: number;
}

/** 造好设置页与已保存的 S3 配置，再挂载；按钮由 `apply()` 同步插进去。 */
const mount = (options: MountOptions = {}): HostHarness => {
    const siyuan = window.siyuan as unknown as {config: {sync?: Record<string, unknown>;};};
    siyuan.config.sync = {provider: options.provider ?? 2, s3: options.s3 ?? defaultS3()};
    document.body.innerHTML = settingsRowHtml();
    const harness = mountFeature(definition, {i18n});
    mounted.push(harness);
    return harness;
};

/** 让 body 上的 MutationObserver 回调跑完（回调排在微任务里）。 */
const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

/** MutationObserver → schedule → requestAnimationFrame 这条链要靠测试自己驱动。 */
const stubFrames = () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback): number => {
        nextId += 1;
        pending.set(nextId, callback);
        return nextId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number): void => {
        pending.delete(handle);
    });
    return {
        flush: async (): Promise<void> => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback(0));
            await settle();
        },
    };
};

// 分隔行 `.fn__hr` 也带同一个属性（方便一起收掉），所以这里必须限定是 button
const usageButton = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>("button[data-ss-oss-usage]");

const statXml = (fields: Record<string, string | number>): string => {
    const body = Object.entries(fields).map(([key, value]) => `<${key}>${value}</${key}>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><BucketStat>${body}</BucketStat>`;
};

const fullStat = (): string =>
    statXml({
        Storage: 1073741824,
        ObjectCount: 3,
        MultipartUploadCount: 2,
        LastModifiedTime: 1700000000,
        StandardStorage: 1024,
        StandardObjectCount: 2,
        InfrequentAccessStorage: 1536,
        InfrequentAccessObjectCount: 1,
        ArchiveStorage: 0,
        ArchiveObjectCount: 0,
    });

const respondWith = (body: string, status = 200): void => {
    mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {status, body}});
};

/** 点开弹窗并等它把结果画进去。 */
const openAndWait = async (): Promise<void> => {
    usageButton()?.click();
    await vi.waitFor(() => expect(document.querySelector(".ss-oss-usage__body")?.textContent).not.toBe("正在查询…"));
};

const rowPairs = (): {key: string; value: string;}[] =>
    Array.from(document.querySelectorAll<HTMLElement>(".ss-oss-usage__row")).map((row) => ({
        key: row.querySelector(".ss-oss-usage__key")?.textContent ?? "",
        value: row.querySelector(".ss-oss-usage__value")?.textContent ??
            row.querySelector(".ss-oss-usage__error")?.textContent ??
            "",
    }));

beforeEach(() => {
    mockState.fetchSyncPost.mockResolvedValue({code: 0, data: {status: 200, body: fullStat()}});
});

afterEach(() => {
    mounted.splice(0).forEach((harness) => harness.dispose());
});

describe("阿里云 OSS 存储桶使用数据", () => {
    it("声明里只有开关一项、默认关闭", () => {
        expect(definition.id).toBe("oss-usage");
        expect(definition.category).toBe("settings");
        expect(definition.enabled).toBe(true);
        expect(definition.settings).toEqual([
            {kind: "switch", key: "enabled", title: "common.enabled", default: false},
        ]);
        expect(definition.mount).toBe(mountOssUsage);
    });

    it("按钮落在同步服务那行的操作列里，形态与相邻按钮一致", () => {
        mount();
        const button = usageButton();

        expect(button).not.toBeNull();
        expect(button?.className).toBe("b3-button b3-button--outline fn__block");
        expect(button?.textContent).toBe("使用数据");
        // 图标用内核自己的 symbol，不引外部资源
        expect(button?.querySelector("use")?.getAttribute("xlink:href")).toBe("#iconCloud");
        // 操作列里按钮之间用 .fn__hr 分隔，缺了它就与「导入 / 导出」挤在一起
        expect(button?.previousElementSibling?.className).toBe("fn__hr");
        expect(button?.parentElement).toBe(document.querySelector("#syncProviderConfigRow .fn__size200"));
        // 这一排只管这份草稿的清除 / 测试连接 / 保存，查桶用量不属于那里
        expect(document.querySelector("#syncProviderConfig [data-ss-oss-usage]")).toBeNull();
    });

    it("Endpoint 不是阿里云、或当前服务商不是 S3 时都不出现按钮", () => {
        mount({s3: defaultS3({endpoint: "https://s3.amazonaws.com"})});
        expect(usageButton()).toBeNull();
        mounted.splice(0).forEach((harness) => harness.dispose());

        // WebDAV / 本地目录即使还留着旧的 S3 Endpoint 也不该出现按钮
        mount({provider: 4});
        expect(usageButton()).toBeNull();
        mounted.splice(0).forEach((harness) => harness.dispose());

        // 只填域名（不带协议）也要能认出来
        mount({s3: defaultS3({endpoint: "oss-cn-hangzhou.aliyuncs.com"})});
        expect(usageButton()).not.toBeNull();
    });

    it("配置不完整时只提示缺哪几项，不去发请求", () => {
        const harness = mount({s3: defaultS3({bucket: "", accessKey: "  ", secretKey: ""})});
        usageButton()?.click();

        expect(harness.records.messages).toEqual([
            "S3 配置不完整，请先在下面填好并保存这几项：Bucket / Access Key / Secret Key",
        ]);
        // 缺凭据还硬发一次请求，只会换来一句看不懂的签名错误
        expect(mockState.fetchSyncPost).not.toHaveBeenCalled();
        expect(document.querySelector(".ss-oss-usage__head")).toBeNull();
    });

    it("成功时按 1024 进制渲染总量、对象数、明细与统计时间", async () => {
        mount();
        await openAndWait();

        expect(document.querySelector(".ss-oss-usage__head")?.textContent).toBe(
            "my-bucket · oss-cn-hangzhou.aliyuncs.com",
        );
        expect(rowPairs()).toEqual([
            {key: "总存储量", value: "1.00 GB（1073741824 B）"},
            {key: "对象数", value: "3 个"},
            {key: "未完成的分片上传", value: "2 个"},
            {key: "标准存储", value: "1.00 KB · 2 个"},
            {key: "低频访问", value: "1.50 KB · 1 个"},
            // 统计时间是秒级时间戳，乘 1000 再按本地时区显示
            {key: "统计时间", value: new Date(1700000000 * 1000).toLocaleString()},
        ]);
        // 归档 / 冷归档全是 0，不占位置
        expect(document.querySelector(".ss-oss-usage__body")?.textContent).not.toContain("归档");
    });

    it("空响应只显示三个 0，不渲染统计时间那一行", async () => {
        respondWith(statXml({Storage: 0, ObjectCount: 0, MultipartUploadCount: 0, LastModifiedTime: 0}));
        mount();
        await openAndWait();

        expect(rowPairs()).toEqual([
            // B 这一档不加小数：0 B 显示成 "0.00 B" 会被当成精度错误
            {key: "总存储量", value: "0 B（0 B）"},
            {key: "对象数", value: "0 个"},
            {key: "未完成的分片上传", value: "0 个"},
        ]);
    });

    it("请求头、签名与转发参数符合 OSS 的 V1 方案", async () => {
        mount();
        usageButton()?.click();
        await vi.waitFor(() => expect(mockState.fetchSyncPost).toHaveBeenCalledTimes(1));

        const [api, payload] = mockState.fetchSyncPost.mock.calls[0] as [string, Record<string, any>];
        expect(api).toBe("/api/network/forwardProxy");
        expect(payload.method).toBe("GET");
        // 虚拟主机风格：桶进域名，规范化资源仍是 /<bucket>/?stat
        expect(payload.url).toBe("https://my-bucket.oss-cn-hangzhou.aliyuncs.com/?stat");
        // 思源存的是秒，内核要毫秒
        expect(payload.timeout).toBe(30000);
        // 内核一定会补 Content-Type，待签字符串里那一格必须与它一致
        expect(payload.contentType).toBe("application/json");
        expect(payload.headers).toHaveLength(2);

        const date = (payload.headers[0] as Record<string, string>)["x-oss-date"];
        const authorization = (payload.headers[1] as Record<string, string>).Authorization;
        expect(date).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);

        const stringToSign = [
            "GET",
            "",
            "application/json",
            date,
            `x-oss-date:${date}`,
            "/my-bucket/?stat",
        ].join("\n");
        const expectedSignature = createHmac("sha1", "SK").update(stringToSign).digest("base64");
        // 签名算错时 OSS 只会回一个 SignatureDoesNotMatch，排查成本极高
        expect(authorization).toBe(`OSS AK:${expectedSignature}`);
    });

    it("path 风格把桶放进路径，超时按内核的范围夹取", async () => {
        mount({s3: defaultS3({pathStyle: true, timeout: 1})});
        usageButton()?.click();
        await vi.waitFor(() => expect(mockState.fetchSyncPost).toHaveBeenCalledTimes(1));

        const payload = mockState.fetchSyncPost.mock.calls[0][1] as Record<string, any>;
        expect(payload.url).toBe("https://oss-cn-hangzhou.aliyuncs.com/my-bucket/?stat");
        // 内核 S3 配置允许 7～300 秒，1 秒会被夹到下限
        expect(payload.timeout).toBe(7000);
        // 规范化资源与虚拟主机风格完全相同
        const authorization = (payload.headers[1] as Record<string, string>).Authorization;
        const date = (payload.headers[0] as Record<string, string>)["x-oss-date"];
        const expected = createHmac("sha1", "SK").update(
            ["GET", "", "application/json", date, `x-oss-date:${date}`, "/my-bucket/?stat"].join("\n"),
        ).digest("base64");
        expect(authorization).toBe(`OSS AK:${expected}`);
    });

    it("内核返回非 0 code 时算「请求没送出去」，带上网络提示与日志", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 502, msg: "proxy failed"});
        const harness = mount();
        await openAndWait();

        expect(rowPairs()).toEqual([{key: "查询失败", value: "proxy failed"}]);
        expect(document.querySelector(".ss-oss-usage__tip")?.textContent).toBe(
            messages["feature.ossUsage.networkTip"],
        );
        // 失败必须落到日志里：用户报上来时只有这一句能定位
        expect(harness.records.logs).toContainEqual(["GetBucketStat failed: proxy failed"]);
    });

    it("内核非 0 code 且没有 msg 时给出 code 号", async () => {
        mockState.fetchSyncPost.mockResolvedValue({code: 500});
        mount();
        await openAndWait();
        expect(rowPairs()).toEqual([{key: "查询失败", value: "forwardProxy code 500"}]);
    });

    it("OSS 明确报错时取 <Error> 里的 Code 与 Message，没有就退回 HTTP 状态码", async () => {
        respondWith(
            "<Error><Code>NoSuchBucket</Code><Message>桶不存在</Message></Error>",
            403,
        );
        mount();
        await openAndWait();
        expect(rowPairs()).toEqual([{key: "查询失败", value: "NoSuchBucket: 桶不存在"}]);
        // 服务端明确回了错误，就不是「网络没通」那一类
        expect(document.querySelector(".ss-oss-usage__tip")).toBeNull();
        mounted.splice(0).forEach((harness) => harness.dispose());

        respondWith("", 403);
        mount();
        await openAndWait();
        expect(rowPairs()).toEqual([{key: "查询失败", value: "HTTP 403"}]);
    });

    it("响应体不是合法 XML 时按解析失败处理", async () => {
        // 未闭合的标签：DOMParser 会产出 parsererror，而不是一个空 BucketStat
        respondWith("<BucketStat><Storage>12");
        mount();
        await openAndWait();
        expect(rowPairs()).toEqual([{key: "查询失败", value: "unexpected response body"}]);
    });

    it("关窗收掉弹窗，卸载时中断仍在飞的请求", async () => {
        mockState.fetchSyncPost.mockImplementation(() => new Promise(() => undefined));
        const harness = mount();
        usageButton()?.click();
        await vi.waitFor(() => expect(mockState.fetchSyncPost).toHaveBeenCalledTimes(1));
        const signal = mockState.fetchSyncPost.mock.calls[0][4] as AbortSignal;
        expect(signal.aborted).toBe(false);

        document.querySelector<HTMLButtonElement>("[data-ss-close]")?.click();
        expect(document.querySelector(".ss-oss-usage__head")).toBeNull();

        // tests/mocks 里的 Dialog.destroy() 不触发 destroyCallback，所以「点关闭即 abort」
        // 这一环只能在真正的宿主上验证；这里退一步确认卸载路径确实把请求掐掉了
        harness.dispose();
        expect(signal.aborted).toBe(true);
    });

    it("destroy 收掉按钮与弹窗，之后重写设置行也不会把按钮插回来", async () => {
        const frames = stubFrames();
        const harness = mount();
        expect(usageButton()).not.toBeNull();
        usageButton()?.click();
        await settle();
        expect(document.querySelector(".ss-oss-usage__head")).not.toBeNull();

        harness.dispose();
        expect(usageButton()).toBeNull();
        expect(document.querySelector(".ss-oss-usage__head")).toBeNull();

        // 内核会整块重写这行设置；卸载后 observer 必须已经断开
        document.body.innerHTML = settingsRowHtml();
        await settle();
        await frames.flush();
        expect(usageButton()).toBeNull();

        // 幂等：再调一次不能抛（宿主卸载顺序里 destroy 可能被走到两次）
        expect(() => harness.instance?.destroy?.()).not.toThrow();
    });

    it("Endpoint 改回阿里云后，不用重载就能把按钮补回来", async () => {
        const frames = stubFrames();
        const harness = mount({s3: defaultS3({endpoint: "https://s3.amazonaws.com"})});
        expect(usageButton()).toBeNull();

        (window.siyuan as unknown as {config: {sync: {s3: Record<string, unknown>;};};}).config.sync.s3.endpoint =
            ALIYUN_ENDPOINT;
        // 内核在 change 里保存 Endpoint，插件靠这个事件重新判定
        document.dispatchEvent(new Event("change", {bubbles: true}));
        await frames.flush();

        expect(usageButton()).not.toBeNull();
        expect(harness.records.styles[0]).toContain(".ss-oss-usage__row");
    });
});
