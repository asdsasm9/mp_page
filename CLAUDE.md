# Mullny Photos — shell command discipline

Every Bash call needs a permission check, and in this project a classifier can
block one with no explanation. Keep commands few, short, and shaped so an
allowlist rule matches them, or you stall waiting on a human.

**Rule zero, before any of the rest of this file: finding or listing files is
never a Bash problem.** Use the Glob tool (e.g. `src/features/plan/**/*.test.{ts,tsx}`)
to find files by name or pattern, and Read/Grep to look inside them. Glob is a
dedicated tool, not Bash — it never touches the permission check this whole
file is about, never mind which directory it searches or how the result is
used afterward. Reaching for `find`, `ls`, `grep -r`, or any of them piped
into another command (`| xargs`, `| head`, command substitution) is the
single most common reason this project stalls, because:
- a path or argument computed at runtime (`| xargs ls`, `$(find ...)`) can
  never be statically verified, so it always stops and asks, no matter how
  safe the result would actually be;
- searching wider than the worktree or your one state directory (e.g. the
  whole `autopilot/` root) sweeps in other projects' data you have no
  business reading, and is correctly blocked, not a bug to route around.
Reach for Bash's `find`/`grep`/`rg` only when you specifically need shell
features Glob/Grep genuinely lack (for example a `git`-aware listing), and
even then keep it to one plain command with no pipe into a second one.

**Never redirect a command's output to a file just to read it back.** The
Bash tool already returns stdout and stderr directly — `npx vitest run
tests/app/Foo.test.tsx -t "case name"` on its own shows you the result. Piping
or redirecting into a file (`> /tmp/out.txt`, `| tee`) and then `cat`/`wc`/`head`
it is always pointless, and doubly so when the target is outside the worktree
and your state directory (like `/tmp`), which is blocked the same way as
described in rule zero above, for the same reason: it's a read outside your
granted directories. If output is genuinely too long to read directly, filter
it in the same command instead of a second one (`-t "name"`, `--reporter=dot`).

**Never put environment variables in front of a command** (`env X=1 npm run ...`, `CHROME_PATH=... node ...`). The permission check cannot verify an assignment and asks the human every time. The Chrome-based checks (`design-check`, `admin-check`, `admin-prod-check`, `admin-encode-check`, `image-fit`, `lightbox-a11y`, `lightbox-network`) find Chrome on their own (`findChrome` in `scripts/design-check.mjs` falls back to `/Applications/Google Chrome.app/...`). Run them as a plain `npm run admin-prod-check`, even though the usage comment at the top of a script mentions `CHROME_PATH=`. If a script really needs a variable, make it read a default inside the script, not on the command line.

**Never pipe a script into an interpreter.** No `python3 - <<'PY'`, no
`bash <<'SH'`, no `node -e '<multi-line program>'`, no `python3 -c` holding
more than a one-liner, no `sed -i`. These are opaque arbitrary code: nothing
can allowlist them safely, and a hook (`hooks/deny-opaque-scripts.sh`) denies
them outright before they reach a permission prompt. A single-line `-c`/`-e`
is fine; anything spanning more than one line is not. They are the main
reason this project prompts (or fails) constantly.

**Use the Write tool for a throwaway script,** then run it as a plain
command: `python3 scripts/check.py`, `node scripts/check.mjs`. That matches
`Bash(python3*)`/`Bash(node*)` in settings.json and runs without prompting.

**Use the dedicated tools instead of shell equivalents.** Read/Edit/Write for
files, Glob and Grep for searching. These match path rules and run silently.
`sed -i`, `cat > file`, and heredoc rewrites do not, and are blocked.

**Run one plain command per Bash call,** with literal arguments — not a
chain of `&&`, a `for`/`while` loop, or a command built around a generated
string, and not `env -i`/`$VAR` manipulation or `$?` capture inline. Even a
read-only one of these stops and asks, because the parser can't verify what
it does. If genuinely recurring shell work is needed, save it as a named
script under `scripts/`, add an `npm run <name>` entry for it, and run that
by name — it then matches `Bash(npm*)`, already allowed, with no further
settings change needed. See `npm run gates` for the existing pattern.

**Never `cd`, not even into the state directory and back.** You are already
running inside this worktree, so a plain `git status` (no path, no `cd`)
already reports on it. Every `--add-dir` path (including the project's state
directory: VISION.md, BACKLOG.md, DECISIONS.md, STATE.md, LOG.md, plans/) is
already readable by its full path with Read/Glob/Grep, no `cd` needed.
`cd dir && ...` is always blocked, even when `dir` is already allowed,
because the permission check cannot verify what a command does after a
directory change. The state directory is a plain folder of markdown files,
not a git repository — never run `git` there at all, only Read/Glob/Grep.

**Know your own state directory instead of searching for it.** Work-package
plans are at `<state directory>/plans/WP-<nn>-<name>.md` (the orchestrator
prompt gives you the exact path as `__PDIR__`/`AUTOPILOT_PDIR`) — Read or
Glob that path directly, per rule zero above.

This applies in auto mode too, and overrides any general guidance that says
to prefer Bash for file edits or quick calculations.
