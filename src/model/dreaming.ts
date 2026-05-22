import db from "../data/database/db.ts";
import workingMemory, { WorkingMemoryItem } from "./working-memory.ts";
import { splitLists } from "../utils/list.ts";
import { liteModel } from "./lite-model.ts";
import { longTermMemory } from "./long-term-memory.ts";
import logger from "../log/logger.ts";

export async function dreaming() {
    await precipitate();
}

async function precipitate(force = false) {
    const data = await db().query(
        "select id, content, weight, last_access from working_memory where dreamed is false",
    );
    const undreamed: WorkingMemoryItem[] = data.rows.map((row: any) => ({
        key: row.id as number,
        value: row.content as string,
        weight: row.weight as number,
        lastAccessed: Number(row.last_access) as number,
    }));
    if (!force && undreamed.length < 20) {
        return;
    }
    logger.info(["model", "lite-model", "long-term-memory", "dreaming"], "start dreaming");
    const current = workingMemory.list();
    const splitResult = splitLists(current, undreamed, "key");
    // inA == alive; inB == undreamed
    const wm = {
        dreamed_alive: splitResult.onlyInA,
        undreamed_expired: splitResult.onlyInB,
        undreamed_alive: splitResult.inBoth,
    };
    const result = await liteModel.dreaming(wm);
    for (const entry of result) {
        await longTermMemory.add(entry);
    }
    await db().query("update working_memory set dreamed = true where id = any($1::int[])", [
        undreamed.map((item) => item.key),
    ]);
    logger.info(["model", "lite-model", "long-term-memory", "dreaming"], "dreaming completed");
}
