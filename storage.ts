export const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error(`Error reading from localStorage: ${key}`, e);
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error(`Error writing to localStorage: ${key}`, e);
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error(`Error removing from localStorage: ${key}`, e);
    }
  }
};
