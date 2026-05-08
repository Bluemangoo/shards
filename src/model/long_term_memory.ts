import db from "../data/database/db.ts";
import { liteModel } from "./lite_model.ts";
import { HintInjectedEvent } from "../types/event.ts";
import { embeddedModel } from "./embedding_model.ts";
import { ChatNode, ConsumedEvent } from "../data/database/history.ts";
import { EVENT_HINT_MAP } from "../napcat/filter.ts";
import { stripPoke } from "../napcat/pre_stringify_event.ts";
import { cached_get_group_member_info, cached_get_stranger_info } from "../napcat/wrapper.ts";

export interface MemorySearchResult {
    content: string;
    created_at: Date;
}

class LongTermMemory {
    async addFromEvent(events: HintInjectedEvent[], trace: string[]) {
        const extracted = await liteModel.extractMemory(events, trace);
        for (const content of extracted) {
            await this.add(content);
        }
    }

    async add(content: string) {
        const newVector = await embeddedModel.createEmbedding([content]);

        const checkQuery = `
            SELECT id, content, (embedding <=> $1) as distance 
            FROM long_term_memory 
            ORDER BY embedding <=> $1 
            LIMIT 1;
        `;

        const { rows } = await db().query(checkQuery, [
            JSON.stringify(newVector.data[0].embedding),
        ]);

        const DUPLICATE_THRESHOLD = 0.06;

        if (rows.length > 0 && rows[0].distance < DUPLICATE_THRESHOLD) {
            return;
        }

        const insertQuery = `
            INSERT INTO long_term_memory (content, embedding) 
            VALUES ($1, $2)
        `;
        await db().query(insertQuery, [content, JSON.stringify(newVector.data[0].embedding)]);
    }

    async search(query: string) {
        const parsed = await liteModel.extendMemorySearch(query);
        const sentences = [query, ...parsed.hypothetical_answers];
        const embeddings = await embeddedModel.createEmbedding(sentences);
        return this.hybridSearch(
            embeddings.data.map((e) => e.embedding),
            parsed.keywords,
            100,
        );
    }

    async fullSearch(
        messages: HintInjectedEvent[],
        history: ConsumedEvent[],
        extras: string[] = [],
    ) {
        const names = new Map<number, Set<string>>();
        // 防止全表搜
        if (extras.length == 0) {
            extras = ["记忆 设定"];
        }

        const result: MemorySearchResult[] = [];
        const embeddingTasker = embeddedModel.createTask();
        const search = (hy: string[], kw: string) => {
            const createEmbeddings = embeddingTasker.add(hy);
            return async () => {
                const embeddings = await createEmbeddings();
                result.push(
                    ...(await this.hybridSearch(
                        embeddings.map((e) => e.embedding),
                        kw,
                        30,
                    )),
                );
            };
        };

        let fullMessageStr = "";
        const addId = async (uid: number, gid?: number) => {
            try {
                if (names.has(uid)) {
                    return;
                }
                const userInfo = await cached_get_stranger_info(uid);
                if (!names.has(uid)) {
                    names.set(uid, new Set<string>());
                }
                names.get(uid)!.add(userInfo.nickname);
                names.get(uid)!.add(userInfo.remark);
                if (gid != null) {
                    const memberInfo = await cached_get_group_member_info(uid, gid);
                    if (!names.has(uid)) {
                        names.set(uid, new Set<string>());
                    }
                    names.get(uid)!.add(memberInfo.card);
                    names.get(uid)!.add(memberInfo.nickname);
                }
            } catch (e) {
                // ignore
            }
        };
        const pickMessage = async (msg: HintInjectedEvent) => {
            if (msg.post_type == "message") {
                let groupId: number | undefined = undefined;
                if (msg.sub_type != "friend") {
                    groupId = msg.group_id;
                }
                await addId(msg.sender.user_id, groupId);
                for (const segment of msg.message) {
                    if (segment.type == "at") {
                        if (segment.data.qq != "all") {
                            await addId(Number(segment.data.qq), groupId);
                        }
                    }
                }
                fullMessageStr += msg.raw_message;
            }
            if (msg.sub_type == "poke") {
                try {
                    let groupId: number | undefined = undefined;
                    if (msg.hint == EVENT_HINT_MAP["notice.notify.poke.group"]) {
                        groupId = msg.group_id;
                    }
                    const ids = [msg.sender_id, msg.user_id, msg.target_id];
                    for (const id of ids) {
                        await addId(id, groupId);
                    }
                    fullMessageStr += (await stripPoke(msg)).stringified_message;
                } catch (e) {
                    // ignore
                }
            }
        };
        const tasks: (() => Promise<any>)[] = [];

        let currentTrace: ChatNode | null = null;
        for (const event of history) {
            if (event.chat_node && currentTrace != event.chat_node) {
                fullMessageStr += currentTrace?.trace.join("\n") || "";
                if (fullMessageStr.length > 0) {
                    tasks.push(search([fullMessageStr], extras.join(" ")));
                    fullMessageStr = "";
                }
                currentTrace = event.chat_node;
            }
            await pickMessage(event.event);
        }
        for (const msg of messages) {
            await pickMessage(msg);
        }
        for (const extra of extras) {
            tasks.push(search([extra], extra));
        }
        for (const u of names.entries()) {
            const arr = Array.from(u[1]);
            arr.push(String(u[0]));
            const nameStr = arr.join(" ");
            tasks.push(search(arr, nameStr));
        }
        if (fullMessageStr.length > 0) {
            tasks.push(search([fullMessageStr], extras.join(" ")));
        }
        await Promise.all(tasks.map((task) => task()));
        return this.sortResults(result);
    }

