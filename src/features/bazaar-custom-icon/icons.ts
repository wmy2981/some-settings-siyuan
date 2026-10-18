/**
 * 「集市包自定义图标」的文件层。
 *
 * 图标不是配置 JSON 里的 base64，而是插件存储目录下 `icons/` 里的真实文件：
 * 文件名是 `作者__包名.扩展名`，内容就是图片本身。这样 author/pkg-name 与自定义图标
 * 两样东西都落在磁盘上，跟着 petal 存储一起同步，而且只改用户自己的客户端 ——
 * 集市包目录一个字节都不碰。
 *
 * 为什么不用 `plugin.saveData`：它只能写存储根目录下的 JSON；图标是二进制文件，
 * 还要单独放一个文件夹，只能用内核的文件 API（官方允许的入口，依然不碰 fs / Node API）。
 *
 * 写入后一律读回校验：文件 API 和宿主的 saveData 一样，不能拿「没报错」当成功。
 */
import {fetchSyncPost} from "siyuan";

/** 图标目录名。与存储根目录下的配置文件分开，避免与 `feature-*` 混淆。 */
export const ICON_DIR = "icons";

/** 管理窗口保存 / 删除图标后广播的事件名；已挂载的功能据此重新读一遍目录。 */
export const ICON_CHANGED_EVENT = "ss-bazaar-custom-icon-changed";

/** 图片扩展名白名单。内核按扩展名给文件挑 Content-Type，读回来时也用得到。 */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

const MIME_BY_EXT: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
};

/** 单张图标的上限。图标是 74×74 的小图，超过这个体积基本不可能是图标。 */
const MAX_ICON_BYTES = 4 * 1024 * 1024;

/** 作者与包名只允许 GitHub 仓库名能出现的字符；不合规就不写盘，避免拼出目录穿越。 */
const SAFE_PART = /^[A-Za-z0-9._-]+$/;

export interface IconFile {
    /** 磁盘上的文件名，同时是这张图标在本功能里的唯一标识。 */
    fileName: string;
    owner: string;
    name: string;
    ext: string;
    /** 工作区内的绝对路径（以 `/` 开头），供内核文件 API 使用。 */
    path: string;
}

export interface IconImage {
    blob: Blob;
    ext: string;
}

interface KernelResponse {
    code?: number;
    msg?: string;
    data?: unknown;
}

const storageDirOf = (pluginName: string): string => `/data/storage/petal/${pluginName}`;

/** 图标目录在工作区里的绝对路径。 */
export const iconDirOf = (pluginName: string): string => `${storageDirOf(pluginName)}/${ICON_DIR}`;

const mimeOf = (ext: string): string => MIME_BY_EXT[ext] || "application/octet-stream";

const isSafePart = (value: string): boolean => value !== "" && SAFE_PART.test(value) && value !== "." && value !== "..";

/**
 * 文件名 → 图标描述。
 *
 * 作者名不可能含下划线，所以第一个 `__` 就一定是分隔符；包名里再出现 `__` 也只是包名的一部分。
 * 扩展名取最后一个点：包名本身可以带点。
 */
export const parseIconFileName = (pluginName: string, fileName: string): IconFile | undefined => {
    const separator = fileName.indexOf("__");
    if (separator <= 0) {
        return undefined;
    }
    const owner = fileName.slice(0, separator);
    const rest = fileName.slice(separator + 2);
    const dot = rest.lastIndexOf(".");
    if (dot <= 0 || dot === rest.length - 1) {
        return undefined;
    }
    const name = rest.slice(0, dot);
    const ext = rest.slice(dot + 1).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext) || !isSafePart(owner) || !isSafePart(name)) {
        return undefined;
    }
    return {
        fileName,
        owner,
        name,
        ext,
        path: `${iconDirOf(pluginName)}/${fileName}`,
    };
};

/** 列出当前全部自定义图标。目录不存在按「一张都没有」处理。 */
export const listIcons = async (pluginName: string): Promise<IconFile[]> => {
    const response: KernelResponse = await fetchSyncPost(
        "/api/file/readDir",
        {path: iconDirOf(pluginName)},
        undefined,
        false,
    );
    if (response.code === 404) {
        return [];
    }
    if (response.code !== 0) {
        throw new Error(
            `cannot list ${iconDirOf(pluginName)}: code ${String(response.code)}${
                response.msg ? `: ${response.msg}` : ""
            }`,
        );
    }
    const entries = Array.isArray(response.data) ? response.data as {name?: unknown; isDir?: unknown;}[] : [];
    const icons: IconFile[] = [];
    entries.forEach((entry) => {
        if (typeof entry.name !== "string" || entry.isDir === true) {
            return;
        }
        const icon = parseIconFileName(pluginName, entry.name);
        if (icon) {
            icons.push(icon);
        }
    });
    return icons;
};

