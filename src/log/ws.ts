import CircularQueue from "../utils/circular-queue.ts";
import { Logger } from "./logger.ts";
import { WebSocketServer, WebSocket } from "ws";
import * as http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { removeLeading } from "../utils/string.ts";
import CONFIG from "../data/config/config.ts";

type Line = {
    level: Logger.Level;
    labels: string[];
    content: string;
};
const connectPool = new Set<WebSocket>();
const pool = new CircularQueue<Line>(500);
const logFilePath = path.join(process.cwd(), "data", "app.log");
function loadLogs(targetZeroCount = 501) {
    let fd;
    try {
        fd = fs.openSync(logFilePath, "r");

        const stat = fs.fstatSync(fd);
        const fileSize = stat.size;

        if (fileSize === 0) return;

        const CHUNK_SIZE = 64 * 1024;
        const buffer = Buffer.alloc(CHUNK_SIZE);

        let position = fileSize;
        let zeroCount = 0;
        let targetPos = 0;

        while (position > 0) {
            const bytesToRead = Math.min(CHUNK_SIZE, position);
            position -= bytesToRead;

            fs.readSync(fd, buffer, 0, bytesToRead, position);

            for (let i = bytesToRead - 1; i >= 0; i--) {
                if (buffer[i] === 0x00) {
                    zeroCount++;
                    if (zeroCount === targetZeroCount) {
                        targetPos = position + i + 1;
                        break;
                    }
                }
            }

            if (zeroCount === targetZeroCount) {
                break;
            }
        }

        const lengthToRead = fileSize - targetPos;
        if (lengthToRead <= 0) return;

        const resultBuffer = Buffer.alloc(lengthToRead);
        fs.readSync(fd, resultBuffer, 0, lengthToRead, targetPos);

        for (const s of resultBuffer.toString("utf8").split("\0")) {
            try {
                const line = JSON.parse(s);
                if (
                    typeof line.level === "string" &&
                    Array.isArray(line.labels) &&
                    typeof line.content === "string"
                ) {
                    pool.push(line);
                }
            } catch {}
        }
    } catch (err) {
        return;
    } finally {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            } catch (closeErr) {}
        }
    }
}
loadLogs();
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });
logStream.on("error", (err) => {
    console.error("日志文件流发生错误:", err);
});
export const wsLoggerHandler: Logger.Processor = async (level, labels, args, stringify) => {
    const line = {
        level,
        labels,
        content: stringify(args),
    };
    pool.push(line);
    logStream.write(JSON.stringify(line) + "\0");
    const txt = JSON.stringify(line);
    for (const ws of connectPool) {
        try {
            ws.send(txt);
        } catch {}
    }
};

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
};
const PUBLIC_DIR = process.cwd() + "/frontend";

const server = http.createServer((req, res) => {
    try {
        function _404() {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("404 Not Found");
        }

        let reqPath = req.url!.split("?")[0];
        if (reqPath.endsWith("/")) {
            reqPath += "index.html";
        }
        let filePath = path.join(PUBLIC_DIR, removeLeading(reqPath, "/"));

        if (!filePath.startsWith(path.normalize(PUBLIC_DIR))) {
            return _404();
        }

        fs.stat(filePath, (err, stats) => {
            if (err) {
                if (err.code === "ENOENT") {
                    return _404();
                }
                res.writeHead(500);
                return res.end(`Server Error: ${err.code}`);
            }

            if (stats.isDirectory()) {
                filePath = path.join(filePath, "index.html");
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    return _404();
                }

                const ext = path.extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || "application/octet-stream";

                res.writeHead(200, { "Content-Type": contentType });
                res.end(data);
            });
        });
    } catch (e) {
        console.error(e);
    }
});

const wsServer = new WebSocketServer({
    server,
});

wsServer.on("connection", (ws) => {
    connectPool.add(ws);
    for (const line of pool.frozen()) {
        ws.send(JSON.stringify(line));
    }
    ws.on("close", () => {
        connectPool.delete(ws);
    });
});

if (CONFIG.logViewer.wsPort) {
    server.listen(CONFIG.logViewer.wsPort);
}
