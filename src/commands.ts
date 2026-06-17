// Steering command parser — turns a plain chat message into a steering action.
//
// This is the user-facing trigger. While an agent run is in progress, a second
// message arriving on the same session is dispatched here first: if it is a
// steering command (e.g. "/steer also check the logs", "/pause") it is applied
// to the live run's controller and the normal "start a new agent run" path is
// skipped. Anything that isn't a recognized command returns { handled: false }
// so the caller proceeds as usual.

import { getController, findController } from "./registry.js";
import { TaskType } from "./types.js";
import type { SteeringNotice } from "./controller.js";

export type SteeringCommandResult = {
  /** True when the message was a steering command and was consumed. */
  handled: boolean;
  /** Human-facing reply to send back, if handled. */
  reply?: string;
};

export type SteeringCommandOptions = {
  /** Forwarded to a freshly-created controller so its notices reach the user. */
  onNotice?: (n: SteeringNotice) => void;
};

const HELP = [
  "Steering commands:",
  "  /steer <text>      append an instruction to the running task",
  "  /inject <text>     add reference context for the agent to consider",
  "  /constrain <text>  change or tighten a constraint",
  "  /pause             pause at the next safe boundary (writes a snapshot)",
  "  /resume            resume a paused run",
  "  /approve <id>      approve a withheld high-risk instruction",
  "  /steer-status      show queue, blocked items and run state",
].join("\n");

/** Parse + execute. Returns handled:false for non-steering messages. */
export function handleSteeringCommand(
  sessionKey: string,
  text: string,
  opts: SteeringCommandOptions = {},
): SteeringCommandResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { handled: false };

  const space = trimmed.indexOf(" ");
  const cmd = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const arg = space === -1 ? "" : trimmed.slice(space + 1).trim();

  switch (cmd) {
    case "/steer":
    case "/append":
      return enqueue(sessionKey, arg, TaskType.APPEND, opts);
    case "/inject":
      return enqueue(sessionKey, arg, TaskType.INJECT, opts);
    case "/constrain":
    case "/modify":
      return enqueue(sessionKey, arg, TaskType.MODIFY, opts);

    case "/pause": {
      const c = findController(sessionKey);
      if (!c) return { handled: true, reply: "No active run to pause." };
      c.pause();
      return { handled: true, reply: "⏸️ Paused — send /resume to continue." };
    }
    case "/resume": {
      const c = findController(sessionKey);
      if (!c) return { handled: true, reply: "No paused run to resume." };
      c.resume();
      return { handled: true, reply: "▶️ Resumed." };
    }
    case "/approve": {
      const c = findController(sessionKey);
      if (!c) return { handled: true, reply: "No active run." };
      if (!arg) return { handled: true, reply: "Usage: /approve <task-id>" };
      const ok = c.approveBlocked(arg);
      return { handled: true, reply: ok ? `Approved ${arg}; will apply next round.` : `No withheld instruction with id ${arg}.` };
    }
    case "/steer-status":
    case "/steer-help":
      return { handled: true, reply: status(sessionKey) };

    default:
      // Unknown slash-word: leave it for the agent (could be a real prompt).
      return { handled: false };
  }
}

function enqueue(
  sessionKey: string,
  arg: string,
  type: TaskType,
  opts: SteeringCommandOptions,
): SteeringCommandResult {
  if (!arg) return { handled: true, reply: "Nothing to add — provide text after the command." };
  // getController so the instruction survives even if queued between runs.
  const c = getController({ sessionKey, ...(opts.onNotice ? { onNotice: opts.onNotice } : {}) });
  const { id, verdict, blocked } = c.enqueue(arg, { type });
  if (blocked) {
    return {
      handled: true,
      reply: `⚠️ Withheld as ${verdict.level} risk (${verdict.reason}).\nApprove with: /approve ${id}`,
    };
  }
  return { handled: true, reply: `✅ Queued (${id}); will fold in at the next round boundary.` };
}

function status(sessionKey: string): string {
  const c = findController(sessionKey);
  if (!c) return `${HELP}\n\n(no active run on this session)`;
  const blocked = c.listBlocked();
  const lines = [
    `State: ${c.getState()}`,
    `Pending in queue: ${c.pending}`,
    `Withheld (need approval): ${blocked.length}`,
  ];
  for (const b of blocked) lines.push(`  • ${b.id}: ${b.content.slice(0, 60)}`);
  return [...lines, "", HELP].join("\n");
}
