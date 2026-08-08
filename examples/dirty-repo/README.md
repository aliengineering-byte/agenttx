# Dirty repository preservation

AgentTX captures staged, unstaged, and non-ignored untracked state when a transaction begins. Use a disposable repository to see it:

```bash
echo "user work" >> tracked.txt
echo "untracked user work" > local-note.txt
git add tracked.txt
agenttx run -- node -e "require('node:fs').writeFileSync('agent.txt', 'agent work\n')"
agenttx diff
agenttx commit
git status --short
```

Expected result: `agent.txt` is accepted, the staged `tracked.txt` change stays staged, and `local-note.txt` remains untracked. AgentTX does not recreate staged/unstaged distinctions inside the isolated clone, but it preserves the original index during acceptance.

For the conflict case, modify a transaction-touched path in the original repository before `agenttx commit`. Acceptance will refuse before applying any transaction file, leave the user edit in place, and suggest `agenttx diff` or `agenttx rollback`.
