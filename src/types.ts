// Runtime steering — shared types.
//
// "Steering" = changing what the agent is doing *while it runs*, without
// restarting the whole task: append a new instruction, pause for review,
// or block a queued instruction that is too dangerous to inject mid-run.

/** Lower number = higher priority (drained first). */
export enum TaskPriority {
  URGENT = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

export enum TaskType {
  /** Add a new instruction on top of the current goal. */
  APPEND = "append",
  /** Tighten or change a constraint ("from now on, don't touch prod"). */
  MODIFY = "modify",
  /** Inject reference context the model should consider. */
  INJECT = "inject",
}

export type SteeringTask = {
  id: string;
  content: string;
  type: TaskType;
  priority: TaskPriority;
  createdAt: number;
  metadata: Record<string, unknown>;
};

/** Risk of a *queued instruction* (not of a running tool). */
export enum RiskLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

/** What we are allowed to do with an instruction of a given risk. */
export enum InterruptPolicy {
  /** Inject as soon as the current round ends. */
  ALLOW = "allow",
  /** Hold in the queue; only inject on an explicit pause/review boundary. */
  QUEUE = "queue",
  /** Never inject automatically; surface to a human instead. */
  DENY = "deny",
}

export enum SteeringState {
  IDLE = "idle",
  RUNNING = "running",
  PAUSED = "paused",
}

export type RiskVerdict = {
  level: RiskLevel;
  policy: InterruptPolicy;
  reason: string;
};
