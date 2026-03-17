# Quota Optimizer Skill

## Description
This skill provides automated strategies to prevent Antigravity, Jules, and Gemini CLI from running out of tokens or credits. It focuses on task offloading, context pruning, and result recycling to ensure a continuous and efficient workflow.

## Guidelines

### 1. Task Routing (Offloading)
- **Small Tasks (up to 100 lines)**: Use **Antigravity** (me). I am fast and precise for local edits.
- **Large Tasks (refactoring, full features, codebase analysis)**: Use **Google Jules**. Jules works asynchronously in the cloud, saving your local Antigravity tokens.
- **Terminal Tasks (git cmds, search, status)**: Use **Gemini CLI**. It is optimized for direct terminal interactions.

### 2. Context Pruning
- Always prune large files before passing them to the AI. Use summary-only versions if possible.
- Avoid passing previous conversation history if it's no longer relevant.
- Use the `prune_context` script provided in this skill to clean up temporary logs.

### 3. Credit Recycling Loop
- When Jules completes a task, use its output as a "Gold Standard" for Antigravity, preventing me from needing to "think" about the solution from scratch.
- Use Antigravity to verify Jules' output locally, which is more token-efficient than Jules running verification tasks in the cloud.

### 4. Avoiding Redundant Research
- Before researching, check the `Knowledge Items (KIs)` already available in your project.
- Use `ls -R` or `grep` before asking the AI to find something.

## Automated Scripts

### `optimize_token_usage.js`
Runs a quick check on the current project size and suggests which files should be ignored (added to `.gitignore` or `.clignore`) to save tokens during codebase scans.

### `cleanup_logs.ps1`
Clears temporary agent logs and caches to keep the workspace lightweight.

## Example Flow
1. **User Request**: "Implement a full auth system."
2. **Quota Action**: 
   - Route to **Jules** (Heavy Task).
   - Jules completes it in the cloud.
   - **Antigravity** (Me) picks up the diff and applies it locally.
   - **Gemini CLI** (Terminal) runs tests and commits the changes.
