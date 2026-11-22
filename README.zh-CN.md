[English](README.md) | [繁體中文](README.zh-TW.md)

# 一些设置

> 一批**可独立启停**的思源增强功能：每个设置项都能单独启用或禁用。

欢迎反馈问题、建议新功能，请[创建 Issue](https://github.com/wmy2981/some-settings-siyuan/issues/new/choose)。

## 功能清单

分类按功能作用到的思源原生功能划分，与设置面板里的页签一一对应。

### 人工智能

* DeepSeek 余额显示
* 智能体回车发送
* 隐藏智能体新会话的推荐操作
* 智能体思考标题固定在顶部
* 智能体工具调用显示细节
* 智能体思考翻译

### 编辑器

* 代码块语言不记忆
* 外链跳转前确认
* 资源文件菜单显示文件大小与元数据
* 斜杠命令新建文件到 assets
* 用悬浮窗口取代录音提示
* 标题图标显示层级
* 行内代码复制按钮
* 隐藏选中文字工具条

### 文档树

* 固定首次添加的文档图标
* 书签打开笔记时跳到上次位置
* 文档树已打开笔记强调色
* 文档树标题渲染行级 Markdown
* 页签标题渲染行级 Markdown
* 自动收起闲置页签
* 大纲显示层级
* 移动端文档树标题字号回归 3.8.9
* 日记直接创建
* 新建文档到固定位置

### 外观

* Modal 遮罩模糊
* 退出应用遮罩始终模糊
* 桌面端命令面板瘦身
* 移动端悬浮 dock 栏高斯模糊
* 移动端栏体动画优化
* 移动端增大候选浮层高度
* 移动端常显立即同步
* 移动端下拉用思源原生样式
* 移动端长按菜单补文字
* 移动端块标保持显示
* 隐藏移动端退出应用按钮

### 连接

* 断连面板立即重连按钮
* 断连后自动重连

### 设置

* 退出应用前弹窗确认
* 阿里云 OSS 存储桶使用数据
* 代码片段编辑区高亮
* F12 开关开发者工具
* 控制台日志查看器

### 集市

* 集市包自定义图标
* 按作者屏蔽集市包
* 隐藏集市已下载页捐赠按钮

### 插件自身

* 详细日志输出
* 显示不可用的设置
* 设置面板搜索
* 清除本插件配置
* 关于本插件
* 插件配置导入导出

## 安装

1. **思源集市** —— 打开 **设置 → 集市**，找到「一些设置」直接安装；后续更新也走这里。
2. **发行版下载** —— 从 [Releases](https://github.com/wmy2981/some-settings-siyuan/releases) 下载
   `package.zip`，解压到 `<工作空间>/data/plugins/some-settings-siyuan/`，让 `plugin.json` 直接躺在这个目录下，
   然后重启思源。
3. **自行编译** —— 克隆仓库后 `npm install`，再 `npm run build`（需要 Node 24 及以上）；构建产物里有
   `package.zip` 和扁平的 `dist/`，把其中任一个解压到同一个目录即可。

然后打开 **设置 → 集市 → 已下载 → 一些设置 → 设置**，这是唯一的入口 —— 插件不在顶栏、状态栏、
停靠栏注册任何按钮。

## 高级用法

在自己的机器上覆盖功能声明与界面文案，参见[用户级声明补丁：`.patch.yml`](docs/patch.zh-CN.md)。

## 集市趋势图表

![集市趋势图表](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/some-settings-siyuan?metrics=downloads,rating,ratings&range=all&area=true&lang=zh)

## 开发

需要 Node.js 24 及以上，克隆仓库后按需执行：

```bash
npm ci              # 安装依赖
npm run dev         # 监听源码，把 index.js / index.css / i18n 直接写到仓库根目录
npm run build       # 校验功能声明后打包出 dist/ 与 package.zip
npm run check       # 只校验功能声明与三份语言文件
npm run typecheck   # TypeScript 类型检查
npm run lint        # ESLint
npm run format      # dprint 格式化（format:check 只检查不写盘）
npm test            # 单元测试（vitest）
```

## 许可证

[AGPL-3.0-or-later](./LICENSE)

随插件分发的第三方内容与构建期工具见[第三方声明](./THIRD_PARTY_NOTICES.md)。
