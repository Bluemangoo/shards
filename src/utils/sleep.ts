export function sleep(ms: number) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (timer.unref) timer.unref();
    });
}
