import OpenAI from "openai";

export function validateModelResponse(response: OpenAI.Chat.ChatCompletion) {
    if (Array.isArray(response.choices) && response.choices.length > 0) {
        return;
    }
    throw new Error("Invalid model response", {
        cause: response,
    });
}
