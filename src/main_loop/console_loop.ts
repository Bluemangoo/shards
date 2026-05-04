import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CONFIG, reloadConfig } from "../data/config/config.ts";
import { loadPrompts as loadMainPrompts, mainModel } from "../model/main_model.ts";
import { liteModel, loadPrompts as loadLitePrompts } from "../model/lite_model.ts";
import { imageModel, loadPrompts as loadImagePrompts } from "../model/image_model.ts";
import { loginInfo, napcat } from "../napcat/client.ts";

export function consoleLoop() {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    process.stdin.unref();

    rl.on("line", async (line) => {
        const text = line.trim();

        if (text === "reload") {
            reloadConfig();
            loadMainPrompts();
            loadLitePrompts();
            loadImagePrompts();
            mainModel.model = CONFIG.mainModel.model;
            mainModel.client.baseURL = CONFIG.mainModel.baseUrl;
            mainModel.client.apiKey = CONFIG.mainModel.apiKey;
            liteModel.model = CONFIG.liteModel.model;
            liteModel.client.baseURL = CONFIG.liteModel.baseUrl;
            liteModel.client.apiKey = CONFIG.liteModel.apiKey;
            imageModel.model = CONFIG.imageModel.model;
            imageModel.client.baseURL = CONFIG.imageModel.baseUrl;
            imageModel.client.apiKey = CONFIG.imageModel.apiKey;
            console.log("Config reloaded.");
        }

        if (text === "relogin") {
            try {
                const loginInfo = await napcat.get_login_info();
                console.log(`Current login ${loginInfo.nickname}(${loginInfo.user_id}, now logout)`);
                await napcat.disconnect();
            } catch (e) {
                // expected error
            }
            await napcat.connect();
            const info = await napcat.get_login_info();
            loginInfo.data = info;
            console.log(`Napcat connected: ${info.nickname} (${info.user_id})`);
        }
    });

    rl.on("SIGINT", () => {
        process.exit(0);
    });

    return rl;
}
