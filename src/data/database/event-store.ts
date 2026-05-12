import db from "./db.ts";
import { ChatWindow } from "../../utils/chat-window.ts";
import { HintInjectedEvent } from "../../types/event.ts";

export class EventStore {
    static async push_event(event: HintInjectedEvent): Promise<void> {
        await db().query("INSERT INTO events (data) VALUES ($1)", [event]);
    }

    static async get_window_events(
        window: ChatWindow | null,
        end_time?: number,
        count: number = 10,
    ): Promise<HintInjectedEvent[]> {
        if (!window) {
            return [];
        }

        const conditions: string[] = [];
        const params: any[] = [];
        let paramIdx = 1;

        if (window.type === "group") {
            conditions.push("data->>'message_type' = 'group'");
            conditions.push(`data->>'group_id' = $${paramIdx++}`);
            params.push(String(window.id));
        } else if (window.type === "private") {
            conditions.push("data->>'message_type' = 'private'");
            conditions.push(`data->>'user_id' = $${paramIdx++}`);
            params.push(String(window.id));
        }

        let query = "SELECT id, data FROM events";
        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }

        if (end_time !== undefined) {
            query += ` AND (data->>'time')::bigint < $${paramIdx++}`;
            params.push(end_time);
        }

        query += " ORDER BY id DESC";

        if (count !== undefined) {
            query += ` LIMIT $${paramIdx++}`;
            params.push(count);
        }

        const { rows } = await db().query(query, params);
        const events: HintInjectedEvent[] = [];

        for (let i = rows.length - 1; i >= 0; i--) {
            events.push(rows[i].data); // we hope it is injected
        }
        return events;
    }

    static async get_distinct_message_events(count: number = 10): Promise<HintInjectedEvent[]> {
        const query = `
            SELECT id, data
            FROM (SELECT DISTINCT ON (data ->> 'target_id') id, data
                  FROM events
                  WHERE data ->> 'message_id' IS NOT NULL
                    AND data ->> 'target_id' IS NOT NULL
                  ORDER BY data ->> 'target_id') l
            ORDER BY id DESC
            LIMIT $1
        `;
        const { rows } = await db().query(query, [count]);
        return rows.map((row) => row.data); // we hope it is injected
    }
}
