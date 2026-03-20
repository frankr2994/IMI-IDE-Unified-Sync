const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises; // For async file operations
const Store = require('electron-store'); // For persistence

const store = new Store();

// Project Root: C:\Users\nikol\Desktop\IMI
// This value is provided in the prompt and should be the absolute path to the project.
const PROJECT_ROOT = 'C:\Users\nikol\Desktop\IMI';

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Assuming a preload script exists
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Load your React app
    // In a Vite setup, this usually points to the dev server or the built index.html
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173'); // Default Vite dev server port
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html')); // Assuming build output in ../dist
    }

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// --- IPC Handlers for AI Context Paths --- //

/**
 * Handles requests from the renderer process to get stored AI context paths.
 * @returns {string[]} An array of file paths configured for AI context.
 */
ipcMain.handle('get-ai-context-paths', async () => {
    // Returns an array, or an empty array if no paths are stored yet
    return store.get('aiContextPaths', []); 
});

/**
 * Handles requests from the renderer process to save AI context paths.
 * @param {Electron.IpcMainInvokeEvent} event - The event object.
 * @param {string[]} paths - An array of file paths to save.
 * @returns {{ success: boolean, error?: string }} - Result of the save operation.
 */
ipcMain.handle('save-ai-context-paths', async (event, paths) => {
    if (Array.isArray(paths)) {
        store.set('aiContextPaths', paths);
        return { success: true };
    }
    return { success: false, error: 'Invalid paths array provided.' };
});

// --- AI Prompt Generation and Context Injection Logic --- //

/**
 * Handles requests from the renderer process to send a message to the Brain AI.
 * This function constructs the full AI prompt by injecting global project memory
 * and content from user-defined context files.
 * @param {Electron.IpcMainInvokeEvent} event - The event object.
 * @param {string} userRequest - The user's current request/message.
 * @returns {Promise<{ response: string, fullPrompt: string }>} - A mock AI response and the full prompt sent.
 */
ipcMain.handle('send-ai-request', async (event, userRequest) => {
    console.log('Received AI request:', userRequest);

    // 1. Retrieve Project Memory (placeholder for existing global context)
    // Assuming 'projectMemory' is stored in electron-store or retrieved from another source.
    const projectMemory = store.get('projectMemory', 'No global project memory available. This is a placeholder for project-wide information.'); 

    // 2. Retrieve AI Context Paths configured by the user
    const aiContextPaths = store.get('aiContextPaths', []);
    let additionalContext = '';

    // 3. Read & Append content from each specified context file
    for (const filePath of aiContextPaths) {
        // Resolve absolute path: if filePath is already absolute, use it; otherwise, join with PROJECT_ROOT
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
        try {
            // Check if file exists and is accessible before reading
            await fs.access(absolutePath, fs.constants.F_OK);
            const content = await fs.readFile(absolutePath, 'utf8');
            additionalContext += `\n--- START ADDITIONAL CONTEXT FILE: ${filePath} ---\n`;
            additionalContext += content;
            additionalContext += `\n--- END ADDITIONAL CONTEXT FILE: ${filePath} ---\n`;
        } catch (error) {
            console.warn(`IMI Brain: Could not read AI context file "${filePath}" (absolute: "${absolutePath}"):`, error.message);
            // Add a warning to the prompt if a file could not be read
            additionalContext += `\n--- WARNING: Could not read AI context file "${filePath}". Error: ${error.message} ---\n`;
        }
    }

    // 4. Construct the Final AI Prompt by combining all context and the user's request
    let finalPrompt = `
You are the Brain inside IMI, a precision surgical coding agent. Your goal is to provide highly accurate, context-aware, and actionable coding instructions and insights to the user.

--- GLOBAL PROJECT MEMORY ---
${projectMemory}
--- END GLOBAL PROJECT MEMORY ---

${additionalContext}

--- USER'S CURRENT REQUEST ---
${userRequest}
--- END USER'S CURRENT REQUEST ---

Based on all the provided context, generate a precise and helpful response.
`;

    console.log('\n--- FINAL AI PROMPT SENT TO BRAIN ---');
    console.log(finalPrompt);
    console.log('-------------------------------------\n');

    // In a real application, you would send `finalPrompt` to your AI model (e.g., OpenAI API)
    // and return its actual response. For this exercise, we'll return a mock response.
    return {
        response: `Brain AI processed your request with enhanced context.\n\nProject Memory snippet: ${projectMemory.substring(0, Math.min(projectMemory.length, 100))}...\nAdditional Context Files processed: ${aiContextPaths.length} file(s).\nYour request: "${userRequest}"\n\n(This is a mock response from the Brain AI demonstrating context injection. The full prompt was logged to the console.)`,
        fullPrompt: finalPrompt // Include full prompt for debugging in the UI
    };
});
