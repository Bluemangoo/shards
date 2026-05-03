import {
    cached_get_friend_info,
    cached_get_group_info,
    cached_get_group_member_display_name,
    cached_get_group_member_info,
    cached_get_stranger_display_name,
} from "./wrapper.ts";
import { HintInjectedEvent, NapcatEvent } from "../types/event.ts";
import { EVENT_HINT_MAP } from "./filter.ts";
import { GroupMessage } from "node-napcat-ts";
import { NapcatResult } from "../types/napcat_api.ts";

export function stripGroupInfo(groupInfo: NapcatResult["get_group_info"]) {
    return {
        group_id: groupInfo.group_id,
        group_name: groupInfo.group_name,
        group_remark: groupInfo.group_remark,
        member_count: groupInfo.member_count,
    };
}

export async function stripPoke(
    event: Extract<
        HintInjectedEvent,
        {
            hint: (typeof EVENT_HINT_MAP)["notice.notify.poke.group" | "notice.notify.poke.friend"];
        }
    >,
) {
    let name1: string;
    let name2: string;
    let groupId: number | undefined = undefined;
    if (event.hint == EVENT_HINT_MAP["notice.notify.poke.group"]) {
        const user1_is_self = event.user_id == event.self_id;
        const user2_is_self = event.target_id == event.self_id;

        name1 = user1_is_self
            ? "你"
            : await cached_get_group_member_display_name(event.user_id, event.group_id);
        name2 = user2_is_self
            ? "你"
            : await cached_get_group_member_display_name(event.target_id, event.group_id);
        groupId = event.group_id;
    } else {
        const user1_is_self = event.sender_id == event.self_id;
        const user2_is_self = event.target_id == event.self_id;

        name1 = user1_is_self
            ? "你"
            : (await cached_get_stranger_display_name(event.sender_id)) || String(event.sender_id);
        name2 = user2_is_self
            ? "你"
            : (await cached_get_stranger_display_name(event.sender_id)) || String(event.target_id);
    }
    let cnt = 0;
    let stringified_message = "";
    for (const component of event.raw_info) {
        if (component.type === "qq") {
            stringified_message += cnt > 0 ? name2 : name1;
            cnt++;
        } else if (component.type === "nor") {
            stringified_message += component.txt;
        }
    }
    return {
        hint: event.hint,
        time: event.time,
        self_id: event.self_id,
        post_type: event.post_type,
        sub_type: event.sub_type,
        group_id: groupId,
        target_id: event.target_id,
        sender_id: event.sender_id,
        stringified_message: stringified_message,
    };
}

export async function stripFullPrivateMessage(
    event: Extract<
        HintInjectedEvent,
        { hint: (typeof EVENT_HINT_MAP)["message.private.friend" | "message.private.group"] }
    >,
) {
    let displayName;
    if (event.self_id == event.sender.user_id) {
        displayName = "我";
    } else {
        displayName = event.sender.card || event.sender.nickname;
    }
    return {
        time: event.time,
        sender: displayName,
        message_id: event.message_id,
        raw_message: event.raw_message,
        message: event.message,
        hint: event.hint,
    };
}

export async function stripFullGroupMessage(
    event: Extract<
        HintInjectedEvent,
        {
            hint: (typeof EVENT_HINT_MAP)["message.group.normal"];
        }
    >,
) {
    let isSelf = event.self_id == event.sender.user_id;
    const senderInfo = await cached_get_group_member_info(event.sender.user_id, event.group_id);
    let sender = {
        is_self: isSelf,
        ...event.sender,
        title: senderInfo.title,
    };
    return {
        time: event.time,
        sender: sender,
        message_id: event.message_id,
        raw_message: event.raw_message,
        message: event.message,
        hint: event.hint,
    };
}

export async function getGroupMessageModelHint(
    event: Extract<
        HintInjectedEvent,
        {
            hint: (typeof EVENT_HINT_MAP)["message.group.normal"];
        }
    >,
) {
    return {
        type: "群聊",
        ...stripGroupInfo(await cached_get_group_info(event.group_id)),
    };
}

