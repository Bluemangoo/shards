import { NCWebsocket } from "node-napcat-ts";
import { EventStack } from "../types/event_stack.ts";
import { ChatWindow } from "../utils/chat_window.ts";
import { onEvent } from "../main_loop/life_cycle.ts";

export const EVENT_HINT_MAP = {
    "message.private.friend": "private_message",
    "message.group.normal": "group.normal",
    "message.private.group": "temporary_private_message",
    "notice.notify.poke.friend": "private_poke",
    "notice.notify.poke.group": "group_poke",
};

export function registerNapcat(napcat: NCWebsocket, eventStack: EventStack<ChatWindow, any>) {
    function push(e: any, hint: string) {
        e["hint"] = hint;
        onEvent(e);
    }
    napcat.on("message.private.friend", (e) => {
        push(e, EVENT_HINT_MAP["message.private.friend"]);
    });
    napcat.on("message.group.normal", (e) => {
        push(e, EVENT_HINT_MAP["message.group.normal"]);
    });
    napcat.on("message.private.group", (e) => {
        push(e, EVENT_HINT_MAP["message.private.group"]);
    });
    napcat.on("notice.notify.poke.friend", (e) => {
        push(e, EVENT_HINT_MAP["notice.notify.poke.friend"]);
    });
    napcat.on("notice.notify.poke.group", (e) => {
        push(e, EVENT_HINT_MAP["notice.notify.poke.group"]);
    });
}
