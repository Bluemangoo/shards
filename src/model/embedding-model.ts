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

    createTask() {
        let batch = {
            input: [] as string[],
            promise: null as Promise<(OpenAI.Embeddings.Embedding | Error)[]> | null,
        };

        const add = (i: string[]) => {
            const currentBatch = batch;

            const start = currentBatch.input.length;
            currentBatch.input.push(...i);
            const end = currentBatch.input.length;

            return async () => {
                if (!currentBatch.promise) {
                    batch = { input: [], promise: null };

                    const chunks: string[][] = [];
                    let currentChunk: string[] = [];
                    let currentLength = 0;

                    for (const text of currentBatch.input) {
                        if (currentLength + text.length > 8192 && currentChunk.length > 0) {
                            chunks.push(currentChunk);
                            currentChunk = [];
                            currentLength = 0;
                        }

                        currentChunk.push(text);
                        currentLength += text.length;
                    }
                    if (currentChunk.length > 0) {
                        chunks.push(currentChunk);
                    }

                    currentBatch.promise = Promise.all(
                        chunks.map((chunk) =>
                            this.createEmbedding(chunk)
                                .then((res) => res.data)
                                .catch((err) => {
                                    if (err instanceof Error) {
                                        return new Array(chunk.length).fill(err) as Error[];
                                    }
                                    throw err;
                                }),
                        ),
                    ).then((results) => {
                        return results.flat();
                    });
                }

                const data = await currentBatch.promise;

                return data.slice(start, end);
            };
        };

        return { add };
    }
}

const embeddedModel = new EmbeddingModel();
export { embeddedModel };
