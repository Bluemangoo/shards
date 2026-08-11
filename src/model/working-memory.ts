import WeightedLRU, { CacheItem } from "../types/weighted-lru.ts";
import db from "../data/database/db.ts";
import { LlmJson } from "@typia/utils";

type Touch = { fn: "touch"; key: number };
type Remove = { fn: "remove"; key: number };
type Add = { fn: "add"; content: string; weight: number };
type Update = { fn: "update"; key: number; content: string; weight: number };
type UpdateContent = { fn: "updateValue"; key: number; content: string };
type UpdateWeight = { fn: "updateWeight"; key: number; weight: number };
type WorkingMemoryProcessRequest = (Touch | Remove | Add | Update | UpdateContent | UpdateWeight)[];

export type WorkingMemoryItem = CacheItem<number, string>;

class WorkingMemory {
    private inner = new WeightedLRU<number, string>(50);

    async load() {
        const data = await db().query(
            "select id, content, weight, last_access from working_memory order by last_access / weight limit 60",
        );
        const entries: WorkingMemoryItem[] = data.rows.map((row: any) => ({
            key: row.id as number,
            value: row.content as string,
            weight: row.weight as number,
            lastAccessed: Number(row.last_access) as number,
        }));
        this.inner.clear();
        this.inner.putAllRaw(entries);
    }

    private async dbUpdate(value: WorkingMemoryItem) {
        await db().query(
            "update working_memory set content=$1, weight=$2, last_access=$3 where id=$4",
            [value.value, value.weight, value.lastAccessed, value.key],
        );
    }

    private async dbDrop(key: number) {
        await db().query("delete from working_memory where id = $1", [key]);
    }

    private async dbAdd(content: string, weight: number, lastAccessed: number) {
        const data = await db().query(
            "insert into working_memory (content, weight, last_access) values ($1, $2, $3) returning id",
            [content, weight, lastAccessed],
        );
        return data.rows[0].id as number;
    }

    async touch(key: number) {
        const d = this.inner.get(key);
        if (d) {
            await this.dbUpdate(d);
            return true;
        } else {
            return false;
        }
    }

    async remove(key: number) {
        this.inner.remove(key);
        await this.dbDrop(key);
    }

    async add(value: string, weight: number) {
        weight = weight <= 0 ? 0.0001 : weight;
        const time = Date.now();
        const id = await this.dbAdd(value, weight, time);
        this.inner.put(id, value, weight, time);
    }

    async update(key: number, value: string, weight: number) {
        if (!this.inner.has(key)) {
            return false;
        }
        weight = weight <= 0 ? 0.0001 : weight;
        const d = this.inner.get(key)!;
        d.value = value;
        d.weight = weight;
        await this.dbUpdate(d);
    }

    async updateContent(key: number, content: string): Promise<boolean> {
        if (!this.inner.has(key)) {
            return false;
        }
        const d = this.inner.get(key)!;
        d.value = content;
        await this.dbUpdate(d);
        return true;
    }

    async updateWeight(key: number, weight: number) {
        if (!this.inner.has(key)) {
            return false;
        }
        const d = this.inner.get(key);
        d!.weight = weight <= 0 ? 0.0001 : weight;
        await this.dbUpdate(d!);
        return true;
    }

    list(): WorkingMemoryItem[] {
        return this.inner.peekAll();
    }

    async execModelOutput(output: string) {
        const d = LlmJson.parse<WorkingMemoryProcessRequest>(output);
        if (d.data == null) {
            if (!d.success) {
                throw d.errors;
            }
            return;
        }
        for (const line of d.data) {
            switch (line.fn) {
                case "touch": {
                    if (line.key != null) {
                        await this.touch(line.key);
                    }
                    break;
                }
                case "remove": {
                    if (line.key != null) {
                        await this.remove(line.key);
                    }
                    break;
                }
                case "add": {
                    if (line.content != null && line.weight != null) {
                        await this.add(line.content, line.weight);
                    }
                    break;
                }
                case "update": {
                    if (line.key != null && line.content != null && line.weight != null) {
                        await this.update(line.key, line.content, line.weight);
                    }
                    break;
                }
                case "updateValue": {
                    if (line.key != null && line.content != null) {
                        await this.updateContent(line.key, line.content);
                    }
                    break;
                }
                case "updateWeight": {
                    if (line.key != null && line.weight != null) {
                        await this.updateWeight(line.key, line.weight);
                    }
                    break;
                }
            }
        }
        if (!d.success) {
            throw d.errors;
        }
    }
}

const workingMemory = new WorkingMemory();
export default workingMemory;
