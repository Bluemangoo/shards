import OpenAI from "openai";
import { ChatNode, ConsumedEvent } from "../data/database/history.ts";
import { ModelContext } from "../utils/context.ts";
import { HintInjectedEvent } from "../types/event.ts";
import {
    InjectOutput,
    napcatMcpApplication,
    napcatToolDefined,
    napcatTools,
} from "../napcat/tools.ts";
import { fullStripEvent, getModelHint } from "../napcat/pre_stringify_event.ts";
import CONFIG from "../data/config/config.ts";
import workingMemory from "./working_memory.ts";
import { longTermMemory } from "./long_term_memory.ts";
import { Receive } from "node-napcat-ts/dist/Structs";
import { sticker } from "../data/database/sticker.ts";
import { readPrompt } from "../utils/file.ts";

class MainModel {
    client: OpenAI;
    model: string;
    prompt_dev: string = "";
    prompt_sys: string = "";
    prompt_hint: string = "";

    constructor(
        baseUrl: string = CONFIG.mainModel.baseUrl,
        apiKey: string = CONFIG.mainModel.apiKey,
        model: string = CONFIG.mainModel.model,
    ) {
        this.model = model;
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
        console.log(
            "Responding to chat with messages:",
            messages.length,
            "and history:",
            history.length,
        );

        const model_messages: any[] = [
            { role: "system", content: this.prompt_dev },
            { role: "system", content: this.prompt_sys },
        ];

        const memoryAndSticker: Promise<void>[] = [];
        memoryAndSticker.push(
            (async () => {
                try {
                    const memory = await longTermMemory.fullSearch(messages, history);
                    console.log("Found", memory.length, "relevant long-term memory items");
                    model_messages.push({
                        role: "system",
                        content: JSON.stringify({
                            type: "matched_memory",
                            memory: memory.map((r) => ({
                                content: r.content,
                                created_at:
                                    r.created_at.toLocaleDateString() +
                                    " " +
                                    r.created_at.toLocaleTimeString(),
                            })),
                        }),
                    });
                } catch (e) {
                    console.error("Failed to search memory, skipped:", e);
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
                    console.error("Failed to inject sticker description", e);
                }
            })(),
        );
        await Promise.all(memoryAndSticker);

        const model_history: ChatNode[] = [];
        const trace: string[] = [];
        const history_messages: any[] = [];
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
        const hints: any[] = [{ type: "hint", remark: "当前工作记忆", workingMemory: wm }];
        const windowContext = await getModelHint(messages[0]);
        if (windowContext) {
            hints.push({ type: "hint", remark: "当前聊天窗口", windowContext });
        }
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

        // 处理历史记录
        for (const event of history) {
            if (event.chat_node && !model_history.includes(event.chat_node)) {
                model_history.push(event.chat_node);
            }
            history_messages.push({
                type: "history_message",
                event: await fullStripEvent(event.event),
            });
        }

        model_messages.push({ role: "user", content: JSON.stringify(history_messages) });

        for (const node of model_history) {
            model_messages.push({ role: "assistant", content: JSON.stringify(node.trace) });
        }

        const new_messages_payload: any[] = [];
        for (const event of messages) {
            new_messages_payload.push({
                type: "new_message",
                event: await fullStripEvent(event),
            });
        }
        new_messages_payload.push({ type: "hint", content: this.prompt_hint });

        model_messages.push({ role: "user", content: JSON.stringify(new_messages_payload) });

        console.log("Requesting main model", model_messages);
        let firstCalled = true;

        while (true) {
            let response;
            try {
                response = await this.client.chat.completions.create({
                    model: this.model,
                    messages: model_messages,
                    tools: napcatToolDefined as any,
                    tool_choice: "auto",
                    reasoning_effort: "medium",
                });
            } catch (e) {
                if (firstCalled) {
                    throw e;
                }
                console.error(e);
                trace.push("!!Uncommon thinking stop, maybe not finished.");
                break;
            }
            firstCalled = false;

            const response_message = response.choices[0].message;
            console.log(response_message);

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
                console.log(`Tool call: ${function_name} with args: ${function_args}`);

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
                    tool_result = `error: ${e}`;
                }

                trace.push(`Tool result: ${String(tool_result).slice(0, 256)}`);
                console.log(`Tool result: ${String(tool_result).slice(0, 256)}`);

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

export function loadPrompts() {
    try {
        mainModel.prompt_dev = readPrompt("dev");
        mainModel.prompt_sys = readPrompt("sys");
        mainModel.prompt_hint = readPrompt("hint");
    } catch (e) {
        console.error("Failed to load prompt files:", e);
    }
}

loadPrompts();

export { mainModel };

class StickerInjector {
    map = new Map<string, Receive["image"]["data"][]>();

    addEvent(event: HintInjectedEvent) {
        if (event.post_type == "message") {
            for (const seg of event.message) {
                if (seg.type == "image") {
                    if (seg.data.summary == "[动画表情]") {
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
