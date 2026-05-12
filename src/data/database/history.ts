import CircularQueue from "../../utils/circular-queue.ts";
import { ChatWindow } from "../../utils/chat-window.ts";
import { EventStore } from "./event-store.ts";
import { HintInjectedEvent } from "../../types/event.ts";

export class ChatNode {
    constructor(public trace: string[]) {}
}

export class ConsumedEvent {
    constructor(
        public event: HintInjectedEvent,
        public chatNode: ChatNode | null,
    ) {}

    static group(ce: ConsumedEvent[]) {
        const out: { events: HintInjectedEvent[]; chatNode: ChatNode | null }[] = [];
        let currentChatNode: ChatNode | null = null;
        let currentEvents: HintInjectedEvent[] = [];
        for (const e of ce) {
            if (e.chatNode != currentChatNode) {
                if (currentEvents.length > 0 || currentChatNode != null) {
                    out.push({
                        events: currentEvents,
                        chatNode: currentChatNode,
                    });
                }
                currentChatNode = e.chatNode;
                currentEvents = [];
            }
        }
        if (currentEvents.length > 0 || currentChatNode != null) {
            out.push({
                events: currentEvents,
                chatNode: currentChatNode,
            });
        }
        return out;
    }
}

export class HistoryManager {
    capacity = 20;
    event_history: HintInjectedEvent[] = [];
    window_history: Map<ChatWindow | null, CircularQueue<ConsumedEvent>> = new Map();
    chat_history: Map<ChatWindow | null, HintInjectedEvent[]> = new Map();

    addEvent(event: HintInjectedEvent): void {
        this.event_history.push(event);
        const window = ChatWindow.fromEvent(event);

        if (!this.chat_history.has(window)) {
            this.chat_history.set(window, []);
        }
        this.chat_history.get(window)!.push(event);
    }

    addProcessedEvent(
        window: ChatWindow | null,
        events: HintInjectedEvent[],
        chat_node: ChatNode,
    ): void {
        if (!this.window_history.has(window)) {
            this.window_history.set(window, new CircularQueue<ConsumedEvent>(this.capacity));
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

    addPretendProcessedEvent(window: ChatWindow | null, events: HintInjectedEvent[]): void {
        if (!this.window_history.has(window)) {
            this.window_history.set(window, new CircularQueue<ConsumedEvent>(this.capacity));
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
            const loaded_events = await EventStore.get_window_events(
                window,
                undefined,
                this.capacity,
            );
            l = new CircularQueue<ConsumedEvent>(this.capacity);
            this.window_history.set(window, l);
            for (const event of loaded_events) {
                l.push(new ConsumedEvent(event, null));
            }
        }
        return l.frozen();
    }
}

export const history = new HistoryManager();
