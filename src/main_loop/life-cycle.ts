import { EventStore } from "../data/database/event-store.ts";
import { HintInjectedEvent } from "../types/event.ts";
import { ChatWindow } from "../utils/chat-window.ts";
import { ChatNode, ConsumedEvent, history } from "../data/database/history.ts";
import { eventStack } from "../main.ts";
import { ModelContext } from "../utils/context.ts";
import { mainModel } from "../model/main-model.ts";
import { liteModel } from "../model/lite-model.ts";
import { longTermMemory } from "../model/long-term-memory.ts";
import { loginInfo } from "../napcat/client.ts";
import { deepContains } from "../utils/obj.ts";
import logger from "../log/logger.ts";

export async function storeEvent(event: HintInjectedEvent) {
    await EventStore.push_event(event);
}

export type ExpectedEvent = {
    ends: number;
    matches: Record<string, any>;
    addToHistory?: boolean;
};
export const expectedEvents = new Set<ExpectedEvent>();
export const isSleeping = { v: false };

function shouldIgnore(event: HintInjectedEvent) {
    const now = Date.now();
    for (const e of expectedEvents) {
        if (e.ends < now) {
            expectedEvents.delete(e);
            continue;
        }
        if (deepContains(event, e)) {
            expectedEvents.delete(e);
            if (e.addToHistory) {
                history.addPretendProcessedEvent(ChatWindow.fromEvent(event), [event]);
            }
            return true;
        }
    }
    if (event.post_type == "notice" && event.sub_type == "poke") {
        if (event.sender_id == event.self_id) {
            history.addPretendProcessedEvent(ChatWindow.fromEvent(event), [event]);
            return true;
        }
    }
    return isSleeping.v;
}

function shouldInstantlyProcess(event: HintInjectedEvent) {
    if (event.post_type == "message") {
        const self_id_str = String(loginInfo.data!.user_id);
        for (const seg of event.message) {
            if (seg.type == "at") {
                if (seg.data.qq == "all" || seg.data.qq == self_id_str) {
                    return true;
                }
            }
        }
    }
    return false;
}

export async function onEvent(event: HintInjectedEvent) {
    logger.info(["napcat", "new-event"], "Received event:", JSON.stringify(event));
    const window = ChatWindow.fromEvent(event);
    await history.getWindowHistory(window); // try init
    await storeEvent(event);
    history.addEvent(event);
    if (shouldIgnore(event)) {
        return;
    }
    eventStack.push(window, event, shouldInstantlyProcess(event));
}

export async function onEventBatch(window: ChatWindow | null, batch: HintInjectedEvent[]) {
    let his: ConsumedEvent[];
    if (window) {
        his = await history.getWindowHistory(window);
    } else {
        his = [];
    }
    const trace = await mainModel.response_chat(batch, his, new ModelContext(window ?? undefined));
    history.addProcessedEvent(window, batch, new ChatNode(trace));
    await Promise.all([
        processWorkingMemory(batch, trace, his),
        processLongTermMemory(batch, trace, his),
    ]);
}

async function processWorkingMemory(
    batch: HintInjectedEvent[],
    trace: string[],
    history: ConsumedEvent[],
) {
    try {
        logger.info(["model", "lite-model", "working-memory"], "Processing working memory");
        await liteModel.processWorkingMemory(batch, trace, history);
        logger.info(["model", "lite-model", "working-memory"], "Saved working memory");
    } catch (e) {
        logger.error(
            ["model", "lite-model", "working-memory"],
            "Failed to process working memory",
            e,
        );
    }
}

async function processLongTermMemory(
    batch: HintInjectedEvent[],
    trace: string[],
    history: ConsumedEvent[],
) {
    try {
        logger.info(
            ["model", "lite-model", "long-term-memory", "add"],
            "Processing long-term memory",
        );
        await longTermMemory.addFromEvent(batch, trace, history);
        logger.info(["model", "lite-model", "long-term-memory", "add"], "Saved long-term memory");
    } catch (e) {
        logger.info(
            ["model", "lite-model", "long-term-memory", "add"],
            "Failed to process long-term memory",
            e,
        );
    }
}
