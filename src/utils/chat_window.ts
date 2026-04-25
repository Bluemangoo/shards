export class ChatWindow {
    static privateWindow: Record<string, ChatWindow> = {};
    static groupWindows: Record<string, ChatWindow> = {};
    readonly type: "private" | "group";
    readonly id: string;

    private constructor(type: "private" | "group", id: string) {
        this.type = type;
        this.id = id;
    }

    static private(id: string) {
        if (!this.privateWindow[id]) {
            this.privateWindow[id] = new ChatWindow("private", id);
        }
        return this.privateWindow[id];
    }

    static group(id: string) {
        if (!this.groupWindows[id]) {
            this.groupWindows[id] = new ChatWindow("group", id);
        }
        return this.groupWindows[id];
    }

    static fromEvent(event: { [key: string]: any }) {
        if (event.group_id) {
            return this.group(String(event.group_id));
        } else if (event.user_id) {
            return this.private(String(event.user_id));
        } else {
            return null;
        }
    }
}
