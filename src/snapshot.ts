// Pause snapshots — capture enough to show a human what the agent was doing and
// to restore the steering queue if the process restarts.
//
// We deliberately do NOT try to snapshot the full provider/streaming state. The
// agent loop already persists transcript + session to SQLite (see state/agent-db),
// so the durable conversation lives there. A steering snapshot is the *control*
// layer: where in the tool loop we paused, and what instructions were queued.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SteeringTask } from "./types.js";

export type SteeringSnapshot = {
  snapshotId: string;
  sessionKey: string;
  timestamp: number;
  state: string;
  round: number;
  note: string;
  pendingTasks: SteeringTask[];
};

export class SnapshotStore {
  constructor(private readonly dir: string) {
    mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  save(snapshot: SteeringSnapshot): string {
    const file = this.pathFor(snapshot.snapshotId);
    writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
    return file;
  }

  load(snapshotId: string): SteeringSnapshot | undefined {
    const file = this.pathFor(snapshotId);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as SteeringSnapshot;
  }
}
