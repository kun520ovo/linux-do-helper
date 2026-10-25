import { CURRENT_DOMAIN, BASE_URL, isHeartToggleUrl } from "../core/runtime-context.js";
import { CONFIG } from "../core/config.js";
import { Storage } from "../core/storage.js";
import { LikeCooldown } from "../core/like-cooldown.js";
import { Utils } from "../core/utils.js";
import { DisposableScope } from "../core/disposable-scope.js";

export class SmartLikes {
  constructor({
    settings,
    session,
    limits,
    counter,
    getReadingState,
    onEnabledChange,
    onAccountChanged,
    notify,
    t,
    sleep = Utils.sleep,
  }) {
    this.settings = settings;
    this.session = session;
    this.limits = limits;
    this.counter = counter;
    this.getReadingState = getReadingState;
    this.onEnabledChange = onEnabledChange;
    this.onAccountChanged = onAccountChanged;
    this.notify = notify;
    this.t = t;
    this.sleep = sleep;
    this.scope = new DisposableScope();
    this.currentAccount = null;
    this.currentUsername = null;
    this.smartLikeSessionId =
      session.get("smartLikeSessionId", null) ||
      (globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : Date.now() + "-" + Math.random().toString(36).slice(2));
    this.smartLikeGeneration = 0;
    this.smartLikeCheckedPostIds = {};
    this.smartLikeFailedPostIds = new Set();
    this.smartLikedPostIds = new Map();
    this.smartLikeStorageReady = true;
    this.smartLikeActiveTask = null;
    this.smartLikeRunToken = 0;
    this.smartLikeIsScanning = false;
    this.smartLikeLastScanAt = 0;
    const lastLikeAt = Number(session.get("smartLikeLastLikeAt", 0));
    this.smartLikeLastLikeAt = Number.isFinite(lastLikeAt) && lastLikeAt > 0 ? lastLikeAt : 0;
    this.smartLikeAccountKey = null;
  }

  start() {
    if (this.smartLikeReady || this.scope.disposed) return;
    this.smartLikeReady = this.initializeSmartLikeTab();
    this.bindSmartLikeScroll();
    this.smartLikeReady.then(() => {
      if (!this.scope.disposed) this.resolveSmartLikeAccount();
    });
  }

  pauseForRateLimit() {
    this.settings.smartLikeEnabled = false;
    Storage.set("smartLikeEnabled", false);
    if (this.smartLikeActiveTask) this.smartLikeActiveTask.pendingReleased = true;
    this.cancelSmartLikeTasks("rate_limited");
    this.persistSmartLikeSession();
    this.updateSmartLikeUI();
  }

  destroy() {
    this.cancelSmartLikeTasks("destroyed");
    this.scope.dispose();
  }

  async initializeSmartLikeTab() {
    try {
      let tab = {};
      if (typeof GM_getTab === "function") {
        tab = await new Promise((resolve) => {
          const timeout = this.scope.setTimeout(() => resolve({}), 3e3);
          try {
            GM_getTab((value) => {
              this.scope.clearTimeout(timeout);
              resolve(value || {});
            });
          } catch (_) {
            this.scope.clearTimeout(timeout);
            resolve({});
          }
        });
      }
      const tabId = tab.smartLikeTabId || this.smartLikeSessionId;
      const sameTab = tabId === this.smartLikeSessionId;
      this.smartLikeSessionId = tabId;
      if (typeof GM_saveTab === "function") {
        try {
          GM_saveTab({ ...tab, smartLikeTabId: tabId });
        } catch (_) {}
      }
      const readObject = (key) => {
        const value = this.session.get(key, {});
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      };
      const generation = this.session.get("smartLikeGeneration", 0);
      this.smartLikeGeneration = (Number.isSafeInteger(generation) && generation >= 0 ? generation : 0) + 1;
      if (sameTab) {
        this.smartLikeCheckedPostIds = readObject("smartLikeProcessedPostIds");
        const failed = this.session.get("smartLikeFailedPostIds", []);
        this.smartLikeFailedPostIds = new Set(
          Array.isArray(failed) ? failed.filter((key) => typeof key === "string") : [],
        );
        const pending = this.session.get("smartLikePendingPostIds", []);
        if (Array.isArray(pending)) {
          for (const task of pending) {
            if (task?.phase === "requesting" && task.accountKey && task.postId) {
              this.smartLikeFailedPostIds.add(this.smartLikeDecisionKey(task.postId, task.accountKey));
            }
          }
        }
      } else {
        this.smartLikeLastLikeAt = 0;
      }
      if (
        !this.session.set("smartLikeSessionId", this.smartLikeSessionId) ||
        !this.session.set("smartLikeGeneration", this.smartLikeGeneration) ||
        !this.persistSmartLikeSession() ||
        !this.persistSmartLikePending()
      ) {
        throw new Error("Session storage write failed");
      }
      this.updateSmartLikeUI();
    } catch (error) {
      this.smartLikeStorageReady = false;
      this.settings.smartLikeEnabled = false;
      this.updateSmartLikeUI();
      console.error("[智能点赞] 会话存储不可用，已暂停发送:", error);
    }
  }

