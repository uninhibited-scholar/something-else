# SomethingElse

**Runtime steering for AI agents** — interject a new instruction, pause for
review, or guard against a destructive command **while the agent is running**,
without restarting the task.

Most agent loops are serial and blocking: once a run starts, you wait for it to
finish before you can say "oh, also check the logs" or "stop, wrong directory."
SomethingElse removes that wait. It's a small, dependency-free TypeScript library
that plugs into any round-based agent loop through a tiny adapter.

```
npm install something-else   # (once published)
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
import { SteeringController, runSteerable } from "something-else";
import type { SteerableAdapter } from "something-else";

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
import { handleSteeringCommand } from "something-else";

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
npm run demo     # fake agent loop: append, pause/resume, block + approve
npm test         # 21 tests
```

## Design

- **Zero runtime dependencies** — Node builtins only.
- **Provider-decoupled** — the harness traffics in plain text + your message
  type; nothing here knows about Anthropic/OpenAI shapes.
- **Durable history is your concern** — a steering snapshot only captures the
  *control* state (current round + pending queue), not your whole transcript.

## License

MIT
