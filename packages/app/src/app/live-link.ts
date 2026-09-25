import { Injectable, inject, signal } from '@angular/core';
import { transitionEvents } from '@nuxmv-editor/language';
import { DiagramStore } from './diagram-store';

export interface LiveUpdate {
    diagram?: string;
    state: string;
    step?: number;
    event?: string | null;
    values?: Record<string, unknown>;
    allowed?: string[];
    violations?: string[];
    /** Set when the machine rejected an event (the state did not change). */
    rejected?: { event: string; reason: string };
    receivedAt?: number;
}

/**
 * Follows a running Python state machine (generated code with EditorLink)
 * through the server's live channel, and shows its state on the diagram.
 */
@Injectable({ providedIn: 'root' })
export class LiveLink {
    private readonly store = inject(DiagramStore);
    readonly channel = signal('notebook');
    readonly connected = signal(false);
    readonly updates = signal<LiveUpdate[]>([]);
    readonly warning = signal<string | null>(null);
    private source?: EventSource;

    connect(channel: string): void {
        this.disconnect();
        if (!/^[\w-]{1,64}$/.test(channel)) {
            this.warning.set('Channel names are 1-64 letters, digits, _ or -.');
            return;
        }
        this.channel.set(channel);
        this.updates.set([]);
        this.warning.set(null);
        this.store.startLive();
        const source = new EventSource(`api/live/${channel}/stream`);
        this.source = source;
        source.onopen = () => this.connected.set(true);
        source.onerror = () => this.connected.set(false);
        source.onmessage = message => this.receive(JSON.parse(message.data) as LiveUpdate);
    }

    disconnect(): void {
        this.source?.close();
        this.source = undefined;
        this.connected.set(false);
        if (this.store.live()) this.store.stopHighlight();
    }

    readonly commandStatus = signal<string | null>(null);

    /** Sends an event to the running machine (two-way link). */
    async send(event: string): Promise<void> {
        try {
            const res = await fetch(`api/live/${this.channel()}/command`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ event })
            });
            const body = (await res.json()) as { listeners?: number; error?: string };
            if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
            this.commandStatus.set(body.listeners ? `Sent ${event}.` : `Sent ${event}, but no machine is listening: link it with link_editor(..., commands=True).`);
        } catch (error) {
            this.commandStatus.set(`Could not send ${event}: ${(error as Error).message}`);
        }
    }

    /** Event leading from the current live state to `state`, if the machine reported one. */
    eventTo(state: string): string | undefined {
        const last = this.updates()[this.updates().length - 1];
        if (!last?.allowed) return undefined;
        const events = transitionEvents(this.store.model());
        const index = this.store.model().transitions.findIndex((t, i) => t.source === last.state && t.target === state && last.allowed!.includes(events[i] ?? ''));
        return index >= 0 ? events[index] : undefined;
    }

    private receive(update: LiveUpdate): void {
        const known = this.store.model().states.some(s => s.name === update.state);
        const name = this.store.model().name;
        this.warning.set(
            !known
                ? `The running machine is in '${update.state}', which is not a state of this diagram${update.diagram ? ` (it runs '${update.diagram}')` : ''}.`
                : update.diagram && name && update.diagram !== name
                  ? `The running machine is '${update.diagram}', this diagram is '${name}'.`
                  : null
        );
        // A step counter going back means the Python side started a new run.
        const last = this.updates()[this.updates().length - 1];
        const restarted = last !== undefined && (update.step ?? 0) < (last.step ?? 0);
        this.updates.set([...(restarted ? [] : this.updates()), update].slice(-500));
        if (known && !update.rejected) this.store.pushLive(update.state, restarted);
    }
}
