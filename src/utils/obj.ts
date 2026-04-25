export function requireNonNull<T>(o: T | undefined | null, e?: string): T {
    if (o == null) {
        throw new Error(e || "Object is required not to be null");
    }
    return o;
}
