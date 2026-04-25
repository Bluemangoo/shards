import { EventStack } from "./types/event_stack.ts";
import { loginInfo, napcat } from "./napcat/client.ts";
import { registerNapcat } from "./napcat/filter.ts";
import { ChatWindow } from "./utils/chat_window.ts";
import { initDb } from "./data/database/db.ts";
import { NapCatEvent } from "./types/event.ts";
import { onEventBatch } from "./main_loop/life_cycle.ts";
import workingMemory from "./model/working_memory.ts";
import { sleep } from "./utils/sleep.ts";

export const eventStack = new EventStack<ChatWindow, { [key: string]: NapCatEvent }>(5);
export default async function main() {
    const runningTasks: Promise<any>[] = [];
    await initDb();
    console.log("Database initialized");
    await workingMemory.load();
    registerNapcat(napcat, eventStack);
    runningTasks.push(
        napcat.connect().then(async () => {
            const info = await napcat.get_login_info();
            loginInfo.data = info;
            console.log(`Napcat connected: ${info.nickname} (${info.user_id})`);
        }),
    );
    runningTasks.push(listenStack());
    await Promise.all(runningTasks);
}

async function listenStack() {
    for await (const [window, stack, confirm] of eventStack.subscribe()) {
        try {
            await onEventBatch(window, stack);
        } catch (e) {
            console.error(e);
            await sleep(5000);
            confirm(false);
        }
    }
}