/** 把图标文件读成 data URL，直接给 `<img src>` 用；内核没有单独托管 petal 目录的路由。 */
export const readIconDataUrl = async (icon: IconFile): Promise<string> => {
    const response = await fetch("/api/file/getFile", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({path: icon.path}),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
        throw new Error(`cannot read ${icon.path}: HTTP ${response.status}`);
    }
    if (contentType.includes("application/json")) {
        // 文件读不到时内核返回的是 JSON 错误体，不是图片
        const error = await response.json() as KernelResponse;
        throw new Error(`cannot read ${icon.path}: code ${String(error.code)}${error.msg ? `: ${error.msg}` : ""}`);
    }
    const raw = await response.blob();
    // 始终按扩展名给 Blob 定 MIME：内核偶尔会回 application/octet-stream，
    // SVG 在 <img> 里必须拿到 image/svg+xml 才会被当图渲染
    return blobToDataUrl(new Blob([raw], {type: mimeOf(icon.ext)}));
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("cannot read the icon into a data URL"));
        reader.readAsDataURL(blob);
    });

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
};

const readIconBytes = async (path: string): Promise<Uint8Array> => {
    const response = await fetch("/api/file/getFile", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({path}),
    });
    if (!response.ok) {
        throw new Error(`cannot read ${path}: HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        const error = await response.json() as KernelResponse;
        throw new Error(`cannot read ${path}: code ${String(error.code)}${error.msg ? `: ${error.msg}` : ""}`);
    }
    return new Uint8Array(await response.arrayBuffer());
};

/**
 * 写入一张图标，写完立刻读回逐字节比对。
 *
 * 同一个包换了扩展名时先删旧文件，否则目录里会同时躺着两张（匹配时先读到哪张看目录顺序）。
 */
export const writeIcon = async (
    pluginName: string,
    owner: string,
    name: string,
    image: IconImage,
): Promise<IconFile> => {
    if (!isSafePart(owner) || !isSafePart(name)) {
        throw new Error(`invalid package key: ${owner}/${name}`);
    }
    const fileName = `${owner}__${name}.${image.ext}`;
    const icon: IconFile = {
        fileName,
        owner,
        name,
        ext: image.ext,
        path: `${iconDirOf(pluginName)}/${fileName}`,
    };

    const existing = await listIcons(pluginName);
    const stale = existing.filter((item) =>
        item.owner === icon.owner && item.name === icon.name && item.fileName !== icon.fileName
    );

    const form = new FormData();
    form.append("path", icon.path);
    form.append("isDir", "false");
    form.append("file", image.blob, fileName);
    const response = await fetch("/api/file/putFile", {method: "POST", body: form});
    if (!response.ok) {
        throw new Error(`cannot write ${icon.path}: HTTP ${response.status}`);
    }
    const result = await response.json() as KernelResponse;
    if (result.code !== 0) {
        throw new Error(`cannot write ${icon.path}: code ${String(result.code)}${result.msg ? `: ${result.msg}` : ""}`);
    }

    // 读回校验：长度或内容不一致都视为没存住，让调用方把问题显示出来
    const written = new Uint8Array(await image.blob.arrayBuffer());
    const readBack = await readIconBytes(icon.path);
    if (!bytesEqual(written, readBack)) {
        throw new Error(`read back mismatch after writing ${icon.path}`);
    }

    // 新文件确认写住之后才删旧扩展名：写失败时用户原来那张还在
    for (const item of stale) {
        await removeIcon(item);
    }
    return icon;
};

/** 删除一张图标。文件本来就不在也算成功。 */
export const removeIcon = async (icon: IconFile): Promise<void> => {
    const response: KernelResponse = await fetchSyncPost(
        "/api/file/removeFile",
        {path: icon.path},
        undefined,
        false,
    );
    if (response.code !== 0 && response.code !== 404) {
        throw new Error(
            `cannot remove ${icon.path}: code ${String(response.code)}${response.msg ? `: ${response.msg}` : ""}`,
        );
    }
};

/**
 * 从文件后缀与文件头判断这是不是一张能显示的图片，并给出规范扩展名。
 *
 * 不信任浏览器给的 MIME（部分系统对 svg / 无后缀文件给空串），以内核同样会处理的
 * 文件头为准；svg 这类文本格式按内容前缀判断。
 */
export const sniffImageExt = (bytes: Uint8Array): string | undefined => {
    const startsWith = (signature: number[], offset = 0): boolean =>
        signature.every((value, index) => bytes[offset + index] === value);
    if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return "png";
    }
    if (startsWith([0xff, 0xd8, 0xff])) {
        return "jpg";
    }
    if (startsWith([0x47, 0x49, 0x46, 0x38])) {
        return "gif";
    }
    if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
        return "webp";
    }
    if (startsWith([0x42, 0x4d])) {
        return "bmp";
    }
    if (startsWith([0x00, 0x00, 0x01, 0x00])) {
        return "ico";
    }
    if (
        startsWith([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4) ||
        startsWith([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73], 4)
    ) {
        return "avif";
    }
    // 只解码开头一段：图标文件不会有 4MB 的 XML 头
    const head = new TextDecoder("utf-8", {fatal: false}).decode(bytes.slice(0, 1024)).trimStart().toLowerCase();
    if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
        return "svg";
    }
    return undefined;
};

const extOfMime = (mime: string): string | undefined => {
    const known: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
        "image/avif": "avif",
        "image/bmp": "bmp",
        "image/x-icon": "ico",
        "image/vnd.microsoft.icon": "ico",
    };
    return known[mime.trim().toLowerCase()];
};

const assertSize = (bytes: Uint8Array): void => {
    if (bytes.length === 0) {
        throw new Error("the image file is empty");
    }
    if (bytes.length > MAX_ICON_BYTES) {
        throw new Error("the image file is larger than 4 MiB");
    }
};

/** 用户在文件选择器里挑中的图片。只认文件头，不认后缀：改过名的文本文件不算图片。 */
export const imageFromFile = async (file: File): Promise<IconImage> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    assertSize(bytes);
    const ext = sniffImageExt(bytes);
    if (!ext) {
        throw new Error("the selected file is not a supported image");
    }
    return {blob: new Blob([bytes], {type: mimeOf(ext)}), ext};
};

/**
 * 粘贴进来的 base64 / data URI。
 *
 * 两种写法都收：完整的 `data:image/png;base64,…`（MIME 从 data URI 里取）与裸 base64
 * （扩展名只能靠文件头判断）。也接受 urlencoded 的 SVG data URI 与直接粘贴的 SVG 源码。
 */
export const imageFromBase64 = (text: string): IconImage => {
    const value = text.trim();
    if (value === "") {
        throw new Error("the base64 text is empty");
    }
    // 直接粘贴 SVG 源码也收：它本来就不是 base64，但用户按提示贴过来的就是这段文本
    if (value.startsWith("<")) {
        const bytes = new TextEncoder().encode(value);
        assertSize(bytes);
        if (sniffImageExt(bytes) !== "svg") {
            throw new Error("the pasted text is not an SVG image");
        }
        return {blob: new Blob([bytes], {type: mimeOf("svg")}), ext: "svg"};
    }
    let payload = value;
    let declaredMime = "";
    if (value.startsWith("data:")) {
        const comma = value.indexOf(",");
        if (comma < 0) {
            throw new Error("the data URI is not complete");
        }
        const meta = value.slice(5, comma);
        declaredMime = meta.split(";")[0].trim().toLowerCase();
        payload = value.slice(comma + 1);
        if (!meta.toLowerCase().includes(";base64")) {
            let bytes: Uint8Array<ArrayBuffer>;
            try {
                bytes = new TextEncoder().encode(decodeURIComponent(payload));
            } catch {
                throw new Error("the data URI is not valid");
            }
            assertSize(bytes);
            const ext = sniffImageExt(bytes) || extOfMime(declaredMime);
            if (!ext) {
                throw new Error("the data URI is not a supported image");
            }
            return {blob: new Blob([bytes], {type: mimeOf(ext)}), ext};
        }
    }
    let binary: string;
    try {
        binary = atob(payload.replace(/\s+/g, ""));
    } catch {
        throw new Error("the base64 text is not valid");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    assertSize(bytes);
    const ext = sniffImageExt(bytes) || extOfMime(declaredMime);
    if (!ext) {
        throw new Error("the base64 text does not hold a supported image");
    }
    return {blob: new Blob([bytes], {type: mimeOf(ext)}), ext};
};
