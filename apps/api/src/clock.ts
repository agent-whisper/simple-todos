/** The only source of "now" in the application. Injected everywhere so time is testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FixedClock implements Clock {
  #at: Date;

  constructor(iso: string) {
    this.#at = new Date(iso);
  }

  now(): Date {
    return new Date(this.#at);
  }

  set(iso: string): void {
    this.#at = new Date(iso);
  }
}
