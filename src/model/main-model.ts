import OpenAI from "openai";
import { ChatNode, ConsumedEvent } from "../data/database/history.ts";
import { ModelContext } from "../utils/context.ts";
import { HintInjectedEvent } from "../types/event.ts";
import {
    InjectOutput,
    napcatMcpApplication,
    napcatToolDefinedFiltered,
    napcatTools,
} from "../napcat/tools.ts";
import { fullStripEvent, getModelHint } from "../napcat/pre-stringify-event.ts";
import CONFIG from "../data/config/config.ts";
import workingMemory from "./working-memory.ts";
import { longTermMemory } from "./long-term-memory.ts";
import { Receive } from "node-napcat-ts/dist/Structs";
import { sticker } from "../data/database/sticker.ts";
import PROMPTS from "../data/config/prompts.ts";
import logger from "../log/logger.ts";
import { loginInfo } from "../napcat/client.ts";
import { validateModelResponse } from "../utils/model.ts";

class MainModel {
    client: OpenAI;

    constructor(
        baseUrl: string = CONFIG.mainModel.baseUrl,
        apiKey: string = CONFIG.mainModel.apiKey,
        public model: string = CONFIG.mainModel.model,
        public reasoningEffort: string = CONFIG.mainModel.reasoningEffort,
    ) {
        this.client = new OpenAI({
            baseURL: baseUrl,
            apiKey: apiKey,
            defaultHeaders: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
            },
        });
    }

    async response_chat(
        messages: HintInjectedEvent[],
        history: ConsumedEvent[],
        context: ModelContext,
    ) {
        logger.info(
            ["model", "life-cycle"],
            "Responding to chat with messages:",
            messages.length,
            "and history:",
            history.length,
        );

        const model_messages: any[] = [
            { role: "system", content: PROMPTS.dev },
            { role: "system", content: PROMPTS.sys },
            // ...PROMPTS.vibe.map((s) => ({ role: "assistant", content: s })),
        ];

        const windowContext = await getModelHint(messages[0]);
        const memoryAndSticker: Promise<void>[] = [];
        memoryAndSticker.push(
            (async () => {
                try {
                    const searchExtra: string[] = [];
                    if (windowContext?.type == "群聊" && (<any>windowContext).group_name != null) {
                        searchExtra.push((<any>windowContext).group_name);
                    } else if (
                        windowContext?.type == "私聊" &&
                        (<any>windowContext).user != null &&
                        (<any>windowContext).user.nickname != null
                    ) {
                        searchExtra.push((<any>windowContext).user.nickname);
                    }
                    const memory = await longTermMemory.fullSearch(messages, history, searchExtra);

                    logger.info(
                        ["model", "life-cycle", "long-term-memory"],
                        "Found",
                        memory.data.length,
                        "relevant long-term memory items",
                    );
                    model_messages.push({
                        role: "system",
                        content: JSON.stringify({
                            type: "matched_memory",
                            memory: memory.data.map((r) => ({
                                content: r.content,
                                created_at:
                                    r.created_at.toLocaleDateString() +
                                    " " +
                                    r.created_at.toLocaleTimeString(),
                            })),
                        }),
                    });
                    if (memory.error && memory.error.length > 0) {
                        throw memory.error;
                    }
                } catch (e) {
                    logger.error(
                        ["model", "life-cycle", "long-term-memory"],
                        "Failed to search memory:",
                        e,
                    );
                }
            })(),
        );
        memoryAndSticker.push(
            (async () => {
                try {
                    const stickerInjector = new StickerInjector();
                    for (const event of messages) {
                        stickerInjector.addEvent(event);
                    }
                    for (const event of history) {
                        stickerInjector.addEvent(event.event);
                    }
                    await stickerInjector.process();
                } catch (e) {
                    logger.info(
                        ["model", "life-cycle", "parse-image"],
                        "Failed to inject sticker description",
                        e,
                    );
                }
            })(),
        );
        await Promise.all(memoryAndSticker);

        const trace: string[] = [];
        const currentWorkingMemory = workingMemory.list();
        const wm = currentWorkingMemory
            .sort((a, b) => a.lastAccessed - b.lastAccessed)
            .map((a) => {
                const date = new Date(a.lastAccessed);
                return {
                    ...a,
                    lastAccessed: date.toLocaleDateString() + " " + date.toLocaleTimeString(),
                };
            });
        const hints: Record<string, any>[] = [
            { type: "hint", remark: "当前工作记忆", workingMemory: wm },
        ];
        if (windowContext) {
            hints.push({ type: "hint", remark: "当前聊天窗口", windowContext });
        }
        hints.push({ type: "hint", remark: "当前登录账号", data: loginInfo.data });
        const date = new Date();
        hints.push({
            type: "hint",
            remark: "当前时间",
            timestamp: (Number(date) / 1000).toFixed(0),
            formated_time: date.toLocaleDateString() + " " + date.toLocaleTimeString(),
        });
        model_messages.push({
            role: "system",
            content: JSON.stringify(hints),
        });
        // again

        model_messages.push({ role: "system", content: PROMPTS.sys });

        // 处理历史记录
        let model_history: ChatNode | null = null;
        let history_messages: any[] = [];
        for (const event of history) {
            if (model_history != event.chatNode) {
                if (history_messages.length > 0) {
                    model_messages.push({
                        role: "user",
                        content: JSON.stringify(history_messages),
                    });
                }
                if (model_history != null) {
                    model_messages.push({
                        role: "assistant",
                        content: model_history.trace.join("\n"),
                    });
                }
                history_messages = [];
                model_history = event.chatNode;
            }
            history_messages.push({
                type: "history_message",
                event: await fullStripEvent(event.event),
            });
        }

        // push last part
        if (history_messages.length > 0) {
            model_messages.push({
                role: "user",
                content: JSON.stringify(history_messages),
            });
        }
        if (model_history != null) {
            model_messages.push({
                role: "assistant",
                content: model_history.trace.join("\n"),
            });
        }

        const new_messages_payload: any[] = [];
        for (const event of messages) {
            new_messages_payload.push({
                type: "new_message",
                event: await fullStripEvent(event),
            });
        }
        new_messages_payload.push({ type: "hint", content: PROMPTS.hint });

        model_messages.push({ role: "user", content: JSON.stringify(new_messages_payload) });

        logger.info(
            ["model", "main-model", "model-input"],
            "Requesting main model",
            model_messages,
        );
        let firstCalled = true;

        while (true) {
            let response;
            try {
                response = await this.client.chat.completions.create({
                    model: this.model,
                    messages: model_messages,
                    stream: false,
                    tools: napcatToolDefinedFiltered() as any, // I know what I'm doing
                    tool_choice: "auto",
                    reasoning_effort: this.reasoningEffort as OpenAI.ReasoningEffort,
                });
                validateModelResponse(response);
            } catch (e) {
                if (firstCalled) {
                    throw e;
                }
                logger.error(["model", "main-model", "lifecycle"], e);
                trace.push("!!Uncommon thinking stop, maybe not finished.");
                break;
            }
            firstCalled = false;

            const response_message = response.choices[0].message;
            logger.info(["model", "main-model", "model-message", "lifecycle"], response_message);

            const reasoning =
                (response_message as any).reasoning_content || (response_message as any).reasoning;
            if (reasoning) {
                trace.push(`Reasoning: ${reasoning}`);
            }

            if (response_message.content != null) {
                trace.push(`Model says: ${response_message.content}`);
            }

            // 必须将模型回复（包含 tool_calls）存入上下文
            model_messages.push(response_message);

            if (!response_message.tool_calls || response_message.tool_calls.length === 0) {
                return trace;
            }

            // 处理工具调用
            for (const tool_call of response_message.tool_calls) {
                if (tool_call.type != "function") {
                    continue;
                }
                const function_name = tool_call.function.name;
                const function_args = tool_call.function.arguments;

                trace.push(`Tool call: ${function_name} with args: ${function_args}`);
                logger.info(
                    ["model", "main-model", "tool-call", "lifecycle"],
                    "Tool call:",
                    function_name,
                    "with args:",
                    function_args,
                );

                let to_upload: any = null;
                let tool_result: any;

                try {
                    const define = napcatMcpApplication.functions.find(
                        (f) => f.name === function_name,
                    );
                    const fn = napcatTools[function_name as keyof typeof napcatTools];
                    if (!define) throw new Error(`Tool ${function_name} not found`);
                    let args = define.parse(function_args);
                    if (!args.success) {
                        throw JSON.stringify(args.errors);
                    }
                    let argsWithContext;
                    if (args.data == null) {
                        argsWithContext = { context };
                    } else {
                        argsWithContext = { ...args.data, context };
                    }
                    tool_result = await fn.fn(argsWithContext as any);

                    if (tool_result instanceof InjectOutput) {
                        to_upload = tool_result.output();
                        tool_result = tool_result.toolOutputPlaceholder();
                    }

                    if (tool_result == null) {
                        tool_result = "";
                    }
                    if (Buffer.isBuffer(tool_result) || tool_result instanceof Uint8Array) {
                        tool_result = Buffer.from(tool_result).toString("base64");
                    } else if (typeof tool_result !== "string") {
                        tool_result = JSON.stringify(tool_result);
                    }
                } catch (e) {
                    let str;
                    if (e instanceof Error) {
                        str = e.toString();
                    } else {
                        str = JSON.stringify(e);
                    }
                    tool_result = `error: ${str}`;
                }

                trace.push(`Tool result: ${String(tool_result)}`);
                logger.info(
                    ["model", "main-model", "tool-call", "lifecycle"],
                    `Tool result: ${String(tool_result).slice(0, 1024)}`,
                );

                // 反馈工具结果
                model_messages.push({
                    role: "tool",
                    tool_call_id: tool_call.id,
                    content: tool_result,
                });

                // 处理需要额外上传的内容（如图片）
                if (to_upload) {
                    model_messages.push({
                        role: "user",
                        content: [to_upload],
                    });
                }
            }
        }
        return trace;
    }
}

