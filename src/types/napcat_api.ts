import { NCWebsocket } from "node-napcat-ts";

export type NapcatResult = {
    [K in keyof NCWebsocket]: NCWebsocket[K] extends (...args: any[]) => any
        ? Awaited<ReturnType<NCWebsocket[K]>>
        : never;
};
