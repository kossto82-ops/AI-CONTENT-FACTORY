import type { EventType } from '../domain/types.js';

export interface DomainEvent {
  type: EventType;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  at: string;
}

type Handler = (evt: DomainEvent) => void | Promise<void>;

/** Minimal in-process event bus (Section 16: MVP). Swap for a broker later. */
class EventBus {
  private handlers = new Map<string, Handler[]>();
  private history: DomainEvent[] = [];

  on(type: EventType | '*', fn: Handler): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
    return () => {
      const cur = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        cur.filter((h) => h !== fn),
      );
    };
  }

  emit(evt: DomainEvent): void {
    this.history.push(evt);
    if (this.history.length > 2000) this.history.shift();
    const target = this.handlers.get(evt.type) ?? [];
    const wild = this.handlers.get('*') ?? [];
    for (const fn of [...target, ...wild]) {
      try {
        const r = fn(evt);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((e) => this.onHandlerError(evt, e));
        }
      } catch (e) {
        this.onHandlerError(evt, e);
      }
    }
  }

  recent(limit = 100): DomainEvent[] {
    return this.history.slice(-limit);
  }

  private onHandlerError(evt: DomainEvent, err: unknown): void {
    // eslint-disable-next-line no-console
    console.error(`[events] handler error for ${evt.type}:`, err);
  }
}

export const eventBus = new EventBus();
