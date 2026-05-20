import OpenAI from "openai";
import CONFIG from "../data/config/config.ts";
import { HintInjectedEvent } from "../types/event.ts";
import { fullStripEvent, getModelHint, preStringifyEvent } from "../napcat/pre-stringify-event.ts";
import workingMemory, { WorkingMemoryItem } from "./working-memory.ts";
import { LlmJson } from "@typia/utils";
import { ChatNode, ConsumedEvent } from "../data/database/history.ts";
import PROMPTS from "../data/config/prompts.ts";

type SearchExtendedAnswer = {
    keywords: string | string[];
    hypothetical_answers?: string[];
};

type FullSearchExtendedAnswer = {
    intent: string;
    keywords: string | string[];
    hypothetical_answers?: string[];
};

class LiteModel {
    client: OpenAI;
    model: string;
    temperature = 0.4;

    constructor(
        baseUrl: string = CONFIG.liteModel.baseUrl,
        apiKey: string = CONFIG.liteModel.apiKey,
        model: string = CONFIG.liteModel.model,
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

    async processWorkingMemory(
        messages: HintInjectedEvent[],
        trace: string[],
        history: ConsumedEvent[],
    ) {
        const windowContext = await getModelHint(messages[0]);
        const currentWorkingMemory = workingMemory.list();
        const stripedMessages = await Promise.all(messages.map((msg) => fullStripEvent(msg)));
        const model_messages: any[] = [
            ...PROMPTS.vibe.map((s) => ({ role: "system", content: "语言使用参考：" + s })),
            { role: "system", content: PROMPTS.workingMemory },
        ];

        const data = [];
        data.push({ type: "设定(无需加入记忆)", sysPrompt: PROMPTS.sys });
        if (windowContext) {
            data.push({ type: "当前聊天窗口", windowContext });
        }
        data.push({
            type: "参考上下文(无需加入记忆)",
            history: await Promise.all(
                ConsumedEvent.group(history).map(async (h) => ({
                    messages: await Promise.all(h.events.map((e) => preStringifyEvent(e))),
                    trace: h.chatNode,
                })),
            ),
        });
        data.push(
            { type: "当前记忆", currentWorkingMemory },
            { type: "当前消息", messages: stripedMessages },
            { type: "模型思考轨迹", trace },
        );
        model_messages.push({
            role: "user",
            content: JSON.stringify(data),
        });
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: model_messages,
            reasoning_effort: "low",
            temperature: this.temperature,
        });

        console.log(response.choices[0].message);
        const content = response.choices[0].message.content;
        if (content) {
            await workingMemory.execModelOutput(content);
        }
    }

    async extendMemorySearch(query: string) {
        const model_messages: any[] = [
            { role: "system", content: PROMPTS.memorySearch },
            { role: "user", content: query },
        ];
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: model_messages,
            reasoning_effort: "low",
        });

        console.log(response.choices[0].message);
        const content = response.choices[0].message.content;
        if (content == null) {
            return {
                keywords: "",
                hypothetical_answers: [],
            };
        }
        const parsed = LlmJson.parse<SearchExtendedAnswer>(content);
        if (!parsed.success) {
            throw parsed.errors;
        }
        let keywords: string;
        if (Array.isArray(parsed.data.keywords)) {
            keywords = parsed.data.keywords.join(" ");
        } else {
            keywords = parsed.data.keywords;
        }
        return {
            keywords,
            hypothetical_answers: parsed.data.hypothetical_answers ?? [],
        };
    }

    async extendFullMemorySearch(messages: HintInjectedEvent[], history: ConsumedEvent[]) {
        const stripedMessages = [];
        const modelHistory: ChatNode[] = [];
        for (const event of history) {
            if (event.chatNode && !modelHistory.includes(event.chatNode)) {
                modelHistory.push(event.chatNode);
            }
            stripedMessages.push(await preStringifyEvent(event.event));
        }
        for (const event of messages) {
            stripedMessages.push(await preStringifyEvent(event));
        }

        const model_messages: any[] = [
            { role: "system", content: PROMPTS.memoryFullSearch },
            {
                role: "user",
                content: JSON.stringify({ events: stripedMessages, trace: modelHistory }),
            },
        ];
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: model_messages,
            reasoning_effort: "low",
            temperature: this.temperature,
        });

        console.log(response.choices[0].message);
        const content = response.choices[0].message.content;
        if (content == null) {
            return [];
        }
        const parsed = LlmJson.parse<Array<FullSearchExtendedAnswer>>(content);
        if (!parsed.success) {
            throw parsed.errors;
        }
        const contents: { keywords: string; hypothetical_answers: string[] }[] = [];
        for (const d of parsed.data) {
            let keywords: string;
            if (Array.isArray(d.keywords)) {
                keywords = d.keywords.join(" ");
            } else {
                keywords = d.keywords;
            }
            const hypothetical_answers = d.hypothetical_answers ?? [];
            hypothetical_answers.push(d.intent);
            contents.push({
                keywords,
                hypothetical_answers,
            });
        }

        return contents;
    }

    async extractMemory(messages: HintInjectedEvent[], trace: string[], history: ConsumedEvent[]) {
        const windowContext = await getModelHint(messages[0]);
        const stripedMessages = await Promise.all(messages.map((msg) => fullStripEvent(msg)));
        const model_messages: any[] = [
            ...PROMPTS.vibe.map((s) => ({ role: "system", content: "语言使用参考：" + s })),
            { role: "system", content: PROMPTS.memoryAdd },
        ];
        const data = [];
        data.push({ type: "设定(无需加入记忆)", sysPrompt: PROMPTS.sys });
        if (windowContext) {
            data.push({ type: "当前聊天窗口", windowContext });
        }
        data.push({
            type: "参考上下文(无需加入记忆)",
            history: await Promise.all(
                ConsumedEvent.group(history).map(async (h) => ({
                    messages: await Promise.all(h.events.map((e) => preStringifyEvent(e))),
                    trace: h.chatNode,
                })),
            ),
        });
        data.push({ type: "当前消息", messages: stripedMessages }, { type: "模型思考轨迹", trace });
        model_messages.push({
            role: "user",
            content: JSON.stringify(data),
        });
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: model_messages,
            reasoning_effort: "medium",
            temperature: this.temperature,
        });
        console.log(response.choices[0].message);
        const content = response.choices[0].message.content;
        if (content == null) {
            return [];
        }
        const parsed = LlmJson.parse<string[]>(content);
        if (!parsed.success) {
            throw parsed.errors;
        }
        return parsed.data;
    }

    async dreaming(workingMemory: {
        dreamed_alive: WorkingMemoryItem[];
        undreamed_expired: WorkingMemoryItem[];
        undreamed_alive: WorkingMemoryItem[];
    }) {
        const model_messages: any[] = [
            ...PROMPTS.vibe.map((s) => ({ role: "system", content: "语言使用参考：" + s })),
            { role: "system", content: PROMPTS.dreaming },
        ];
        model_messages.push({
            role: "user",
            content: JSON.stringify(workingMemory),
        });
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: model_messages,
            reasoning_effort: "high",
            temperature: this.temperature,
        });
        console.log(response.choices[0].message);
        const content = response.choices[0].message.content;
        if (content == null) {
            return [];
        }
        const parsed = LlmJson.parse<string[]>(content);
        if (!parsed.success) {
            throw parsed.errors;
        }
        return parsed.data;
    }
}

const liteModel = new LiteModel();

export { liteModel };
