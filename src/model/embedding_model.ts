import OpenAI from "openai";
import CONFIG from "../data/config/config.ts";

class EmbeddingModel {
    private client: OpenAI;
    public model: string;

    constructor(
        baseUrl: string = CONFIG.embeddingModel.baseUrl,
        apiKey: string = CONFIG.embeddingModel.apiKey,
        model: string = CONFIG.embeddingModel.model,
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

    async createEmbedding(input: string[]) {
        return this.client.embeddings.create({ input, model: this.model });
    }
}

const embeddedModel = new EmbeddingModel();
export { embeddedModel };
