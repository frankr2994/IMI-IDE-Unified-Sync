---
description: Automated Quota Recycling System (AQRS)
---

# Quota Recycling System Flow

This workflow ensures you never run out of Antigravity or Jules credits by recycling context and task outputs.

## Step 1: Trigger Heavy Task (Jules Cloud)
If the task involves >10 files or complex logic:
1.  Use the `jules` command to initiate a background task.
2.  `jules task create "Implement feature X"`
3.  Jules performs the work in its isolated cloud environment (Freeing up Antigravity tokens).

## Step 2: Ingest Response (Antigravity Local)
Once Jules finishes:
1.  Antigravity fetches the PR or diff.
2.  Antigravity applies ONLY the relevant changes locally.
3.  **Recycle Benefit**: Antigravity doesn't need to 'discover' the solution, only 'apply' it, saving 80% of tokens.

## Step 3: Terminal Verification (Gemini CLI)
Verify the work using Gemini CLI in the terminal:
1.  `gemini -p "Verify tests pass in the current directory"`
2.  `gemini -p "Commit changes with descriptive message"`

## Step 4: Token Pruning (Automatic)
// turbo
1.  Run the pruning script: `node .agent/skills/quota_optimizer/scripts/monitor.js`
2.  Review the saturation percentage.
3.  If >90%, run `git gc` and `npm prune` to decrease workspace weight for the next AI scan.

# Continuous Loop Implementation
The IMI Dashboard will monitor these stages and notify you when to 'Switch' agents to preserve total system quota.
