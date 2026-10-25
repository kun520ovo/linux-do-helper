import { CURRENT_DOMAIN, BASE_URL, isHeartToggleUrl } from "../core/runtime-context.js";

import { Storage } from "../core/storage.js";
import { LikeCooldown } from "../core/like-cooldown.js";
import { Utils } from "../core/utils.js";
import { RequestManager } from "../core/request-manager.js";
import { networkInterceptor } from "../core/network-interceptor.js";
import { DisposableScope } from "../core/disposable-scope.js";

class LikeCounter {
  constructor({ autoStart = true } = {}) {
    this.scope = new DisposableScope();
    this.CONFIG = {
      STORAGE_KEY: `linuxdo_likes_counter_${CURRENT_DOMAIN}`,
      SYNC_INTERVAL: 30 * 60 * 1e3,
      MAX_STORED_ITEMS: 500,
      LIMITS: { 0: 50, 1: 50, 2: 75, 3: 100, 4: 150 },
    };
    this.state = {
      timestamps: [],
      cooldownUntil: 0,
      lastSync: 0,
      matched: true,
      userTrustLevel: null,
    };
    this.currentUser = null;
    this.accountKey = null;
    this.accountGeneration = 0;
    this.uiUpdateCallbacks = [];
    this.syncTimer = null;
    this.loadState();
    if (autoStart) this.start();
  }
  start() {
    if (this.started || this.scope.disposed) return;
    this.started = true;
    this.installInterceptors();
    this.startPeriodicSync();
  }
  destroy() {
    this.accountGeneration++;
    this._likeInterceptorUnsubscribe?.();
    this.scope.dispose();
    this.uiUpdateCallbacks = [];
  }
  getAccountKey(user) {
    const id = Number(user?.id ?? user?.user_id);
    if (Number.isSafeInteger(id) && id > 0) return `id:${id}`;
    const username = String(user?.username || "")
      .trim()
      .replace(/^@/, "")
      .trim()
      .toLowerCase();
    return username ? `username:${username}` : null;
  }
  getAccountStorageKey() {
    return this.accountKey ? `${this.CONFIG.STORAGE_KEY}_${encodeURIComponent(this.accountKey)}` : null;
  }
  createEmptyState() {
    return { timestamps: [], cooldownUntil: 0, lastSync: 0, matched: false, userTrustLevel: null };
  }
  loadState() {
    this.state = this.createEmptyState();
    const storageKey = this.getAccountStorageKey();
    if (!storageKey) return;
    try {
      const stored = GM_getValue(storageKey, "{}");
      const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
      this.state.timestamps = Array.isArray(parsed?.timestamps)
        ? parsed.timestamps
            .filter((ts) => Number.isFinite(ts) && ts > 0)
            .slice(0, this.CONFIG.MAX_STORED_ITEMS)
        : [];
      this.state.lastSync = Number(parsed?.lastSync) || 0;
      this.state.matched = parsed?.matched === true;
      this.state.userTrustLevel = parsed?.userTrustLevel ?? null;
    } catch (e) {
      console.error("[LikeCounter] 加载状态失败:", e);
    }
    this.cleanOldEntries();
  }
  saveState() {
    const storageKey = this.getAccountStorageKey();
    if (!storageKey) return false;
    try {
      const { timestamps, lastSync, matched, userTrustLevel } = this.state;
      GM_setValue(storageKey, JSON.stringify({ timestamps, lastSync, matched, userTrustLevel }));
      return true;
    } catch (e) {
      console.error("[LikeCounter] 保存状态失败:", e);
      return false;
    }
  }
  cleanOldEntries() {
    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1e3;
    this.state.cooldownUntil = this.accountKey ? LikeCooldown.read(this.accountKey) : 0;
    this.state.timestamps = this.state.timestamps.filter((ts) => ts > cutoff);
    this.state.timestamps.sort((a, b) => b - a);
    if (this.state.cooldownUntil > 0 && this.state.cooldownUntil < now) {
      const expectedBase = this.state.cooldownUntil - 24 * 60 * 60 * 1e3;
      const beforeCount = this.state.timestamps.length;
      this.state.timestamps = this.state.timestamps.filter(
        (ts) => ts < expectedBase || ts >= expectedBase + 5e3,
      );
      if (this.state.timestamps.length < beforeCount) {
        this.checkAndUpdateMismatch();
      }
      this.state.cooldownUntil = 0;
    }
  }
  checkAndUpdateMismatch() {
    const limit = this.getDailyLimit();
    const count = this.state.timestamps.length;
    this.state.matched =
      count >= limit || this.state.lastSync === 0 || (this.state.lastSync > 0 && count === 0);
  }
  getDailyLimit() {
    if (this.currentUser && this.CONFIG.LIMITS[this.currentUser.trust_level] !== void 0) {
      return this.CONFIG.LIMITS[this.currentUser.trust_level];
    }
    if (this.state.userTrustLevel !== null && this.CONFIG.LIMITS[this.state.userTrustLevel] !== void 0) {
      return this.CONFIG.LIMITS[this.state.userTrustLevel];
    }
    try {
      const username = this.currentUser?.username;
      if (username) {
        const cacheKey = `trustLevelCache_${CURRENT_DOMAIN}_${username}`;
        const cachedData = Storage.get(cacheKey, null);
        if (cachedData?.currentLevel !== void 0) {
          const level = parseInt(cachedData.currentLevel);
          if (this.CONFIG.LIMITS[level] !== void 0) {
            return this.CONFIG.LIMITS[level];
          }
        }
      }
    } catch (e) {}
    return 50;
  }
  getRemainingLikes() {
    this.cleanOldEntries();
    const limit = this.getDailyLimit();
    const used = this.state.timestamps.length;
    return Math.max(0, limit - used);
  }
  getUsedLikes() {
    this.cleanOldEntries();
    return this.state.timestamps.length;
  }
  isInCooldown() {
    return this.state.cooldownUntil > Date.now();
  }
  getCooldownRemaining() {
    if (!this.isInCooldown()) return 0;
    return Math.max(0, this.state.cooldownUntil - Date.now());
  }
  formatCooldown() {
    const diff = this.getCooldownRemaining();
    if (!Number.isFinite(diff)) return "暂不可用";
    if (diff <= 0) return null;
    const h = Math.floor(diff / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4);
    const s = Math.floor((diff % 6e4) / 1e3);
    if (h > 0) {
      return `${h}小时${String(m).padStart(2, "0")}分${String(s).padStart(2, "0")}秒`;
    }
    return `${String(m).padStart(2, "0")}分${String(s).padStart(2, "0")}秒`;
  }
  processToggleResponse(
    url,
    data,
    method = "PUT",
    accountKey = this.accountKey,
    accountGeneration = this.accountGeneration,
    status = 0,
  ) {
    if (
      !isHeartToggleUrl(url, method) ||
      !accountKey ||
      accountKey !== this.accountKey ||
      accountGeneration !== this.accountGeneration
    )
      return;
    this.loadState();
    const now = Date.now();
    const succeeded = status >= 200 && status < 300;
    const hasReaction = data != null && Object.prototype.hasOwnProperty.call(data, "current_user_reaction");
    if (!succeeded && (status === 429 || data?.error_type === "rate_limit")) {
      const waitSeconds = data?.extras?.wait_seconds || 0;
      if (waitSeconds > 0) {
        const cooldownUntil = now + waitSeconds * 1e3;
        this.state.cooldownUntil = LikeCooldown.extend(accountKey, cooldownUntil);
        console.log(`[LikeCounter] 触发限流，冷却 ${waitSeconds} 秒`);
      }
      const limit = this.getDailyLimit();
      const currentCount = this.state.timestamps.length;
      this.state.matched = currentCount >= limit;
      if (currentCount < limit && waitSeconds > 0) {
        const needed = limit - currentCount;
        const placeholderBaseTime = now + waitSeconds * 1e3 - 24 * 60 * 60 * 1e3;
        const safeNeeded = Math.min(needed, 200);
        for (let i = 0; i < safeNeeded; i++) {
          this.state.timestamps.push(placeholderBaseTime + i);
        }
        this.state.timestamps.sort((a, b) => b - a);
      }
    } else if (succeeded && (!hasReaction || !!data.current_user_reaction)) {
      this.state.timestamps.push(now);
      console.log(`[LikeCounter] 记录点赞，当前已用 ${this.state.timestamps.length}/${this.getDailyLimit()}`);
    } else {
      console.log("[LikeCounter] 请求失败或心形反应未激活，忽略本次响应");
    }
    this.saveState();
    this.notifyUIUpdate();
  }
  installInterceptors() {
    const self = this;
    this._likeInterceptorUnsubscribe?.();
    this._likeInterceptorUnsubscribe = networkInterceptor.register({
      beforeRequest(request) {
        if (!isHeartToggleUrl(request.url, request.method)) return null;
        return {
          accountKey: self.accountKey,
          accountGeneration: self.accountGeneration,
        };
      },
      async afterResponse({ request, response, context }) {
        if (!context || !isHeartToggleUrl(request.url, request.method)) return;
        try {
          let data = null;
          if (request.transport === "fetch") {
            try {
              data = await response.clone().json();
            } catch (_) {}
          } else {
            try {
              data = response.responseType === "json" ? response.response : JSON.parse(response.responseText);
            } catch (_) {}
          }
          self.processToggleResponse(
            request.url,
            data,
            request.method,
            context.accountKey,
            context.accountGeneration,
            response.status,
          );
        } catch (_) {}
      },
    });
    console.log("[LikeCounter] 拦截器已安装");
  }
  async syncRemote(force = false) {
    if (!this.accountKey) {
      const discoveryGeneration = this.accountGeneration;
      let user = null;
      try {
        const currentUser =
          window.Discourse?.User?.current?.() || window.Discourse?.currentUser || window.User?.current?.();
        if (this.getAccountKey(currentUser)) user = currentUser;
      } catch (e) {}
      if (!user) {
        try {
          const preloadData = document.getElementById("data-preloaded");
          if (preloadData) {
            const data = JSON.parse(preloadData.dataset.preloaded);
            if (data?.currentUser) {
              const cu =
                typeof data.currentUser === "string" ? JSON.parse(data.currentUser) : data.currentUser;
              if (this.getAccountKey(cu)) user = cu;
            }
          }
        } catch (e) {}
      }
      if (!user) {
        const session429Until = Storage.get("session429Until", 0);
        if (session429Until > Date.now()) {
          const remainMinutes = Math.ceil((session429Until - Date.now()) / 6e4);
          console.log(`[LikeCounter] session/current 429 冷却期中，剩余 ${remainMinutes} 分钟，跳过同步`);
          return;
        }
        try {
          const response = await fetch(`${BASE_URL}/session/current.json`);
          if (response.status === 429) {
            console.warn("[LikeCounter] session/current 遇到 429，设置 30 分钟冷却");
            Storage.set("session429Until", Date.now() + 30 * 60 * 1e3);
            return;
          }
          if (response.ok) {
            const data = await response.json();
            if (this.getAccountKey(data.current_user)) user = data.current_user;
          }
        } catch (e) {
          console.error("[LikeCounter] 获取用户信息失败:", e);
        }
      }
      if (discoveryGeneration !== this.accountGeneration || !user) return;
      this.setCurrentUser(user);
    }
    const accountKey = this.accountKey;
    const accountGeneration = this.accountGeneration;
    const username = this.currentUser?.username;
    if (!accountKey || !username) return;
    this.loadState();
    if (!force) {
      const timeSinceLastSync = Date.now() - (this.state.lastSync || 0);
      const minSyncInterval = 30 * 60 * 1e3;
      if (timeSinceLastSync < minSyncInterval) {
        const remainMinutes = Math.ceil((minSyncInterval - timeSinceLastSync) / 6e4);
        console.log(
          `[LikeCounter] 距离上次同步仅 ${Math.floor(timeSinceLastSync / 6e4)} 分钟，跳过本次同步（剩余 ${remainMinutes} 分钟）`,
        );
        this.notifyUIUpdate();
        return;
      }
    }
    console.log(`[LikeCounter] 开始同步用户 ${username} 的点赞数据...`);
    try {
      const limit = this.getDailyLimit();
      const cutoffTime = Date.now() - 24 * 60 * 60 * 1e3;
      console.log(`[LikeCounter] 只读取 API 点赞历史，窗口起点: ${new Date(cutoffTime).toLocaleString()}`);
      const reactions = await this.fetchUserActions(username, cutoffTime, accountKey, accountGeneration);
      if (accountKey !== this.accountKey || accountGeneration !== this.accountGeneration) return;
      const postMap = /* @__PURE__ */ new Map();
      for (const item of reactions) {
        if (!postMap.has(item.post_id) || postMap.get(item.post_id) < item.timestamp) {
          postMap.set(item.post_id, item.timestamp);
        }
      }
      const dedupedTimestamps = Array.from(postMap.values());
      console.log(`[LikeCounter] 用户信任等级: ${this.currentUser?.trust_level}, 限额: ${limit}`);
      console.log(
        `[LikeCounter] 从 API 获取到 ${reactions.length} 条反应记录，去重后 ${dedupedTimestamps.length} 个不同帖子`,
      );
      this.state.cooldownUntil = LikeCooldown.read(accountKey);
      this.state.timestamps = dedupedTimestamps;
      this.state.lastSync = Date.now();
      this.state.matched = true;
      this.cleanOldEntries();
      if (this.state.timestamps.length >= limit) {
        const oldestTs = Math.min(...this.state.timestamps);
        const estimatedCooldown = oldestTs + 24 * 60 * 60 * 1e3;
        if (estimatedCooldown > Date.now() && estimatedCooldown > this.state.cooldownUntil) {
          this.state.cooldownUntil = LikeCooldown.extend(accountKey, estimatedCooldown);
          console.log(
            `[LikeCounter] API 数据达到限额，估算冷却时间: ${new Date(estimatedCooldown).toLocaleString()}`,
          );
        }
      }
      if (this.currentUser?.trust_level !== void 0) {
        this.state.userTrustLevel = this.currentUser.trust_level;
      }
      this.saveState();
      this.notifyUIUpdate();
      console.log(`[LikeCounter] 同步完成，已用 ${this.state.timestamps.length}/${limit}`);
    } catch (e) {
      console.error("[LikeCounter] 同步失败:", e);
    }
  }
  async fetchUserActions(
    username,
    cutoffTime,
    accountKey = this.accountKey,
    accountGeneration = this.accountGeneration,
  ) {
    const allItems = [];
    const cutoff = cutoffTime || Date.now() - 24 * 60 * 60 * 1e3;
    let offset = 0;
    let pages = 0;
    console.log(
      `[LikeCounter] 开始获取 ${username} 的点赞历史，窗口起点: ${new Date(cutoff).toLocaleString()}`,
    );
    while (pages < 5) {
      if (accountKey !== this.accountKey || accountGeneration !== this.accountGeneration) break;
      try {
        const url = `${BASE_URL}/user_actions.json?limit=50&username=${username}&filter=1&offset=${offset}`;
        const response = await RequestManager.run(
          `user-actions-${CURRENT_DOMAIN}-${username}`,
          async () => {
            const r = await fetch(url, { credentials: "include" });
            if (r.status === 429) throw new Error("429 user_actions");
            return r;
          },
          {
            minInterval: 1500,
            retries: 1,
            backoffBase: 1200,
            cooldownKey: `userActions429Until_${CURRENT_DOMAIN}_${username}`,
            cooldownMs: 20 * 60 * 1e3,
          },
        );
        if (!response || accountKey !== this.accountKey || accountGeneration !== this.accountGeneration)
          break;
        const res = await response.json();
        if (accountKey !== this.accountKey || accountGeneration !== this.accountGeneration) break;
        const items = res.user_actions || [];
        if (!items.length) {
          console.log(`[LikeCounter] 没有更多数据，结束获取`);
          break;
        }
        let hasOld = false;
        for (const item of items) {
          const t = new Date(item.created_at).getTime();
          if (t > cutoff) {
            allItems.push({ post_id: item.post_id, timestamp: t });
          } else {
            hasOld = true;
          }
        }
        if (hasOld || items.length < 50) {
          console.log(`[LikeCounter] ${hasOld ? "遇到窗口外的旧数据" : "数据不足50条"}，结束获取`);
          break;
        }
        offset += 50;
        pages++;
        await Utils.sleep(Utils.random(350, 900));
      } catch (e) {
        console.error(`[LikeCounter] 获取点赞历史出错:`, e);
        break;
      }
    }
    console.log(`[LikeCounter] 点赞历史获取完成，共 ${allItems.length} 条`);
    return allItems;
  }
  startPeriodicSync() {
    this.scope.setTimeout(() => this.syncRemote(), 3e3);
    this.syncTimer = this.scope.setInterval(() => {
      this.syncRemote();
    }, this.CONFIG.SYNC_INTERVAL);
  }
  setCurrentUser(user) {
    const accountKey = this.getAccountKey(user);
    this.currentUser = accountKey
      ? {
          ...user,
          username: String(user?.username || "")
            .trim()
            .replace(/^@/, "")
            .trim(),
        }
      : null;
    if (accountKey !== this.accountKey) {
      this.accountKey = accountKey;
      this.accountGeneration++;
      this.loadState();
    }
    this.notifyUIUpdate();
  }
  onUIUpdate(callback) {
    this.uiUpdateCallbacks.push(callback);
    return () => {
      this.uiUpdateCallbacks = this.uiUpdateCallbacks.filter((item) => item !== callback);
    };
  }
  notifyUIUpdate() {
    for (const callback of this.uiUpdateCallbacks) {
      try {
        callback(this.getStatus());
      } catch (e) {
        console.error("[LikeCounter] UI更新回调错误:", e);
      }
    }
  }
  getStatus() {
    this.cleanOldEntries();
    return {
      remaining: this.getRemainingLikes(),
      used: this.getUsedLikes(),
      limit: this.getDailyLimit(),
      isInCooldown: this.isInCooldown(),
      cooldownRemaining: this.getCooldownRemaining(),
      cooldownFormatted: this.formatCooldown(),
      cooldownUntil: this.state.cooldownUntil,
      matched: this.state.matched,
      lastSync: this.state.lastSync,
    };
  }
  manualSync() {
    return this.syncRemote(true);
  }
}

export { LikeCounter };
