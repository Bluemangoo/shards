import * as util from "node:util";
import { wsLoggerHandler } from "./ws.ts";
import CONFIG from "../data/config/config.ts";

export namespace Logger {
    export class Logger {
        protected loggers: Map<Level, Processor[]> = new Map([
            ["info", []],
            ["warn", []],
            ["error", []],
        ]);
        register(levels: Level[], processor: Processor) {
            for (const level of levels) {
                this.loggers.get(level)!.push(processor);
            }
        }
        protected stringify: Stringify = (args: any[]) => {
            const rendered: string[] = [];
            for (const arg of args) {
                if (typeof arg == "string") {
                    rendered.push(arg);
                } else {
                    rendered.push(util.inspect(arg, { colors: true }));
                }
            }
            return rendered.join(" ");
        };
        info(label: string[], ...args: any[]) {
            for (const processor of this.loggers.get("info")!) {
                processor("info", label, args, this.stringify);
            }
        }
        warn(label: string[], ...args: any[]) {
            for (const processor of this.loggers.get("warn")!) {
                processor("warn", label, args, this.stringify);
            }
        }
        error(label: string[], ...args: any[]) {
            for (const processor of this.loggers.get("error")!) {
                processor("error", label, args, this.stringify);
            }
        }
    }
    export type Level = "info" | "warn" | "error";
    export type Stringify = (args: any[]) => string;
    export type Processor = (
        level: Level,
        label: string[],
        args: any[],
        stringify: Stringify,
    ) => any;
}

const logger = new Logger.Logger();

logger.register(["info", "warn", "error"], (level, _label, args, _fn) => console[level](...args));
// tips: 需要额外的面板观测自己在这里注册钩子拿打完标签的日志。
if (CONFIG.logViewer.wsPort) {
    logger.register(["info", "warn", "error"], wsLoggerHandler);
}

export default logger;
