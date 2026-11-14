const path = require("path");
const fs = require("fs");
const webpack = require("webpack");
const {EsbuildPlugin} = require("esbuild-loader");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const ZipPlugin = require("zip-webpack-plugin");
const pluginManifest = require("./plugin.json");

// icon / preview 的实际文件名由 plugin.json 决定（集市要求包根目录下与字段同名）。
// 源文件放在 assets/ 下，打包时复制到包根目录。
const packageImagePatterns = [
    ["icon", "icon.png"],
    ["preview", "preview.png"],
].flatMap(([field, legacyName]) => {
    const fileName = pluginManifest[field] || (fs.existsSync(path.join("assets", legacyName)) ? legacyName : "");
    if (!fileName) {
        return [];
    }
    const source = path.join("assets", fileName);
    if (!fs.existsSync(source)) {
        throw new Error(`plugin.json 的 ${field} 声明了 ${fileName}，但 ${source} 不存在`);
    }
    return [{from: source, to: "./dist/"}];
});

module.exports = (env, argv) => {
    const production = argv.mode === "production";
    const plugins = [
        new MiniCssExtractPlugin({
            filename: production ? "dist/index.css" : "index.css",
        }),
    ];
    if (production) {
        plugins.push(
            // 头部只放一段短的许可声明：完整文本随包发在 LICENSE 里（见下面的 CopyPlugin）。
            // 不要把整份 LICENSE 塞进 banner —— AGPL 全文 34KB，只会变成 bundle 开头一大段注释。
            new webpack.BannerPlugin({
                banner: [
                    `${pluginManifest.displayName.default} v${pluginManifest.version} - ${pluginManifest.url}`,
                    "Copyright (C) 2026 wmy2981",
                    "SPDX-License-Identifier: AGPL-3.0-or-later",
                    "Licensed under the GNU Affero General Public License v3.0 or later; see LICENSE for the full text.",
                    "The sponsor icon in the donate button is taken from SiYuan (AGPL-3.0, (C) siyuan-note).",
                ].join("\n"),
            }),
        );
        plugins.push(
            new CopyPlugin({
                patterns: [
                    ...packageImagePatterns,
                    {from: "README*.md", to: "./dist/"},
                    // AGPL 要求分发时随附许可全文，所以 LICENSE 必须进 package.zip
                    {from: "LICENSE", to: "./dist/"},
                    {from: "plugin.json", to: "./dist/"},
                    {from: "src/i18n/", to: "./dist/i18n/"},
                ],
            }),
        );
        // package.zip 里必须是扁平结构（不带 dist/ 前缀），集市按根目录取文件
        plugins.push(
            new ZipPlugin({
                filename: "package.zip",
                algorithm: "gzip",
                include: [/dist/],
                pathMapper: (assetPath) => assetPath.replace("dist/", ""),
            }),
        );
    } else {
        plugins.push(
            new CopyPlugin({
                patterns: [
                    {from: "src/i18n/", to: "./i18n/"},
                ],
            }),
        );
    }
    return {
        mode: argv.mode || "development",
        watch: !production,
        devtool: production ? false : "eval-source-map",
        output: {
            filename: "[name].js",
            path: path.resolve(__dirname),
            libraryTarget: "commonjs2",
            library: {
                type: "commonjs2",
            },
        },
        externals: {
            siyuan: "siyuan",
        },
        entry: {
            [production ? "dist/index" : "index"]: "./src/index.ts",
        },
        optimization: {
            minimize: production,
            minimizer: [
                // 保留全部 console 调用：插件出问题时可诊断性比几 KB 体积重要得多。
                // esbuild 的压缩默认会丢掉 console.log，那正是「点了保存但没有任何提示」的帮凶。
                new EsbuildPlugin({
                    drop: [],
                    pure: [],
                }),
            ],
        },
        resolve: {
            extensions: [".ts", ".scss", ".js", ".json"],
        },
        module: {
            rules: [
                {
                    test: /\.ts(x?)$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        {
                            loader: "esbuild-loader",
                            options: {
                                target: "es6",
                            },
                        },
                    ],
                },
                {
                    test: /\.scss$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        MiniCssExtractPlugin.loader,
                        {
                            loader: "css-loader",
                        },
                        {
                            loader: "sass-loader",
                        },
                    ],
                },
            ],
        },
        plugins,
    };
};
