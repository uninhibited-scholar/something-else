// Per-session controller registry.
//
// The agent loop runs deep inside `handleAgentRun`, but steering commands arrive
// from the outside (a gateway message, a CLI keystroke, a channel command). This
// registry is the shared lookup keyed by sessionKey so both sides meet.

import { SteeringController } from "./controller.js";
import type { SteeringControllerOptions } from "./controller.js";

const controllers = new Map<string, SteeringController>();

/** Get the controller for a session, creating it on first use. */
export function getController(opts: SteeringControllerOptions): SteeringController {
  const existing = controllers.get(opts.sessionKey);
  if (existing) return existing;
  const created = new SteeringController(opts);
  controllers.set(opts.sessionKey, created);
  return created;
}

/** Look up an existing controller without creating one. */
export function findController(sessionKey: string): SteeringController | undefined {
  return controllers.get(sessionKey);
}

export function disposeController(sessionKey: string): void {
  controllers.delete(sessionKey);
}
