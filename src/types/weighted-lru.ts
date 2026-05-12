export interface CacheItem<K, V> {
    key: K;
    value: V;
    weight: number;
    lastAccessed: number;
}

export default class WeightedLRU<K, V> {
    private cache: Map<K, CacheItem<K, V>>;
    private readonly capacity: number;

    constructor(capacity: number) {
        this.cache = new Map();
        this.capacity = capacity;
    }

    public get(key: K): CacheItem<K, V> | undefined {
        const item = this.cache.get(key);
        if (!item) return undefined;

        item.lastAccessed = Date.now();
        return item;
    }

    public put(key: K, value: V, weight: number = 1, lastAccessed: number = Date.now()): void {
        const safeWeight = weight <= 0 ? 0.0001 : weight;

        if (this.cache.has(key)) {
            const item = this.cache.get(key)!;
            item.value = value;
            item.weight = safeWeight;
            item.lastAccessed = lastAccessed;
            return;
        }

        if (this.cache.size >= this.capacity) {
            this.evict();
        }

        this.cache.set(key, {
            key,
            value,
            weight: safeWeight,
            lastAccessed: Date.now(),
        });
    }

    public has(key: K): boolean {
        return this.cache.has(key);
    }

    private putRaw(data: CacheItem<K, V>): void {
        this.cache.set(data.key, data);
    }

    public putAllRaw(data: CacheItem<K, V>[]): void {
        for (const d of data) {
            this.putRaw(d);
        }
        if (this.cache.size >= this.capacity) {
            this.evict();
        }
    }

    public remove(key: K): boolean {
        return this.cache.delete(key);
    }

    public peekAll(): CacheItem<K, V>[] {
        const nodes: CacheItem<K, V>[] = [];

        for (const item of this.cache.values()) {
            nodes.push(item);
        }

        return nodes;
    }

    private evict(): void {
        const now = Date.now();
        let maxScore = -1;
        let keyToEvict: K | null = null;

        for (const [key, item] of this.cache.entries()) {
            const score = (now - item.lastAccessed) / item.weight;
            if (score > maxScore) {
                maxScore = score;
                keyToEvict = key;
            }
        }

        if (keyToEvict !== null) {
            this.cache.delete(keyToEvict);
        }
    }

    public clear(): void {
        this.cache.clear();
    }
}
