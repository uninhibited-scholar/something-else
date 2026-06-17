// Real-world adapter: wrapping an openclaw-replica-style agent loop.
//
//   npx tsx src/examples/openclaw-adapter.ts
//
// This mirrors the message + streaming-provider shapes used by openclaw-replica
// (https://github.com/uninhibited-scholar/openclaw-replica) so it reads like a
// genuine integration. The provider/tool calls below are stubbed so the file
// runs with no API key; in the real project you'd swap them for
// `createProvider(config)` and the tool registry, and drop `runSteerable` into
// `handleAgentRun`'s tool-call loop.

import { SteeringController } from "../controller.js";
import { runSteerable } from "../harness.js";
import type { SteerableAdapter } from "../harness.js";

// ── Types mirrored from openclaw-replica (src/llm/provider.ts) ───────────────
type ChatMessage =
  | { role: "user" | "assistant" | "system"; content: string }
  | { role: "tool"; callId: string; name: string; content: string };

type ProviderChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: { callId: string; name: string; args: Record<string, unknown> } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Stubbed provider + tools (replace with the real ones) ────────────────────
// Emits a tool call for the first few rounds, then a final summary. If a
// steering instruction has been injected, the summary acknowledges it — showing
// the new instruction genuinely reached the model mid-run.
async function* fakeStream(round: number, messages: ChatMessage[]): AsyncGenerator<ProviderChunk> {
  if (round < 3) {
    yield { type: "text", text: `Working on it (round ${round})… ` };
    yield { type: "tool_call", call: { callId: `c${round}`, name: "list_files", args: { glob: "**/*.ts" } } };
  } else {
    const steered = messages.some((m) => m.role === "user" && m.content.includes("TODO"));
    yield { type: "text", text: steered ? "Done — exports audited AND TODOs listed (per your mid-run note)." : "Done — exports audited." };
  }
}

async function runTool(name: string, _args: Record<string, unknown>): Promise<string> {
  return `[${name}] ok (3 matches)`;
}

// ── The adapter ──────────────────────────────────────────────────────────────
function openclawAdapter(): SteerableAdapter<ChatMessage> {
  return {
    toUserMessage: (text) => ({ role: "user", content: text }),

    runRound: async ({ round, messages }) => {
      await sleep(120); // pretend the model + tools take a moment
      const pending: Array<{ callId: string; name: string; args: Record<string, unknown> }> = [];
      let text = "";

      for await (const chunk of fakeStream(round, messages)) {
        if (chunk.type === "text") text += chunk.text;
        else pending.push(chunk.call);
      }
      if (text) messages.push({ role: "assistant", content: text });

      if (pending.length === 0) {
        process.stdout.write(`  · model: ${text}\n`);
        return { done: true };
      }

      for (const call of pending) {
        const result = await runTool(call.name, call.args);
        messages.push({ role: "tool", callId: call.callId, name: call.name, content: result });
        process.stdout.write(`  · tool ${call.name} → ${result}\n`);
      }
      return { done: false };
    },
  };
}

async function main(): Promise<void> {
  const controller = new SteeringController({
    sessionKey: "telegram:42",
    snapshotDir: "/tmp/something-else-openclaw",
    onNotice: (n) => process.stdout.write(`  «${n.kind}» ${n.message}\n`),
  });

  const messages: ChatMessage[] = [{ role: "user", content: "audit the repo for unused exports" }];
  const loop = runSteerable({ controller, messages, adapter: openclawAdapter() });

  // A user sends "/steer …" on the same Telegram chat while the run is going:
  setTimeout(() => {
    process.stdout.write("\n>>> incoming: /steer also list any TODO comments\n");
    controller.enqueue("also list any TODO comments");
  }, 150);

  await loop;
  process.stdout.write(`\nFinal context: ${messages.length} messages.\n`);
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
