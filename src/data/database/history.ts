import CircularQueue from "../../utils/circular_queue.ts";
import { ChatWindow } from "../../utils/chat_window.ts";
import { EventStore } from "./eventStore.ts";

export class ChatNode {
    constructor(public trace: string[]) {}
}

export class ConsumedEvent {
    constructor(
        public event: any,
        public chat_node: ChatNode | null,
    ) {}
}

export class HistoryManager {
    public event_history: any[] = [];
    public window_history: Map<ChatWindow | null, CircularQueue<ConsumedEvent>> = new Map();
    public chat_history: Map<ChatWindow | null, any[]> = new Map();

    addEvent(event: any): void {
        this.event_history.push(event);
        const window = ChatWindow.fromEvent(event);

        if (!this.chat_history.has(window)) {
            this.chat_history.set(window, []);
        }
        this.chat_history.get(window)!.push(event);
    }

    addProcessedEvent(window: ChatWindow | null, events: any[], chat_node: ChatNode): void {
        if (!this.window_history.has(window)) {
            this.window_history.set(window, new CircularQueue<ConsumedEvent>(10));
        }
        if (!this.chat_history.has(window)) {
            this.chat_history.set(window, []);
        }

        const wHistory = this.window_history.get(window)!;
        const cHistory = this.chat_history.get(window)!;

        for (const event of events) {
            wHistory.push(new ConsumedEvent(event, chat_node));
            cHistory.push(event);
        }
    }

    addPretendProcessedEvent(window: ChatWindow | null, events: any[]): void {
        if (!this.window_history.has(window)) {
            this.window_history.set(window, new CircularQueue<ConsumedEvent>(10));
        }
        if (!this.chat_history.has(window)) {
            this.chat_history.set(window, []);
        }

        const wHistory = this.window_history.get(window)!;
        const cHistory = this.chat_history.get(window)!;

        for (const event of events) {
            wHistory.push(new ConsumedEvent(event, null));
            cHistory.push(event);
        }
    }

    async getWindowHistory(window: ChatWindow | null): Promise<ConsumedEvent[]> {
        let l = this.window_history.get(window);

        if (!l) {
            const loaded_events = await EventStore.get_window_events(window, undefined, 10);
            l = new CircularQueue<ConsumedEvent>(10);
            this.window_history.set(window, l);
            for (const event of loaded_events) {
                l.push(new ConsumedEvent(event, null));
            }
        }
        return l.frozen();
    }
}

export const history = new HistoryManager();
