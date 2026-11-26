import { describe, expect, it, vi } from "vitest";
import { abortable, SingleFlight } from "./single-flight";

describe("SingleFlight", () => {
  it("aborts the caller that held the slot", () => {
    const flight = new SingleFlight();
    const first = flight.start("user-1");
    expect(first.signal.aborted).toBe(false);
    const second = flight.start("user-1");
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second).not.toBe(first);
  });

  it("keeps keys apart", () => {
    const flight = new SingleFlight();
    const a = flight.start("user-1");
    const b = flight.start("user-2");
    expect(a.signal.aborted).toBe(false);
    expect(b.signal.aborted).toBe(false);
  });

  it("does not drop the slot of a newer caller", () => {
    const flight = new SingleFlight();
    const first = flight.start("user-1");
    const second = flight.start("user-1");
    flight.finish("user-1", first);
    const third = flight.start("user-1");
    expect(second.signal.aborted).toBe(true);
    expect(third.signal.aborted).toBe(false);
  });
});

describe("abortable", () => {
  it("rejects when the signal aborts before the work settles", async () => {
    const controller = new AbortController();
    const work = new Promise<string>(() => undefined);
    const settled = abortable(work, controller.signal);
    controller.abort();
    await expect(settled).rejects.toThrow("aborted");
  });

  it("passes the answer through", async () => {
    const controller = new AbortController();
    await expect(abortable(Promise.resolve("ok"), controller.signal)).resolves.toBe("ok");
  });

  it("passes a failure through", async () => {
    const controller = new AbortController();
    await expect(abortable(Promise.reject(new Error("boom")), controller.signal)).rejects.toThrow("boom");
  });

  it("rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const work = vi.fn(() => new Promise<string>(() => undefined));
    await expect(abortable(work(), controller.signal)).rejects.toThrow("aborted");
  });
});
