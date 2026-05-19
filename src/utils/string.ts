export function removeLeading(origin: string, lead: string) {
    if (origin.startsWith(lead)) {
        return origin.slice(lead.length);
    } else {
        return origin;
    }
}

export function removeTrail(origin: string, trail: string) {
    if (origin.endsWith(trail)) {
        return origin.slice(0, origin.length - trail.length);
    } else {
        return origin;
    }
}
