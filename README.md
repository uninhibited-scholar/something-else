# SomethingElse

[![CI](https://github.com/uninhibited-scholar/something-else/actions/workflows/ci.yml/badge.svg)](https://github.com/uninhibited-scholar/something-else/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Zero deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**Runtime steering for AI agents** — interject a new instruction, pause for
review, or guard against a destructive command **while the agent is running**,
without restarting the task.

![demo](assets/demo.svg)

Most agent loops are serial and blocking: once a run starts, you wait for it to
finish before you can say "oh, also check the logs" or "stop, wrong directory."
SomethingElse removes that wait. It's a small, dependency-free TypeScript library
that plugs into any round-based agent loop through a tiny adapter.

```
npm install @uninhibited-scholar/something-else
```

## Why it's safe

An agent loop runs tools in discrete **rounds**. A new instruction is only ever
injected at the **boundary between rounds** — never in the middle of a running
tool. A half-finished file write or shell command is never torn apart by a
mid-flight edit. Safety by construction, not by locking.

```
round N:   model → tool calls → tools execute ──┐
                                                │  ← steering boundary:
                                                │     drain queue, await pause
round N+1: [injected instruction] → model ──────┘
```

## Three things you can do mid-run

| | Call | Behavior |
|---|---|---|
| **Append** | `controller.enqueue(text)` | Folded into the plan at the next round boundary. No restart. |
| **Pause / resume** | `controller.pause()` / `resume()` | Loop blocks at the next boundary; a JSON snapshot of round + queue is written to disk. |
| **Guard** | automatic | Destructive instructions (`rm -rf`, `DROP TABLE`, `curl … \| sh`) are withheld until `approveBlocked(id)`. |

## Quick start (any agent loop)

Implement a one-method adapter for your message type and let `runSteerable` own
the steering boundary:

```ts
import { SteeringController, runSteerable } from "@uninhibited-scholar/something-else";
import type { SteerableAdapter } from "@uninhibited-scholar/something-else";

const controller = new SteeringController({ sessionKey: "chat:42" });

const adapter: SteerableAdapter<MyMessage> = {
  toUserMessage: (text) => ({ role: "user", content: text }),
  runRound: async ({ round, messages }) => {
    const reply = await myProvider.step(messages); // your model + tools
    return { done: reply.toolCalls.length === 0 };
  },
};

await runSteerable({ controller, messages, adapter });

// …meanwhile, from anywhere with the same sessionKey:
controller.enqueue("also group the findings by file");
controller.pause();   // resume() to continue
```

No adapter and just want the engine? Use the controller directly and call
`await controller.beforeRound(round)` yourself at the top of your loop — it
returns `{ injectedMessage }` to append.

## Slash-command trigger (optional)

If your front-end is chat-based, `handleSteeringCommand` turns plain messages
into steering actions so users never leave the chat box:

```ts
import { handleSteeringCommand } from "@uninhibited-scholar/something-else";

const steer = handleSteeringCommand(sessionKey, incomingText);
if (steer.handled) { reply(steer.reply); return; }  // don't start a new run
// …otherwise proceed with a normal agent run
```

```
/steer <text>      append an instruction to the running task
/inject <text>     add reference context
/constrain <text>  change or tighten a constraint
/pause             pause at the next boundary (writes a snapshot)
/resume            resume
/approve <id>      approve a withheld high-risk instruction
/steer-status      show queue / blocked / state
```

Unknown slash words fall through so they reach the agent as a normal prompt.

## Try it now (no API key)

```
npm install
npm run demo            # fake agent loop: append, pause/resume, block + approve
npm run demo:openclaw   # openclaw-replica-style adapter: steer a tool-call loop
npm test                # 21 tests
```

`npm run demo:openclaw` shows a steering instruction reaching the model
mid-run — the agent finishes the original task *and* the one you added:

```
  · tool list_files → [list_files] ok (3 matches)

>>> incoming: /steer also list any TODO comments
  «queued» Queued instruction; will apply at next round boundary.
  · tool list_files → [list_files] ok (3 matches)
  «injected» Injecting 1 steering instruction(s) into the plan.
  · tool list_files → [list_files] ok (3 matches)
  · model: Done — exports audited AND TODOs listed (per your mid-run note).
```

See [`src/examples/openclaw-adapter.ts`](src/examples/openclaw-adapter.ts) for
how the adapter wraps an [openclaw-replica](https://github.com/uninhibited-scholar/openclaw-replica)-style
streaming tool-call loop.

> Want an animated SVG of this for the README? Run
> [`./scripts/record-demo.sh`](scripts/record-demo.sh) (needs `asciinema` +
> `svg-term-cli`) to produce `assets/demo.svg`.

## Design

- **Zero runtime dependencies** — Node builtins only.
- **Provider-decoupled** — the harness traffics in plain text + your message
  type; nothing here knows about Anthropic/OpenAI shapes.
- **Durable history is your concern** — a steering snapshot only captures the
  *control* state (current round + pending queue), not your whole transcript.

## Contributing

Issues and PRs are welcome. To get set up:

```
npm install
npm run typecheck && npm test
```

CI runs typecheck + tests + build on Node 18/20/22 for every push and PR. Please
keep the zero-runtime-dependency rule and add a test for any behavior change.

## License

MIT

