/**
 * 插件入口：卸载行为。
 *
 * 卸载只该落下一条提示，**不能**删插件私有目录里的任何东西 —— 配置与用户的
 * `.patch.yml` 都要留给重装后的自己。这里用宿主替身观察「有没有发删除请求」。
 */
import {
    describe,
    expect,
    it,
} from "vitest";
import SomeSettingsPlugin from "../src/index";
import {mockState} from "./mocks/siyuan";

const pluginOf = (): SomeSettingsPlugin =>
    new SomeSettingsPlugin(
        {i18n: {"plugin.unloaded": "Some Settings unloaded"}} as never,
    ) as SomeSettingsPlugin;

describe("uninstall", () => {
    it("keeps the whole plugin storage directory", async () => {
        const plugin = pluginOf();
        mockState.fetchSyncPost.mockClear();
        await plugin.uninstall();
        // 既不列目录、也不删文件、更不删目录
        expect(mockState.fetchSyncPost).not.toHaveBeenCalled();
        expect(plugin.removeData).not.toHaveBeenCalled();
    });

    it("still tells the user the plugin is gone", async () => {
        await pluginOf().uninstall();
        expect(mockState.messages).toHaveLength(1);
        expect(mockState.messages[0].text).toContain("Some Settings unloaded");
    });
});
