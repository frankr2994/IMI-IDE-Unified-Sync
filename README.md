<div align="center">

# ⚡ IMI — IDE Merge Integrations

**The AI-powered desktop workspace that puts every major AI model at your fingertips.**
Multi-brain orchestration · Zero-token Skill Engine · Local AI via Ollama · Built with Electron + React

[![Version](https://img.shields.io/badge/version-1.0.4-9b4dff?style=for-the-badge&logo=electron&logoColor=white)](https://github.com/creepybunny99/IMI-IDE-Unified-Sync)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/creepybunny99/IMI-IDE-Unified-Sync)
[![React](https://img.shields.io/badge/built_with-Electron_+_React-61dafb?style=for-the-badge&logo=react&logoColor=white)](https://github.com/creepybunny99/IMI-IDE-Unified-Sync)
[![AI](https://img.shields.io/badge/AI-Gemini_%C2%B7_Claude_%C2%B7_GPT_%C2%B7_Groq_%C2%B7_Ollama-ff6b35?style=for-the-badge)](https://github.com/creepybunny99/IMI-IDE-Unified-Sync)

</div>

---

## What is IMI?

IMI is a desktop AI command center built on Electron. You choose which AI model acts as your **Brain** (planner/reasoner) and which acts as your **Coder** (code writer) — they work as a team. Type a request in plain English, and IMI figures out what to build, writes the code, and applies the changes directly to your project files.

No copy-pasting. No switching tabs. Just results.

---

## Core Architecture

### 🧠 Brain + ⚙️ Coder Split

Every request goes through two stages:

| Stage | Role | Available Models |
|-------|------|-----------------|
| 🧠 **Brain** | Thinks, plans, reasons about what needs to happen | Gemini 2.5 Pro · Claude · GPT-4o · Groq · Ollama |
| ⚙️ **Coder** | Writes the code and applies it to your files | IMI-CORE · Aider · OpenHands · Claude Code |

You pick both independently. The brain figures out the strategy. The coder executes it. That's the whole point.

### 🔧 IMI-CORE Patch Engine

IMI's built-in coder uses a precision search-and-replace patch format — no full file rewrites, just surgical edits:

```json
[
  {
    "file": "src/App.tsx",
    "search": "exact text to find",
    "replace": "new code to put here"
  }
]
```

Fast, safe, and token-efficient. Only the lines that need to change get touched.

---

## Features

### ⚡ Skill Engine — Zero Token Responses

IMI intercepts common requests **before** they ever reach an AI. Matched commands return instantly, saving ~400–600 tokens per hit. Goal: handle 90% of routine requests with zero API calls.

- Pattern-match your most-used commands
- Auto-creates new skills when it detects repeated patterns
- Full skills library with hit counts and token savings stats
- One-click optimization to prune weak/unused skills

### 📋 Plan Mode — Multi-Phase Orchestration

Break complex tasks into phases. Each phase runs sequentially with full AI reasoning at each step:

1. Describe what you want
2. IMI's brain generates a structured execution plan
3. Each phase is handed off to your chosen coder automatically
4. Real-time progress shown in the right panel

Edit any phase before it runs. Skip phases you don't need. Full control over every step.

### 🤖 AI Fleet Support

| Provider | Models | Notes |
|----------|--------|-------|
| **Google Gemini** | gemini-2.5-pro, gemini-2.5-flash | Default brain — free tier available |
| **Anthropic Claude** | claude-sonnet-4-5 | Excellent reasoning & code quality |
| **OpenAI** | gpt-4o | Industry standard |
| **Groq** | llama-3.3-70b | Ultra-fast inference |
| **Ollama** | Any local model | 100% offline, no API key needed |

### 🦙 Ollama — Local AI Hub

Browse, download, and run AI models completely offline:

- Featured model browser (Llama, Mistral, Qwen, DeepSeek, Phi, Gemma, and more)
- Hardware-aware recommendations — checks your GPU VRAM before suggesting models
- Live pull progress with download speed and time remaining
- HuggingFace GGUF model search and direct install
- One-click model management

### 🛠 Dev Hub

- **NPM Browser** — search and install MCP packages directly
- **GitHub Browser** — search repos by stars/forks, preview and clone
- **Installed Tools** — check versions of Node, Git, Python, Docker, and more
- **MCP Server Manager** — add, configure, and connect Model Context Protocol servers

### 🎤 Voice Input

Click the mic, speak your request, Gemini transcribes it automatically. No third-party service needed.

### 🔄 GitHub Auto-Sync

Commit and push your project to GitHub directly from IMI — on a schedule or on demand.

### 📊 Dashboard

Live stats at a glance — CPU, RAM, thread count, file count, project size, token usage, and API quota.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Git](https://git-scm.com/)
- A free [Google Gemini API key](https://aistudio.google.com/app/apikey) to get started (all other providers are optional)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/creepybunny99/IMI-IDE-Unified-Sync.git
cd IMI-IDE-Unified-Sync

# Install dependencies
npm install

# Start in development mode
npm run electron:dev
```

### Add Your API Key

1. Launch IMI
2. Click **System** at the bottom of the sidebar
3. Go to **APIs & KEYS**
4. Paste your Gemini API key and save

That's it — IMI is ready to use.

---

## API Keys

| Provider | Where to Get It | Required? |
|----------|----------------|-----------|
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/app/apikey) | ✅ Recommended (free tier) |
| Anthropic Claude | [console.anthropic.com](https://console.anthropic.com) | Optional |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | Optional |
| Groq | [console.groq.com](https://console.groq.com) | Optional |
| Ollama | None — runs locally | Optional |

---

## Project Structure

```
IMI/
├── electron-main.cjs     # Electron main process — all IPC handlers, AI routing, plan execution
├── src/
│   ├── App.tsx           # Full UI — all tabs, state, and components (React + TypeScript)
│   ├── App.css           # Component styles
│   └── index.css         # Theme variables and global styles
├── package.json
└── vite.config.ts
```

---

## Build for Distribution

```bash
# Build a Windows NSIS installer
npm run dist
```

Output goes to `dist-electron/`.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift + Enter` | New line in message |
| `Ctrl + P` | Toggle Plan Mode |
| `Ctrl + Y` | Toggle YOLO Mode (auto-approve all plan phases) |

---

## Roadmap

- [ ] Code Snippet Manager — save, tag, search, and reuse code snippets
- [ ] Git UI — visual staging, commits, branch management, and PR creation
- [ ] Project Notes & To-Dos — persistent notes per project
- [ ] Dependency Tree Visualizer — graphical package.json explorer
- [ ] Customizable Dashboard Widgets — drag-and-drop status panels
- [ ] More coder integrations (Cursor, Windsurf, Continue)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 31 |
| UI | React 18 + TypeScript |
| Build tool | Vite 5 |
| Animations | Framer Motion |
| Icons | Lucide React |
| Default AI | Google Gemini 2.5 Pro |
| Local AI | Ollama |

---

<div align="center">

Built by [@creepybunny99](https://github.com/creepybunny99) · **IMI v1.0.4** · Windows · Electron

*Designed for the next generation of autonomous engineering.*

</div>
