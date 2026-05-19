import { EventStack } from "./types/event-stack.ts";
import { loginInfo, napcat } from "./napcat/client.ts";
import { registerNapcat } from "./napcat/filter.ts";
import { ChatWindow } from "./utils/chat-window.ts";
import { initDb } from "./data/database/db.ts";
import { HintInjectedEvent } from "./types/event.ts";
import { onEventBatch } from "./main_loop/life-cycle.ts";
import workingMemory from "./model/working-memory.ts";
import { consoleLoop } from "./main_loop/console-loop.ts";
import { dreamingLoop } from "./main_loop/dreaming-loop.ts";
import { initFace } from "./utils/qface.ts";

export const eventStack = new EventStack<ChatWindow, HintInjectedEvent>(5);
export default async function main() {
    const runningTasks: Promise<any>[] = [];
    await initDb();
    console.log("Database initialized");
    await initFace();
    consoleLoop();
    await workingMemory.load();
    registerNapcat(napcat);
    runningTasks.push(
        napcat.connect().then(async () => {
            const info = await napcat.get_login_info();
            loginInfo.data = info;
            console.log(`Napcat connected: ${info.nickname} (${info.user_id})`);
        }),
    );
    runningTasks.push(listenStack());
    runningTasks.push(dreamingLoop());
    await Promise.all(runningTasks);
}

async function listenStack() {
    for await (const [window, stack, confirm] of eventStack.subscribe()) {
        try {
            await onEventBatch(window, stack);
        } catch (e) {
            console.error(e);
            // await sleep(5000);
            confirm(false);
        }
    }
}
