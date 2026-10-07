---
name: wrap-up
description: End-of-session checklist - verify, review, and summarize before committing. Use when the user says they're done or asks to wrap up.
disable-model-invocation: true
---

1. Run the `test-runner` agent; report real results.
2. Run the `code-reviewer` agent on the current diff.
3. List files changed and any TODOs left behind.
4. Suggest a commit message (imperative, under 72 chars) but do not commit unless asked.
5. If you learned something future sessions need (a command, a gotcha), propose a one-line addition to CLAUDE.md.
