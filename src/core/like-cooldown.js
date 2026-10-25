import { resolveStorageArea } from "./storage.js";

const createLikeCooldown = ({ storageArea, key = "likeResumeTime" } = {}) => {
  const area = resolveStorageArea(storageArea);
  return {
    load() {
      try {
        if (!area?.getItem) throw new Error("Storage unavailable");
        const raw = area?.getItem(key);
        const stored = raw ? JSON.parse(raw) : null;
        const state = { accounts: {}, legacyUntil: 0 };
        const validUntil = (value) => {
          const until = Number(value ?? 0);
          if (!Number.isFinite(until) || until < 0) {
            throw new Error("Invalid like cooldown timestamp");
          }
          return until;
        };
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          state.legacyUntil = validUntil(stored.legacyUntil);
          if (stored.accounts != null) {
            if (typeof stored.accounts !== "object" || Array.isArray(stored.accounts)) {
              throw new Error("Invalid like cooldown accounts");
            }
            for (const [accountKey, until] of Object.entries(stored.accounts)) {
              if (/^(id|username):/.test(accountKey)) {
                state.accounts[accountKey] = validUntil(until);
              }
            }
          }
        } else if (stored === null || typeof stored === "number") {
          state.legacyUntil = validUntil(stored);
        } else {
          throw new Error("Invalid like cooldown state");
        }
        return state;
      } catch (error) {
        console.error("[点赞冷却] 存储不可读，暂停点赞:", error);
        return null;
      }
    },
    read(accountKey) {
      const state = this.load();
      if (!state) return Infinity;
      return Math.max(state.legacyUntil, accountKey ? Number(state.accounts[accountKey]) || 0 : 0);
    },
    extend(accountKey, until) {
      const state = this.load();
      if (!state) return Infinity;
      const nextUntil = Number(until);
      if (!Number.isFinite(nextUntil) || nextUntil < 0) return Infinity;
      if (nextUntil > 0) {
        if (accountKey) {
          state.accounts[accountKey] = Math.max(Number(state.accounts[accountKey]) || 0, nextUntil);
        } else {
          state.legacyUntil = Math.max(state.legacyUntil, nextUntil);
        }
      }
      try {
        if (!area?.setItem) return Infinity;
        area.setItem(key, JSON.stringify(state));
      } catch (error) {
        console.error("[点赞冷却] 存储不可写，暂停点赞:", error);
        return Infinity;
      }
      return Math.max(state.legacyUntil, accountKey ? Number(state.accounts[accountKey]) || 0 : 0);
    },
    clear(accountKeys) {
      const state = this.load();
      if (!state) return false;
      try {
        state.legacyUntil = 0;
        const keys = Array.isArray(accountKeys) ? accountKeys : [accountKeys];
        for (const accountKey of keys) {
          if (/^(id|username):/.test(String(accountKey || ""))) {
            delete state.accounts[accountKey];
          }
        }
        if (!area?.setItem) return false;
        area.setItem(key, JSON.stringify(state));
        return true;
      } catch (error) {
        console.error("[点赞冷却] 清除失败:", error);
        return false;
      }
    },
    key,
    raw: area,
  };
};

const LikeCooldown = createLikeCooldown();

export { createLikeCooldown, LikeCooldown };
