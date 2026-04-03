import { EVENT_NAMES } from './catalog';

export interface EventDebugRecord {
  type: string;
  timestamp_ms: number;
  payload: unknown;
}

class EventDebugBuffer {
  private readonly catalog = new Set<string>(EVENT_NAMES);
  private readonly capacity: number;
  private readonly records: EventDebugRecord[] = [];

  constructor(capacity = 200) {
    this.capacity = capacity;
  }

  push(record: EventDebugRecord) {
    if (!this.catalog.has(record.type)) return;
    this.records.push(record);
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity);
    }
  }

  list(): EventDebugRecord[] {
    return this.records.slice();
  }

  clear() {
    this.records.splice(0, this.records.length);
  }
}

export const eventDebugBuffer = new EventDebugBuffer();
