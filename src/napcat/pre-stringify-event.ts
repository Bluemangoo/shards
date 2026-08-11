import {
    cached_fetch_ptt_text,
    cached_get_friend_info,
    cached_get_group_info,
    cached_get_group_member_display_name,
    cached_get_group_member_info,
    cached_get_stranger_display_name,
    cached_get_stranger_info,
} from "./wrapper.ts";
import {
    HintInjectedEvent,
    HintInjectedEventOf,
    HintInjectedMessageEvent,
    NapcatEvent,
} from "../types/event.ts";
import { EVENT_HINT_MAP } from "./filter.ts";
import { GroupMessage } from "node-napcat-ts";
import { NapcatResult } from "../types/napcat-api.ts";
import { stringifyDurationSeconds } from "../utils/time.ts";
import { getFace } from "../utils/qface.ts";
import { removeLeading } from "../utils/string.ts";
import logger from "../log/logger.ts";

export const MESSAGE_INJECT_TAGS = {
    FACE: Symbol("isFaceProcessed"),
    JSON: Symbol("isJsonProcessed"),
    AT: Symbol("isAtProcessed"),
    PTT: Symbol("isPttProcessed"),
} as const;
export type WithInjectTags = Partial<
    Record<(typeof MESSAGE_INJECT_TAGS)[keyof typeof MESSAGE_INJECT_TAGS], boolean>
>;

export function stripGroupInfo(groupInfo: NapcatResult["get_group_info"]) {
    return {
        group_id: groupInfo.group_id,
        group_name: groupInfo.group_name,
        group_remark: groupInfo.group_remark,
        member_count: groupInfo.member_count,
    };
}

export async function stripPoke(
    event: HintInjectedEventOf<"notice.notify.poke.group" | "notice.notify.poke.friend">,
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
        sender_id: "sender_id" in event ? event.sender_id : undefined,
        stringified_message,
    };
}

export async function stripBan(
    event: HintInjectedEventOf<"notice.group_ban.ban" | "notice.group_ban.lift_ban">,
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

export async function stripGroupIncreaseDecrease(
    event: HintInjectedEventOf<"notice.group_increase" | "notice.group_decrease">,
) {
    const group_info = await cached_get_group_info(event.group_id);
    const name = await cached_get_stranger_display_name(event.user_id);
    let stringified_message;
    switch (event.sub_type) {
        case "approve":
        case "invite":
            stringified_message = `${name} 加入了群聊`;
            break;
        case "kick":
        case "kick_me":
            stringified_message = `${name} 被踢出了群聊`;
            break;
        case "leave":
            stringified_message = `${name} 退出了群聊`;
            break;
        case "disband":
            stringified_message = undefined;
    }
    return {
        ...event,
        group_info,
        stringified_message,
    };
}

export async function stripTitleChange(event: HintInjectedEventOf<"notice.notify.title">) {
    const group_info = await cached_get_group_info(event.group_id);
    const userIsSelf = event.user_id == event.self_id;
    const userName = userIsSelf
        ? "你"
        : await cached_get_group_member_display_name(event.user_id, event.group_id);
    const stringified_message = `恭喜 ${userName} 获得群主授予的 ${event.title} 头衔`;
    return {
        ...event,
        group_info,
        stringified_message,
    };
}

export async function stripFullPrivateMessage(
    event: HintInjectedEventOf<"message.private.friend" | "message.private.group">,
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
        message: event.message,
        hint: event.hint,
    };
}

