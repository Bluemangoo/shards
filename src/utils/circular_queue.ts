export default class CircularQueue<T> {
    private readonly buffer: (T | undefined)[];
    private head: number = 0;
    private tail: number = 0;
    private size: number = 0;
    private readonly capacity: number;

    constructor(capacity: number) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
    }

    is_empty(): boolean {
        return this.size === 0;
    }

    is_full(): boolean {
        return this.size === this.capacity;
    }

    push(item: T) {
        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.capacity;
        if (!this.is_full()) {
            this.size++;
        }
    }

    pop(): T | undefined {
        if (this.is_empty()) {
            return undefined;
        }
        const item = this.buffer[this.head];
        this.buffer[this.head] = undefined; // 清空引用帮助 GC
        this.head = (this.head + 1) % this.capacity;
        this.size--;
        return item;
    }

    peek_front(): T | undefined {
        if (this.is_empty()) return undefined;
        return this.buffer[this.head];
    }

    peek_end(): T | undefined {
        if (this.is_empty()) return undefined;
        // tail 指向的是下一个插入位置，所以要减 1
        const lastIndex = (this.tail - 1 + this.capacity) % this.capacity;
        return this.buffer[lastIndex];
    }

    frozen(): T[] {
        const result: T[] = [];
        for (let i = 0; i < this.size; i++) {
            const index = (this.head + i) % this.capacity;
            result.push(this.buffer[index] as T);
        }
        return result;
    }
}
