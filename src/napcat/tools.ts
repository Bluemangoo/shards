import { ToolArguments, toolHelper } from "../types/mcp.ts";
import { loginInfo, napcat } from "./client.ts";
import { expectedEvents, storeEvent } from "../main_loop/life-cycle.ts";
import { downloadFileWithAutoExt, urlToDataUrl } from "../utils/net.ts";
import { SendMessageSegment, Structs } from "node-napcat-ts";
import { fullStripEvent, preStringifyEvent } from "./pre-stringify-event.ts";
import { EventStore } from "../data/database/event-store.ts";
import {
    cached_get_forward_message,
    cached_get_friend_info,
    cached_get_friend_list,
    cached_get_group_info,
    cached_get_stranger_display_name,
    cached_get_stranger_info,
} from "./wrapper.ts";
import typia from "typia";
import { longTermMemory, MemorySearchResult } from "../model/long-term-memory.ts";
import { sticker } from "../data/database/sticker.ts";
import fs from "node:fs";
import { fileToBase64Url, findSingleFileByBaseName } from "../utils/file.ts";
import { eventStack } from "../main.ts";
import { HintInjectedEvent } from "../types/event.ts";
import { history } from "../data/database/history.ts";
import { EVENT_HINT_MAP, injectRawMsg } from "./filter.ts";
import { NapcatResult } from "../types/napcat-api.ts";
import { fetchUrlAsMarkdown } from "../utils/browse.ts";
import axios from "axios";
import CONFIG from "../data/config/config.ts";
import logger from "../log/logger.ts";
import { ChatWindow } from "../utils/chat-window.ts";

