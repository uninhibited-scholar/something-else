// Runtime steering — public surface.
//
// Lets a human change what an agent is doing *while it runs*: append an
// instruction, pause for review, or have a destructive instruction withheld for
// approval — without restarting the task. Wired into the agent loop between tool
// rounds, the safe boundary where no tool is mid-execution.

export { SteeringController, fuseInstructions } from "./controller.js";
export type {
  SteeringControllerOptions,
  SteeringNotice,
  EnqueueResult,
  BeforeRoundResult,
} from "./controller.js";
export { getController, findController, disposeController } from "./registry.js";
export { runSteerable } from "./harness.js";
export type { SteerableAdapter, RunSteerableOptions } from "./harness.js";
export { handleSteeringCommand } from "./commands.js";
export type { SteeringCommandResult, SteeringCommandOptions } from "./commands.js";
export { SteeringQueue, makeTask } from "./queue.js";
export { classifyInstruction } from "./risk.js";
export { SnapshotStore } from "./snapshot.js";
export type { SteeringSnapshot } from "./snapshot.js";
export {
  TaskPriority,
  TaskType,
  RiskLevel,
  InterruptPolicy,
  SteeringState,
} from "./types.js";
export type { SteeringTask, RiskVerdict } from "./types.js";
