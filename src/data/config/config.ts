import { requireNonNull } from "../../utils/obj.ts";
import init from "../../init.ts";

function generateConfig() {
    init()

    return {
        napcat: {
            wsUrl: requireNonNull(process.env.NAPCAT_WS_URL),
            token: requireNonNull(process.env.NAPCAT_TOKEN),
        },
        mainModel: {
            baseUrl: requireNonNull(process.env.OPENAI_URL),
            apiKey: requireNonNull(process.env.OPENAI_KEY),
            model: requireNonNull(process.env.MODEL),
        },
        liteModel: {
            baseUrl: requireNonNull(process.env.LITE_OPENAI_URL || process.env.OPENAI_URL),
            apiKey: requireNonNull(process.env.LITE_OPENAI_KEY || process.env.OPENAI_KEY),
            model: requireNonNull(process.env.LITE_MODEL || process.env.MODEL),
        },
        embeddingModel: {
            baseUrl: requireNonNull(process.env.EMBEDDING_OPENAI_URL || process.env.OPENAI_URL),
            apiKey: requireNonNull(process.env.EMBEDDING_OPENAI_KEY || process.env.OPENAI_KEY),
            model: requireNonNull(process.env.EMBEDDING_MODEL),
        },
        imageModel: {
            baseUrl: requireNonNull(process.env.IMAGE_OPENAI_URL || process.env.OPENAI_URL),
            apiKey: requireNonNull(process.env.IMAGE_OPENAI_KEY || process.env.OPENAI_KEY),
            model: requireNonNull(process.env.IMAGE_MODEL || process.env.MODEL),
        },
        database: {
            url: requireNonNull(process.env.PG_URL),
        },
        langSearch: {
            apiKey: process.env.LANG_SEARCH_API_KEY,
        },
    };
}

export const CONFIG = generateConfig();

export function reloadConfig() {
    const newData = generateConfig();
    Object.assign(CONFIG, newData);
}

export default CONFIG;