export async function getPrivateMessageModelHint(
    event: Extract<
        HintInjectedEvent,
        { hint: (typeof EVENT_HINT_MAP)["message.private.friend" | "message.private.group"] }
    >,
) {
    let user:
        | {
              user_id: number;
              nickname: string;
              ingroup_card: string;
              from?: ReturnType<typeof stripGroupInfo>;
          }
        | { user_id: number; nickname?: string; remark?: string };
    if (event.hint == EVENT_HINT_MAP["message.private.group"]) {
        const u = await cached_get_group_member_info(event.user_id, event.group_id);
        user = {
            user_id: event.user_id,
            nickname: u.nickname,
            ingroup_card: u.card,
            from: stripGroupInfo(await cached_get_group_info(event.group_id)),
        };
    } else {
        const u = await cached_get_friend_info(event.user_id);
        if (u) {
            user = {
                user_id: event.user_id,
                nickname: u.nickname,
                remark: u.remark,
            };
        } else {
            user = {
                user_id: event.user_id,
            };
        }
    }
    return {
        type: "私聊",
        ...user,
    };
}

export async function getPrivatePokeModelHint(event: NapcatEvent) {
    let user: { user_id: number; nickname?: string; remark?: string };
    const u = await cached_get_friend_info(event.user_id);
    if (u) {
        user = {
            nickname: u.nickname,
            remark: u.remark,
            user_id: event.user_id,
        };
    } else {
        user = {
            user_id: event.user_id,
        };
    }
    return {
        type: "私聊",
        ...user,
    };
}

export async function getGroupPokeModelHint(
    event: Extract<
        HintInjectedEvent,
        {
            hint: (typeof EVENT_HINT_MAP)["notice.notify.poke.group"];
        }
    >,
) {
    return {
        type: "群聊",
        ...stripGroupInfo(await cached_get_group_info(event.group_id)),
    };
}

export async function injectAt(e: HintInjectedEvent) {
    if (e.post_type == "message") {
        const event = e as GroupMessage;
        for (const seg of event.message) {
            if (seg.type == "at") {
                if (seg.data.qq == "all") {
                    (<any>seg.data).stringified = "@全体成员";
                    (<any>seg.data).include_self = true;
                    (<any>seg.data).is_self = false;
                } else {
                    const userInfo = await cached_get_group_member_info(
                        seg.data.qq,
                        event.group_id,
                    );
                    const displayName = await cached_get_group_member_display_name(
                        seg.data.qq,
                        event.group_id,
                    );
                    (<any>seg.data).stringified = `@${displayName}`;
                    (<any>seg.data).user = {
                        user_id: userInfo.user_id,
                        nickname: userInfo.nickname,
                        card: userInfo.card,
                    };
                    (<any>seg.data).include_self = (<any>seg.data).is_self =
                        seg.data.qq == String(event.self_id);
                }
            }
        }
    }
}

export async function preStringifyEvent(event: HintInjectedEvent) {
    let postEvent;
    switch (event.hint) {
        case EVENT_HINT_MAP["notice.notify.poke.friend"]:
        case EVENT_HINT_MAP["notice.notify.poke.group"]:
            postEvent = await stripPoke(event);
            break;
        case EVENT_HINT_MAP["message.group.normal"]:
            await injectAt(event);
            break;
        default:
            postEvent = event;
    }
    return postEvent;
}

export async function fullStripEvent(event: HintInjectedEvent) {
    let postEvent;
    postEvent = await preStringifyEvent(event);
    switch (event.hint) {
        case EVENT_HINT_MAP["message.group.normal"]:
            postEvent = await stripFullGroupMessage(event);
            break;
        case EVENT_HINT_MAP["message.private.friend"]:
        case EVENT_HINT_MAP["message.private.group"]:
            postEvent = await stripFullPrivateMessage(event);
            break;
    }
    const dateInjected: typeof postEvent & { formatted_time: string } = postEvent as any;
    const date = new Date(event.time * 1000);
    dateInjected.formatted_time = date.toLocaleDateString() + " " + date.toLocaleTimeString();
    return dateInjected;
}

export async function getModelHint<T extends HintInjectedEvent>(event: T) {
    switch (event.hint) {
        case EVENT_HINT_MAP["message.group.normal"]:
            return await getGroupMessageModelHint(event);
        case EVENT_HINT_MAP["message.private.friend"]:
        case EVENT_HINT_MAP["message.private.group"]:
            return await getPrivateMessageModelHint(event);
        case EVENT_HINT_MAP["notice.notify.poke.friend"]:
            return await getPrivatePokeModelHint(event);
        case EVENT_HINT_MAP["notice.notify.poke.group"]:
            return await getGroupPokeModelHint(event);
        default:
            return null;
    }
}
