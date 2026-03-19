# Plan: Systems Tab Overhaul

Overhaul the "Systems" tab in `src/App.tsx` into 5 functional subcategories: **SYSTEM PREFERENCES**, **APIs**, **GITHUB**, **TELEMETRY**, and **AUTOMATION**.

## 1. State & Configuration Changes (src/App.tsx)

### New State Variables
Add the following state variables to the `App` component:
*   `uiScaling` (number, default: 100)
*   `soundEffects` (boolean, default: true)
*   `autoExport` (boolean, default: false)
*   `snapshotOnSync` (boolean, default: true)
*   *   `telemetryEnabled` (boolean, default: true)
*   `errorReporting` (boolean, default: true)
*   `usageStats` (boolean, default: true)
*   `githubRepo` (string, default: '')
*   `githubBranch` (string, default: 'main')

### Persistence Logic
*   **Update `loadConfig`**: Ensure all new state variables are loaded from the stored configuration.
*   **Update `saveConfig`**: Ensure all new state variables are included in the object sent to `save-api-config`.

## 2. UI Implementation (src/App.tsx)

### Sub-Navigation
*   Implement a horizontal navigation menu within the "System" tab.
*   The options will be: `SYSTEM PREFERENCES`, `APIs`, `GITHUB`, `TELEMETRY`, and `AUTOMATION`.
*   Use `settingsActiveSubTab` to manage the active selection.

### Subcategory 1: SYSTEM PREFERENCES
*   **PROJECT WORKSPACE**: (Existing) Project root input.
*   **THEME SELECTOR**: (Existing) Buttons for Glass, Dark, Neon.
*   **UI SCALING**: (New) Slider control from 80% to 120%.
*   **SYSTEM SOUND**: (New) Toggle for audio feedback.
*   **LOG RETENTION**: (Existing) Slider for log count.

### Subcategory 2: APIs
*   **SECURE CREDENTIALS**: (Existing) Filterable list of all API keys (Gemini, Jules, OpenAI, Claude, etc.), **excluding GitHub**.

### Subcategory 3: GITHUB
*   **GITHUB ACCESS**: (Existing) GitHub Personal Access Token (PAT) input.
*   **REPOSITORY SETTINGS**: (New) Input for "Repository Path" (e.g., owner/repo).
*   **BRANCH SETTINGS**: (New) Input for "Default Branch" (e.g., main, master).

### Subcategory 4: TELEMETRY
*   **DATA COLLECTION**: (New) Toggle for "Enable Telemetry".
*   **DIAGNOSTICS**: (New) Toggle for "Automatic Error Reporting".
*   **USAGE ANALYTICS**: (New) Toggle for "Anonymous Usage Statistics".

### Subcategory 5: AUTOMATION
*   **WORKFLOWS**:
    *   **Auto-Export**: (New) Toggle for automatic workspace export after snapshots.
    *   **Snapshot on Sync**: (New) Toggle for triggering snapshots after sync operations.
*   **MAINTENANCE**:
    *   **Snapshot Frequency**: (Existing) Slider for frequency.

## 3. Implementation Steps

1.  **Initialize State**: Add the new state variables to `src/App.tsx`.
2.  **Update Config IPC**: Modify `loadConfig` and `saveConfig`.
3.  **Refactor UI**:
    *   Update the `settings` tab rendering logic to include the sub-nav.
    *   Create a conditional rendering block for each of the 5 subtabs.
    *   Port existing controls into their respective sections.
    *   Add new controls (Sliders/Toggles/Inputs) for the new features.
4.  **Style Refinement**: Ensure the new controls match the existing "glass-card" and premium UI aesthetic.

## 4. Verification Plan
*   **Functional Test**: Navigate through all 5 subtabs and verify all controls are present and reactive.
*   **Persistence Test**: Modify a setting in each category, save, and reload the application to ensure values are retained.
*   **Visual Test**: Ensure the layout is responsive and consistent across different subtabs.
