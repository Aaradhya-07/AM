/**
 * A source of timestamps.
 *
 * Injected rather than read from `Date` directly so that adapter results are
 * reproducible in tests. Production callers use `systemClock`.
 */
export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

/** A clock that returns fixed values in order, then repeats the last one. */
export function fixedClock(...values: readonly string[]): Clock {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value ?? "1970-01-01T00:00:00.000Z";
  };
}
