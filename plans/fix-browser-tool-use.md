# Plan: Fix Browser Tool-Use & Intent Recognition

## Objective
Improve Gemini's ability to open the browser by broadening intent recognition and adding a fallback mechanism to resolve mentioned site names into URLs.

## Key Files & Context
- `electron-main.cjs`: Contains the IPC handler `execute-command-stream`, the intent classification logic, and the "auto-open" URL extraction.

## Implementation Steps

### 1. Broaden Browser Intent Recognition
Update the `isSimpleOpen` and `needsAutomation` regexes in `electron-main.cjs` to include terms like "see", "sight", "look at", and "view" in the context of browser requests.

### 2. Enhance URL Extraction & Resolution
Modify the post-response logic in `res.on('end')` within `execute-command-stream`:
- If no raw URL is found in the AI response but the request was browser-related.
- Scan for proper nouns or site-like names (e.g., "Google Finance").
- Use the existing `ddgResolveUrl` function to attempt to resolve these names to actual URLs.

### 3. Update Brain Prompt
Add a rule to `chatPrefix` in `electron-main.cjs`:
- "When mentioning websites or web tools, ALWAYS include the raw URL in parentheses (e.g., Google Finance (https://google.com/finance)) so the system can open it for the user."

### 4. Improve `isSimpleOpen` logic
- Add "see", "sight", "view" to the triggers.
- Ensure "let me see it" triggers the browser routing.

## Verification & Testing
- **Test Case 1**: Ask "whast the best sight for usa stock market and let me see it on the browser" and verify it opens Google Finance (or similar).
- **Test Case 2**: Ask "open netflix" (existing functionality) to ensure no regressions.
- **Test Case 3**: Ask "look at yahoo finance" and verify it resolves the name and opens the browser.
