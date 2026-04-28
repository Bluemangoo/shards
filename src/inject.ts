import { initDb } from "./data/database/db.ts";
import workingMemory from "./model/working_memory.ts";
import { longTermMemory } from "./model/long_term_memory.ts";

async function inject() {
    await initDb();
    console.log("Database initialized");
    await workingMemory.load();

    // logic
    await longTermMemory.add("事实：㊗️谐音猪，常用于替换猪这个字");

    // end
    process.exit(0);
}

// noinspection JSIgnoredPromiseFromCall
inject();
