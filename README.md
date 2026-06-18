# SomethingElse — Runtime Steering for AI Agents

> *Interrupt, pause & guard a running agent loop — without restarting the task.*

[![CI](https://github.com/uninhibited-scholar/something-else/actions/workflows/ci.yml/badge.svg)](https://github.com/uninhibited-scholar/something-else/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Zero deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**Runtime steering for AI agents** — interject a new instruction, pause for
review, or guard against a destructive command **while the agent is running**,
without restarting the task.

> 🧩 **Part of the Agent Loop Toolkit** — three small, zero-dependency, framework-agnostic libraries you bolt onto any agent loop. Each works standalone; together they cover **context → gate → steer**.
>
> | Where it plugs in | Library | What it does |
> | --- | --- | --- |
> | **The context** going in | [context-compressor](https://github.com/uninhibited-scholar/context-compressor) | Shrink the LLM context window 40–80% — drop noise, redundancy, long-tail detail |
> | **The plan**, before a step runs | [precheck-guardian](https://github.com/uninhibited-scholar/precheck-guardian) | Preview the plan, see per-step risk, approve / reject / edit |
> | **The run**, while it's live ← *you are here* | **something-else** | Interject, pause, or guard a live loop without restarting |

![demo](assets/demo.svg)

Most agent loops are serial and blocking: once a run starts, you wait for it to
finish before you can say "oh, also check the logs" or "stop, wrong directory."
SomethingElse removes that wait. It's a small, dependency-free TypeScript library
that plugs into any round-based agent loop through a tiny adapter.

### Why not just restart it?

Because restarting throws away everything the run has already earned, and can't undo what it already did:

- **Lost progress is expensive.** A run that's spent 20 minutes and thousands of tokens building up context — crawled pages, intermediate results, tool state — loses all of it on restart, then has to repay that time and cost from zero.
- **Side effects are already real.** By the time you notice it's off track, the agent may have written files, hit APIs, or created records. You can't "restart" actions that already happened — you can only correct course *in place*, mid-loop.
- **Long tasks drift mid-run.** Deep research and multi-step coding take tens of minutes. Spotting a wrong turn at minute 5 and waiting for the whole run to finish before redoing it is the worst case — a single interjection saves the entire re-run.
- **Restarting wipes your feedback.** Corrections you already gave in earlier rounds vanish too; you end up re-teaching the same lesson.

`Ctrl+C` and re-prompt is fine for a 10-second run. SomethingElse exists for the runs where starting over is the costly option.

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

## When to use this (and when not to)

Mid-run steering is increasingly common, so be honest with yourself about which
bucket you're in:

**Reach for SomethingElse when** you have a **hand-rolled agent loop** or use a
runtime whose tool loop you don't control the internals of (e.g. the
[Vercel AI SDK](#vercel-ai-sdk)) and you want append / pause / guard without
writing the plumbing. It's framework-agnostic, zero-dependency, and small enough
to read in one sitting.

**You probably don't need it if** you're already on a framework with first-class
human-in-the-loop support:

| Framework | Built-in mid-run control | Verdict |
|---|---|---|
| **LangGraph** | `interrupt()`, checkpoints, state edits | Use its built-ins — don't add this. |
| **OpenHands** | send messages to a running agent | Built-in; this is redundant. |
| **OpenAI Agents SDK** | tool-approval / interruptions | Mostly covered. |
| **Vercel AI SDK** | `prepareStep` hook only, no queue/pause | ✅ Good fit — this fills the gap. |
| **Hand-rolled loop** | whatever you build | ✅ Its reason to exist. |

The one thing SomethingElse leans on that most built-ins don't advertise:
instructions are injected **only between tool rounds**, so a running tool is
never interrupted — a safety property you get for free.

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

### Vercel AI SDK

The AI SDK runs the tool loop for you, but its `prepareStep` callback fires
right before each step — the exact steering boundary. Three lines:

```ts
import { streamText, stepCountIs } from "ai";
import { SteeringController } from "@uninhibited-scholar/something-else";

const controller = new SteeringController({ sessionKey: "chat:42" });

streamText({
  model, messages, tools,
  stopWhen: stepCountIs(10),
  prepareStep: async ({ stepNumber, messages }) => {
    const steer = await controller.beforeRound(stepNumber);
    return steer.injectedMessage
      ? { messages: [...messages, { role: "user", content: steer.injectedMessage }] }
      : {};
  },
});

// elsewhere, on the same sessionKey:
controller.enqueue("also grep for TODOs");
```

Runnable, no API key: `npm run demo:vercel`
([source](src/examples/vercel-ai-sdk.ts)).

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
npm run demo:vercel     # Vercel AI SDK: steer via the prepareStep callback
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

