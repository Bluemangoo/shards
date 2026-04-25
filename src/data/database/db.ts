import { Client } from "pg";
import CONFIG from "../config/config.ts";
import { migrateDB } from "./migration.ts";
import { readFileSync } from "node:fs";

const dbVersion = 1;

let _db: Client | undefined = undefined;

export async function initDb(): Promise<Client> {
    if (!_db) {
        // connect
        _db = new Client({
            connectionString: CONFIG.database.url,
        });
        const e = _db.end;
        _db.end = async function () {
            e.apply(_db);
            _db = undefined;
        };
        _db.on("error", async (_) => {
            await _db?.end();
            await initDb();
        });
        await _db.connect();

        // migrate
        let status = 0; // -1 as init
        let currentDBVer: number | undefined = undefined;
        try {
            const result = await _db.query("select version from meta;");
            currentDBVer = result.rows[0].version;
        } catch (e) {
            status = -1;
        }
        if (currentDBVer == undefined || status == -1) {
            await _db.query(readFileSync(process.cwd() + "/src/sql/init.sql").toString());
        } else {
            await migrateDB(currentDBVer, dbVersion, _db);
        }
    }
    return _db;
}

export default function db(): Client {
    return <Client>_db;
}
