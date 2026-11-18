/**
 * 构建配置。
 *
 * 宿主用 CommonJS 加载插件，集市要的是「包根目录扁平」的 zip，两件事都由这里产出：
 * - 开发（`--mode development`）：仓库根目录就是插件目录，配合 `--watch` 原地更新
 *   index.js / index.css 与 i18n，宿主里重载插件即可生效；
 * - 生产（`--mode production`）：先清空 dist，再放 index.js、index.css、i18n，
 *   以及 plugin.json 声明的那几个静态文件，最后打成不带目录前缀的 package.zip。
 */
import {zipSync} from "fflate";
import fs from "node:fs";
import path from "node:path";
import {
    defineConfig,
    type Plugin,
} from "vite";

const root = import.meta.dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));

/**
 * 图标与预览图：集市要求包根目录下的文件名与 plugin.json 的字段值逐字一致，
 * 所以按声明去找 assets/ 里的源文件，不写死名字。
 */
function imageAssets(): {source: string; name: string;}[] {
    return [
        ["icon", "icon.png"],
        ["preview", "preview.png"],
    ].flatMap(([field, legacyName]) => {
        const name = manifest[field] || (fs.existsSync(path.join(root, "assets", legacyName)) ? legacyName : "");
        if (!name) {
            return [];
        }
        const source = path.join(root, "assets", name);
        if (!fs.existsSync(source)) {
            throw new Error(`plugin.json 的 ${field} 声明了 ${name}，但 ${source} 不存在`);
        }
        return [{source, name}];
    });
}

/** 生产包里除产物与 i18n 以外的静态文件：集市按它们展示，AGPL 要求随附许可全文。 */
function packageFiles(): {source: string; name: string;}[] {
    const readmes: string[] = [...new Set(Object.values(manifest.readme ?? {}))] as string[];
    return [
        ...imageAssets(),
        ...readmes.map((name) => ({source: path.join(root, name), name})),
        {source: path.join(root, "LICENSE"), name: "LICENSE"},
        {source: path.join(root, "plugin.json"), name: "plugin.json"},
    ];
}

/** 把产物目录里的全部文件按相对路径塞进一个扁平 zip（集市按根目录取文件）。 */
function writePackageZip(source: string, target: string): void {
    const files: Record<string, Uint8Array> = {};
    const collect = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                collect(full);
                continue;
            }
            files[path.relative(source, full).split(path.sep).join("/")] = fs.readFileSync(full);
        }
    };
    collect(source);
    fs.writeFileSync(target, zipSync(files, {level: 9}));
}

/**
 * 压缩后必须还留着 console 调用：插件出问题时控制台一片空白，
 * 远比多几 KB 难查。日志本来就走 core/log.ts，被 minimizer 悄悄删掉就等于失明。
 */
function assertConsoleKept(bundle: string): void {
    if (!bundle.includes("console.")) {
        throw new Error("压缩后的产物里没有 console 调用：minifier 把日志删了，先查构建配置");
    }
}

/**
 * 产物收尾：i18n 由宿主在运行时按语言读取，必须与 index.js 一起就位；
 * 生产模式再补静态文件、打 zip。开发模式下不动仓库根目录里的同名文件。
 *
 * 许可声明在 `generateBundle` 里贴到产物最前面：`output.banner` 会被压缩阶段当普通注释删掉。
 */
function buildArtifacts(options: {production: boolean; outDir: string; banner: string;}): Plugin {
    const outDir = path.join(root, options.outDir);
    return {
        name: "some-settings:artifacts",
        apply: "build",
        generateBundle(_options, bundle) {
            if (!options.production) {
                return;
            }
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === "chunk" && chunk.fileName === "index.js") {
                    chunk.code = `${options.banner}\n${chunk.code}`;
                }
            }
        },
        writeBundle() {
            fs.cpSync(path.join(root, "src/i18n"), path.join(outDir, "i18n"), {recursive: true});
            const indexJs = fs.readFileSync(path.join(outDir, "index.js"), "utf8");
            assertConsoleKept(indexJs);
            if (!options.production) {
                return;
            }
            for (const file of packageFiles()) {
                fs.copyFileSync(file.source, path.join(outDir, file.name));
            }
            writePackageZip(outDir, path.join(root, "package.zip"));
        },
    };
}

export default defineConfig(({mode}) => {
    const production = mode === "production";
    const outDir = production ? "dist" : ".";
    // 头部只放一段短的许可声明：完整文本随包发在 LICENSE 里。
    // 不要把整份 LICENSE 塞进 banner —— AGPL 全文 34KB，只会变成 bundle 开头一大段注释。
    const banner = [
        "/*!",
        ...[
            `${manifest.displayName.default} v${manifest.version} - ${manifest.url}`,
            "Copyright (C) 2026 wmy2981",
            "SPDX-License-Identifier: AGPL-3.0-or-later",
            "Licensed under the GNU Affero General Public License v3.0 or later; see LICENSE for the full text.",
            "The sponsor icon in the donate button is taken from SiYuan (AGPL-3.0, (C) siyuan-note).",
        ].map((line) => ` * ${line}`),
        " */",
    ].join("\n");
    return {
        // 没有页面入口，也就没有 public/ 目录
        publicDir: false,
        build: {
            outDir,
            // 开发时 outDir 就是仓库根目录：清空等于删掉源码，Vite 也因此每次启动提示
            // 「outDir 与 root 相同」，那正是要的行为
            emptyOutDir: production,
            copyPublicDir: false,
            // 桌面端与移动端的 WebView 都不算新，沿用改造前的 ES6 目标
            target: "es2015",
            sourcemap: production ? false : "inline",
            minify: production,
            lib: {
                entry: path.join(root, "src/index.ts"),
                // 宿主用 CommonJS 加载 index.js，集市也只认包根目录下的这个名字
                formats: ["cjs"],
                fileName: () => "index.js",
                // 集市要求包根目录必须有 index.css
                cssFileName: "index",
            },
            rolldownOptions: {
                // siyuan 是宿主的运行时包，只在 npm 上有类型声明，不打进包里
                external: ["siyuan"],
            },
        },
        plugins: [buildArtifacts({production, outDir, banner})],
    };
});
