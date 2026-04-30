import { EventStore } from "../data/database/event_store.ts";
import { NapCatEvent } from "../types/event.ts";
import { ChatWindow } from "../utils/chat_window.ts";
import { ChatNode, ConsumedEvent, history } from "../data/database/history.ts";
import { eventStack } from "../main.ts";
import { ModelContext } from "../utils/context.ts";
import { mainModel } from "../model/main_model.ts";
import { liteModel } from "../model/lite_model.ts";
import { longTermMemory } from "../model/long_term_memory.ts";
import { EVENT_HINT_MAP } from "../napcat/filter.ts";
import { Receive } from "node-napcat-ts/dist/Structs";
import { loginInfo } from "../napcat/client.ts";

export async function storeEvent(event: any) {
    await EventStore.push_event(event);
}

function shouldIgnore(event: NapCatEvent) {
    if (
        event.hint == EVENT_HINT_MAP["notice.notify.poke.friend"] ||
        event.hint == EVENT_HINT_MAP["notice.notify.poke.group"]
    ) {
        return event.sender_id == event.self_id;
    }
    return false;
}

function shouldInstantlyProcess(event: NapCatEvent) {
    if (event.message != null) {
        const self_id_str = String(loginInfo.data!.user_id);
        for (const seg of event.message as Receive[keyof Receive][]) {
            if (seg.type == "at") {
                if (seg.data.qq == "all" || seg.data.qq == self_id_str) {
                    return true;
                }
            }
        }
    }
    return false;
}

export async function onEvent(event: NapCatEvent) {
    console.log("Received event:", JSON.stringify(event));
    const window = ChatWindow.fromEvent(event);
    await history.getWindowHistory(window); // try init
    await storeEvent(event);
    history.addEvent(event);
    if (window && shouldIgnore(event)) {
        history.addPretendProcessedEvent(window, [event]);
        return;
    }
    eventStack.push(window, event, shouldInstantlyProcess(event));
}

export async function onEventBatch(window: ChatWindow | null, batch: NapCatEvent[]) {
    let his: ConsumedEvent[];
    if (window) {
        his = await history.getWindowHistory(window);
    } else {
        his = [];
    }
    const trace = await mainModel.response_chat(batch, his, new ModelContext(window ?? undefined));
    history.addProcessedEvent(window, batch, new ChatNode(trace));
    await Promise.all([processWorkingMemory(batch, trace), processLongTermMemory(batch, trace)]);
}

async function processWorkingMemory(batch: NapCatEvent[], trace: string[]) {
    try {
        console.log("Processing working memory");
        await liteModel.processWorkingMemory(batch, trace);
        console.log("Saved working memory");
    } catch (e) {
        console.error("Failed to process working memory", e);
    }
}

async function processLongTermMemory(batch: NapCatEvent[], trace: string[]) {
    try {
        console.log("Processing long-term memory");
        await longTermMemory.addFromEvent(batch, trace);
        console.log("Saved long-term memory");
    } catch (e) {
        console.error("Failed to process long-term memory", e);
    }
}
