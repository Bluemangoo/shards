import puppeteer, { Browser, Page } from "puppeteer";
import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import fs from "node:fs";
import { createRequire } from "node:module";
import { ConnectionClosedError } from "puppeteer-core";
import { retry } from "./function.ts";
import logger from "../log/logger.ts";

export interface ArticleResult {
    title: string;
    excerpt: string;
    markdown: string;
}

let browser: Browser = await puppeteer.launch({
    headless: true,
});

const retryAbleErrors = [ConnectionClosedError];
const retryAbleFilters = [
    (e: unknown) => {
        if (e instanceof Error) {
            if (e.message.startsWith("net::ERR_CONNECTION")) {
                return true;
            }
        }
        return false;
    },
];
const retryTimes = 3;

export async function fetchUrlAsMarkdown(url: string): Promise<ArticleResult> {
    if (!browser || !browser.connected) {
        logger.warn(["tool-call"], "浏览器实例已断开，正在尝试重启...");
        browser.close().catch(() => {});
        browser = await puppeteer.launch({ headless: true });
    }
    const page: Page = await browser.newPage();
    try {
        await page.setUserAgent({
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        });

        await page.setRequestInterception(true);
        page.on("request", (req) => {
            const resourceType = req.resourceType();
            if (["font", "media", "stylesheet", "image"].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await retry(
            () => page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 }),
            retryAbleErrors,
            retryAbleFilters,
            retryTimes,
        );
        await autoScroll(page);

        const require = createRequire(import.meta.url);
        // !ASSUME file is there!
        const readabilityPath = require.resolve("@mozilla/readability/Readability.js");
        const readabilityCode = fs.readFileSync(readabilityPath, "utf-8");
        await page.evaluate(readabilityCode)

        const article = await page.evaluate(() => {
            const win = window as any;
            const mod = typeof module !== "undefined" ? module : { exports: null };

            const ReadabilityConstructor = win.Readability || mod.exports;

            if (!ReadabilityConstructor) {
                throw new Error("Readability 未能成功注入到 window 对象中");
            }

            const reader: Readability = new ReadabilityConstructor(document);
            return reader.parse();
        });

        if (!article) {
            throw new Error("无法从该页面提取正文，可能页面被严重混淆或反爬限制。");
        }

        const turndownService = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
            hr: "---",
            bulletListMarker: "-",
            emDelimiter: "*",
        });

        turndownService.remove([
            "script",
            "noscript",
            "style",
            "iframe",
            "canvas",
            "video",
            "audio",
        ]);

        const markdownContent = turndownService.turndown(article.content || "");

        return {
            title: article.title || "",
            excerpt: article.excerpt || "",
            markdown: markdownContent.substring(0, 50000),
        };
    } finally {
        await page.close();
    }
}

async function autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}