export async function stripFullGroupMessage(event: HintInjectedEventOf<"message.group.normal">) {
    let isSelf = event.self_id == event.sender.user_id;
    let title: string | undefined = undefined;
    try {
        const senderInfo = await cached_get_group_member_info(event.sender.user_id, event.group_id);
        title = senderInfo.title;
    } catch (e) {
        logger.error(
            ["pre-message", "lifecycle"],
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
        message: event.message,
        hint: event.hint,
    };
}

export async function stripFriendAddRequest(event: HintInjectedEventOf<"request.friend">) {
    return {
        ...event,
        tips: "这是一条好友申请，请调用工具做出处理。你有权拒绝不熟悉的人的好友请求。",
    };
}

export async function getFriendAddRequestModelHint(event: HintInjectedEventOf<"request.friend">) {
    const u = await cached_get_stranger_info(event.user_id);
    const user = {
        user_id: event.user_id,
        remark: u.remark || undefined,
        nickname: u.nickname,
    };
    return {
        type: "私聊",
        ...user,
    };
}

export async function getPrivateMessageModelHint(
    event: HintInjectedEventOf<"message.private.friend" | "message.private.group">,
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
            logger.warn(
                ["get-model-hint", "lifecycle"],
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

export async function getGroupModelHint(event: { group_id: number }) {
    return {
        type: "群聊",
        ...stripGroupInfo(await cached_get_group_info(event.group_id)),
    };
}

export async function injectPttText(e: HintInjectedMessageEvent) {
    if (e[MESSAGE_INJECT_TAGS.PTT]) {
        return;
    }
    for (const seg of e.message) {
        if (seg.type == "record") {
            try {
                (seg.data as any).text = (await cached_fetch_ptt_text(e.message_id)).text;
            } catch (e) {
                logger.error(["pre-message", "lifecycle"], "Failed to fetch ptt text", e);
            }
        }
    }
    e[MESSAGE_INJECT_TAGS.PTT] = true;
}

export async function injectJson(e: HintInjectedMessageEvent) {
    if (e[MESSAGE_INJECT_TAGS.JSON]) {
        return;
    }
    for (const seg of e.message) {
        if (seg.type == "json") {
            try {
                seg.data = JSON.parse(seg.data.data);
            } catch {}
        }
    }
    e[MESSAGE_INJECT_TAGS.JSON] = true;
}

export async function injectFace(event: HintInjectedMessageEvent) {
    if (event[MESSAGE_INJECT_TAGS.FACE]) {
        return;
    }
    for (const seg of event.message) {
        if (seg.type == "face") {
            if (seg.data.raw?.faceText) {
                (seg.data as any) = {
                    face_id: seg.data.id,
                    describe: removeLeading(seg.data.raw.faceText, "/"),
                };
            } else {
                const face = getFace(seg.data.id);
                if (face) {
                    (seg.data as any) = {
                        face_id: seg.data.id,
                        describe: removeLeading(face.describe, "/"),
                    };
                }
            }
        }
    }
    event[MESSAGE_INJECT_TAGS.FACE] = true;
}

export async function injectAt(e: HintInjectedMessageEvent) {
    if (e[MESSAGE_INJECT_TAGS.AT]) {
        return;
    }
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
                    logger.warn(
                        ["pre-message", "lifecycle"],
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
    e[MESSAGE_INJECT_TAGS.AT] = true;
}

export async function preStringifyEvent(event: HintInjectedEvent) {
    try {
        let postEvent;
        if (event.post_type == "message") {
            await injectPttText(event);
            await injectJson(event);
            await injectFace(event);
        }
        switch (event.hint) {
            case EVENT_HINT_MAP["notice.notify.poke.friend"]:
            case EVENT_HINT_MAP["notice.notify.poke.group"]:
                postEvent = await stripPoke(event);
                break;
            case EVENT_HINT_MAP["notice.group_ban.ban"]:
            case EVENT_HINT_MAP["notice.group_ban.lift_ban"]:
                postEvent = await stripBan(event);
                break;
            case EVENT_HINT_MAP["notice.notify.title"]:
                postEvent = await stripTitleChange(event);
                break;
            case EVENT_HINT_MAP["notice.group_increase"]:
            case EVENT_HINT_MAP["notice.group_decrease"]:
                postEvent = await stripGroupIncreaseDecrease(event);
                break;
            case EVENT_HINT_MAP["request.friend"]:
                postEvent = await stripFriendAddRequest(event);
                break;
            case EVENT_HINT_MAP["message.group.normal"]:
                await injectAt(event);
            // fallthrough
            default:
                postEvent = event;
        }
        return postEvent;
    } catch (e) {
        logger.error(["pre-message", "lifecycle"], "Failed to stripe event", event, e);
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
        logger.error(["pre-message", "lifecycle"], "Failed to full stripe event", event, e);
        return event;
    }
}

export async function getModelHint<T extends HintInjectedEvent>(event: T) {
    try {
        switch (event.hint) {
            case EVENT_HINT_MAP["message.group.normal"]:
            case EVENT_HINT_MAP["notice.group_ban.ban"]:
            case EVENT_HINT_MAP["notice.group_ban.lift_ban"]:
            case EVENT_HINT_MAP["notice.notify.poke.group"]:
            case EVENT_HINT_MAP["notice.group_increase"]:
            case EVENT_HINT_MAP["notice.group_decrease"]:
            case EVENT_HINT_MAP["notice.notify.title"]:
                return await getGroupModelHint(event);
            case EVENT_HINT_MAP["message.private.friend"]:
            case EVENT_HINT_MAP["message.private.group"]:
                return await getPrivateMessageModelHint(event);
            case EVENT_HINT_MAP["notice.notify.poke.friend"]:
                return await getPrivatePokeModelHint(event);
            case EVENT_HINT_MAP["request.friend"]:
                return await getFriendAddRequestModelHint(event);
            default:
                return null;
        }
    } catch (e) {
        logger.error(["get-model-hint", "lifecycle"], "Failed to get model hint", event, e);
        return null;
    }
}
