// Standalone demo — runtime steering against a *fake* agent loop via the
// adapter API. No LLM/API keys required.
//
//   npx tsx src/examples/demo.ts
//
// Shows: (A) appending an instruction mid-run, (B) pausing and resuming, and
// (C) a destructive instruction being withheld until approved — all without
// restarting the task.

import { SteeringController } from "../controller.js";
import { runSteerable } from "../harness.js";
import type { SteerableAdapter } from "../harness.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A host message type — here just a string. In a real app this is your
// provider's ChatMessage.
type Msg = string;

// The adapter: how to turn injected text into a message, and how to run one
// round of *your* agent loop. This fake loop just "works" for 6 rounds.
function makeAdapter(): SteerableAdapter<Msg> {
  return {
    toUserMessage: (text) => text,
    runRound: async ({ round, messages }) => {
      console.log(`  [round ${round}] model works… (${messages.length} msgs in context)`);
      await sleep(200); // pretend a tool ran
      return { done: round >= 5 };
    },
  };
}

async function main(): Promise<void> {
  const ctrl = new SteeringController({
    sessionKey: "demo",
    snapshotDir: "/tmp/something-else-demo",
    onNotice: (n) => console.log(`  «${n.kind}» ${n.message}`),
  });

  const messages: Msg[] = ["scan the project for TODOs"];
  const loop = runSteerable({ controller: ctrl, messages, adapter: makeAdapter(), maxRounds: 6 });

  // A) Append a normal instruction while running.
  await sleep(250);
  console.log("\n>>> user: '/steer also group the TODOs by file'");
  ctrl.enqueue("also group the TODOs by file");

  // B) Pause for review, then resume.
  await sleep(450);
  console.log("\n>>> user: '/pause'");
  ctrl.pause("reviewing intermediate output");
  await sleep(600);
  console.log(">>> user: '/resume'");
  ctrl.resume();

  // C) Try a destructive instruction — it gets withheld until approved.
  await sleep(250);
  console.log("\n>>> user: '/steer rm -rf the build dir'");
  const { id, blocked } = ctrl.enqueue("rm -rf the build dir");
  console.log(`    blocked = ${blocked}; human approves the override…`);
  ctrl.approveBlocked(id);

  await loop;
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
