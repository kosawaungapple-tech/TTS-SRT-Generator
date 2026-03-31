/**
 * Safe Browser Utilities
 * Wraps browser APIs that might throw "The operation is insecure" in restricted environments (like iframes).
 */

export const safeStorage = {
  getItem: (key: string) => {
    try {
      return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      if (typeof window !== 'undefined') localStorage.setItem(key, value);
    } catch (e) {
      // Ignore
    }
  },
  removeItem: (key: string) => {
    try {
      if (typeof window !== 'undefined') localStorage.removeItem(key);
    } catch (e) {
      // Ignore
    }
  },
  clear: () => {
    try {
      if (typeof window !== 'undefined') localStorage.clear();
    } catch (e) {
      // Ignore
    }
  }
};

export const safeSessionStorage = {
  getItem: (key: string) => {
    try {
      return typeof window !== 'undefined' ? sessionStorage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      if (typeof window !== 'undefined') sessionStorage.setItem(key, value);
    } catch (e) {
      // Ignore
    }
  },
  removeItem: (key: string) => {
    try {
      if (typeof window !== 'undefined') sessionStorage.removeItem(key);
    } catch (e) {
      // Ignore
    }
  },
  clear: () => {
    try {
      if (typeof window !== 'undefined') sessionStorage.clear();
    } catch (e) {
      // Ignore
    }
  }
};

export const safeHistory = {
  pushState: (data: any, title: string, url: string) => {
    try {
      if (typeof window !== 'undefined' && window.history) {
        window.history.pushState(data, title, url);
      }
    } catch (e) {
      console.warn('History pushState failed:', e);
    }
  },
  replaceState: (data: any, title: string, url: string) => {
    try {
      if (typeof window !== 'undefined' && window.history) {
        window.history.replaceState(data, title, url);
      }
    } catch (e) {
      console.warn('History replaceState failed:', e);
    }
  }
};

export const safeLocation = {
  reload: () => {
    try {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (e) {
      console.warn('Location reload failed:', e);
    }
  }
};

export const safeClipboard = {
  writeText: async (text: string): Promise<boolean> => {
    if (!text) return false;
    
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('Clipboard API failed, using fallback:', err);
    }

    // Fallback
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // Ensure it's not visible but still in DOM
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (fallbackErr) {
      console.error('Fallback copy failed:', fallbackErr);
      return false;
    }
  },
  
  readText: async (): Promise<string | null> => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return await navigator.clipboard.readText();
      }
    } catch (err) {
      console.warn('Clipboard read API failed:', err);
    }
    return null;
  }
};
