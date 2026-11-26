/**
 * One running call per key. When a second call starts for the same key the
 * first caller is gone (a reload sent it), so the first call is aborted and
 * replaced. The lock lives in the web process: one process serves the app.
 */
export class SingleFlight {
  private readonly running = new Map<string, AbortController>();

  /** Take the slot for `key` and abort the caller that held it. */
  start(key: string): AbortController {
    this.running.get(key)?.abort();
    const controller = new AbortController();
    this.running.set(key, controller);
    return controller;
  }

  /** Release the slot, but only while this caller still owns it. */
  finish(key: string, controller: AbortController): void {
    if (this.running.get(key) === controller) this.running.delete(key);
  }
}

const ABORTED = "aborted";

/**
 * Settle with `work`, or reject as soon as `signal` aborts. The work itself
 * keeps running when the provider cannot take a signal; the caller returns
 * early and the answer is dropped.
 */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(ABORTED));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(ABORTED));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
