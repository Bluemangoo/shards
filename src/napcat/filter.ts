import { NCWebsocket } from "node-napcat-ts";
import { onEvent } from "../main_loop/life-cycle.ts";
import { HintInjectedEvent, NapcatEvent } from "../types/event.ts";
import { NapcatResult } from "../types/napcat-api.ts";
import { EventKey } from "node-napcat-ts/dist/Interfaces";

export const EVENT_HINT_MAP = {
    "message.private.friend": "private_message",
    "message.group.normal": "group_normal",
    "message.private.group": "temporary_private_message",
    "notice.notify.poke.friend": "private_poke",
    "notice.notify.poke.group": "group_poke",
    "notice.group_ban.ban": "group_ban",
    "notice.group_ban.lift_ban": "group_lift_ban",
    "request.friend": "friend_add_request",
    "notice.group_increase": "group_member_increase",
    "notice.group_decrease": "group_member_decrease",
    "notice.notify.title": "title_change"
} as const satisfies Partial<Record<EventKey, string>>;

export function injectRawMsg(event: NapcatResult["get_msg"], extra?: Record<string, any>) {
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
    if (extra) {
        for (const key in extra) {
            (e as any)[key] = extra[key];
        }
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
        push(e, EVENT_HINT_MAP["notice.notify.poke.friend"]);
    });
    napcat.on("notice.notify.poke.group", (e) => {
        push(e as any, EVENT_HINT_MAP["notice.notify.poke.group"]);
    });
    napcat.on("notice.group_ban.ban", (e) => {
        push(e, EVENT_HINT_MAP["notice.group_ban.ban"]);
    });
    napcat.on("notice.group_ban.lift_ban", (e) => {
        push(e, EVENT_HINT_MAP["notice.group_ban.lift_ban"]);
    });
    napcat.on("request.friend", (e) => {
        push(e, EVENT_HINT_MAP["request.friend"]);
    });
    napcat.on("notice.group_increase", (e)=>{
        push(e, EVENT_HINT_MAP["notice.group_increase"]);
    })
    napcat.on("notice.group_decrease", (e) => {
        push(e, EVENT_HINT_MAP["notice.group_decrease"]);
    });
    napcat.on("notice.notify.title", (e)=>{
        push(e, EVENT_HINT_MAP["notice.notify.title"]);
    })
}
