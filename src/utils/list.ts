export function splitLists<T, K extends keyof T>(listA: T[], listB: T[], key: K) {
    // 1. 创建 Map，Map 的键类型由 T[K] 决定（即该属性的具体类型）
    const mapA = new Map<T[K], T>();
    const mapB = new Map<T[K], T>();

    // 填充 Map
    listA.forEach((item) => mapA.set(item[key], item));
    listB.forEach((item) => mapB.set(item[key], item));

    const onlyInA: T[] = [];
    const onlyInB: T[] = [];
    const inBoth: T[] = [];

    // 遍历 A 区分
    listA.forEach((item) => {
        const val = item[key];
        if (mapB.has(val)) {
            inBoth.push(item);
        } else {
            onlyInA.push(item);
        }
    });

    // 遍历 B 找独有的
    listB.forEach((item) => {
        const val = item[key];
        if (!mapA.has(val)) {
            onlyInB.push(item);
        }
    });

    return { onlyInA, onlyInB, inBoth };
}