    sortResults(results: MemorySearchResult[]) {
        return [...new Map(results.map((item) => [item.content, item])).values()].sort(
            (a, b) => Number(a.created_at) - Number(b.created_at),
        );
    }

    async hybridSearch(
        queryEmbeddings: number[][],
        queryKeywords: string,
        limit = 5,
    ): Promise<MemorySearchResult[]> {
        // noinspection SqlResolve
        const query = `
            WITH unnested_embeddings AS (SELECT CAST(value AS vector) AS emb
                                         FROM json_array_elements_text($1::json)),
                 vector_search AS (SELECT l.id,
                                          l.content,
                                          l.created_at,
                                          ROW_NUMBER() OVER (ORDER BY MIN(l.embedding <=> u.emb)) as rank
                                   FROM long_term_memory l
                                            CROSS JOIN unnested_embeddings u
                                   GROUP BY l.id, l.content, l.created_at
                                   HAVING MIN(l.embedding <=> u.emb) < 0.45
                                   ORDER BY MIN(l.embedding <=> u.emb)
                                   LIMIT 50),
                 keyword_search AS (SELECT id,
                                           content,
                                           created_at,
                                           ROW_NUMBER() OVER (ORDER BY content <-> $2) as rank
                                    FROM long_term_memory
                                    WHERE (content <-> $2) < 0.6
                                    ORDER BY content <-> $2
                                    LIMIT 50)
            
            SELECT v.id                                                                      as id,
                   v.content                                                                 as content,
                   v.created_at                                                              as created_at,
                   (COALESCE(1.0 / (60 + v.rank), 0.0) + COALESCE(1.0 / (60 + k.rank), 0.0)) as rrf_score
            FROM vector_search v
                     FULL OUTER JOIN keyword_search k ON v.id = k.id
            ORDER BY rrf_score DESC
            LIMIT $3;
        `;

        const embeddingsJson = JSON.stringify(queryEmbeddings.map((arr) => JSON.stringify(arr)));

        const { rows } = await db().query(query, [embeddingsJson, queryKeywords, limit]);

        return rows.map((r) => ({
            content: r.content,
            created_at: new Date(r.created_at),
        }));
    }
}

const longTermMemory = new LongTermMemory();

export { longTermMemory };
