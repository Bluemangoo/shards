import { config } from "@dotenvx/dotenvx";

export default function init() {
    config({ quiet: true, overload: true });
}

init();
