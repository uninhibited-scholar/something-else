import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SteeringController } from "../controller.js";
import { runSteerable } from "../harness.js";
import type { SteerableAdapter } from "../harness.js";

const snapDir = () => mkdtempSync(join(tmpdir(), "harness-"));

describe("runSteerable", () => {
  it("injects a queued instruction into the host loop between rounds", async () => {
    const ctrl = new SteeringController({ sessionKey: "h:1", snapshotDir: snapDir() });
    const seenPerRound: number[] = [];
    const adapter: SteerableAdapter<string> = {
      toUserMessage: (t) => `<<${t}>>`,
      runRound: async ({ round, messages }) => {
        seenPerRound.push(messages.length);
        if (round === 0) ctrl.enqueue("do the extra thing"); // queued during round 0
        return { done: round >= 2 };
      },
    };
    const messages = ["start"];
    await runSteerable({ controller: ctrl, messages, adapter, maxRounds: 10 });

    // Round 0 saw 1 msg; by round 1 the injected message was appended.
    expect(seenPerRound[0]).toBe(1);
    expect(messages.some((m) => m.includes("do the extra thing"))).toBe(true);
  });

  it("stops when the adapter reports done and marks the controller idle", async () => {
    const ctrl = new SteeringController({ sessionKey: "h:2", snapshotDir: snapDir() });
    let rounds = 0;
    const adapter: SteerableAdapter<string> = {
      toUserMessage: (t) => t,
      runRound: async () => {
        rounds++;
        return { done: rounds >= 3 };
      },
    };
    await runSteerable({ controller: ctrl, messages: [], adapter });
    expect(rounds).toBe(3);
    expect(ctrl.getState()).toBe("idle");
  });

  it("respects maxRounds as a safety bound", async () => {
    const ctrl = new SteeringController({ sessionKey: "h:3", snapshotDir: snapDir() });
    let rounds = 0;
    const adapter: SteerableAdapter<string> = {
      toUserMessage: (t) => t,
      runRound: async () => {
        rounds++;
        return { done: false }; // never finishes on its own
      },
    };
    await runSteerable({ controller: ctrl, messages: [], adapter, maxRounds: 4 });
    expect(rounds).toBe(4);
  });
});