  smartLikeDecisionKey(postId, accountKey = this.smartLikeAccountKey) {
    return accountKey + "|" + postId;
  }

  persistSmartLikePending() {
    if (!this.isSmartLikeGenerationCurrent()) return false;
    const task = this.smartLikeActiveTask;
    const pending =
      task && !task.pendingReleased && this.isSmartLikeGenerationCurrent(task)
        ? [{ postId: task.postId, topicId: task.topicId, accountKey: task.accountKey, phase: task.phase }]
        : [];
    if (!this.session.set("smartLikePendingPostIds", pending)) this.smartLikeStorageReady = false;
    return this.smartLikeStorageReady;
  }

  updateSmartLikeUI() {
    this.onEnabledChange(this.settings.smartLikeEnabled);
  }

  setSmartLikeEnabled(enabled) {
    if (this.scope.disposed) return false;
    const next = !!enabled;
    if (next && this.limits.isLikeCoolingDown()) {
      this.settings.smartLikeEnabled = false;
      Storage.set("smartLikeEnabled", false);
      this.updateSmartLikeUI();
      this.notify(
        Number.isFinite(this.limits.getLikeResumeTime())
          ? `${this.t("likeCoolingDown")}，${new Date(this.limits.getLikeResumeTime()).toLocaleTimeString()}`
          : "点赞状态暂不可用，智能点赞已关闭",
      );
      return false;
    }
    if (next && !this.smartLikeStorageReady) {
      this.notify("点赞会话存储不可用，请恢复存储后刷新页面");
      this.updateSmartLikeUI();
      return false;
    }
    this.settings.smartLikeEnabled = next;
    Storage.set("smartLikeEnabled", next);
    if (!next) this.cancelSmartLikeTasks("disabled");
    this.updateSmartLikeUI();
    if (next && this.getReadingState().autoRunning && this.getSmartLikeTopicId())
      this.scheduleSmartLikeScan();
    return true;
  }

  getSmartLikeSpeedConfig() {
    const probability = { slow: 0.05, normal: 0.15, fast: 0.25 }[this.settings.smartLikeSpeed] ?? 0.15;
    return { probability, minWait: 200, maxWait: 500 };
  }

  persistSmartLikeSession() {
    if (!this.isSmartLikeGenerationCurrent()) return false;
    const results = [
      this.session.set("smartLikeProcessedPostIds", this.smartLikeCheckedPostIds),
      this.session.set("smartLikeFailedPostIds", Array.from(this.smartLikeFailedPostIds)),
      this.session.set("smartLikeLastLikeAt", this.smartLikeLastLikeAt),
    ];
    if (results.some((result) => !result)) this.smartLikeStorageReady = false;
    return this.smartLikeStorageReady;
  }

  getSmartLikePostId(post) {
    const id = post?.dataset?.postId || post?.querySelector("article[data-post-id]")?.dataset.postId;
    return /^\d+$/.test(String(id || "")) ? String(id) : "";
  }

