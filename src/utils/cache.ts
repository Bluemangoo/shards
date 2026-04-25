function lru<T>(fn: (...args: any[]) => Promise<T>, ttlMs: number = 600000) {
    const cache = new Map<string, { value: T; expires: number }>();
    return async (...args: any[]): Promise<T> => {
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
}
