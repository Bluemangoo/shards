import { readdir } from "node:fs/promises";
import { parse } from "node:path";
import fs from "node:fs";
import path from "path";
import mime from "mime-types";

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

export function readPrompt(name: string) {
    return fs
        .readFileSync(path.join(process.cwd(), `prompt/${name}.md`), "utf-8")
        .replaceAll("\r\n", "\n");
}

export function readPrompts(dirName: string): string[] {
    const targetDir = path.join(process.cwd(), "prompt", dirName);

    let files;
    try {
        files = fs.readdirSync(targetDir);
    } catch {
        return [];
    }

    return files
        .filter((file) => file.endsWith(".md") || file.endsWith(".txt"))
        .map((file) => {
            const filePath = path.join(targetDir, file);
            return fs.readFileSync(filePath, "utf-8").replaceAll("\r\n", "\n");
        });
}

export function fileToBase64Url(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    const base64String = fileBuffer.toString("base64");
    const mimeType = mime.lookup(filePath) || "application/octet-stream";
    return `data:${mimeType};base64,${base64String}`;
}

export function resetExt(filePath: string): string {
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    let ext: string | undefined = undefined;
    if (buffer.subarray(0, 3).toString("ascii") === "GIF") {
        ext = ".gif";
    }
    if (buffer.subarray(0, 4).toString("hex") === "89504e47" /*0x89+PNG*/) {
        ext = ".png";
    }
    if (buffer.subarray(0, 3).toString("hex") === "ffd8ff") {
        ext = ".jpg";
    }
    if (ext == undefined || filePath.endsWith(ext)) {
        return filePath;
    }

    const parsed = path.parse(filePath);
    const finalFilePath = path.join(parsed.dir, parsed.name + ext);
    fs.renameSync(filePath, finalFilePath);

    return finalFilePath;
}
