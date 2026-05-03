import { NCWebsocket } from "node-napcat-ts";
import { onEvent } from "../main_loop/life_cycle.ts";
import { HintInjectedEvent, NapcatEvent } from "../types/event.ts";
import { NapcatResult } from "../types/napcat_api.ts";

export const EVENT_HINT_MAP = {
    "message.private.friend": "private_message",
    "message.group.normal": "group_normal",
    "message.private.group": "temporary_private_message",
    "notice.notify.poke.friend": "private_poke",
    "notice.notify.poke.group": "group_poke",
} as const;

export function injectMsgHint(event: NapcatResult["get_msg"]) {
    const e = event as unknown as Extract<
        HintInjectedEvent,
        {
            hint: (typeof EVENT_HINT_MAP)[
                | "message.private.friend"
                | "message.private.group"
                | "message.group.normal"];
        }
    >;
    if (e.message_type == "private" && e.sub_type == "group") {
        e.hint = EVENT_HINT_MAP["message.private.group"];
    } else if (e.message_type == "group") {
        e.hint = EVENT_HINT_MAP["message.group.normal"];
    } else {
        e.hint = EVENT_HINT_MAP["message.private.friend"];
    }
    return e;
}

export function registerNapcat(napcat: NCWebsocket) {
    function push(e: NapcatEvent, hint: (typeof EVENT_HINT_MAP)[keyof typeof EVENT_HINT_MAP]) {
        (e as HintInjectedEvent).hint = hint;
        onEvent(e as HintInjectedEvent);
    }
    // for "e as any", it works on my machine. update your napcat.
    napcat.on("message.private.friend", (e) => {
        push(e, EVENT_HINT_MAP["message.private.friend"]);
    });
    napcat.on("message.group.normal", (e) => {
        push(e, EVENT_HINT_MAP["message.group.normal"]);
    });
    napcat.on("message.private.group", (e) => {
        push(e as any, EVENT_HINT_MAP["message.private.group"]);
    });
    napcat.on("notice.notify.poke.friend", (e) => {
        push(e as any, EVENT_HINT_MAP["notice.notify.poke.friend"]);
    });
    napcat.on("notice.notify.poke.group", (e) => {
        push(e as any, EVENT_HINT_MAP["notice.notify.poke.group"]);
    });
}
