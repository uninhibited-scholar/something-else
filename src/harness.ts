// Framework-agnostic steering harness.
//
// This is the adapter layer that makes SomethingElse usable from *any* agent
// loop, not just one codebase. A host implements `SteerableAdapter<M>` for its
// own message type `M`, and `runSteerable` owns the steering boundary between
// rounds: it awaits any pause, drains the queue, and injects the fused
// instruction as a host message — then hands control back to the host to run one
// round.
//
//   host loop  ──runRound──▶  model + tools
//        ▲                         │
//        └──── runSteerable ◀──────┘   (drains queue, awaits pause here)

import { SteeringController } from "./controller.js";

export type SteerableAdapter<M> = {
  /** Convert injected steering text into one host message. */
  toUserMessage: (text: string) => M;
  /**
   * Run a single round of the host agent loop against the current messages.
   * Return `{ done: true }` when the agent has finished (no more tool calls).
   * Mutating `messages` in place is fine; the harness reuses the same array.
   */
  runRound: (ctx: { round: number; messages: M[] }) => Promise<{ done: boolean }>;
};

export type RunSteerableOptions<M> = {
  controller: SteeringController;
  /** The conversation so far; injected steering messages are appended here. */
  messages: M[];
  adapter: SteerableAdapter<M>;
  /** Safety bound on rounds (mirrors a typical tool-call cap). */
  maxRounds?: number;
};

/**
 * Drive a host agent loop with runtime steering. The host stays in control of
 * the model/provider/tooling; this only owns the between-round boundary.
 */
export async function runSteerable<M>(opts: RunSteerableOptions<M>): Promise<void> {
  const { controller, messages, adapter, maxRounds = 50 } = opts;

  controller.markRunning(0);
  try {
    for (let round = 0; round < maxRounds; round++) {
      // Steering boundary: await pause, then fold in any queued instructions.
      const steer = await controller.beforeRound(round);
      if (steer.injectedMessage) {
        messages.push(adapter.toUserMessage(steer.injectedMessage));
      }

      const { done } = await adapter.runRound({ round, messages });
      if (done) break;
    }
  } finally {
    controller.markIdle();
  }
}