export const napcatTools = {
    /**
     * 发送私聊或群聊消息。在上下文中可不填类型和 id，简单消息用字符串类型即可。
     */
    send_message: toolHelper(
        async (
            p: {
                user_id?: number;
                group_id?: number;
                message: SendMessageSegment[] | string;
            } & ToolArguments,
        ) => {
            if (p.user_id == null && p.group_id == null) {
                if (p.context.window) {
                    if (p.context.window.type === "private") {
                        p.user_id = Number(p.context.window.id);
                    } else if (p.context.window.type === "group") {
                        p.group_id = Number(p.context.window.id);
                    }
                }
            }
            const isPrivate = p.user_id != null;
            if (p.context.window && p.context.window.type === "group") {
                p.group_id = p.group_id || Number(p.context.window.id);
            }
            if (
                p.context.window &&
                p.context.window.type === "private" &&
                p.context.window.fromGroup != null
            ) {
                p.group_id = p.group_id || Number(p.context.window.fromGroup);
            }

            let result;
            let injectInfo: Record<string, any> = {};
            if (!isPrivate) {
                result = await napcat.send_msg({
                    group_id: p.group_id!,
                    message: <any>p.message, // support string msg
                });
            } else {
                // check is friend
                let withGroupId = false;
                try {
                    const f = await cached_get_friend_info(p.user_id!);
                    if (f == null) {
                        withGroupId = true;
                    }
                } catch {}
                result = await napcat.send_msg({
                    message_type: "private", // 如果带了 group_id 会默认发群消息，需要手动写一下 message_type
                    user_id: p.user_id!,
                    message: <any>p.message,
                    group_id: withGroupId ? p.group_id : undefined, // 群临时会话
                } as any);
                injectInfo.user_id = p.user_id!;
            }

            const message = await napcat.get_msg({ message_id: result.message_id });
            const event = injectRawMsg(message, injectInfo);
            await storeEvent(event);
            const messageWindow = ChatWindow.fromEvent(event);
            if (p.context.window != messageWindow) {
                history.addPretendProcessedEvent(messageWindow, [event]);
            }
            return result;
        },
        "发送消息",
        '发送私聊或群聊消息如"message_type":"group","group_id":"123456","message":"hello"，在上下文中可不填类型和id，简单消息或包含cq码用字符串类型即可,结构化消息禁止自以为是地转义为string；如果上下文为群聊而向没加好友的群友发私聊消息会尝试发送临时会话的消息，这时发送成功不代表和对方加上好友了。',
    ),

    poke: toolHelper(
        async (
            p: {
                user_id?: number;
                group_id?: number;
                poke_type?: "private" | "group";
            } & ToolArguments,
        ) => {
            let type = p.poke_type;
            let groupId = p.group_id;
            let userId = p.user_id;

            if (type == null || (type === "group" && groupId == null)) {
                if (p.context.window) {
                    if (p.context.window.type === "group") {
                        groupId = Number(p.context.window.id);
                        type = "group";
                    } else if (p.context.window.type === "private") {
                        userId = userId || Number(p.context.window.id);
                        type = "private";
                    }
                }
            }

            if (userId == null) {
                return "需要提供user_id";
            }

            if (type === "group" && groupId != null) {
                if (p.group_id != null && String(p.group_id) != p.context.window?.id) {
                    // 不在当前对话窗口
                    expectedEvents.add({
                        ends: Date.now() + 30 * 1000,
                        matches: {
                            post_type: "notice",
                            sub_type: "poke",
                            groupId,
                            sender_id: loginInfo.data!.user_id,
                            target_id: userId,
                        },
                        addToHistory: true, // 主要目的
                    });
                }
                return await napcat.group_poke({ group_id: groupId, user_id: userId });
            } else {
                // 如果是 private 或者没找到合适的类型，默认使用好友戳一戳
                if (p.user_id != null && String(p.user_id) != p.context.window?.id) {
                    // 不在当前对话窗口
                    expectedEvents.add({
                        ends: Date.now() + 30 * 1000,
                        matches: {
                            post_type: "notice",
                            sub_type: "poke",
                            sender_id: loginInfo.data!.user_id,
                            target_id: userId,
                        },
                        addToHistory: true, // 主要目的
                    });
                }
                return await napcat.friend_poke({ user_id: userId });
            }
        },
        "戳一戳",
        "戳一戳别人，在上下文中可不填类型和id",
    ),

    get_message: toolHelper(
        async (
            p: {
                message_id: string | number;
            } & ToolArguments,
        ) => {
            const message = await napcat.get_msg({ message_id: Number(p.message_id) });
            return await preStringifyEvent(injectRawMsg(message));
        },
        "获取单条消息",
        "根据消息 ID 获取消息详细信息",
    ),

    get_forward_message: toolHelper(
        async (
            p: {
                forward_message_id: string;
            } & ToolArguments,
        ) => {
            return await cached_get_forward_message(p.forward_message_id);
        },
        "获取合并转发消息内容",
        "传入forward消息组分的id，获取合并转发消息的内容",
    ),

    get_history_messages: toolHelper(
        async (
            p: {
                message_type?: "private" | "group";
                group_id?: number;
                user_id?: number;
                message_seq?: number;
                count?: number;
            } & ToolArguments,
        ) => {
            let type = p.message_type;
            let groupId = p.group_id;
            let userId = p.user_id;

            if (type == null || (groupId != null && userId != null)) {
                if (p.context.window) {
                    if (p.context.window.type === "group") {
                        type = "group";
                        groupId = Number(p.context.window.id);
                    } else if (p.context.window.type === "private") {
                        type = "private";
                        userId = Number(p.context.window.id);
                    }
                }
            }

            let messageHistory: NapcatResult["get_msg"][] = [];
            if (type === "group" && groupId != null) {
                const res = await napcat.get_group_msg_history({
                    group_id: groupId,
                    message_seq: p.message_seq,
                    count: p.count ?? 10,
                });
                messageHistory = res.messages || [];
            } else if (type === "private" && userId != null) {
                const res = await napcat.get_friend_msg_history({
                    user_id: userId,
                    message_seq: p.message_seq,
                    count: p.count ?? 10,
                });
                messageHistory = res.messages || [];
            } else {
                return [];
            }

            return await Promise.all(messageHistory.map((m) => preStringifyEvent(injectRawMsg(m))));
        },
        "获取历史消息",
        "根据时间范围获取历史消息，其中可选的message_seq为起始消息序号，在上下文中可不填类型和id",
    ),

    withdraw_message: toolHelper(
        async (
            p: {
                message_id: number;
            } & ToolArguments,
        ) => {
            await napcat.delete_msg({ message_id: p.message_id });
        },
        "撤回消息",
        "按照消息id撤回一条消息，一般两分钟内可撤回，自己有群管理员权限可以无视，不知道能不能撤回可以先试一下",
    ),

    get_chat_list: toolHelper(
        async (_p: ToolArguments) => {
            const messages = await EventStore.get_distinct_message_events(20);
            const chatList: {
                message_type: "group" | "private";
                id: number;
                display_name: string | null;
                time: number;
            }[] = [];

            for (const message of messages) {
                if (
                    message.hint == EVENT_HINT_MAP["notice.notify.poke.group"] ||
                    message.hint == EVENT_HINT_MAP["message.group.normal"]
                ) {
                    const groupInfo = await cached_get_group_info(message.group_id);
                    chatList.push({
                        message_type: "group",
                        id: message.group_id,
                        display_name: groupInfo.group_remark || groupInfo.group_name,
                        time: message.time,
                    });
                } else if (
                    message.hint == EVENT_HINT_MAP["message.private.group"] ||
                    message.hint == EVENT_HINT_MAP["message.private.friend"] ||
                    message.hint == EVENT_HINT_MAP["notice.notify.poke.friend"]
                ) {
                    let id;
                    if (message.hint == EVENT_HINT_MAP["notice.notify.poke.friend"]) {
                        id = message.target_id;
                    } else {
                        id = message.user_id;
                    }
                    chatList.push({
                        message_type: "private",
                        id,
                        display_name: await cached_get_stranger_display_name(id),
                        time: message.time,
                    });
                }
            }
            return chatList;
        },
        "获取聊天列表",
        "获取当前的聊天列表(最多20条)，包含群聊和私聊",
    ),

    get_friend_list: toolHelper(
        async (_p: ToolArguments) => {
            return await cached_get_friend_list();
        },
        "获取好友列表",
        "获取当前的好友列表（全部），由于数据较多建议先用get_chat_list。",
    ),

    get_user_info: toolHelper(
        async (
            p: {
                user_id: number;
            } & ToolArguments,
        ) => {
            const selfInfo = loginInfo.data!;
            let user: Partial<
                Awaited<ReturnType<typeof cached_get_stranger_info>> & { avatar: string }
            >;
            if (p.user_id == selfInfo.user_id) {
                user = selfInfo;
            } else {
                user = await cached_get_stranger_info(p.user_id);
                user = {
                    user_id: user.user_id,
                    nickname: user.nickname,
                    uid: user.uid,
                    age: user.age,
                    qid: user.qid,
                    qqLevel: user.qqLevel,
                    sex: user.sex,
                    long_nick: user.long_nick,
                    is_vip: user.is_vip,
                    is_years_vip: user.is_years_vip,
                    vip_level: user.vip_level,
                    remark: user.remark,
                    status: user.status,
                };
            }

            user.avatar = `https://q1.qlogo.cn/g?b=qq&nk=${p.user_id}&s=0`;
            return user;
        },
        "获取用户信息",
        "根据id获取用户的昵称、头像等信息",
    ),

    get_group_info: toolHelper(
        async (
            p: {
                group_id?: number;
            } & ToolArguments,
        ) => {
            let groupId = p.group_id;
            if (groupId == null && p.context.window?.type === "group") {
                groupId = Number(p.context.window.id);
            }
            if (!groupId) throw new Error("Missing group_id");
            let info: Partial<
                Awaited<ReturnType<typeof napcat.get_group_info>> &
                    Awaited<ReturnType<typeof napcat.get_group_info_ex>> & {
                        groupOwnerId: {
                            memberUin: string;
                            memberUid: string;
                        };
                    } & {
                        avatar: string;
                    }
            > = {
                ...(await napcat.get_group_info({ group_id: groupId })),
                ...(await napcat.get_group_info_ex({ group_id: groupId })),
            };
            info = {
                group_id: info.group_id,
                group_name: info.group_name,
                member_count: info.member_count,
                max_member_count: info.max_member_count,
                group_all_shut: info.group_all_shut,
                group_remark: info.group_remark,
                groupOwnerId: info.extInfo?.groupOwnerId,
            };

            info.avatar = `https://p.qlogo.cn/gh/${groupId}/${groupId}/640/`;
            return info;
        },
        "获取群信息",
        "根据群 ID 获取群信息，在上下文中可不填类型和id",
    ),

    get_group_member_list: toolHelper(
        async (
            p: {
                group_id?: number;
            } & ToolArguments,
        ) => {
            let groupId = p.group_id;
            if (groupId == null && p.context.window?.type === "group") {
                groupId = Number(p.context.window.id);
            }
            if (!groupId) throw new Error("Missing group_id");
            return await napcat.get_group_member_list({ group_id: groupId });
        },
        "获取群成员列表",
        "根据群 ID 获取群成员列表，在上下文中可不填类型和id",
    ),

    forward_messages: toolHelper(
        async (
            p: {
                message_ids: (string | number)[];
                message_type?: "private" | "group";
                user_id?: number;
                group_id?: number;
            } & ToolArguments,
        ) => {
            let type = p.message_type;
            let groupId = p.group_id;
            let userId = p.user_id;

            if (type == null || (groupId != null && userId != null)) {
                if (p.context.window) {
                    if (p.context.window.type === "group") {
                        groupId = Number(p.context.window.id);
                        type = "group";
                    } else if (p.context.window.type === "private") {
                        userId = Number(p.context.window.id);
                        type = "private";
                    }
                }
            }

            const messageReceipts = [];
            for (const msgId of p.message_ids) {
                const msg = await napcat.get_msg({ message_id: Number(msgId) });
                if (type == "group") {
                    messageReceipts.push(
                        await napcat.send_msg({ group_id: groupId!, message: msg.message as any }),
                    );
                } else if (type == "private") {
                    messageReceipts.push(
                        await napcat.send_msg({ user_id: userId!, message: msg.message as any }),
                    );
                }
            }
            return messageReceipts;
        },
        "转发消息",
        "根据消息 ID 列表转发消息，将会逐条按顺序发送，也可用于复读，在上下文中可不填类型和id",
    ),

    get_forward_msg: toolHelper(
        async (
            p: {
                message_id: string;
            } & ToolArguments,
        ) => {
            return await napcat.get_forward_msg({ message_id: p.message_id });
        },
        "获取合并消息内容",
        "根据合并消息 ID 获取合并消息的内容",
    ),

    read_image: toolHelper(
        async (
            p: {
                image_url: string;
                file_id?: string;
            } & ToolArguments,
        ) => {
            try {
                if (p.file_id == "") {
                    // 模型偶尔喜欢加
                    p.file_id = undefined;
                }
                if (p.file_id != null) {
                    const f = await napcat.get_image({ file: p.file_id });
                    return new ImageOutput(fileToBase64Url(f.file));
                }
            } catch (e) {
                logger.warn(["tool-call", "napcat"], e);
            }
            return new ImageOutput(await urlToDataUrl(p.image_url));
        },
        "读取图片",
        "根据图片 URL 读取图片内容，返回图片。有file_id(消息data中的file字段，形如AABBCC.jpg)可以一起传进来，保险一点。",
        () => !CONFIG.mainModel.image,
    ),

    read_record: toolHelper(
        async (
            p: {
                file_id: string;
            } & ToolArguments,
        ) => {
            const f = await napcat.get_record({ file: p.file_id, out_format: "mp3" });
            return new Mp3Output((<any>f).base64 /* it exists */);
        },
        "读取语音",
        "根据语音文件 ID 读取语音内容。",
        () => !CONFIG.mainModel.audio,
    ),

    download_file: toolHelper(
        async (
            p: {
                file_url: string;
            } & ToolArguments,
        ) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

            try {
                const response = await fetch(p.file_url, { signal: controller.signal });
                if (!response.ok) {
                    throw new Error(`HTTP 请求错误: ${response.status} - ${response.statusText}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                // const mimeType = response.headers.get("content-type") || "application/octet-stream";

                try {
                    const textDecoder = new TextDecoder("utf-8", { fatal: true });

                    return textDecoder.decode(arrayBuffer);
                } catch (decodeError) {
                    const base64 = Buffer.from(arrayBuffer).toString("base64");
                    return new FileOutput(base64);
                }
            } catch (error: any) {
                if (error.name === "AbortError") {
                    throw new Error("下载超时");
                }
                throw error;
            } finally {
                clearTimeout(timeoutId);
            }
        },
        "下载文件",
        "根据文件URL下载文件，返回文件内容",
    ),

    search_web: toolHelper(
        async (
            p: {
                query: string;
            } & ToolArguments,
        ) => {
            const res = await axios.post(
                "https://api.langsearch.com/v1/web-search",
                {
                    query: p.query,
                    summary: true,
                },
                {
                    headers: {
                        Authorization: `Bearer ${CONFIG.langSearch.apiKey}`,
                        "Content-Type": "application/json",
                    },
                },
            );
            return res.data.data ?? res.data;
        },
        "网络搜索",
        "使用搜索引擎搜索，返回搜索结果，有兴趣/概括不全的页面自己单独浏览",
        CONFIG.langSearch.apiKey == null,
    ),

    view_webpage: toolHelper(
        async (p: { url: string } & ToolArguments) => {
            const article = await fetchUrlAsMarkdown(p.url);
            const text = JSON.stringify(article);
            if (text.length < 2500) {
                return text;
            }
            return new LongTextOutput(text, article.title + "\n" + article.excerpt);
        },
        "浏览网页",
        "不支持交互式网页，仅获取网页正文内容，返回标题、简介和正文文本",
    ),

    block: toolHelper(
        async (p: { id: number } & ToolArguments) => {
            return await napcat.delete_friend({ user_id: p.id, temp_block: true });
        },
        "删除并拉黑好友",
        "根据id删除并拉黑好友（需要是好友）",
    ),

    mute: toolHelper(
        async (p: { user_id: number; group_id?: number; duration: number } & ToolArguments) => {
            let gid = p.group_id;
            if (p.context.window?.type === "group") {
                gid = gid || Number(p.context.window.id);
            }
            if (gid == null) {
                throw new Error("Missing group_id");
            }
            const excepted = {
                ends: Date.now() + 30 * 1000,
                matches: {
                    notice_type: "group_ban",
                    group_id: gid,
                    user_id: p.user_id,
                    operator_id: loginInfo.data?.user_id,
                },
            };
            expectedEvents.add(excepted);
            try {
                return await napcat.set_group_ban({
                    duration: p.duration,
                    group_id: gid,
                    user_id: p.user_id,
                });
            } catch (error) {
                expectedEvents.delete(excepted);
                throw error;
            }
        },
        "群禁言",
        "禁言一个人，duration单位是秒，为0则是解禁，在上下文中可不填group_id，需要自己是群管理，不确定可以先获取自己的群成员信息查一下",
    ),

    search_memory: toolHelper(
        async (p: { query: string[]; limit?: number } & ToolArguments) => {
            const r = await Promise.all(
                p.query.map((q) => {
                    return longTermMemory.search(q, p.limit);
                }),
            );
            const unwrap: MemorySearchResult[] = [];
            for (const result of r) {
                unwrap.push(...result);
            }
            return longTermMemory.sortResults(unwrap);
        },
        "在记忆中搜索",
        "根据句子在记忆中搜索。一次搜索中每个查询一个完整句子。请不要吝啬使用。limit默认为100，搜索对别人的记忆之类的需要更全面内容的情况可以考虑写300到500。",
    ),

    list_stickers: toolHelper(
        async (_p: {} & ToolArguments) => {
            const s = await sticker.listStickers();
            return s.map((s) => ({
                id: s.id,
                summary: s.description_data.summary,
                tags: s.description_data.tags,
            }));
        },
        "列出所有表情包",
        "列出已保存的全部表情包，返回的表情包不包含详细内容只有概括，需要更详细的内容请使用表情包id查询表情包详情",
    ),

    save_sticker: toolHelper(
        async (p: { file_id: string; url: string } & ToolArguments) => {
            const existing = await sticker.findStickersWithFileId(p.file_id);
            if (existing.length > 0) {
                return `表情包已存在，id：${existing[0]}`;
            }
            const d = await sticker.getOrCreateDescription(p.file_id, p.url);
            if (!d) {
                return "创建表情包描述失败";
            }
            let tFile = await findSingleFileByBaseName(
                process.cwd() + "/data/temp_stickers",
                p.file_id,
            );
            if (tFile != null) {
                fs.copyFileSync(
                    process.cwd() + "/data/temp_stickers/" + tFile,
                    process.cwd() + "/data/stickers/" + tFile,
                );
            } else {
                tFile = await downloadFileWithAutoExt(
                    p.url,
                    p.file_id,
                    process.cwd() + "/data/stickers/",
                );
            }
            if (tFile == null) {
                return "表情包下载失败";
            }
            const id = await sticker.addSticker(d.id, p.file_id, tFile);
            return {
                sticker_id: id,
            };
        },
        "收藏表情包",
        "收藏表情包到表情包列表，之后可以发送",
    ),

    get_sticker: toolHelper(
        async (p: { id: number } & ToolArguments) => {
            const s = await sticker.getSticker(p.id);
            if (!s) {
                return "表情包不存在";
            }
            return {
                id: s.id,
                summary: s.description_data.summary,
                description: s.description_data.description,
                tags: s.description_data.tags,
            };
        },
        "获取表情包",
        "获取表情包描述详情",
    ),

    view_sticker: toolHelper(
        async (p: { id: number } & ToolArguments) => {
            const s = await sticker.getSticker(p.id);
            if (!s) {
                return "表情包不存在";
            }
            return new ImageOutput(
                fileToBase64Url(process.cwd() + "/data/stickers/" + s.file_name),
            );
        },
        "查看表情包",
        "查看表情包图片",
        () => !CONFIG.mainModel.image,
    ),

    send_sticker: toolHelper(
        async (
            p: {
                user_id?: number;
                group_id?: number;
                sticker_id: number;
            } & ToolArguments,
        ) => {
            if (p.user_id == null && p.group_id == null) {
                if (p.context.window) {
                    if (p.context.window.type === "private") {
                        p.user_id = Number(p.context.window.id);
                    } else if (p.context.window.type === "group") {
                        p.group_id = Number(p.context.window.id);
                    }
                }
            }

            let s = await sticker.getSticker(p.sticker_id);
            let needUpdate = false;
            if (!s) {
                return "表情包不存在";
            }

            let result;
            try {
                if (p.group_id != null) {
                    result = await napcat.send_msg({
                        group_id: p.group_id,
                        message: [Structs.image(s.file_id)],
                    });
                } else {
                    result = await napcat.send_msg({
                        user_id: p.user_id!,
                        message: [Structs.image(s.file_id)],
                    });
                }
            } catch (e) {
                let eStr: string;
                if (typeof e == "object") {
                    eStr = JSON.stringify(e);
                } else {
                    eStr = String(e);
                }
                if (!eStr.includes("1200")) {
                    throw e;
                }
                needUpdate = true;
                const buff = fs.readFileSync(process.cwd() + "/data/stickers/" + s.file_name);
                if (p.group_id != null) {
                    result = await napcat.send_msg({
                        group_id: p.group_id,
                        message: [Structs.image(buff)],
                    });
                } else {
                    result = await napcat.send_msg({
                        user_id: p.user_id!,
                        message: [Structs.image(buff)],
                    });
                }
            }

            const message = await napcat.get_msg({ message_id: result.message_id });
            if (needUpdate && message.message[0].type == "image") {
                try {
                    await sticker.updateStickerFileId(
                        s.id,
                        s.file_id,
                        message.message[0].data.file,
                    );
                } catch (e) {
                    logger.error(
                        ["tool-call", "sticker", "database"],
                        `Failed to update file id for sticker ${s.id}`,
                        e,
                    );
                }
            }

            await storeEvent(injectRawMsg(message));
            return result;
        },
        "发送表情包",
        '向私聊或群聊发送表情包如"group_id":"123456","sticker_id":6，在上下文中可不填类型和id',
    ),

    process_friend_request: toolHelper(
        async (p: { flag: string; approve: boolean; remark?: string } & ToolArguments) => {
            await napcat.set_friend_add_request({
                flag: p.flag,
                approve: p.approve,
            });
            return "Success";
        },
        "处理好友请求",
        "需要在收到好友请求后才能使用，需要传入的flag是好友请求中的flag，用于允许或拒绝添加好友请求。remark是对好友的备注，一般不用加，除非根据历史你发现需要备注一个昵称才能保持认出TA。",
    ),

    wait_next: toolHelper(
        async (p: { min?: number; max?: number } & ToolArguments) => {
            if (!p.context.window) {
                return { error: "当前不处于特定的聊天窗口中，无法等待。" };
            }

            const minMs = (p.min || 10) * 1000;
            const maxMs = Math.max(p.min || 10, p.max || 60) * 1000;
            const startTime = performance.now();
            const events: HintInjectedEvent[] = [];
            while (performance.now() - startTime < minMs) {
                const e = await eventStack.consumeOne(
                    p.context.window,
                    minMs - (performance.now() - startTime),
                );
                if (e) {
                    events.push(e);
                }
            }
            if (events.length == 0) {
                const e = await eventStack.consumeOne(
                    p.context.window,
                    maxMs - (performance.now() - startTime),
                );
                if (e) {
                    events.push(e);
                }
            }
            if (events.length > 0) {
                history.addPretendProcessedEvent(p.context.window, events);
                return await Promise.all(events.map((e) => fullStripEvent(e)));
            }
            return { error: "timeout" };
        },
        "阻塞等待下一条消息",
        "如果你觉得对方没说完且正在发送下一条消息，则使用此工具。传入min设定最小等待时长(秒)(默认10s)，传入max设定最大等待时长(秒)(默认60s)，这两个参数一般可以不传。一般不要timeout了还继续等，这种情况等事件循环推消息就好了。",
    ),
};
type ToolFunctions = {
    [K in keyof typeof napcatTools]: (typeof napcatTools)[K]["fn"];
};

export const napcatMcpApplication = (() => {
    const app = typia.llm.application<ToolFunctions>();
    app.functions.forEach((tool) => {
        const meta = napcatTools[tool.name as keyof typeof napcatTools];
        tool.description = [meta.title, meta.description].filter((v) => v != null).join("\n");
    });
    return app;
})();

export const napcatToolDefined = (() =>
    napcatMcpApplication.functions.map((f) => ({ type: "function", function: f })))();
export function napcatToolDefinedFiltered() {
    return napcatToolDefined.filter((f) => {
        const d = napcatTools[f.function.name as keyof typeof napcatTools].disabled;
        if (typeof d == "function") {
            return !d();
        }
        return !d;
    });
}

export abstract class InjectOutput {
    abstract toolOutputPlaceholder(): string;
    abstract output(): any;
}

export class ImageOutput extends InjectOutput {
    constructor(public image: string) {
        super();
    }

    toolOutputPlaceholder(): string {
        return "Image will be uploaded in the next user message";
    }

    output() {
        return {
            type: "image_url",
            image_url: {
                url: this.image,
            },
        };
    }
}

export class Mp3Output extends InjectOutput {
    constructor(public audio: string) {
        super();
    }

    toolOutputPlaceholder(): string {
        return "Record will be uploaded in the next user message";
    }

    output() {
        return {
            type: "input_audio",
            input_audio: {
                data: this.audio,
                format: "mp3",
            },
        };
    }
}

export class FileOutput extends InjectOutput {
    constructor(
        public file: string,
        public filename?: string,
    ) {
        super();
    }

    toolOutputPlaceholder(): string {
        return "File will be uploaded in the next user message";
    }

    output() {
        return {
            type: "file",
            file: {
                file_data: this.file,
                filename: this.filename,
            },
        };
    }
}

export class LongTextOutput extends InjectOutput {
    constructor(
        public text: string,
        public description?: string,
    ) {
        super();
    }

    toolOutputPlaceholder(): string {
        let t = "Text too long, will be sent in the next user message.";
        if (this.description != null) {
            t += " " + this.description;
        }
        return t;
    }

    output() {
        return {
            type: "text",
            text: this.text,
        };
    }
}
