import { HintInjectedEvent } from "../types/event.ts";
import { EVENT_HINT_MAP } from "../napcat/filter.ts";

export class ChatWindow {
    static privateWindow: Record<string, ChatWindow> = {};
    static groupWindows: Record<string, ChatWindow> = {};
    readonly type: "private" | "group";
    readonly id: string;
    fromGroup?: string;

    private constructor(type: "private" | "group", id: string, fromGroup?: string) {
        this.type = type;
        this.id = id;
        this.fromGroup = fromGroup;
    }

    static private(id: string, fromGroup?: string) {
        if (!this.privateWindow[id]) {
            this.privateWindow[id] = new ChatWindow("private", id, fromGroup);
        }
        this.privateWindow[id].fromGroup = fromGroup; // 临时 -> 加好友
        return this.privateWindow[id];
    }

    static group(id: string) {
        if (!this.groupWindows[id]) {
            this.groupWindows[id] = new ChatWindow("group", id);
        }
        return this.groupWindows[id];
    }

    static fromEvent(event: HintInjectedEvent) {
        if (
            event.hint == EVENT_HINT_MAP["notice.notify.poke.group"] ||
            event.hint == EVENT_HINT_MAP["message.group.normal"] ||
            event.hint == EVENT_HINT_MAP["notice.group_ban.ban"] ||
            event.hint == EVENT_HINT_MAP["notice.group_ban.lift_ban"] ||
            event.hint == EVENT_HINT_MAP["notice.group_increase"] ||
            event.hint == EVENT_HINT_MAP["notice.group_decrease"] ||
            event.hint == EVENT_HINT_MAP["notice.notify.title"]
        ) {
            return this.group(String(event.group_id));
        } else if (event.user_id) {
            if (event.hint == EVENT_HINT_MAP["message.private.group"]) {
                return this.private(String(event.user_id), String(event.group_id));
            }
            return this.private(String(event.user_id));
        } else {
            return null;
        }
    }
}
