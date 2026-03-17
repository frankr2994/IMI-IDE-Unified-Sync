# IMI System Performance Rules

## 🚨 MISSION: NEVER RUN OUT OF QUOTA 🚨
1. **Always Route Heavy Tasks to JULES**: Jules works asynchronously in the cloud. Use it for anything that takes more than 10 seconds to 'think'.
2. **Prune Conversation Daily**: Run `node .agent/skills/quota_optimizer/scripts/monitor.js` to check saturation.
3. **Loop Credits**: When Jules finishes a task, download the diff and ask Antigravity to 'Review the minimal changes' instead of 'Think of a solution'. 
4. **Terminal First**: For git, search, and system commands, use **Gemini CLI**. It is the most token-efficient terminal integration.

## 🛠 Unified System Flow
- **Dashboard**: `http://127.0.0.1:3333/` (The IMI Command Center)
- **Primary Agents**: Antigravity (me), Jules (cloud), Gemini CLI (shell).
- **Secondary Agents**: Any IDE added later (Integrated via the Dashboard).
