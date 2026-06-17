// SteeringController — the per-session brain that the agent loop consults
// between tool rounds.
//
// Responsibilities:
//   • hold a priority queue of pending instructions
//   • gate the loop when a human pauses, and release it on resume
//   • classify each instruction and withhold destructive ones for approval
//   • fuse approved instructions into a single message to inject next round
//
// It is intentionally decoupled from the LLM provider: `beforeRound()` returns
// plain text to inject, so this whole module could be lifted into another agent
// framework unchanged.

import { join } from "node:path";
import { SteeringQueue, makeTask } from "./queue.js";
import type { EnqueueOptions } from "./queue.js";
import { classifyInstruction } from "./risk.js";
import { SnapshotStore } from "./snapshot.js";
import { InterruptPolicy, SteeringState, TaskType } from "./types.js";
import type { RiskVerdict, SteeringTask } from "./types.js";

export type SteeringNotice = {
  kind: "queued" | "blocked" | "injected" | "paused" | "resumed";
  message: string;
};

export type SteeringControllerOptions = {
  sessionKey: string;
  maxQueueSize?: number;
  snapshotDir?: string;
  /** Surface human-facing notices (e.g. stream them into the channel). */
  onNotice?: (notice: SteeringNotice) => void;
};

export type EnqueueResult = {
  id: string;
  verdict: RiskVerdict;
  /** True when the instruction was withheld pending human approval. */
  blocked: boolean;
};

export type BeforeRoundResult = {
  /** Loop was paused and has now resumed. */
  resumedFromPause: boolean;
  /** Text to append as a user message, or undefined if nothing to inject. */
  injectedMessage?: string;
  injected: SteeringTask[];
};

export class SteeringController {
  private readonly queue: SteeringQueue;
  private readonly snapshots: SnapshotStore;
  private readonly onNotice: ((n: SteeringNotice) => void) | undefined;
  readonly sessionKey: string;

  private state: SteeringState = SteeringState.IDLE;
  private round = 0;

  // Instructions held back as too risky to auto-inject, keyed by task id.
  private readonly blocked = new Map<string, SteeringTask>();

  // Pause gate: while paused, `pausePromise` is unresolved and the loop awaits it.
  private pausePromise: Promise<void> | undefined;
  private pauseResolve: (() => void) | undefined;

  constructor(opts: SteeringControllerOptions) {
    this.sessionKey = opts.sessionKey;
    this.queue = new SteeringQueue(opts.maxQueueSize ?? 100);
    this.snapshots = new SnapshotStore(opts.snapshotDir ?? join(process.cwd(), ".snapshots"));
    this.onNotice = opts.onNotice;
  }

  getState(): SteeringState {
    return this.state;
  }

  markRunning(round: number): void {
    this.state = this.state === SteeringState.PAUSED ? this.state : SteeringState.RUNNING;
    this.round = round;
  }

  markIdle(): void {
    this.state = SteeringState.IDLE;
  }

  /** Add a new instruction. Destructive ones are withheld for approval. */
  enqueue(content: string, opts: EnqueueOptions = {}): EnqueueResult {
    const verdict = classifyInstruction(content);
    const task = makeTask(content, { ...opts, metadata: { ...opts.metadata, verdict } });

    if (verdict.policy === InterruptPolicy.DENY) {
      this.blocked.set(task.id, task);
      this.notice({
        kind: "blocked",
        message: `Instruction withheld (${verdict.level}): ${verdict.reason}. Approve with task id ${task.id} to inject it.`,
      });
      return { id: task.id, verdict, blocked: true };
    }

    this.queue.enqueue(task);
    this.notice({
      kind: "queued",
      message:
        verdict.policy === InterruptPolicy.QUEUE
          ? `Queued sensitive instruction (${verdict.level}); will apply at next round boundary.`
          : `Queued instruction; will apply at next round boundary.`,
    });
    return { id: task.id, verdict, blocked: false };
  }

  /** Promote a previously blocked instruction into the live queue. */
  approveBlocked(taskId: string): boolean {
    const task = this.blocked.get(taskId);
    if (!task) return false;
    this.blocked.delete(taskId);
    this.queue.enqueue(task);
    this.notice({ kind: "queued", message: `Approved instruction ${taskId}; will apply next round.` });
    return true;
  }

  listBlocked(): SteeringTask[] {
    return [...this.blocked.values()];
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Request a pause. Takes effect at the next round boundary. */
  pause(note = "paused by user"): void {
    if (this.state === SteeringState.PAUSED) return;
    this.state = SteeringState.PAUSED;
    this.pausePromise = new Promise((resolve) => {
      this.pauseResolve = resolve;
    });
    const snap = this.snapshots.save({
      snapshotId: `snap_${this.sessionKey.replace(/[^\w.-]/g, "_")}_${Date.now()}`,
      sessionKey: this.sessionKey,
      timestamp: Date.now(),
      state: this.state,
      round: this.round,
      note,
      pendingTasks: this.queue.toJSON(),
    });
    this.notice({ kind: "paused", message: `Paused at round ${this.round}. Snapshot: ${snap}` });
  }

  /** Release a pause. */
  resume(): void {
    if (this.state !== SteeringState.PAUSED) return;
    this.state = SteeringState.RUNNING;
    this.pauseResolve?.();
    this.pausePromise = undefined;
    this.pauseResolve = undefined;
    this.notice({ kind: "resumed", message: "Resumed." });
  }

  /**
   * Called by the agent loop at the start of each round. Awaits any pause, then
   * drains the queue and returns text to inject as a fresh user message.
   */
  async beforeRound(round: number): Promise<BeforeRoundResult> {
    this.round = round;
    let resumedFromPause = false;

    while (this.state === SteeringState.PAUSED && this.pausePromise) {
      resumedFromPause = true;
      await this.pausePromise;
    }

    const injected = this.queue.drain();
    if (injected.length === 0) {
      return { resumedFromPause, injected: [] };
    }

    this.notice({
      kind: "injected",
      message: `Injecting ${injected.length} steering instruction(s) into the plan.`,
    });
    return { resumedFromPause, injected, injectedMessage: fuseInstructions(injected) };
  }

  private notice(n: SteeringNotice): void {
    this.onNotice?.(n);
  }
}

/** Merge drained tasks into one user-style instruction block (context fusion). */
export function fuseInstructions(tasks: SteeringTask[]): string {
  const lines = tasks.map((t) => {
    const label =
      t.type === TaskType.MODIFY ? "Updated constraint" : t.type === TaskType.INJECT ? "Additional context" : "New instruction";
    return `- ${label}: ${t.content}`;
  });
  return [
    "[Runtime steering] The user added the following while you were working.",
    "Fold these into your current plan without restarting completed work:",
    ...lines,
  ].join("\n");
}
