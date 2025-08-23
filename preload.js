// Preload script for Electron
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'electronAPI', {
        // Send messages to main process
        send: (channel, data) => {
            // Whitelist channels
            let validChannels = ['toMain', 'check-for-update', 'restart-app'];
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        // Receive messages from main process
        receive: (channel, func) => {
            let validChannels = ['fromMain', 'update-available', 'update-downloaded', 'update-not-available', 'update-error', 'bot-output', 'bot-finished'];
            if (validChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender` 
                ipcRenderer.on(channel, (event, ...args) => func(...args));
            }
        },
        // Invoke methods and get responses
        invoke: (channel, data) => {
            let validChannels = ['dialog:openFile', 'dialog:saveFile', 'force-update-check', 'launch-bot'];
            if (validChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, data);
            }
            return Promise.reject(new Error(`Invalid channel: ${channel}`));
        },
        // Check if app is packaged
        isPackaged: () => {
            return ipcRenderer.invoke('is-packaged');
        },
        // Get resource path
        getResourcePath: (filename) => {
            return ipcRenderer.invoke('get-resource-path', filename);
        }
    }
);

// Log that preload script has loaded
console.log('Preload script loaded successfully');
