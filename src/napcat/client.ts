import { NCWebsocket } from "node-napcat-ts";
import CONFIG from "../data/config/config.ts";

export const napcat = new NCWebsocket(
    {
        baseUrl: CONFIG.napcat.wsUrl,
        accessToken: CONFIG.napcat.token,
        reconnection: {
            enable: true,
            attempts: 10,
            delay: 5000,
        },
    },
    false,
);

export const loginInfo: {
    data?: {
        user_id: number;
        nickname: string;
    };
} = {};
