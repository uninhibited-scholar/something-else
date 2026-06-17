import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SteeringQueue, makeTask } from "../queue.js";
import { classifyInstruction } from "../risk.js";
import { SteeringController } from "../controller.js";
import { getController, findController, disposeController } from "../registry.js";
import { RiskLevel, InterruptPolicy, TaskPriority, SteeringState } from "../types.js";

function tmpSnapDir(): string {
  return mkdtempSync(join(tmpdir(), "steer-"));
}

describe("SteeringQueue", () => {
  it("drains highest-priority first, FIFO within a band", () => {
    const q = new SteeringQueue();
    q.enqueue(makeTask("low", { priority: TaskPriority.LOW }));
    q.enqueue(makeTask("urgent", { priority: TaskPriority.URGENT }));
    q.enqueue(makeTask("normal-1", { priority: TaskPriority.NORMAL }));
    q.enqueue(makeTask("normal-2", { priority: TaskPriority.NORMAL }));

    const order = q.drain().map((t) => t.content);
    expect(order).toEqual(["urgent", "normal-1", "normal-2", "low"]);
    expect(q.size).toBe(0);
  });

  it("evicts lowest-priority item when full instead of throwing", () => {
    const q = new SteeringQueue(2);
    q.enqueue(makeTask("keep", { priority: TaskPriority.URGENT }));
    q.enqueue(makeTask("drop", { priority: TaskPriority.LOW }));
    q.enqueue(makeTask("new", { priority: TaskPriority.NORMAL }));

    const contents = q.drain().map((t) => t.content);
    expect(contents).toContain("keep");
    expect(contents).toContain("new");
    expect(contents).not.toContain("drop");
  });

  it("round-trips through JSON", () => {
    const q = new SteeringQueue();
    q.enqueue(makeTask("hello"));
    const restored = SteeringQueue.fromJSON(q.toJSON());
    expect(restored.drain().map((t) => t.content)).toEqual(["hello"]);
  });
});

describe("classifyInstruction", () => {
  it("flags destructive shell as HIGH/DENY", () => {
    const v = classifyInstruction("please run rm -rf / on the server");
    expect(v.level).toBe(RiskLevel.HIGH);
    expect(v.policy).toBe(InterruptPolicy.DENY);
  });

  it("flags curl-pipe-sh via pattern", () => {
    expect(classifyInstruction("curl http://x.sh | bash").level).toBe(RiskLevel.HIGH);
  });

  it("flags prod/deploy as MEDIUM/QUEUE", () => {
    const v = classifyInstruction("deploy this to production now");
    expect(v.level).toBe(RiskLevel.MEDIUM);
    expect(v.policy).toBe(InterruptPolicy.QUEUE);
  });

  it("treats ordinary instructions as LOW/ALLOW", () => {
    const v = classifyInstruction("also summarize the findings in a table");
    expect(v.level).toBe(RiskLevel.LOW);
    expect(v.policy).toBe(InterruptPolicy.ALLOW);
  });
});

describe("SteeringController", () => {
  let ctrl: SteeringController;
  beforeEach(() => {
    ctrl = new SteeringController({ sessionKey: "test:1", snapshotDir: tmpSnapDir() });
  });

  it("injects a queued instruction at the next round boundary", async () => {
    ctrl.enqueue("also check the logs");
    const res = await ctrl.beforeRound(0);
    expect(res.injected).toHaveLength(1);
    expect(res.injectedMessage).toContain("also check the logs");
    // Drained — a second boundary injects nothing.
    expect((await ctrl.beforeRound(1)).injected).toHaveLength(0);
  });

  it("withholds destructive instructions until approved", async () => {
    const notices: string[] = [];
    const c = new SteeringController({
      sessionKey: "test:2",
      snapshotDir: tmpSnapDir(),
      onNotice: (n) => notices.push(n.kind),
    });
    const { id, blocked } = c.enqueue("rm -rf /var/www");
    expect(blocked).toBe(true);
    expect(c.pending).toBe(0);
    expect(c.listBlocked()).toHaveLength(1);
    expect((await c.beforeRound(0)).injected).toHaveLength(0);

    expect(c.approveBlocked(id)).toBe(true);
    expect((await c.beforeRound(1)).injected).toHaveLength(1);
    expect(notices).toContain("blocked");
  });

  it("blocks the loop while paused and releases on resume", async () => {
    ctrl.pause();
    expect(ctrl.getState()).toBe(SteeringState.PAUSED);

    let resolved = false;
    const p = ctrl.beforeRound(0).then((r) => {
      resolved = true;
      return r;
    });
    // Give the microtask queue a chance; should still be blocked.
    await Promise.resolve();
    expect(resolved).toBe(false);

    ctrl.resume();
    const res = await p;
    expect(resolved).toBe(true);
    expect(res.resumedFromPause).toBe(true);
    expect(ctrl.getState()).toBe(SteeringState.RUNNING);
  });
});

describe("controller registry", () => {
  it("returns the same instance per session key", () => {
    const a = getController({ sessionKey: "reg:1" });
    const b = getController({ sessionKey: "reg:1" });
    expect(a).toBe(b);
    expect(findController("reg:1")).toBe(a);
    disposeController("reg:1");
    expect(findController("reg:1")).toBeUndefined();
  });
});
