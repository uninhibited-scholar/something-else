import { describe, it, expect, afterEach } from "vitest";
import { handleSteeringCommand } from "../commands.js";
import { findController, disposeController } from "../registry.js";
import { SteeringState } from "../types.js";

const SESSION = "cmd:test";
afterEach(() => disposeController(SESSION));

describe("handleSteeringCommand", () => {
  it("ignores non-command messages", () => {
    expect(handleSteeringCommand(SESSION, "just a normal prompt").handled).toBe(false);
    expect(findController(SESSION)).toBeUndefined();
  });

  it("ignores unknown slash words (could be a real prompt)", () => {
    expect(handleSteeringCommand(SESSION, "/explain this code").handled).toBe(false);
  });

  it("queues an append instruction", async () => {
    const res = handleSteeringCommand(SESSION, "/steer also check the logs");
    expect(res.handled).toBe(true);
    expect(res.reply).toContain("Queued");
    const c = findController(SESSION)!;
    expect(c.pending).toBe(1);
    const drained = await c.beforeRound(0);
    expect(drained.injectedMessage).toContain("also check the logs");
  });

  it("withholds a destructive instruction and approves by id", () => {
    const res = handleSteeringCommand(SESSION, "/steer rm -rf /tmp/build");
    expect(res.handled).toBe(true);
    expect(res.reply).toContain("Withheld");
    const c = findController(SESSION)!;
    expect(c.pending).toBe(0);
    expect(c.listBlocked()).toHaveLength(1);

    const id = c.listBlocked()[0]!.id;
    const approve = handleSteeringCommand(SESSION, `/approve ${id}`);
    expect(approve.reply).toContain("Approved");
    expect(c.pending).toBe(1);
  });

  it("pause/resume drive controller state", () => {
    // Create the controller first (pause needs an existing one).
    handleSteeringCommand(SESSION, "/steer do a thing");
    expect(handleSteeringCommand(SESSION, "/pause").reply).toContain("Paused");
    expect(findController(SESSION)!.getState()).toBe(SteeringState.PAUSED);
    expect(handleSteeringCommand(SESSION, "/resume").reply).toContain("Resumed");
    expect(findController(SESSION)!.getState()).toBe(SteeringState.RUNNING);
  });

  it("reports a helpful status", () => {
    handleSteeringCommand(SESSION, "/steer task one");
    const res = handleSteeringCommand(SESSION, "/steer-status");
    expect(res.reply).toContain("Pending in queue: 1");
    expect(res.reply).toContain("Steering commands:");
  });

  it("rejects empty append text", () => {
    expect(handleSteeringCommand(SESSION, "/steer").reply).toContain("Nothing to add");
  });
});