  getSmartLikeTopicId() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] !== "t") return "";
    const id = /^\d+$/.test(parts[1] || "") ? parts[1] : parts[2];
    return /^\d+$/.test(id || "") ? id : "";
  }

  async resolveSmartLikeAccount(force = false) {
    if (this.scope.disposed) return null;
    if (this.smartLikeAccountRequest) return this.smartLikeAccountRequest;
    const now = Date.now();
    if (!force && now - (this.smartLikeAccountCheckedAt || 0) < 3e4) return this.currentAccount;
    if (Storage.get("session429Until", 0) > now) return null;
    this.smartLikeAccountRequest = (async () => {
      let user = null;
      try {
        const response = await fetch(`${BASE_URL}/session/current.json`, {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(1e4),
        });
        if (response.status === 429) Storage.set("session429Until", Date.now() + 30 * 60 * 1e3);
        if (response.ok) user = (await response.json())?.current_user || null;
      } catch (_) {}
      if (this.scope.disposed) return null;
      const id = Number(user?.id ?? user?.user_id);
      const username =
        typeof user?.username === "string" ? user.username.trim().replace(/^@/, "").trim().toLowerCase() : "";
      const key = Number.isSafeInteger(id) && id > 0 ? `id:${id}` : username ? `username:${username}` : null;
      if (this.smartLikeAccountKey !== key) {
        this.cancelSmartLikeTasks("account_changed");
      }
      this.smartLikeAccountKey = key;
      this.currentAccount = key ? { id, username, key } : null;
      this.smartLikeAccountCheckedAt = Date.now();
      if (key?.startsWith("id:") && username) {
        const usernameKey = `username:${username}`;
        const usernameUntil = LikeCooldown.read(usernameKey);
        if (usernameUntil > LikeCooldown.read(key)) LikeCooldown.extend(key, usernameUntil);
        const prefix = `${usernameKey}|`;
        let merged = false;
        for (const [oldKey, value] of Object.entries(this.smartLikeCheckedPostIds)) {
          const newKey = `${key}|${oldKey.slice(prefix.length)}`;
          if (oldKey.startsWith(prefix) && !Object.hasOwn(this.smartLikeCheckedPostIds, newKey)) {
            this.smartLikeCheckedPostIds[newKey] = { ...value };
            merged = true;
          }
        }
        for (const oldKey of Array.from(this.smartLikeFailedPostIds)) {
          const newKey = `${key}|${oldKey.slice(prefix.length)}`;
          if (oldKey.startsWith(prefix) && !this.smartLikeFailedPostIds.has(newKey)) {
            this.smartLikeFailedPostIds.add(newKey);
            merged = true;
          }
        }
        if (merged) this.persistSmartLikeSession();
      }
      this.counter?.setCurrentUser(key ? user : null);
      this.currentUsername = key ? username : null;
      this.onAccountChanged(this.currentAccount);
      if (key) {
        this.loadSmartLikedPosts();
        if (this.limits.isLikeCoolingDown() && this.settings.smartLikeEnabled)
          this.setSmartLikeEnabled(false);
      }
      return this.currentAccount;
    })();
    try {
      return await this.smartLikeAccountRequest;
    } catch (error) {
      this.smartLikeStorageReady = false;
      console.error("[智能点赞] 账号记录不可用，已暂停发送:", error);
      return null;
    } finally {
      this.smartLikeAccountRequest = null;
    }
  }

  getSmartLikeStorageKey() {
    return this.smartLikeAccountKey
      ? `smartLikedPostIds_${encodeURIComponent(this.smartLikeAccountKey)}`
      : null;
  }

  loadSmartLikedPosts() {
    this.smartLikedPostIds = /* @__PURE__ */ new Map();
    const key = this.getSmartLikeStorageKey();
    if (!key) return;
    const entries = this.readSmartLikedRecords(this.smartLikeAccountKey);
    const kept = entries.sort((a, b) => a.recordedAt - b.recordedAt).slice(-5e3);
    this.smartLikedPostIds = new Map(kept.map((item) => [item.postId, item.recordedAt]));
  }

  readSmartLikedRecords(accountKey) {
    if (!accountKey) return [];
    const keys = [`smartLikedPostIds_${encodeURIComponent(accountKey)}`];
    if (
      accountKey === this.currentAccount?.key &&
      accountKey.startsWith("id:") &&
      this.currentAccount.username
    ) {
      keys.push(`smartLikedPostIds_${encodeURIComponent(`username:${this.currentAccount.username}`)}`);
    }
    const records = /* @__PURE__ */ new Map();
    for (const key of keys) {
      const entries = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(entries)) throw new Error("Invalid liked post history");
      for (const item of entries) {
        const postId = String(item?.postId || "");
        const recordedAt = Number(item?.recordedAt);
        if (
          /^\d+$/.test(postId) &&
          Number.isFinite(recordedAt) &&
          recordedAt > 0 &&
          (!records.has(postId) || recordedAt < records.get(postId))
        ) {
          records.set(postId, recordedAt);
        }
      }
    }
    return Array.from(records, ([postId, recordedAt]) => ({ postId, recordedAt }));
  }

  recordLikedPost(postId, accountKey = this.smartLikeAccountKey) {
    if (!accountKey || !postId) return false;
    const key = `smartLikedPostIds_${encodeURIComponent(accountKey)}`;
    let entries;
    try {
      entries = this.readSmartLikedRecords(accountKey);
    } catch (error) {
      this.smartLikeStorageReady = false;
      console.error("[智能点赞] 无法读取成功记录，已暂停后续发送:", error);
      return false;
    }
    const map = /* @__PURE__ */ new Map();
    for (const item of [...entries, { postId: String(postId), recordedAt: Date.now() }]) {
      const id = String(item?.postId || "");
      const time = Number(item?.recordedAt);
      if (!/^\d+$/.test(id) || !Number.isFinite(time) || time <= 0) continue;
      if (!map.has(id) || time < map.get(id)) map.set(id, time);
    }
    const kept = Array.from(map.entries())
      .filter(([post, time]) => post && Number.isFinite(time))
      .sort((a, b) => a[1] - b[1])
      .slice(-5e3)
      .map(([post, time]) => ({ postId: post, recordedAt: time }));
    const saved = Storage.set(key, kept);
    if (!saved) {
      this.smartLikeStorageReady = false;
      console.error("[智能点赞] 成功记录保存失败，已暂停后续发送");
    }
    if (accountKey === this.smartLikeAccountKey)
      this.smartLikedPostIds = new Map(kept.map((item) => [item.postId, item.recordedAt]));
    return saved;
  }

  markSmartLikeChecked(postId, decision, reason = "", accountKey = this.smartLikeAccountKey) {
    this.smartLikeCheckedPostIds[this.smartLikeDecisionKey(postId, accountKey)] = {
      decision,
      reason,
      at: Date.now(),
    };
    this.persistSmartLikeSession();
  }

  getSmartLikeReactionState(post) {
    if (!post?.isConnected) return "unknown";
    const actions = post.querySelector(".discourse-reactions-actions");
    const button = post.querySelector(
      'button[title="点赞此帖子"], button[title="Like this post"], button.btn-toggle-reaction-like',
    );
    if (
      actions?.classList.contains("has-used-main-reaction") ||
      (button &&
        (button.getAttribute("aria-pressed") === "true" ||
          ["has-like", "my-likes", "liked"].some((name) => button.classList.contains(name))))
    )
      return "heart_active";
    if (actions && /reacted/i.test(actions.className)) return "other_reaction";
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return "unknown";
    return "none";
  }

  isSmartLikeGenerationCurrent(
    task = { sessionId: this.smartLikeSessionId, generation: this.smartLikeGeneration },
  ) {
    return (
      task.sessionId === this.smartLikeSessionId &&
      task.generation === this.smartLikeGeneration &&
      task.sessionId === this.session.get("smartLikeSessionId") &&
      task.generation === this.session.get("smartLikeGeneration")
    );
  }

  canRunLikeFlow(task = null) {
    if (
      this.scope.disposed ||
      !this.smartLikeStorageReady ||
      !this.isSmartLikeGenerationCurrent() ||
      !this.settings.smartLikeEnabled ||
      !this.getReadingState().autoRunning ||
      !this.getReadingState().isScrolling ||
      !this.smartLikeAccountKey ||
      !this.getSmartLikeTopicId() ||
      this.limits.isLikeCoolingDown()
    )
      return false;
    if (
      task &&
      (!this.isSmartLikeGenerationCurrent(task) ||
        task.runToken !== this.smartLikeRunToken ||
        task.accountKey !== this.smartLikeAccountKey ||
        task.topicId !== this.getSmartLikeTopicId())
    )
      return false;
    return true;
  }

  shouldLikePost() {
    return (
      this.settings.smartLikeEnabled &&
      Date.now() - this.smartLikeLastLikeAt >= 2e3 &&
      Math.random() < this.getSmartLikeSpeedConfig().probability
    );
  }

  async tryLikePost(post, task) {
    const key = this.smartLikeDecisionKey(task.postId, task.accountKey);
    const canAttempt = () =>
      this.canRunLikeFlow(task) &&
      post.isConnected &&
      this.getSmartLikePostId(post) === task.postId &&
      this.isLikeAllowedInCurrentCategory()?.allowed === true;
    const run = async () => {
      this.loadSmartLikedPosts();
      if (!canAttempt() || this.smartLikedPostIds.has(task.postId) || this.smartLikeFailedPostIds.has(key))
        return;
      const state = this.getSmartLikeReactionState(post);
      if (state !== "none") {
        if (state !== "unknown") this.markSmartLikeChecked(task.postId, "skip", state);
        return;
      }
      const { minWait, maxWait } = this.getSmartLikeSpeedConfig();
      await this.sleep(Utils.random(minWait, maxWait));
      if (!canAttempt() || this.getSmartLikeReactionState(post) !== "none") return;
      this.loadSmartLikedPosts();
      if (this.smartLikedPostIds.has(task.postId)) return;
      this.smartLikeActiveTask = task;
      task.phase = "requesting";
      if (!this.persistSmartLikePending()) return;
      const result = await this.sendLikeRequest(task.postId, task);
      const sameSession = this.isSmartLikeGenerationCurrent(task);
      if (result.success) {
        this.recordLikedPost(task.postId, task.accountKey);
        if (sameSession) {
          this.smartLikeLastLikeAt = Date.now();
          this.markSmartLikeChecked(task.postId, "success", "http_success", task.accountKey);
        }
        console.log("[智能点赞] 点赞成功，帖子 ID=" + task.postId);
      } else if (result.rateLimited) {
        this.limits.handleSmartLike429(result.waitSeconds, result.timeLeft, result.url, "PUT", {
          accountKey: task.accountKey,
          retryAfter: result.retryAfter,
          responseAt: result.responseAt,
        });
      } else if (sameSession && !result.cancelled) {
        this.smartLikeFailedPostIds.add(key);
        this.markSmartLikeChecked(task.postId, "failed", result.reason || "request_failed", task.accountKey);
        console.warn("[智能点赞] 点赞请求失败，帖子 ID=" + task.postId);
      }
    };
    try {
      if (typeof navigator.locks?.request === "function") {
        await navigator.locks.request("smart-like:" + task.accountKey, { mode: "exclusive" }, run);
      } else {
        await run();
      }
    } catch (error) {
      if (task.phase === "requesting" && this.isSmartLikeGenerationCurrent(task)) {
        this.smartLikeFailedPostIds.add(key);
        this.persistSmartLikeSession();
      }
      console.error("[智能点赞] 处理帖子失败:", error);
    } finally {
      if (this.smartLikeActiveTask === task) this.smartLikeActiveTask = null;
      this.persistSmartLikePending();
    }
  }

  async sendLikeRequest(postId, task) {
    if (!this.canRunLikeFlow(task)) return { success: false, cancelled: true };
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!csrfToken) return { success: false, cancelled: true };
    const url =
      BASE_URL +
      "/discourse-reactions/posts/" +
      encodeURIComponent(postId) +
      "/custom-reactions/heart/toggle.json";
    if (!isHeartToggleUrl(url, "PUT")) return { success: false, cancelled: true };
    const controller = new AbortController();
    const timeout = this.scope.setTimeout(() => controller.abort(), 15e3);
    try {
      const response = await fetch(url, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        signal: controller.signal,
      });
      if (response.ok) return { success: true };
      const data = await response.json().catch(() => ({}));
      if (response.status === 429 || data?.error_type === "rate_limit") {
        return {
          success: false,
          rateLimited: true,
          url,
          waitSeconds: data?.extras?.wait_seconds,
          timeLeft: data?.extras?.time_left,
          retryAfter: response.headers?.get?.("Retry-After"),
          responseAt: Date.now(),
        };
      }
      return { success: false, reason: "http_" + response.status };
    } catch (error) {
      return { success: false, reason: error?.name === "AbortError" ? "timeout" : "network_error" };
    } finally {
      this.scope.clearTimeout(timeout);
    }
  }

  async scanSmartLikePosts() {
    await this.smartLikeReady;
    if (
      this.scope.disposed ||
      this.smartLikeIsScanning ||
      !this.smartLikeStorageReady ||
      !this.isSmartLikeGenerationCurrent() ||
      !this.settings.smartLikeEnabled ||
      !this.getReadingState().autoRunning ||
      !this.getReadingState().isScrolling ||
      !this.getSmartLikeTopicId()
    )
      return;
    this.smartLikeIsScanning = true;
    this.smartLikeLastScanAt = Date.now();
    try {
      await this.resolveSmartLikeAccount();
      if (!this.canRunLikeFlow() || this.isLikeAllowedInCurrentCategory()?.allowed !== true) return;
      const topicId = this.getSmartLikeTopicId();
      const runToken = this.smartLikeRunToken;
      const height = window.innerHeight || document.documentElement.clientHeight;
      for (const post of document.querySelectorAll('article[id^="post_"]')) {
        if (
          !this.canRunLikeFlow() ||
          runToken !== this.smartLikeRunToken ||
          topicId !== this.getSmartLikeTopicId()
        )
          break;
        const postId = this.getSmartLikePostId(post);
        const key = this.smartLikeDecisionKey(postId);
        if (
          !postId ||
          this.smartLikeCheckedPostIds[key] ||
          this.smartLikeFailedPostIds.has(key) ||
          this.smartLikedPostIds?.has(postId)
        )
          continue;
        const rect = post.getBoundingClientRect();
        if (rect.top >= height * 0.9 || rect.bottom <= height * 0.1) continue;
        const state = this.getSmartLikeReactionState(post);
        if (state === "unknown") continue;
        if (state !== "none") {
          this.markSmartLikeChecked(postId, "skip", state);
          continue;
        }
        this.markSmartLikeChecked(postId, "viewed", "probability_or_interval");
        if (!this.shouldLikePost()) continue;
        await this.tryLikePost(post, {
          postId,
          topicId,
          accountKey: this.smartLikeAccountKey,
          sessionId: this.smartLikeSessionId,
          generation: this.smartLikeGeneration,
          runToken,
          createdAt: Date.now(),
          phase: "waiting",
        });
      }
    } catch (error) {
      console.error("[智能点赞] 扫描帖子失败:", error);
    } finally {
      this.smartLikeIsScanning = false;
    }
  }

  cancelSmartLikeTasks() {
    this.smartLikeRunToken++;
    this.scope.clearTimeout(this.smartLikeScanTimer);
    this.smartLikeScanTimer = null;
    this.persistSmartLikePending();
  }

  scheduleSmartLikeScan() {
    if (this.scope.disposed || this.smartLikeScanTimer) return;
    const delay = Math.max(0, 2e3 - (Date.now() - this.smartLikeLastScanAt));
    this.smartLikeScanTimer = this.scope.setTimeout(() => {
      this.smartLikeScanTimer = null;
      this.scanSmartLikePosts();
    }, delay);
  }

  bindSmartLikeScroll() {
    if (this.smartLikeScrollBound) return;
    this.smartLikeScrollBound = true;
    this.scope.listen(
      window,
      "scroll",
      () => {
        if (
          this.settings.smartLikeEnabled &&
          this.getReadingState().autoRunning &&
          this.getReadingState().isScrolling
        )
          this.scheduleSmartLikeScan();
      },
      { passive: true },
    );
    this.scope.listen(window, "pagehide", () => this.cancelSmartLikeTasks("pagehide"));
    this.scope.listen(window, "storage", (event) => {
      if (event.key === "likeResumeTime") {
        this.counter?.loadState();
        this.counter?.notifyUIUpdate();
        if (this.limits.isLikeCoolingDown()) this.setSmartLikeEnabled(false);
      } else if (event.key === "smartLikeEnabled" && event.newValue === "false") {
        this.setSmartLikeEnabled(false);
      }
    });
  }

  isLikeAllowedInCurrentCategory() {
    if (CURRENT_DOMAIN === "idcflare.com") {
      return { allowed: true, reason: "idcflare_no_restriction" };
    }
    const config = CONFIG.likeAllowedCategories;
    if (!config || !config.allowed || config.allowed.length === 0) {
      return { allowed: true, reason: "no_config" };
    }
    let subcategory = null;
    let parentCategory = null;
    const topicCategory = document.querySelector(".topic-category");
    if (topicCategory) {
      const badges = topicCategory.querySelectorAll(".badge-category__name, .category-name");
      const names = [];
      badges.forEach((badge) => {
        const name = badge.textContent?.trim();
        if (name) names.push(name);
      });
      if (names.length >= 2) {
        subcategory = names[0];
        parentCategory = names[1];
      } else if (names.length === 1) {
        parentCategory = names[0];
      }
    }
    if (!parentCategory) {
      const headerCategory = document.querySelector(".extra-info-wrapper .badge-category__name");
      if (headerCategory) {
        parentCategory = headerCategory.textContent?.trim();
      }
    }
    const detectedCategories = [];
    if (subcategory) detectedCategories.push(subcategory);
    if (parentCategory) detectedCategories.push(parentCategory);
    if (detectedCategories.length === 0) {
      console.log("[板块检查] 无法获取当前板块信息，默认不允许点赞");
      return { allowed: false, reason: "category_not_found", categories: [] };
    }
    if (detectedCategories.some((name) => config.excluded?.includes(name))) {
      return { allowed: false, reason: "excluded", categories: detectedCategories };
    }
    console.log(
      "[板块检查] 检测到板块:",
      detectedCategories.join(" > "),
      subcategory ? `(子版块: ${subcategory}, 父版块: ${parentCategory})` : `(顶级板块: ${parentCategory})`,
    );
    if (subcategory) {
      if (config.excluded && config.excluded.includes(subcategory)) {
        console.log(`[板块检查] 子版块 "${subcategory}" 在排除列表中，不允许点赞`);
        return {
          allowed: false,
          reason: "subcategory_excluded",
          category: subcategory,
          categories: detectedCategories,
        };
      }
      if (config.allowed.includes(subcategory)) {
        console.log(`[板块检查] 子版块 "${subcategory}" 在允许列表中，允许点赞`);
        return {
          allowed: true,
          reason: "subcategory_allowed",
          category: subcategory,
          categories: detectedCategories,
        };
      }
      if (parentCategory && config.allowed.includes(parentCategory)) {
        console.log(
          `[板块检查] 子版块 "${subcategory}" 不在允许列表，父版块 "${parentCategory}" 在允许列表中，允许点赞`,
        );
        return {
          allowed: true,
          reason: "parent_allowed",
          category: parentCategory,
          subcategory,
          categories: detectedCategories,
        };
      }
      console.log(
        `[板块检查] 子版块 "${subcategory}" 和父版块 "${parentCategory}" 都不在允许列表中，不允许点赞`,
      );
      return { allowed: false, reason: "not_in_allowed_list", categories: detectedCategories };
    } else {
      if (config.excluded && config.excluded.includes(parentCategory)) {
        console.log(`[板块检查] 板块 "${parentCategory}" 在排除列表中，不允许点赞`);
        return {
          allowed: false,
          reason: "excluded",
          category: parentCategory,
          categories: detectedCategories,
        };
      }
      if (config.allowed.includes(parentCategory)) {
        console.log(`[板块检查] 板块 "${parentCategory}" 在允许列表中，允许点赞`);
        return { allowed: true, reason: "allowed", category: parentCategory, categories: detectedCategories };
      }
      console.log(`[板块检查] 板块 "${parentCategory}" 不在允许列表中，不允许点赞`);
      return { allowed: false, reason: "not_in_allowed_list", categories: detectedCategories };
    }
  }
}
