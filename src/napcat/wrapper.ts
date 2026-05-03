import { napcat } from "./client.ts";

function memoize<T, P extends (...args: any[]) => Promise<T>>(fn: P, ttlMs: number = 600000): P {
    const cache = new Map<string, { value: T; expires: number }>();
    const f = async (...args: any[]): Promise<T> => {
        const key = JSON.stringify(args);
        const now = Date.now();
        const cached = cache.get(key);
        if (cached && cached.expires > now) {
            return cached.value;
        }
        const result = await fn(...args);
        cache.set(key, { value: result, expires: now + ttlMs });
        return result;
    };
    return f as P;
}

export const cached_get_group_info = memoize(async (group_id: string | number) => {
    return await napcat.get_group_info({ group_id: Number(group_id) });
});

export const cached_get_group_member_info = memoize(
    async (user_id: string | number, group_id: string | number) => {
        return await napcat.get_group_member_info({
            user_id: String(user_id),
            group_id: String(group_id),
        } as any);
    },
);

export const cached_get_friend_list = memoize(async () => {
    return await napcat.get_friend_list();
});

export const cached_get_friend_info = memoize(async (user_id: string | number) => {
    const friends = await cached_get_friend_list();
    const intUserId = Number(user_id);
    return friends.find((f) => f.user_id === intUserId) || null;
});

export const cached_get_stranger_info = memoize(async (user_id: string | number) => {
    return await napcat.get_stranger_info({ user_id: Number(user_id) });
});

export const cached_get_friend_display_name = memoize(
    async (user_id: string | number): Promise<string | null> => {
        const info = await cached_get_friend_info(user_id);
        if (info) {
            return info.remark || info.nickname || null;
        }
        return null;
    },
);

export const cached_get_stranger_display_name = memoize(
    async (user_id: string | number): Promise<string | null> => {
        const info = await cached_get_stranger_info(user_id);
        if (info) {
            return info.remark || info.nickname || null;
        }
        return null;
    },
);

export const cached_get_group_member_display_name = memoize(
    async (user_id: string | number, group_id: string | number): Promise<string> => {
        const member_info = await cached_get_group_member_info(user_id, group_id);
        let nickname: string | undefined;
        let remark: string | undefined;

        if (member_info) {
            if (member_info.card) return member_info.card;
            nickname = member_info.nickname;
        }

        const stranger_info = await cached_get_stranger_info(user_id);
        remark = stranger_info.remark;
        if (!nickname) nickname = stranger_info.nickname;

        return remark || nickname || String(user_id);
    },
);

export const cached_get_forward_message = memoize(async (message_id: string | number) => {
    return await napcat.get_forward_msg({
        message_id: String(message_id),
    });
});

export const cached_get_login_info = memoize(async () => {
    return await napcat.get_login_info();
});
