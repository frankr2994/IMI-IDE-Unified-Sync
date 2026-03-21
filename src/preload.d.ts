// This tells TypeScript that the 'window' object has a property 
// called 'electronAPI' with an 'openDirectory' method.

export interface IElectronAPI {
  openDirectory: (path: string) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}