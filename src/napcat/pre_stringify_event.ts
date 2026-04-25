import {
    cached_get_friend_display_name,
    cached_get_friend_info,
    cached_get_group_info,
    cached_get_group_member_display_name,
    cached_get_group_member_info,
} from "./wrapper.ts";
import { NapCatEvent } from "../types/event.ts";
import { EVENT_HINT_MAP } from "./filter.ts";

export function stripGroupInfo<
    T extends {
        group_remark: string;
        group_id: number;
        group_name: string;
        member_count: number;
    },
>(groupInfo: T) {
    return {
        group_id: groupInfo.group_id,
        group_name: groupInfo.group_name,
        group_remark: groupInfo.group_remark,
        member_count: groupInfo.member_count,
    };
}

export async function stripPoke(event: any) {
    let name1: string;
    let name2: string;
    if (event.group_id != undefined) {
        const user1_is_self = event.user_id == event.self_id;
        const user2_is_self = event.target_id == event.self_id;

        name1 = user1_is_self
            ? "你"
            : await cached_get_group_member_display_name(event.user_id, event.group_id);
        name2 = user2_is_self
            ? "你"
            : await cached_get_group_member_display_name(event.target_id, event.group_id);
    } else {
        const user1_is_self = event.sender_id == event.self_id;
        const user2_is_self = event.target_id == event.self_id;

        name1 = user1_is_self
            ? "你"
            : (await cached_get_friend_display_name(event.sender_id)) || event.sender_id;
        name2 = user2_is_self
            ? "你"
            : (await cached_get_friend_display_name(event.target_id)) || event.target_id;
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
        group_id: event.group_id,
        target_id: event.target_id,
        sender_id: event.sender_id,
        stringified_message: stringified_message,
    };
}

export async function stripFullPrivateMessage(event: NapCatEvent) {
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

export async function stripFullGroupMessage(event: NapCatEvent) {
    let isSelf = event.self_id == event.sender.user_id;
    let sender = {
        is_self: isSelf,
        ...event.sender,
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

export async function getGroupMessageModelHint(event: NapCatEvent) {
    return {
        type: "群聊",
        ...stripGroupInfo(await cached_get_group_info(event.group_id)),
    };
}

export async function getPrivateMessageModelHint(event: NapCatEvent) {
    const isTempChat = event.group_id != null;
    let user: Record<string, any>;
    if (isTempChat) {
        const u = await cached_get_group_member_info(event.user_id, event.group_id);
        user = {
            nickname: u.nickname,
            ingroup_card: u.card,
            from: stripGroupInfo(await cached_get_group_info(event.group_id)),
        };
    } else {
        const u = await cached_get_friend_info(event.user_id);
        if (u) {
            user = {
                nickname: u.nickname,
                remark: u.remark,
            };
        } else {
            user = {};
        }
    }
    user.user_id = event.user_id;
    return {
        type: "私聊",
        ...user,
    };
}

export async function getPrivatePokeModelHint(event: NapCatEvent) {
    let user: Record<string, any>;
    const u = await cached_get_friend_info(event.user_id);
    if (u) {
        user = {
            nickname: u.nickname,
            remark: u.remark,
        };
    } else {
        user = {};
    }
    user.user_id = event.user_id;
    return {
        type: "私聊",
        ...user,
    };
}

export async function getGroupPokeModelHint(event: NapCatEvent) {
    return {
        type: "群聊",
        ...stripGroupInfo(await cached_get_group_info(event.group_id)),
    };
}

export async function preStringifyEvent(event: NapCatEvent) {
    switch (event.hint) {
        case EVENT_HINT_MAP["notice.notify.poke.friend"]:
        case EVENT_HINT_MAP["notice.notify.poke.group"]:
            event = await stripPoke(event);
            break;
    }
    return event;
}

export async function fullStripEvent(event: NapCatEvent) {
    event = await preStringifyEvent(event);
    switch (event.hint) {
        case EVENT_HINT_MAP["message.group.normal"]:
            event = await stripFullGroupMessage(event);
            break;
        case EVENT_HINT_MAP["message.private.friend"]:
        case EVENT_HINT_MAP["message.private.group"]:
            event = await stripFullPrivateMessage(event);
            break;
    }
    const date = new Date(event.time * 1000);
    event.formatted_time = date.toLocaleDateString() + " " + date.toLocaleTimeString();
    return event;
}

export async function getModelHint(event: NapCatEvent): Promise<Record<string, any> | null> {
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
