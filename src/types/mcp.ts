import { ModelContext } from "../utils/context.ts";

export interface ToolArguments {
    /**
     * @internal
     */
    context: ModelContext;
}

export function toolHelper<T extends ToolArguments, R>(
    fn: (p: T) => R,
    title?: string,
    description?: string,
) {
    return {
        fn,
        title,
        description,
    };
}
