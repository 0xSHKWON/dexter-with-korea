---
name: run-desktop
description: Build, launch, and drive the Dexter Electron desktop app to verify a change in the real UI. Use when asked to run or start the desktop app, screenshot it, click through it, or confirm a desktop change works outside of tests.
---

The desktop app is the primary product (the CLI has one user). Its UI is React in
an Electron window, and `bun test` never touches it — so a desktop change is
unverified until it has been clicked in a running window.

Drive it through the Playwright REPL at `.claude/skills/run-desktop/driver.mjs`.
macOS only; there is no xvfb involved.

## Setup (once per clone)

```bash
cd desktop
npm install
node node_modules/electron/install.js   # see Gotchas — npm install alone may skip this
npm run build                           # package.json main is ./out/main/index.js
```

Rebuild (`npm run build`) after any change under `desktop/src/` — the driver runs
the built output, not the sources.

## Run

Scripted (the usual path — commands are piped, one per line):

```bash
printf 'launch\nss landing\nquit\n' | node .claude/skills/run-desktop/driver.mjs
```

Interactive:

```bash
node .claude/skills/run-desktop/driver.mjs
```

Screenshots land in `/tmp/dexter-shots/` (override with `SCREENSHOT_DIR`).
**Open them and look.** A blank frame means the app never finished booting.

### Commands

| command | what it does |
|---|---|
| `launch` | launch + wait for `.chat` to mount |
| `ss [name]` | screenshot → `/tmp/dexter-shots/<name>.png` |
| `click <sel>` | click via DOM |
| `click-text <text>` | click the button/nav item with that text (sidebar tabs work) |
| `set-input <sel> <text>` | set a React-controlled input (quote a selector containing spaces) |
| `type <text>` / `press <key>` | keyboard input |
| `wait <sel>` | wait for a selector, 20s |
| `poll-for <sel> [ms]` | 50ms polling, for states too short-lived for `wait` |
| `dialog accept\|dismiss` | arm a one-shot handler for the next `window.confirm` and print its message |
| `eval <js>` / `text [sel]` | evaluate in the page / print innerText |
| `windows` | list windows |
| `quit` | close and clean up the temp profile |

### A full example that exercises the app

```bash
printf 'launch
set-input ".composer textarea" 삼성전자 분석해줘
click-text 전송
wait .composer-note
text .composer
click-text History
dialog dismiss
click .hist-row-del
eval document.querySelectorAll(".hist-row").length
quit
' | node .claude/skills/run-desktop/driver.mjs
```

## Your data is not at risk

`launch` creates a throwaway `--user-data-dir` and deletes it on `quit`, so the
real install's chat history and encrypted API keys are never read or written.
That also means **the app starts empty every time** — no history, model shows
`미설정`. That is the isolated profile, not data loss; the real DB lives at
`~/Library/Application Support/dexter-desktop/dexter-desktop.db`.

Set `DEXTER_REAL_PROFILE=1` only when a run genuinely needs the stored API keys,
and never combine it with a `dialog accept` on a delete.

## What you cannot verify here

There are no API keys in the repo, so a question returns
`[LLM] OPENAI_API_KEY not found in environment variables` instead of an answer.
Useful anyway — that error is a settled assistant turn, so it still exercises the
answered/error UI states. Anything about **answer content** (markdown shape,
Korean company names, the desktop channel profile) needs a keyed run.

## Gotchas

- **`npm install` can leave `node_modules/electron/dist` empty.** The binary is
  fetched by electron's postinstall; any earlier `--ignore-scripts` install
  poisons it. Fix: `node node_modules/electron/install.js`. `launch` checks for
  the binary and prints this.
- **`playwright-core` lives in the repo root**, not in `desktop/`. The driver
  resolves it through the root `package.json` — don't "fix" that to a local path.
- **Assigning `.value` on a React input does nothing.** React tracks the previous
  value on the node, so `set-input` uses the native setter plus a bubbling
  `input` event. Without it the field looks filled but state never updates and
  the submit button stays disabled — which reads as "the button is broken".
- **Selectors with spaces**: `set-input` takes the first token as the selector
  unless you quote it (`set-input ".composer textarea" …`). `poll-for` only
  peels a trailing timeout when the last token is a number.
- **Piped commands need serializing.** readline emits every buffered line at
  once and does not await an async handler; the driver chains them on a queue.
  If you add a command, keep it in that chain or it will run before `launch`.
- **`DEXTER_CORE_ROOT`** is set by the driver so the sidecar finds the Bun core.
  Launching Electron by hand without it makes every run fail to spawn.
- **The sidecar cold start is ~0.4–0.7s**, so transient UI states (a conversion's
  취소 button) exist only briefly. Use `poll-for`, not `wait`.
- **No tmux on this machine.** The scripted pipe above is the interactive
  substitute.

## Troubleshooting

- **`ERROR: app not built`** → `cd desktop && npm run build`.
- **`WARN: .chat never appeared`** → the renderer threw. `eval document.body.innerHTML.slice(0,500)`.
- **`NOT_AN_INPUT (DIV)`** → the selector had spaces and got split; quote it.
- **`NOT_FOUND` on a row that is visible** → it rendered after the click. Add
  `wait`/`poll-for` before it.
