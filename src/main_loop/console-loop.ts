import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CONFIG, reloadConfig } from "../data/config/config.ts";
import { mainModel } from "../model/main-model.ts";
import { liteModel } from "../model/lite-model.ts";
import { imageModel } from "../model/image-model.ts";
import { loginInfo, napcat } from "../napcat/client.ts";
import { eventStack } from "../main.ts";
import { reloadPrompt } from "../data/config/prompts.ts";
import { compressLogs } from "../log/ws.ts";
import { isSleeping } from "./life-cycle.ts";

export function consoleLoop() {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    process.stdin.unref();
    // noinspection JSUnusedGlobalSymbols
    const func: Record<string, () => unknown> = {
        reload,
        relogin,
        next,
        drop,
        sleep,
        wakeup,
        "compress logs": compressLogs,
        config,
        status,
    };

    rl.on("line", async (line) => {
        const text = line.trim();

        if (text === "help") {
            console.log("Available:", Object.keys(func).join(", "));
        }

        func[text]?.();
    });

    rl.on("SIGINT", () => {
        process.exit(0);
    });

    return rl;
}

async function reload() {
    reloadConfig();
    reloadPrompt();
    mainModel.model = CONFIG.mainModel.model;
    mainModel.client.baseURL = CONFIG.mainModel.baseUrl;
    mainModel.client.apiKey = CONFIG.mainModel.apiKey;
    mainModel.reasoningEffort = CONFIG.mainModel.reasoningEffort;
    liteModel.model = CONFIG.liteModel.model;
    liteModel.client.baseURL = CONFIG.liteModel.baseUrl;
    liteModel.client.apiKey = CONFIG.liteModel.apiKey;
    imageModel.model = CONFIG.imageModel.model;
    imageModel.client.baseURL = CONFIG.imageModel.baseUrl;
    imageModel.client.apiKey = CONFIG.imageModel.apiKey;
    console.log("Config reloaded.");
}

async function relogin() {
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

async function next() {
    eventStack.next();
}
async function drop() {
    eventStack.clear();
}
async function config() {
    console.log(CONFIG);
}
async function sleep() {
    isSleeping.v = true;
}
async function wakeup() {
    isSleeping.v = false;
}
async function status() {
    console.log(`Sleeping: ${isSleeping.v}`);
    const eventStackStatus = eventStack.status();
    console.log(`Event stack: (${eventStackStatus.size})`);
    for (const [window, stack] of eventStackStatus) {
        console.log(`- ${window?.type} ${window?.id} (${stack.length})`);
    }
}
