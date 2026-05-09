import { readPrompt, readPrompts } from "../../utils/file.ts";

function generatePrompts() {
    return {
        dev: readPrompt("dev"),
        dreaming: readPrompt("dreaming"),
        hint: readPrompt("hint"),
        image: readPrompt("image"),
        memoryAdd: readPrompt("memory.add"),
        memoryFullSearch: readPrompt("memory.full.search"),
        memorySearch: readPrompt("memory.search"),
        sys: readPrompt("sys"),
        workingMemory: readPrompt("working.memory"),
        vibe: readPrompts("vibe"),
    };
}

export const PROMPTS = generatePrompts();

export function reloadPrompt() {
    const newData = generatePrompts();
    Object.assign(PROMPTS, newData);
}

export default PROMPTS;
