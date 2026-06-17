// Real-world integration: Vercel AI SDK (`ai` package).
//
//   npx tsx src/examples/vercel-ai-sdk.ts
//
// The AI SDK runs the tool-call loop *for you* inside `streamText` / `generateText`,
// so there's no hand-written loop to drop `runSteerable` into. Instead it exposes
// `prepareStep` — a callback fired right before every step — which is the exact
// "between rounds" boundary SomethingElse needs. Steering becomes a three-line
// hook:
//
//   import { streamText, stepCountIs } from "ai";
//   import { openai } from "@ai-sdk/openai";
//   import { SteeringController } from "@uninhibited-scholar/something-else";
//
//   const controller = new SteeringController({ sessionKey: "chat:42" });
//
//   const result = streamText({
//     model: openai("gpt-4o"),
//     messages,
//     tools: { listFiles, grep },
//     stopWhen: stepCountIs(10),
//     prepareStep: async ({ stepNumber, messages }) => {
//       const steer = await controller.beforeRound(stepNumber);   // ← steering boundary
//       if (steer.injectedMessage) {
//         return { messages: [...messages, { role: "user", content: steer.injectedMessage }] };
//       }
//       return {};
//     },
//   });
//
//   // …meanwhile, from your chat handler, on the same sessionKey:
//   controller.enqueue("also grep for TODOs");
//   controller.pause();   // resume() to continue
//
// Below is a self-contained, no-API-key runnable version: a tiny stand-in for
// `streamText` that honors `prepareStep` exactly like the real SDK, so you can
// watch a steering instruction land mid-run.

import { SteeringController } from "../controller.js";

// ── Minimal shapes mirrored from the AI SDK (ai@4/5) ─────────────────────────
type ModelMessage = { role: "user" | "assistant" | "tool" | "system"; content: string };

type PrepareStep = (opts: {
  stepNumber: number;
  messages: ModelMessage[];
}) => Promise<{ messages?: ModelMessage[] } | void>;

type StreamTextOptions = {
  messages: ModelMessage[];
  stopAfterStep: number;
  prepareStep: PrepareStep;
  onText: (text: string) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stand-in for the AI SDK's internal step loop. The real `streamText` does this
// for you; the only part you write is `prepareStep`.
async function fakeStreamText(opts: StreamTextOptions): Promise<ModelMessage[]> {
  let messages = opts.messages;

  for (let stepNumber = 0; ; stepNumber++) {
    const adjusted = await opts.prepareStep({ stepNumber, messages });
    if (adjusted && adjusted.messages) messages = adjusted.messages;

    await sleep(120); // pretend the model + tools run

    if (stepNumber < opts.stopAfterStep) {
      messages = [...messages, { role: "tool", content: "[list_files] ok (3 matches)" }];
      opts.onText(`· step ${stepNumber}: tool list_files → ok`);
    } else {
      const steered = messages.some((m) => m.role === "user" && m.content.includes("TODO"));
      const final = steered
        ? "Done — files listed AND TODOs grepped (per your mid-run note)."
        : "Done — files listed.";
      opts.onText(`· model: ${final}`);
      return messages;
    }
  }
}

async function main(): Promise<void> {
  const controller = new SteeringController({
    sessionKey: "chat:42",
    snapshotDir: "/tmp/something-else-vercel",
    onNotice: (n) => process.stdout.write(`  «${n.kind}» ${n.message}\n`),
  });

  const messages: ModelMessage[] = [{ role: "user", content: "list the TypeScript files" }];

  // A user sends "/steer …" on the same session while the run is going:
  setTimeout(() => {
    process.stdout.write("\n>>> incoming: /steer also grep for TODO comments\n");
    controller.enqueue("also grep for TODO comments");
  }, 150);

  await fakeStreamText({
    messages,
    stopAfterStep: 3,
    onText: (t) => process.stdout.write(`  ${t}\n`),
    // The entire integration: consult the controller before each step.
    prepareStep: async ({ stepNumber, messages }) => {
      const steer = await controller.beforeRound(stepNumber);
      if (steer.injectedMessage) {
        return { messages: [...messages, { role: "user", content: steer.injectedMessage }] };
      }
      return {};
    },
  });

  process.stdout.write("\nDone.\n");
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
