import { CURRENT_DOMAIN, BASE_URL } from "../core/runtime-context.js";
import { RequestManager } from "../core/request-manager.js";

class UserInfoHelper {
  constructor() {
    this.userInfoCache = /* @__PURE__ */ new Map();
    this.pendingRequests = /* @__PURE__ */ new Map();
    this.DAY_IN_MS = 24 * 60 * 60 * 1e3;
    this.isEnabled = true;
    this.observer = null;
    this.init();
  }
  init() {
    if (!this.isEnabled) return;
    if (this.observer) {
      this.observer.disconnect();
    }
    const debouncedEnhance = this.debounce(() => {
      if (!this.isEnabled || document.hidden) return;
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(() => this.isEnabled && this.enhanceUserInfo(), { timeout: 1200 });
      } else {
        setTimeout(() => this.isEnabled && this.enhanceUserInfo(), 120);
      }
    }, 600);
    this.observer = new MutationObserver((mutations) => {
      if (!this.isEnabled || document.hidden) return;
      const hasRelevantMutation = mutations.some((mutation) =>
        Array.from(mutation.addedNodes || []).some((node) => {
          if (node.nodeType !== 1) return false;
          if (node.closest && node.closest("#my-gift-panel")) return false;
          return (
            node.matches?.(".topic-post, article, .post-stream") ||
            node.querySelector?.(".topic-post article, .names a[data-user-card]")
          );
        }),
      );
      if (hasRelevantMutation) {
        debouncedEnhance();
      }
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    this.enhanceUserInfo();
  }
  destroy() {
    this.isEnabled = false;
    this.observer?.disconnect();
  }
  debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
  isTopicPage() {
    return window.location.pathname.includes("/t/topic/");
  }
  async enhanceUserInfo() {
    if (!this.isTopicPage()) return;
    const articles = document.querySelectorAll(".topic-post article");
    for (const article of articles) {
      const anchor = article.querySelector(".names a[data-user-card]");
      if (!anchor) continue;
      const slug = anchor.getAttribute("data-user-card");
      if (!slug) continue;
      const normalizedSlug = slug.trim().toLowerCase();
      if (article.querySelector(`.user-reg-info[data-user="${normalizedSlug}"]`)) {
        continue;
      }
      const postWrapper = article.closest(".topic-post");
      const postNumber = postWrapper?.getAttribute("data-post-number");
      const isFirstPost = postNumber === "1";
      if (isFirstPost) {
        await this.loadAndDisplayUserInfo(anchor, slug, normalizedSlug);
      } else {
        this.addInfoButton(anchor, slug, normalizedSlug);
      }
    }
  }
  addInfoButton(anchor, rawSlug, normalizedSlug) {
    const namesContainer = anchor.closest(".names");
    if (!namesContainer) return;
    if (namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`)) {
      return;
    }
    if (namesContainer.querySelector(`.user-reg-info[data-user="${normalizedSlug}"]`)) {
      return;
    }
    const button = document.createElement("button");
    button.className = "user-info-btn";
    button.setAttribute("data-user", normalizedSlug);
    button.setAttribute("data-raw-slug", rawSlug);
    button.textContent = "📊";
    button.title = "点击查看用户注册信息";
    button.style.cssText = `
margin-left: 6px;
font-size: 14px;
cursor: pointer;
background: none;
border: none;
padding: 2px 4px;
opacity: 0.6;
transition: opacity 0.2s;
vertical-align: middle;
      `;
    button.addEventListener("mouseenter", () => {
      button.style.opacity = "1";
    });
    button.addEventListener("mouseleave", () => {
      button.style.opacity = "0.6";
    });
    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = "⏳";
      try {
        await this.loadAndDisplayUserInfo(anchor, rawSlug, normalizedSlug);
      } catch (error) {
        console.error("加载用户信息失败:", error);
        button.textContent = "📊";
        button.disabled = false;
      }
    });
    anchor.insertAdjacentElement("afterend", button);
    this.addTopicsButton(anchor, rawSlug, normalizedSlug);
  }
  addTopicsButton(anchor, rawSlug, normalizedSlug) {
    const namesContainer = anchor.closest(".names");
    if (!namesContainer) return;
    if (namesContainer.querySelector(`.user-topics-btn[data-user="${normalizedSlug}"]`)) {
      return;
    }
    const topicsBtn = document.createElement("a");
    topicsBtn.className = "user-topics-btn";
    topicsBtn.setAttribute("data-user", normalizedSlug);
    topicsBtn.href = `${BASE_URL}/u/${rawSlug}/activity/topics`;
    topicsBtn.target = "_blank";
    topicsBtn.textContent = "查看话题";
    topicsBtn.title = "查看该用户的话题";
    topicsBtn.style.cssText = `
margin-left: 6px;
font-size: 12px;
cursor: pointer;
text-decoration: none;
padding: 2px 6px;
opacity: 0.7;
transition: all 0.2s;
vertical-align: middle;
display: inline-block;
color: #667eea;
background: rgba(102, 126, 234, 0.1);
border-radius: 4px;
      `;
    topicsBtn.addEventListener("mouseenter", () => {
      topicsBtn.style.opacity = "1";
      topicsBtn.style.background = "rgba(102, 126, 234, 0.2)";
    });
    topicsBtn.addEventListener("mouseleave", () => {
      topicsBtn.style.opacity = "0.7";
      topicsBtn.style.background = "rgba(102, 126, 234, 0.1)";
    });
    const infoBtn = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
    if (infoBtn) {
      infoBtn.insertAdjacentElement("afterend", topicsBtn);
    } else {
      anchor.insertAdjacentElement("afterend", topicsBtn);
    }
  }
  async loadAndDisplayUserInfo(anchor, slug, normalizedSlug) {
    const namesContainer = anchor.closest(".names");
    if (!namesContainer) return;
    const existingInfo = namesContainer.querySelector(`.user-reg-info[data-user="${normalizedSlug}"]`);
    if (existingInfo) {
      console.log(`用户 ${normalizedSlug} 信息已存在，跳过`);
      const button2 = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
      if (button2) button2.remove();
      return;
    }
    const info = await this.fetchUserInfo(slug, normalizedSlug);
    if (!info) {
      const button2 = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
      if (button2) {
        button2.textContent = "📊";
        button2.disabled = false;
      }
      return;
    }
    const infoNode = this.buildInfoNode(info, normalizedSlug);
    if (!infoNode) {
      const button2 = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
      if (button2) {
        button2.textContent = "📊";
        button2.disabled = false;
      }
      return;
    }
    const finalCheck = namesContainer.querySelector(`.user-reg-info[data-user="${normalizedSlug}"]`);
    if (finalCheck) {
      console.log(`用户 ${normalizedSlug} 信息在等待期间已被添加，跳过`);
      const button2 = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
      if (button2) button2.remove();
      return;
    }
    const button = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
    if (button) button.remove();
    anchor.insertAdjacentElement("afterend", infoNode);
    if (!namesContainer.querySelector(`.user-topics-btn[data-user="${normalizedSlug}"]`)) {
      this.addTopicsButton(anchor, slug, normalizedSlug);
    }
  }
  async fetchUserInfo(slug, normalizedSlug) {
    if (this.userInfoCache.has(normalizedSlug)) {
      return this.userInfoCache.get(normalizedSlug);
    }
    if (this.pendingRequests.has(normalizedSlug)) {
      return this.pendingRequests.get(normalizedSlug);
    }
    const requestPromise = this.doFetchUserInfo(slug, normalizedSlug);
    this.pendingRequests.set(normalizedSlug, requestPromise);
    try {
      const info = await requestPromise;
      if (info) {
        this.userInfoCache.set(normalizedSlug, info);
      }
      return info;
    } finally {
      this.pendingRequests.delete(normalizedSlug);
    }
  }
  async doFetchUserInfo(slug, normalizedSlug) {
    try {
      const PROFILE_API_BUILDERS = [
        (s) => `${BASE_URL}/u/${encodeURIComponent(s)}.json`,
        (s) => `${BASE_URL}/users/${encodeURIComponent(s)}.json`,
      ];
      const SUMMARY_API_BUILDERS = [
        (s) => `${BASE_URL}/u/${encodeURIComponent(s)}/summary.json`,
        (s) => `${BASE_URL}/users/${encodeURIComponent(s)}/summary.json`,
      ];
      const [profileData, summaryData] = await Promise.all([
        this.fetchFirstAvailable(PROFILE_API_BUILDERS, slug),
        this.fetchFirstAvailable(SUMMARY_API_BUILDERS, slug),
      ]);
      if (!profileData && !summaryData) {
        return null;
      }
      const user = profileData && (profileData.user || profileData);
      const summary = summaryData && (summaryData.user_summary || summaryData.summary || summaryData);
      const createdAt = this.pickCreatedAt(user) || (summary && this.pickCreatedAt(summary));
      if (!createdAt) {
        return null;
      }
      const topicCount = this.pickFirstNumber(
        user && (user.topic_count ?? user.topicCount),
        summary && (summary.topic_count ?? summary.topics_count),
      );
      const totalPostCount = this.pickFirstNumber(
        user && (user.post_count ?? user.postCount),
        summary && (summary.post_count ?? summary.posts_count),
      );
      let repliesCount = this.pickFirstNumber(summary && (summary.replies_count ?? summary.reply_count));
      if (repliesCount === null && totalPostCount !== null && topicCount !== null) {
        repliesCount = Math.max(0, totalPostCount - topicCount);
      }
      const trustLevelRaw = this.pickFirstValue(
        user && (user.trust_level ?? user.trustLevel),
        summary && (summary.trust_level ?? summary.trustLevel),
      );
      const trustLevel = this.normalizeTrustLevel(trustLevelRaw);
      const days = this.calcDays(createdAt);
      return {
        slug: normalizedSlug,
        createdAt,
        days,
        topicCount: typeof topicCount === "number" && Number.isFinite(topicCount) ? topicCount : void 0,
        repliesCount:
          typeof repliesCount === "number" && Number.isFinite(repliesCount) ? repliesCount : void 0,
        trustLevel,
      };
    } catch (error) {
      console.error("获取用户信息失败:", slug, error);
      return null;
    }
  }
  async fetchFirstAvailable(builders, slug) {
    for (const builder of builders) {
      const url = builder(slug);
      const data = await this.safeFetchJson(url);
      if (data) {
        return data;
      }
    }
    return null;
  }
  async safeFetchJson(url) {
    try {
      const response = await RequestManager.run(
        `safe-fetch-${CURRENT_DOMAIN}-${url}`,
        async () => {
          const r = await fetch(url, { credentials: "include" });
          if (r.status === 429) throw new Error(`429 ${url}`);
          return r;
        },
        {
          minInterval: 1200,
          retries: 1,
          backoffBase: 1e3,
          cooldownKey: `safeFetch429Until_${CURRENT_DOMAIN}`,
          cooldownMs: 20 * 60 * 1e3,
        },
      );
      if (!response || !response.ok) {
        return null;
      }
      return await response.json();
    } catch (error) {
      return null;
    }
  }
  pickFirstNumber(...values) {
    for (const value of values) {
      const numberValue = Number(value);
      if (!Number.isNaN(numberValue)) {
        return numberValue;
      }
    }
    return null;
  }
  pickFirstValue(...values) {
    for (const value of values) {
      if (value !== void 0 && value !== null) {
        return value;
      }
    }
    return null;
  }
  normalizeTrustLevel(raw) {
    if (raw === void 0 || raw === null) {
      return void 0;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      const TRUST_LEVEL_ALIAS = {
        newuser: 0,
        basic: 1,
        member: 2,
        regular: 3,
        leader: 4,
      };
      const alias = TRUST_LEVEL_ALIAS[raw.toLowerCase()];
      if (alias !== void 0) {
        return alias;
      }
      const numeric = Number(raw);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }
    return void 0;
  }
  pickCreatedAt(source) {
    if (!source) {
      return null;
    }
    return (
      source.created_at ||
      source.createdAt ||
      source.registration_date ||
      source.registrationDate ||
      source.joined ||
      source.joinedAt ||
      null
    );
  }
  calcDays(createdAt) {
    const createdTime = new Date(createdAt).getTime();
    if (Number.isNaN(createdTime)) {
      return 0;
    }
    const diff = Date.now() - createdTime;
    return Math.max(0, Math.floor(diff / this.DAY_IN_MS));
  }
  buildInfoNode(info, normalizedSlug) {
    const segments = [`注册 ${this.formatNumber(info.days)} 天`];
    if (typeof info.topicCount === "number" && Number.isFinite(info.topicCount)) {
      segments.push(`发帖 ${this.formatNumber(info.topicCount)}`);
    }
    if (typeof info.repliesCount === "number" && Number.isFinite(info.repliesCount)) {
      segments.push(`回帖 ${this.formatNumber(info.repliesCount)}`);
    }
    if (typeof info.trustLevel === "number" && Number.isFinite(info.trustLevel)) {
      const FULL_TRUST_LEVEL_LABELS = {
        0: "Lv0 新手",
        1: "Lv1 入门",
        2: "Lv2 成员",
        3: "Lv3 常驻",
        4: "Lv4 领袖",
      };
      const label = FULL_TRUST_LEVEL_LABELS[info.trustLevel] || `信任级别 Lv${info.trustLevel}`;
      segments.push(label);
    }
    if (!segments.length) {
      return null;
    }
    const span = document.createElement("span");
    span.className = "user-reg-info";
    span.setAttribute("data-user", normalizedSlug);
    span.textContent = ` · ${segments.join(" · ")}`;
    span.style.cssText = `
margin-left: 6px;
font-size: 12px;
color: #1a4c7c;
      `;
    return span;
  }
  formatNumber(value) {
    return Number(value).toLocaleString("zh-CN");
  }
}

export { UserInfoHelper };
