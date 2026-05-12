import { napcat } from "./client.ts";

export async function fetch_ptt_text(params: { message_id: number }): Promise<{ text: string }> {
    return await napcat.send("fetch_ptt_text" as any, params);
}
