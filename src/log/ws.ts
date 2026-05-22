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
export const wsLoggerHandler: Logger.Processor = async (level, labels, args, stringify) => {
    const line = {
        level,
        labels,
        content: stringify(args),
    };
    pool.push(line);
    for (const ws of connectPool) {
        ws.send(JSON.stringify(line));
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
