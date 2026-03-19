# Plan: Reorganize "System" Settings into 5 Subcategories

Reorganize the "System" tab into 5 functional subcategories: "System Preferences", "APIs", "Workspace Control", "AI Core Behavior", and "Context & Memory". Each subtab will provide real features and controls without placeholders.

## 1. Proposed Subcategories & Features

### Subcategory 1: System Preferences (Existing & Refined)
*   **Theme Selector**: Selection between "Glass", "Dark", and "Neon" (Existing).
*   **UI Scaling**: Slider to adjust dashboard density (New).
*   **System Sound Toggle**: Toggle for audio feedback (New).
*   **Log Retention (Moved from Global)**: Log retention size (Existing).

### Subcategory 2: APIs (Renamed from Secure Credentials)
*   **Key Management**: All current keys (Gemini, Jules, GitHub, OpenAI, Claude, etc.).
*   **Key Validation Status**: Visual indicator for linked keys (Existing).

### Subcategory 3: Workspace Control (New Subcategory)
*   **Project Root**: Input for setting the working directory (Existing).
*   **Export Hub**: 
    *   **Manual Export**: Button to trigger workspace export (Moved from header).
    *   **Auto-Export**: Toggle for automatic export after snapshots (New).
*   **IDE Integrations**: Link status and setup for VS Code, Cursor, and Zed (New).

### Subcategory 4: AI Core Behavior (New Subcategory)
*   **Engine Defaults**: 
    *   **Default Brain**: Global preference for the planning agent (Gemini/ChatGPT/Claude).
    *   **Default Coder**: Global preference for the implementation agent (Jules/Antigravity).
*   **Recycling Protocol**: Toggle for "Infinite Token" mode via Jules cloud offloading (New).
*   **Stream Speed**: Slider for adjusting response animation speed (New).

### Subcategory 5: Context & Memory (New Subcategory)
*   **Snapshot Management**:
    *   **Frequency**: Frequency of automated snapshots (Existing).
    *   **Snapshot on Sync**: Trigger snapshot whenever a sync operation completes (New).
*   **Quota Protection**: 
    *   **Saturation Threshold**: Slider to set when Quota Organizer should warn about token usage (New).
    *   **Safe Mode Toggle**: Force use of cloud engines when tokens are low (New).
*   **History Purge**: Button to clear all local logs and session history (New).

## 2. Implementation Steps

### Phase 1: State & Configuration
1.  Add state variables for new features:
    *   `uiScaling` (number, default: 100)
    *   `soundEffects` (boolean, default: true)
    *   `streamSpeed` (number, default: 50)
    *   `autoExport` (boolean, default: false)
    *   `snapshotOnSync` (boolean, default: true)
    *   `quotaThreshold` (number, default: 80)
    *   `safeMode` (boolean, default: true)
2.  Update `loadConfig` and `saveConfig` to handle these new parameters.

### Phase 2: UI Reorganization
1.  **Subtab Navigation**: Implement a horizontal navigation bar inside the "System" tab using `settingsActiveSubTab`.
2.  **Conditional Rendering**: Refactor the current "System" tab content to render subcategories conditionally.
3.  **Migration**: Move the existing "Project Workspace", "System Preferences", and "Secure Credentials" into their respective new subtabs.
4.  **New Components**: Add the UI controls for all new features listed above.

### Phase 3: Integration & Testing
1.  **Refactor Exports**: Move the Export Hub button from the header into the Workspace subtab.
2.  **Link Defaults**: Connect the "Engine Defaults" in settings to the initial state of the Dashboard pickers.
3.  **Validation**: Verify that all settings are persistent and that the UI layout is clean and intuitive.

## 3. Key Files & Context
*   `src/App.tsx`: Main file for UI and logic.
*   `electron-main.cjs`: (Reference) For IPC calls like `save-api-config` and `export-workspace`.

## 4. Verification Plan
*   **Functional Test**: Switch between all 5 subtabs and ensure they display correct content.
*   **Persistence Test**: Modify a setting (e.g., UI Scaling), refresh/reload, and ensure it persists.
*   **UI Test**: Ensure no "placeholder" text or non-functional buttons remain.
