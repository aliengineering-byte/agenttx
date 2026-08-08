# Basic local transaction

From any disposable Git repository with at least one commit:

```bash
agenttx run -- node -e "require('node:fs').writeFileSync('agent-note.txt', 'made in a transaction\n')"
agenttx diff --full
agenttx inspect
agenttx rollback
```

`agent-note.txt` exists only in the transaction workspace and disappears on rollback. Run the sequence again and use `agenttx commit` to accept it into the original working tree. The commit command accepts files; it does not create a Git commit.
