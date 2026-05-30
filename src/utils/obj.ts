export function requireNonNull<T>(o: T | undefined | null, e?: string): T {
    if (o == null) {
        throw new Error(e || "Object is required not to be null");
    }
    return o;
}

export function stringToBoolean(s?: string, defaultValue = false) {
    if (s == null) return defaultValue;
    return ["y", "yes", "true", "t", "1"].includes(s.toLowerCase());
}

export function deepContains(sup: any, sub: any): boolean {
    if (sup === sub) return true;
    if (sub === undefined) return true; // undefined is considered contained in any object

    if (typeof sub !== "object" || sub === null || typeof sup !== "object" || sup === null) {
        return false;
    }

    if (Array.isArray(sub)) {
        if (!Array.isArray(sup) || sub.length !== sup.length) return false;
        return sub.every((item, index) => deepContains(sup[index], item));
    }

    return Object.keys(sub).every((key) => {
        if (!Object.prototype.hasOwnProperty.call(sup, key)) {
            return false;
        }
        return deepContains(sup[key], sub[key]);
    });
}
