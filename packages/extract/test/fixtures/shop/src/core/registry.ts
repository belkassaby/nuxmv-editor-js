import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class Session {
    user = '';
}

export type Listener = (event: string) => void;

export class EventBus {
    private listeners: Listener[] = [];

    on(listener: Listener): void {
        this.listeners.push(listener);
    }

    emit(event: string): void {
        for (const listener of this.listeners) listener(event);
    }
}

export class QueryBuilder {
    private parts: string[] = [];

    select(columns: string): this {
        this.parts.push(`SELECT ${columns}`);
        return this;
    }

    from(table: string): this {
        this.parts.push(`FROM ${table}`);
        return this;
    }

    where(condition: string): this {
        this.parts.push(`WHERE ${condition}`);
        return this;
    }

    build(): string {
        return this.parts.join(' ');
    }
}
