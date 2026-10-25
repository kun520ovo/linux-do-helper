const resolveStorageArea = (storageArea) => {
  if (storageArea) return storageArea;
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch (_) {}
  return void 0;
};

const createStorage = (storageArea) => {
  const area = resolveStorageArea(storageArea);
  return {
    get: (key, defaultValue = null) => {
      try {
        const value = area?.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
      } catch (_) {
        return defaultValue;
      }
    },
    set: (key, value) => {
      try {
        if (!area?.setItem) return false;
        area.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.error("Storage error:", error);
        return false;
      }
    },
    remove: (key) => {
      try {
        if (!area?.removeItem) return false;
        area.removeItem(key);
        return true;
      } catch (error) {
        console.error("Storage error:", error);
        return false;
      }
    },
    raw: area,
  };
};

const Storage = createStorage();

export { resolveStorageArea, createStorage, Storage };
