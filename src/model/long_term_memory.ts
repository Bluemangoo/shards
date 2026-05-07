import db from "../data/database/db.ts";
import { liteModel } from "./lite_model.ts";
import { HintInjectedEvent } from "../types/event.ts";
import { embeddedModel } from "./embedding_model.ts";
import { ConsumedEvent } from "../data/database/history.ts";

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
        const searchPattern = await liteModel.extendFullMemorySearch(messages, history);
        const result: MemorySearchResult[] = [];
        for (const entry of searchPattern) {
            const embeddings = await embeddedModel.createEmbedding(entry.hypothetical_answers);
            result.push(
                ...(await this.hybridSearch(
                    embeddings.data.map((e) => e.embedding),
                    entry.keywords,
                    50,
                )),
            );
        }
        for (const extra of extras) {
            const embeddings = await embeddedModel.createEmbedding([extra]);
            result.push(
                ...(await this.hybridSearch(
                    embeddings.data.map((e) => e.embedding),
                    extra,
                    50,
                )),
            );
        }
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

        // 返回时把时间和内容一起带出去
        return rows.map((r) => ({
            content: r.content,
            created_at: new Date(r.created_at),
        }));
    }
}

const longTermMemory = new LongTermMemory();

export { longTermMemory };
