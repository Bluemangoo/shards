export function stringifyDurationSeconds(seconds: number): string {
    if (seconds <= 0) return "0秒";

    const d = Math.floor(seconds / (24 * 3600));
    const h = Math.floor((seconds % (24 * 3600)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const units = [
        { v: d, label: "天" },
        { v: h, label: "小时" },
        { v: m, label: "分钟" },
        { v: s, label: "秒" },
    ];

    const first = units.findIndex((u) => u.v > 0);
    const last = Array.from(units)
        .reverse()
        .findIndex((u) => u.v > 0);
    const lastIdx = last === -1 ? -1 : units.length - 1 - last;

    if (first === -1) return "0秒";

    return units
        .slice(first, lastIdx + 1)
        .map((u) => `${u.v}${u.label}`)
        .join("");
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Operation timed out"));
    }, ms);
  });

  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => {
    clearTimeout(timeoutId);
  });
}