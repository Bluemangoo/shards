import OpenAI from "openai";
import CONFIG from "../data/config/config.ts";
import fs from "node:fs";
import path from "path";
import { LlmJson } from "@typia/utils";

type ImageParseResult = {
    summary: string;
    description: string;
    tags: string[];
};

class ImageModel {
    client: OpenAI;
    model: string;
    prompt = "";

    constructor(
        baseUrl: string = CONFIG.imageModel.baseUrl,
        apiKey: string = CONFIG.imageModel.apiKey,
        model: string = CONFIG.imageModel.model,
    ) {
        this.model = model;
        this.client = new OpenAI({
            baseURL: baseUrl,
            apiKey: apiKey,
            defaultHeaders: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
            },
        });
    }

    async parseImage(image: string) {
        const model_messages: any[] = [
            { role: "system", content: this.prompt },
            {
                role: "user",
                content: [
                    {
                        type: "image_url",
                        image_url: {
                            url: image,
                        },
                    },
                ],
            },
        ];
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: model_messages,
        });

        console.log(response.choices[0].message);
        const content = response.choices[0].message.content;
        if (content == null) {
            return null;
        }
        const result = LlmJson.parse<ImageParseResult>(content);
        if (!result.success) {
            throw result.errors;
        }
        return result.data;
    }
}

const imageModel = new ImageModel();
export function loadPrompts() {
    const root = process.cwd();
    try {
        imageModel.prompt = fs.readFileSync(path.join(root, "prompt/image.md"), "utf-8");
    } catch (e) {
        console.error("Failed to load prompt files:", e);
    }
}

loadPrompts();
export { imageModel };
