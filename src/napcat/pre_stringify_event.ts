import {
    cached_get_friend_info,
    cached_get_group_info,
    cached_get_group_member_display_name,
    cached_get_group_member_info,
    cached_get_stranger_display_name,
    cached_get_stranger_info,
} from "./wrapper.ts";
import { HintInjectedEvent, NapcatEvent } from "../types/event.ts";
import { EVENT_HINT_MAP } from "./filter.ts";
import { GroupMessage } from "node-napcat-ts";
import { NapcatResult } from "../types/napcat_api.ts";
import { stringifyDurationSeconds } from "../utils/time.ts";

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
            : (await cached_get_stranger_display_name(event.target_id)) || String(event.target_id);
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
        stringified_message,
    };
}

export async function stripBan(
    event: Extract<
        HintInjectedEvent,
        {
            hint: (typeof EVENT_HINT_MAP)["notice.group_ban.ban" | "notice.group_ban.lift_ban"];
        }
    >,
) {
    let userName: string;
    let opName: string;
    const user1_is_self = event.user_id == event.self_id;
    const user2_is_self = event.operator_id == event.self_id;

    userName = user1_is_self
        ? "你"
        : await cached_get_group_member_display_name(event.user_id, event.group_id);
    opName = user2_is_self
        ? "你"
        : await cached_get_group_member_display_name(event.operator_id, event.group_id);
    let stringified_message = `${userName} 被 ${opName} `;
    if (event.sub_type == "ban") {
        const timeString = stringifyDurationSeconds(event.duration);
        stringified_message += `禁言了 ${timeString}`;
    } else {
        stringified_message += "解除禁言";
    }
    return {
        ...event,
        stringified_message,
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
    let title: string | undefined = undefined;
    try {
        const senderInfo = await cached_get_group_member_info(event.sender.user_id, event.group_id);
        title = senderInfo.title;
    } catch (e) {
        console.error(
            `stripFullGroupMessage: Failed to get member info ${event.sender.user_id} in ${event.group_id}`,
            e,
        );
    }
    let sender = {
        is_self: isSelf,
        ...event.sender,
        title,
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
            hint: (typeof EVENT_HINT_MAP)[
                | "message.group.normal"
                | "notice.group_ban.ban"
                | "notice.group_ban.lift_ban"];
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
              remark?: string;
              ingroup_card?: string;
              from?: ReturnType<typeof stripGroupInfo>;
          }
        | { user_id: number; nickname?: string; remark?: string };
    if (event.hint == EVENT_HINT_MAP["message.private.group"]) {
        try {
            const u = await cached_get_group_member_info(event.user_id, event.group_id);
            user = {
                user_id: event.user_id,
                nickname: u.nickname,
                ingroup_card: u.card || undefined,
                from: stripGroupInfo(await cached_get_group_info(event.group_id)),
            };
        } catch (e) {
            console.error(
                `getPrivateMessageModelHint Failed to get member info ${event.user_id} in ${event.group_id}`,
                e,
            );
            const u = await cached_get_stranger_info(event.user_id);
            user = {
                user_id: event.user_id,
                remark: u.remark || undefined,
                nickname: u.nickname,
                from: stripGroupInfo(await cached_get_group_info(event.group_id)),
            };
        }
    } else {
        const u = await cached_get_friend_info(event.user_id);
        if (u) {
            user = {
                user_id: event.user_id,
                nickname: u.nickname,
                remark: u.remark || undefined,
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
                    const strangerInfo = await cached_get_stranger_info(seg.data.qq);
                    try {
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
                            card: userInfo.card || undefined,
                            remark: strangerInfo.remark || undefined,
                        };
                        (<any>seg.data).include_self = (<any>seg.data).is_self =
                            seg.data.qq == String(event.self_id);
                    } catch (e) {
                        console.error(
                            `injectAt Failed to get member info ${seg.data.qq} in ${event.group_id}`,
                            e,
                        );
                        const displayName =
                            (await cached_get_stranger_display_name(seg.data.qq)) || seg.data.qq;
                        (<any>seg.data).stringified = `@${displayName}`;
                        (<any>seg.data).user = {
                            user_id: strangerInfo.user_id,
                            nickname: strangerInfo.nickname,
                            remark: strangerInfo.remark || undefined,
                        };
                        (<any>seg.data).include_self = (<any>seg.data).is_self =
                            seg.data.qq == String(event.self_id);
                    }
                }
            }
        }
    }
}

export async function preStringifyEvent(event: HintInjectedEvent) {
    try {
        let postEvent;
        switch (event.hint) {
            case EVENT_HINT_MAP["notice.notify.poke.friend"]:
            case EVENT_HINT_MAP["notice.notify.poke.group"]:
                postEvent = await stripPoke(event);
                break;
            case EVENT_HINT_MAP["notice.group_ban.ban"]:
            case EVENT_HINT_MAP["notice.group_ban.lift_ban"]:
                postEvent = await stripBan(event);
                break;
            case EVENT_HINT_MAP["message.group.normal"]:
                postEvent = event;
                await injectAt(event);
                break;
            default:
                postEvent = event;
        }
        return postEvent;
    } catch (e) {
        console.error("Failed to stripe event", event, e);
        return event;
    }
}

export async function fullStripEvent(event: HintInjectedEvent) {
    try {
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
    } catch (e) {
        console.error("Failed to full stripe event", event, e);
        return event;
    }
}

export async function getModelHint<T extends HintInjectedEvent>(event: T) {
    try {
        switch (event.hint) {
            case EVENT_HINT_MAP["message.group.normal"]:
            case EVENT_HINT_MAP["notice.group_ban.ban"]:
            case EVENT_HINT_MAP["notice.group_ban.lift_ban"]:
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
    } catch (e) {
        console.error("Failed to get model hint", event, e);
        return null;
    }
}
