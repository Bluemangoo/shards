import { readdir } from "node:fs/promises";
import { parse } from "node:path";

export async function findSingleFileByBaseName(
    targetDir: string,
    targetName: string,
): Promise<string | null> {
    try {
        const entries = await readdir(targetDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isFile()) {
                const { name } = parse(entry.name);

                if (name === targetName) {
                    return entry.name;
                }
            }
        }

        return null;
    } catch (error) {
        console.error(`无法读取目录: ${targetDir}`, error);
        return null;
    }
}