const mainModel = new MainModel();

export { mainModel };

class StickerInjector {
    static STICKER_SUB_TYPES = [1, 2, 7];
    map = new Map<string, Receive["image"]["data"][]>();

    addEvent(event: HintInjectedEvent) {
        if (event.post_type == "message") {
            for (const seg of event.message) {
                if (seg.type == "image") {
                    if (StickerInjector.STICKER_SUB_TYPES.includes(<number>seg.data.sub_type)) {
                        let e = this.map.get(seg.data.file);
                        if (!e) {
                            this.map.set(seg.data.file, []);
                            e = this.map.get(seg.data.file)!;
                        }
                        e.push(seg.data);
                    }
                }
            }
        }
    }

    async process() {
        const tasks: Promise<void>[] = [];
        logger.info(["parse-image", "lifecycle"], "Processing sticker", [...this.map.keys()]);
        for (const entry of this.map.entries()) {
            tasks.push(this.processOne(entry[0], entry[1]));
        }
        await Promise.all(tasks);
    }

    private async processOne(fileId: string, segs: Receive["image"]["data"][]) {
        const d = await sticker.getOrCreateDescription(fileId, segs[0].url);
        if (d == null) {
            return;
        }
        segs.forEach((seg) => {
            // any: inject
            (<any>seg).sticker_summary = d.summary;
            (<any>seg).description = d.description;
            (<any>seg).tags = d.tags;
        });
    }
}
