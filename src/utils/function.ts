export async function retry<T>(
    fn: () => Promise<T>,
    whitelist: (abstract new (...args: any) => any)[],
    retries: number,
): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            let flag = false;
            for (const errType of whitelist) {
                if (e instanceof errType) {
                    flag = true;
                }
            }
            if (!flag) {
                throw e;
            }
            lastError = e;
        }
    }
    throw lastError;
}
