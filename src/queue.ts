// Priority queue for steering instructions.
//
// FIFO within a priority band, priority bands drained highest-first. Bounded so
// a misbehaving caller can't grow it without limit. Serializable so it can be
// captured in a pause snapshot and restored later.

import { TaskPriority, TaskType } from "./types.js";
import type { SteeringTask } from "./types.js";

let seq = 0;

export type EnqueueOptions = {
  type?: TaskType;
  priority?: TaskPriority;
  metadata?: Record<string, unknown>;
};

export function makeTask(content: string, opts: EnqueueOptions = {}): SteeringTask {
  return {
    id: `task_${Date.now().toString(36)}_${(seq++).toString(36)}`,
    content,
    type: opts.type ?? TaskType.APPEND,
    priority: opts.priority ?? TaskPriority.NORMAL,
    createdAt: Date.now(),
    metadata: opts.metadata ?? {},
  };
}

export class SteeringQueue {
  private items: SteeringTask[] = [];

  constructor(private readonly maxSize = 100) {}

  enqueue(task: SteeringTask): string {
    if (this.items.length >= this.maxSize) {
      // Drop the lowest-priority, oldest item to make room rather than throw —
      // a live agent should never crash because the steering buffer is full.
      let dropIdx = 0;
      for (let i = 1; i < this.items.length; i++) {
        if ((this.items[i]?.priority ?? 0) > (this.items[dropIdx]?.priority ?? 0)) dropIdx = i;
      }
      this.items.splice(dropIdx, 1);
    }
    this.items.push(task);
    return task.id;
  }

  /** Stable sort by priority (FIFO preserved inside a band) and remove all. */
  drain(): SteeringTask[] {
    const drained = [...this.items].sort((a, b) => a.priority - b.priority);
    this.items = [];
    return drained;
  }

  peek(): SteeringTask | undefined {
    return this.items[0];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  toJSON(): SteeringTask[] {
    return [...this.items];
  }

  static fromJSON(tasks: SteeringTask[], maxSize = 100): SteeringQueue {
    const q = new SteeringQueue(maxSize);
    for (const t of tasks) q.items.push(t);
    return q;
  }
}
