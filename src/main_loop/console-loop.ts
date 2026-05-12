import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CONFIG, reloadConfig } from "../data/config/config.ts";
import { mainModel } from "../model/main-model.ts";
import { liteModel } from "../model/lite-model.ts";
import { imageModel } from "../model/image-model.ts";
import { loginInfo, napcat } from "../napcat/client.ts";
import { eventStack } from "../main.ts";
import { reloadPrompt } from "../data/config/prompts.ts";

export function consoleLoop() {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    process.stdin.unref();

    rl.on("line", async (line) => {
        const text = line.trim();

        if (text === "reload") {
            reloadConfig();
            reloadPrompt();
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
                console.log(
                    `Current login ${loginInfo.nickname}(${loginInfo.user_id}, now logout)`,
                );
                await napcat.disconnect();
            } catch (e) {
                // expected error
            }
            await napcat.connect();
            const info = await napcat.get_login_info();
            loginInfo.data = info;
            console.log(`Napcat connected: ${info.nickname} (${info.user_id})`);
        }

        if (text === "next") {
            eventStack.next();
        }
    });

    rl.on("SIGINT", () => {
        process.exit(0);
    });

    return rl;
}
