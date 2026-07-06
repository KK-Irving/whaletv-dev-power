# Network Drive Search Guide
## Problem
Workspace on network drive (W:\, \\192.168...). Recursive searches and git grep timeout (>10s).
## Safe Operations
cmd /c "dir /b /ad <path>" - non-recursive directory listing
cmd /c "dir /b <path>" - non-recursive file listing
git --git-dir="<path>" ls-tree -r --name-only HEAD | Select-String "pattern" - small repo search
Select-String -Path <file> -Pattern "pattern" - targeted file search
## Forbidden Operations
Get-ChildItem -Recurse (any path on network drive)
git grep on vendor/whale.git or hardware/amlogic/audio.git (large repos)
find / dir /s (recursive on network mount)
## Fallback Priority
1. Use module-path-map.md to locate known paths
2. Use cmd dir commands for directory structure exploration
3. Use small git repos with ls-tree for file listing
4. Use OpenGrok remote search (5th priority in code search)
