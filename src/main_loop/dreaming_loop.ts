import { sleep } from "../utils/sleep.ts";
import { dreaming } from "../model/dreaming.ts";

export async function dreamingLoop() {
    // noinspection InfiniteLoopJS
    while (true) {
        await sleep(30 * 60 * 1000);
        try {
            await dreaming();
        } catch (err) {}
    }
}
