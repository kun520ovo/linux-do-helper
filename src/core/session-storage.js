export function createSessionStorage(storageArea = globalThis.sessionStorage) {
  return {
    get(key, defaultValue = null) {
      try {
        const value = storageArea.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
      } catch {
        return defaultValue;
      }
    },
    set(key, value) {
      try {
        storageArea.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.error("SessionStorage error:", error);
        return false;
      }
    },
  };
}
