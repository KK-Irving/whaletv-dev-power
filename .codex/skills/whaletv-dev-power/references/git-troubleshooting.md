# Git Troubleshooting Guide

## Purpose
Systematic troubleshooting for common git blocking issues in WhaleTV development.
Use error messages as keywords to look up solutions, not bound to specific drives/paths.

## Quick Lookup Table

| Error/Trigger | Diagnosis | Solution |
|--------------|-----------|---------|
| fatal: detected dubious ownership | git config --global --list missing safe.directory | git config --global --add safe.directory <path> |
| Permission denied (publickey) | ssh -T git@<host> fails | eval ssh-agent; ssh-add ~/.ssh/id_rsa |
| commit-msg hook timeout | git log -1 exists but no Change-Id | git commit --amend --no-edit |
| git grep hangs/stalls | Network drive or large repo | Use module-path-map to limit scope |
| Get-ChildItem -Recurse timeout | Network mount recursion | Use cmd /c dir /b /ad; see network-search-guide.md |
| .gitignore excludes needed files | git check-ignore -v <file> reveals pattern | Override with git add -f <file> (use with caution) |
| remote rejected (not a Gerrit ref) | Pushed to branch not refs/for/ | Use: git push HEAD:refs/for/<target-branch> |
| Your branch is ahead | Local commit not pushed | Check: git log origin/<branch>..HEAD |

## commit-msg Hook Timeout (Detailed)

### Symptoms
- git commit appears to hang ~30 seconds
- Error message about connection timeout to Gerrit

### Resolution Steps
1. Verify commit state: git log -1
   (If commit shows, it was created successfully despite timeout)
2. Check Change-Id: git log -1 --format=%B | grep Change-Id
   (If Change-Id present, everything is fine)
3. If missing Change-Id: git commit --amend --no-edit
   (Re-runs commit-msg hook to fetch new Change-Id)
4. If still failing: check network (ping whale-gerrit.zeasn.com), check SSH

### Prevention
- Set GERRIT_TIMEOUT_MS=30000 in mcp.json
- Ensure SSH key is loaded before committing

## SSH Authentication Issues

### Check SSH Connection
ssh -T -p 29418 <user>@whale-gerrit.zeasn.com

### Start SSH Agent (Windows/Linux/macOS)
eval ssh-agent; ssh-add ~/.ssh/id_rsa    (Windows)
eval "$(ssh-agent -s)"; ssh-add ~/.ssh/id_rsa    (Linux/macOS)

### Verify Key is Loaded
ssh-add -l
