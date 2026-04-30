class AsyncCondition {
    private _waiters: Array<() => void> = [];

    async wait(timeoutMs?: number): Promise<void> {
        return new Promise((resolve) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            const done = () => {
                if (timer) clearTimeout(timer);
                const idx = this._waiters.indexOf(done);
                if (idx !== -1) this._waiters.splice(idx, 1);
                resolve();
            };
            if (timeoutMs !== undefined) timer = setTimeout(done, timeoutMs);
            this._waiters.push(done);
        });
    }

    notifyAll() {
        const current = this._waiters;
        this._waiters = [];
        current.forEach((w) => w());
    }
}

export class EventStack<K, T> {
    private _stacks = new Map<K | null, T[]>();
    private _lastPushTimes = new Map<K | null, number>();
    private _forceFlush = new Set<K | null>();
    private readonly _countThreshold: number;
    private readonly _timeout: number; // s
    private _condition = new AsyncCondition();

    constructor(countThreshold: number = 10, timeoutSeconds: number = 60.0) {
        this._countThreshold = countThreshold;
        this._timeout = timeoutSeconds;
    }

    private _now() {
        return performance.now() / 1000;
    }

    repush(window: K | null, events: T[]): void {
        let stack = this._stacks.get(window);
        if (!stack) {
            stack = [];
            this._stacks.set(window, stack);
        }
        stack.unshift(...events);
        this._lastPushTimes.set(window, this._now());
        this._condition.notifyAll();
    }

    push(window: K | null, event: T, immediate: boolean = false): void {
        let stack = this._stacks.get(window);
        if (!stack) {
            stack = [];
            this._stacks.set(window, stack);
        }

        stack.push(event);
        this._lastPushTimes.set(window, this._now());

        if (immediate) {
            this._forceFlush.add(window);
        }

        this._condition.notifyAll();
    }

    async consumeOne(window: K | null, timeoutMs: number): Promise<T | null> {
        const start = performance.now();
        while (true) {
            const stack = this._stacks.get(window);
            if (stack && stack.length > 0) {
                return stack.shift()!;
            }

            const elapsed = performance.now() - start;
            if (elapsed >= timeoutMs) {
                return null;
            }
            await this._condition.wait(timeoutMs - elapsed);
        }
    }

    async *subscribe(): AsyncGenerator<[K | null, T[], (success: boolean) => void], void, unknown> {
        while (true) {
            const hasData = Array.from(this._stacks.values()).some((s) => s.length > 0);
            if (!hasData) {
                await this._condition.wait();
            }

            while (true) {
                const now = this._now();
                let readyWindow: K | null = undefined as any;
                let found = false;
                let nextWait: number = this._timeout;
                let isNullCase = false;

                for (const [window, stack] of this._stacks.entries()) {
                    if (stack.length === 0) continue;

                    if (window === null) {
                        readyWindow = null;
                        found = true;
                        isNullCase = true;
                        break;
                    }

                    const elapsed = now - (this._lastPushTimes.get(window) || now);
                    const isForced = this._forceFlush.has(window);

                    if (
                        elapsed > 5 &&
                        (stack.length >= this._countThreshold ||
                            elapsed >= this._timeout ||
                            isForced)
                    ) {
                        readyWindow = window;
                        found = true;
                        break;
                    } else {
                        nextWait = Math.min(nextWait, this._timeout - elapsed);
                    }
                }

                if (found) {
                    this._forceFlush.delete(readyWindow);

                    const stack = this._stacks.get(readyWindow)!;
                    let output: [K | null, T[]];

                    if (isNullCase) {
                        const singleItem = stack.shift()!;
                        output = [null, [singleItem]];
                    } else {
                        const batch = [...stack];
                        stack.length = 0;
                        output = [readyWindow, batch];
                    }

                    const pushback = (success: boolean) => {
                        if (!success) {
                            this.repush(...output);
                        }
                    };

                    yield [output[0], output[1], pushback];
                    break;
                }

                await this._condition.wait(Math.max(0, nextWait * 1000));
            }
        }
    }
}
