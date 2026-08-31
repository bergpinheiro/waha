/**
 * Unmask "*" in events list to exact values
 * Remove duplicates if any
 */
export class EventWildUnmask {
  constructor(
    private readonly events: string[] | any,
    private readonly all: string[] | any | null = null,
  ) {
    // in case of enum - convert to array
    this.events = Object.values(events);
    this.all = all ? Object.values(all) : this.events;
  }

  unmask(events: string[]): { events: string[]; unknown: string[] } {
    const rightEvents = [];
    const unknown = [];
    if (events.includes('*')) {
      rightEvents.push(...this.all);
    }

    for (const event of events) {
      if (event === '*') {
        continue;
      }
      if (!this.events.includes(event)) {
        unknown.push(event);
        continue;
      }
      rightEvents.push(event);
    }
    // unique values, the caller decides what to do with unknown ones
    return {
      events: [...new Set(rightEvents)],
      unknown: [...new Set(unknown)],
    };
  }
}
