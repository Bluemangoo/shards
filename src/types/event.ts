import { EVENT_HINT_MAP } from "../napcat/filter.ts";
import { AllHandlers } from "node-napcat-ts/dist/Interfaces";
import { WithInjectTags } from "../napcat/pre-stringify-event.ts";

export type NapcatEvent = {
    [K in keyof typeof EVENT_HINT_MAP]: AllHandlers[K] &
        (K extends keyof ExtraFieldsMap ? ExtraFieldsMap[K] : unknown);
}[keyof typeof EVENT_HINT_MAP];
type ExtraFieldsMap = {
    "notice.notify.poke.group": { sender_id: number };
    "message.private.group": { group_id: number };
};
export type HintInjectedEvent = {
    [K in keyof typeof EVENT_HINT_MAP]: AllHandlers[K] & {
        hint: (typeof EVENT_HINT_MAP)[K];
    } & (K extends keyof ExtraFieldsMap ? ExtraFieldsMap[K] : unknown) &
        WithInjectTags;
}[keyof typeof EVENT_HINT_MAP];
export type HintInjectedMessageEvent = Extract<
    HintInjectedEvent,
    {
        post_type: "message";
    }
>;
export type HintInjectedEventOf<T extends keyof typeof EVENT_HINT_MAP> = Extract<
    HintInjectedEvent,
    {
        hint: (typeof EVENT_HINT_MAP)[T];
    }
>;
