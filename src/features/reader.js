import { CURRENT_DOMAIN, BASE_URL } from "../core/runtime-context.js";
import { CONFIG } from "../core/config.js";
import { Storage } from "../core/storage.js";
import { Utils } from "../core/utils.js";
import { DisposableScope } from "../core/disposable-scope.js";

export class Reader {
  constructor({ settings, session, view, getCurrentUsername, hooks, sleep = Utils.sleep }) {
    this.settings = settings;
    this.session = session;
    this.view = view;
    this.getCurrentUsername = getCurrentUsername;
    this.hooks = hooks;
    this.sleep = sleep;
    this.scope = new DisposableScope();
    this.runGeneration = 0;
    this.scrollGeneration = 0;
    this.isScrolling = false;
    this.navigationTimeout = null;
    this.navigationGuardInterval = null;
    this.accumulatedTime = session.get("accumulatedTime", 0);
    this.lastActionTime = Date.now();
    this.isTopicPage = window.location.href.includes("/t/topic/");
    this.onChallengePage = CURRENT_DOMAIN === "linux.do" && window.location.pathname.startsWith("/challenge");
    if (window.opener !== null) {
      this.autoRunning = false;
      session.set("autoRunning", false);
      this.topicList = [];
      session.set("topicList", []);
      console.log("[窗口独立] 检测到新开窗口，已清除继承的自动阅读状态");
    } else {
      this.autoRunning = this.onChallengePage ? false : session.get("autoRunning", false);
      this.topicList = session.get("topicList", []);
    }
    this.firstUseChecked = Storage.get("firstUseChecked", false);
    this.selectedPost = Storage.get("selectedPost", null);
    this.currentSessionReadCount = session.get("currentSessionReadCount", 0);
    this.readTopics = [];
    this.skippedReadCount = session.get("skippedReadCount", 0);
    this.todayReadCount = this.loadTodayReadCount();
    this.totalReadCount = Storage.get("totalReadCount", 0);
    if (this.totalReadCount < this.todayReadCount) {
      this.totalReadCount = this.todayReadCount;
      Storage.set("totalReadCount", this.totalReadCount);
    }
    this.lastFetchedPage = session.get("lastFetchedPage", 0);
    this.historicalMaxPage = this.loadHistoricalMaxPage();
    this.t = view.t;
  }

  isRunCurrent(generation) {
    return !this.scope.disposed && this.autoRunning && generation === this.runGeneration;
  }

  getSnapshot() {
    return {
      autoRunning: this.autoRunning,
      isScrolling: this.isScrolling,
      topicList: this.topicList,
      currentSessionReadCount: this.currentSessionReadCount,
      skippedReadCount: this.skippedReadCount,
      todayReadCount: this.todayReadCount,
      totalReadCount: this.totalReadCount,
      lastFetchedPage: this.lastFetchedPage,
      historicalMaxPage: this.historicalMaxPage,
    };
  }

  start() {
    if (this.onChallengePage || this.scope.disposed) return;
    if (!this.hooks.canRead()) {
      this.stopAutoReading();
      return;
    }
    if (!this.firstUseChecked) {
      this.handleFirstUse();
    } else if (this.autoRunning) {
      this.loadUserReadHistory().then(() => {
        if (this.scope.disposed || !this.autoRunning) return;
        if (this.topicList.length > 0) this.scope.setTimeout(() => this.view.updateReadingStatus(), 100);
        if (this.isTopicPage) this.startScrolling();
        else
          this.getLatestTopics().then(() => {
            if (this.autoRunning && !this.scope.disposed) this.navigateNextTopic();
          });
      });
    } else this.loadUserReadHistory();
    this.startNavigationGuard();
  }

  resetTopicList() {
    this.topicList = [];
    this.session.set("topicList", []);
  }

  resetSessionReadCount() {
    this.currentSessionReadCount = 0;
    this.session.set("currentSessionReadCount", 0);
  }

  destroy() {
    this.stopAutoReading();
    this.scope.dispose();
  }

  getPageContextKey(urlString = window.location.href) {
    try {
      const base = window.location?.origin || BASE_URL;
      const url = new URL(urlString, base);
      const topicMatch = url.pathname.match(/^\/t\/topic\/(\d+)(?:\/\d+)?\/?$/);
      if (topicMatch) return `topic:${topicMatch[1]}`;
      return `${url.pathname}${url.search}`;
    } catch (_) {
      return String(urlString || "");
    }
  }

  getTopicProgressSnapshot() {
    const { scrollHeight } = document.documentElement || {};
    return {
      scrollHeight: scrollHeight || 0,
      postCount: document.querySelectorAll(".topic-post").length,
      maxLoadedPostNumber: this.getLoadedMaxPostNumber(),
    };
  }

  parseCssPixels(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  isBlueTimelineColor(value) {
    const rgb = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
    if (!rgb) return false;
    const red = Number(rgb[1]);
    const green = Number(rgb[2]);
    const blue = Number(rgb[3]);
    const alpha = rgb[4] === void 0 ? 1 : Number(rgb[4]);
    return alpha > 0.35 && blue >= 120 && green >= 90 && red <= 80;
  }

  isBlueDotStyle(style, fallbackRect = null) {
    if (!style || style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity || 1) < 0.2) return false;
    const width = this.parseCssPixels(style.width) || fallbackRect?.width || 0;
    const height = this.parseCssPixels(style.height) || fallbackRect?.height || 0;
    const radius = this.parseCssPixels(style.borderTopLeftRadius);
    const isSmallRound =
      width >= 4 &&
      width <= 18 &&
      height >= 4 &&
      height <= 18 &&
      Math.abs(width - height) <= 6 &&
      radius >= Math.min(width, height) * 0.35;
    if (!isSmallRound) return false;
    return [style.backgroundColor, style.borderColor, style.color].some((color) =>
      this.isBlueTimelineColor(color),
    );
  }

  hasUnreadTimelineBlueDot() {
    const containers = Array.from(
      document.querySelectorAll(
        [
          ".topic-timeline",
          ".timeline-scrollarea",
          ".timeline-container",
          ".timeline-replies",
          ".topic-navigation",
        ].join(","),
      ),
    );
    if (containers.length === 0) return false;
    return containers.some((container) =>
      Array.from(container.querySelectorAll("*")).some((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const directStyle = window.getComputedStyle(element);
        if (this.isBlueDotStyle(directStyle, rect)) return true;
        return ["::before", "::after"].some((pseudo) => {
          const pseudoStyle = window.getComputedStyle(element, pseudo);
          if (!pseudoStyle || pseudoStyle.content === "none") return false;
          return this.isBlueDotStyle(pseudoStyle);
        });
      }),
    );
  }

  nudgeScrollForReadConfirmation() {
    const pixels = CONFIG.scroll.readConfirmationNudgePixels;
    window.dispatchEvent(new Event("scroll"));
    window.scrollBy({ top: -pixels, behavior: "auto" });
    window.scrollBy({ top: pixels * 2, behavior: "smooth" });
  }

  async waitForTopicReadConfirmation() {
    if (!this.isTopicPage) return true;
    let clearChecks = 0;
    for (let attempt = 0; attempt < CONFIG.scroll.readConfirmationChecks; attempt++) {
      if (!this.autoRunning) return false;
      if (!this.hasUnreadTimelineBlueDot()) {
        clearChecks++;
        if (clearChecks >= CONFIG.scroll.readConfirmationClearChecks) return true;
      } else {
        clearChecks = 0;
        console.log("[完整阅读] 检测到楼层小蓝点未消失，继续等待阅读确认...");
        this.nudgeScrollForReadConfirmation();
      }
      await this.sleep(CONFIG.scroll.readConfirmationDelay);
    }
    return !this.hasUnreadTimelineBlueDot();
  }

  getLoadedMaxPostNumber() {
    const posts = Array.from(document.querySelectorAll(".topic-post[data-post-number]"));
    return posts.reduce((max, post) => {
      const number = Number.parseInt(post.getAttribute("data-post-number") || "0", 10);
      return Number.isFinite(number) ? Math.max(max, number) : max;
    }, 0);
  }

  async getCurrentTopicMaxPostNumber() {
    const topicIdMatch = window.location.pathname.match(/\/t\/topic\/(\d+)/);
    const topicId = topicIdMatch ? topicIdMatch[1] : null;
    if (!topicId) return this.getLoadedMaxPostNumber();
    if (this._topicMaxPostNumberTopicId === topicId && Number.isFinite(this._topicMaxPostNumber)) {
      return this._topicMaxPostNumber;
    }
    const url = new URL(window.location.href);
    url.hash = "";
    const jsonUrl = url.toString().replace(/\/$/, "") + ".json";
    try {
      const response = await fetch(jsonUrl, { credentials: "include" });
      const data = response && response.ok ? await response.json() : null;
      const maxPostNumber = Number(data?.highest_post_number || data?.posts_count || 0);
      this._topicMaxPostNumberTopicId = topicId;
      this._topicMaxPostNumber =
        Number.isFinite(maxPostNumber) && maxPostNumber > 0 ? maxPostNumber : this.getLoadedMaxPostNumber();
      return this._topicMaxPostNumber;
    } catch (_) {
      return this.getLoadedMaxPostNumber();
    }
  }

  hasTopicProgressChanged(previous, current) {
    return (
      current.scrollHeight > previous.scrollHeight + 50 ||
      current.postCount > previous.postCount ||
      current.maxLoadedPostNumber > previous.maxLoadedPostNumber
    );
  }

  async isTopicFullyRead() {
    const settleChecks = CONFIG.scroll.bottomSettleChecks;
    const settleDelay = CONFIG.scroll.bottomSettleDelay;
    const targetMaxPostNumber = await this.getCurrentTopicMaxPostNumber();
    let previous = this.getTopicProgressSnapshot();
    for (let attempt = 0; attempt < settleChecks; attempt++) {
      await this.sleep(settleDelay);
      if (!this.autoRunning || !this.isScrolling) return false;
      if (!Utils.isNearBottom() || !Utils.isPageLoaded()) return false;
      const current = this.getTopicProgressSnapshot();
      if (targetMaxPostNumber > 0 && current.maxLoadedPostNumber < targetMaxPostNumber) return false;
      if (this.hasTopicProgressChanged(previous, current)) return false;
      if (this.hasUnreadTimelineBlueDot()) {
        console.log("[完整阅读] 楼层小蓝点仍存在，暂不跳转下一篇");
        this.nudgeScrollForReadConfirmation();
        return false;
      }
      previous = current;
    }
    const reachedLastPost = targetMaxPostNumber <= 0 || previous.maxLoadedPostNumber >= targetMaxPostNumber;
    return reachedLastPost && (await this.waitForTopicReadConfirmation());
  }

  isPageLoadingStalled(timeOnPage) {
    return this.isTopicPage && timeOnPage > CONFIG.time.topicLoadingTimeout && !Utils.isPageLoaded();
  }

  getScrollPlan(shouldReadFullTopic) {
    if (!shouldReadFullTopic) {
      const delay = Utils.random(CONFIG.scroll.minSpeed, CONFIG.scroll.maxSpeed);
      const distance = Utils.random(CONFIG.scroll.minDistance, CONFIG.scroll.maxDistance);
      return {
        step: distance * CONFIG.scroll.stepMultiplier,
        behavior: "smooth",
        delay,
        allowFastScroll: true,
      };
    }
    const viewportHeight = Math.max(
      window.innerHeight || 0,
      document.documentElement?.clientHeight || 0,
      CONFIG.scroll.fullTopicMinStep,
    );
    const getStepRange = (minRatio, maxRatio) => {
      const minStep2 = Math.max(12, Math.floor(viewportHeight * minRatio));
      const maxStep2 = Math.max(minStep2, Math.floor(viewportHeight * maxRatio));
      return [minStep2, maxStep2];
    };
    const roll = Utils.random(1, 100);
    if (roll <= CONFIG.scroll.fullTopicBacktrackChance) {
      const [minStep2, maxStep2] = getStepRange(
        CONFIG.scroll.fullTopicBacktrackMinRatio,
        CONFIG.scroll.fullTopicBacktrackMaxRatio,
      );
      return {
        step: -Utils.random(minStep2, maxStep2),
        behavior: "smooth",
        delay: Utils.random(
          CONFIG.scroll.fullTopicBacktrackMinSpeed,
          CONFIG.scroll.fullTopicBacktrackMaxSpeed,
        ),
        allowFastScroll: false,
      };
    }
    const useSlowStep = roll <= CONFIG.scroll.fullTopicSlowChance;
    const [minStep, maxStep] = useSlowStep
      ? getStepRange(CONFIG.scroll.fullTopicSmallStepMinRatio, CONFIG.scroll.fullTopicSmallStepMaxRatio)
      : getStepRange(CONFIG.scroll.fullTopicNormalStepMinRatio, CONFIG.scroll.fullTopicNormalStepMaxRatio);
    const [minDelay, maxDelay] = useSlowStep
      ? [CONFIG.scroll.fullTopicSlowMinSpeed, CONFIG.scroll.fullTopicSlowMaxSpeed]
      : [CONFIG.scroll.fullTopicNormalMinSpeed, CONFIG.scroll.fullTopicNormalMaxSpeed];
    return {
      step: Utils.random(minStep, maxStep),
      behavior: "smooth",
      delay: Utils.random(minDelay, maxDelay),
      allowFastScroll: false,
    };
  }

  async recoverFromStuck() {
    const generation = this.runGeneration;
    if (!this.isRunCurrent(generation)) return;
    console.log("🔧 开始恢复流程...");
    this.stopScrolling();
    await this.sleep(1e3);
    if (!this.isRunCurrent(generation)) return;
    if (this.isTopicPage) {
      console.log("📖 在文章页，重新开始滚动");
      this.startScrolling();
    } else {
      console.log("📋 在列表页，尝试导航到下一篇");
      if (this.topicList.length === 0) {
        await this.getLatestTopics();
        if (!this.isRunCurrent(generation)) return;
      }
      await this.navigateNextTopic();
    }
    this.pageLoadTime = Date.now();
  }

  handleButtonClick() {
    if (this.scope.disposed) return;
    if (this.isScrolling || this.autoRunning) {
      this.stopAutoReading();
    } else {
      if (!this.hooks.canRead()) return;
      const generation = ++this.runGeneration;
      this.autoRunning = true;
      this.session.set("autoRunning", true);
      this.view.setReadingRunning(true);
      this.startNavigationGuard();
      this.view.prepareForReading();
      if (!this.firstUseChecked) {
        this.handleFirstUse();
      } else if (this.isTopicPage) {
        this.startScrolling();
      } else {
        this.getLatestTopics().then(() => {
          if (!this.isRunCurrent(generation)) return;
          this.navigateNextTopic();
        });
      }
    }
  }

  async handleFirstUse() {
    if (!this.autoRunning) return;
    if (CURRENT_DOMAIN !== "linux.do") {
      console.log("非 linux.do 域名，跳过新手教程");
      Storage.set("firstUseChecked", true);
      this.firstUseChecked = true;
      await this.getLatestTopics();
      if (!this.autoRunning) return;
      await this.navigateNextTopic();
      return;
    }
    if (!this.selectedPost) {
      const randomIndex = Math.floor(Math.random() * CONFIG.mustRead.posts.length);
      this.selectedPost = CONFIG.mustRead.posts[randomIndex];
      Storage.set("selectedPost", this.selectedPost);
      console.log(`随机选择文章: ${this.selectedPost.url}`);
      window.location.href = this.selectedPost.url;
      return;
    }
    const currentUrl = window.location.href;
    if (currentUrl.includes(this.selectedPost.url)) {
      Storage.set("firstUseChecked", true);
      this.firstUseChecked = true;
      if (this.isTopicPage) this.startScrolling();
      else {
        await this.getLatestTopics();
        if (this.autoRunning) await this.navigateNextTopic();
      }
    } else {
      window.location.href = this.selectedPost.url;
    }
  }

  async getLatestTopics() {
    const generation = this.runGeneration;
    if (!this.isRunCurrent(generation)) return [];
    let topicList = [];
    let retryCount = 0;
    let totalSkipped = 0;
    let emptyPageCount = 0;
    let topicLimit = this.settings.topicLimitCount || 100;
    if (this.settings.stopAfterReadEnabled) {
      const remainingToRead = this.settings.stopAfterReadCount - this.currentSessionReadCount;
      if (remainingToRead > 0) {
        topicLimit = remainingToRead;
        console.log(
          `[阅读限制] 开启阅读限制，本次只获取 ${topicLimit} 篇帖子（限制${this.settings.stopAfterReadCount}篇，已读${this.currentSessionReadCount}篇）`,
        );
      } else {
        console.log(`[阅读限制] 已达到阅读限制，不再获取新帖子`);
        topicLimit = 0;
      }
    }
    const maxPagesPerFetch = Math.max(50, Math.ceil(topicLimit / 5));
    let startPage = this.getStartPage();
    let page = startPage;
    const maxPage = startPage + maxPagesPerFetch - 1;
    const endpoint = this.settings.readUnreadEnabled ? "unread" : "latest";
    const topicType = this.settings.readUnreadEnabled ? this.t("unreadTopics") : this.t("latestTopics");
    console.log(
      `[页码续读] 从第${startPage}页开始获取${this.settings.readUnreadEnabled ? "未读" : "最新"}帖子（限制：${topicLimit}篇，最大翻到第${maxPage}页）...`,
    );
    this.view.updateTopicStatus({
      fetching: true,
      type: topicType,
      current: 0,
      target: topicLimit,
      skipped: 0,
      startPage,
    });
    while (topicList.length < topicLimit && retryCount < CONFIG.article.retryLimit && page <= maxPage) {
      try {
        const response = await fetch(`${BASE_URL}/${endpoint}.json?no_definitions=true&page=${page}`);
        if (!this.isRunCurrent(generation)) return topicList;
        if (response.status === 502) {
          this.view.showNotification(this.t("stoppedByServerBusy"));
          this.stopAutoReading();
          return topicList;
        }
        const data = await response.json();
        if (!this.isRunCurrent(generation)) return topicList;
        if (data?.topic_list?.topics && data.topic_list.topics.length > 0) {
          emptyPageCount = 0;
          let filteredTopics = data.topic_list.topics.filter(
            (topic) => topic.posts_count < CONFIG.article.commentLimit,
          );
          if (this.settings.skipReadEnabled) {
            const beforeCount = filteredTopics.length;
            filteredTopics = filteredTopics.filter((topic) => !this.isTopicRead(topic.id.toString()));
            const skippedCount = beforeCount - filteredTopics.length;
            if (skippedCount > 0) {
              totalSkipped += skippedCount;
              console.log(
                `第${page}页：跳过了 ${skippedCount} 篇已读帖子，获取 ${filteredTopics.length} 篇未读`,
              );
            }
          }
          topicList.push(...filteredTopics);
          if (topicList.length > 1) {
            const seenTopicIds = /* @__PURE__ */ new Set();
            const beforeDedupCount = topicList.length;
            topicList = topicList.filter((topic) => {
              const topicId = String(topic?.id ?? "");
              if (!topicId) return false;
              if (seenTopicIds.has(topicId)) {
                return false;
              }
              seenTopicIds.add(topicId);
              return true;
            });
            const dedupedCount = beforeDedupCount - topicList.length;
            if (dedupedCount > 0) {
              console.log(`[去重] 第${page}页合并后移除了 ${dedupedCount} 篇重复 topic`);
            }
          }
          page++;
          this.view.updateTopicStatus({
            fetching: true,
            type: topicType,
            current: topicList.length,
            target: topicLimit,
            skipped: totalSkipped,
            page: page - 1,
            maxPages: maxPage,
            startPage,
          });
          if (this.settings.readUnreadEnabled && data.topic_list.topics.length === 0) {
            console.log("未读帖子模式：API返回空数据，没有更多未读帖子");
            break;
          }
        } else {
          emptyPageCount++;
          console.log(`第${page}页：API返回空数据（连续${emptyPageCount}页为空）`);
          if (emptyPageCount >= 3) {
            if (startPage > 1 && topicList.length < topicLimit) {
              console.log(`[页码续读] 连续${emptyPageCount}页为空，从第1页重新扫描...`);
              page = 1;
              startPage = 1;
              emptyPageCount = 0;
              this.lastFetchedPage = 0;
              this.session.set("lastFetchedPage", 0);
              continue;
            }
            break;
          }
          page++;
        }
      } catch (error) {
        console.error("获取文章列表失败:", error);
        retryCount++;
        await this.sleep(1e3);
        if (!this.isRunCurrent(generation)) return topicList;
      }
    }
    const finalPage = page - 1;
    this.lastFetchedPage = finalPage;
    this.session.set("lastFetchedPage", finalPage);
    this.saveHistoricalMaxPage(finalPage);
    const reachedMaxPages = page > maxPage && topicList.length < topicLimit;
    if (reachedMaxPages) {
      console.log(
        `[页码续读] 已达到本次最大页数 ${maxPage} 页，获取到 ${topicList.length}/${topicLimit} 篇帖子`,
      );
    }
    if (topicList.length > topicLimit) {
      topicList = topicList.slice(0, topicLimit);
    }
    if (topicList.length > 1) {
      const seenTopicIds = /* @__PURE__ */ new Set();
      const beforeDedupCount = topicList.length;
      topicList = topicList.filter((topic) => {
        const topicId = String(topic?.id ?? "");
        if (!topicId) return false;
        if (seenTopicIds.has(topicId)) {
          return false;
        }
        seenTopicIds.add(topicId);
        return true;
      });
      const dedupedCount = beforeDedupCount - topicList.length;
      if (dedupedCount > 0) {
        console.log(`[去重] 最终列表移除了 ${dedupedCount} 篇重复 topic`);
      }
    }
    if (this.settings.randomOrderEnabled && topicList.length > 1) {
      topicList = this.shuffleArray(topicList);
      console.log("已随机打乱帖子顺序");
    }
    this.topicList = topicList;
    this.session.set("topicList", topicList);
    console.log(
      `[页码续读] 已获取 ${topicList.length} 篇${this.settings.readUnreadEnabled ? "未读" : "最新"}文章${this.settings.randomOrderEnabled ? "（随机顺序）" : ""}（第${startPage}-${finalPage}页）`,
    );
    this.view.updateTopicStatus({
      fetching: false,
      type: topicType,
      current: topicList.length,
      target: topicLimit,
      skipped: totalSkipped,
      ready: true,
      reachedMaxPages,
      totalPages: finalPage - startPage + 1,
      startPage,
      endPage: finalPage,
    });
    if (topicList.length === 0) {
      if (this.settings.readUnreadEnabled) {
        this.view.showNotification(this.t("noUnreadPosts"));
        this.settings.readUnreadEnabled = false;
        Storage.set("readUnreadEnabled", false);
        this.resetPageProgress();
        await this.getLatestTopics();
        if (!this.isRunCurrent(generation)) return topicList;
      } else if (this.settings.skipReadEnabled && startPage > 1) {
        console.log("[页码续读] 高页码无未读帖子，从第1页重新开始");
        this.resetPageProgress();
        this.historicalMaxPage = 0;
        Storage.set("historicalMaxPageData", null);
        await this.getLatestTopics();
        if (!this.isRunCurrent(generation)) return topicList;
      } else if (this.settings.skipReadEnabled) {
        this.view.showNotification("所有帖子都已读过，停止阅读");
        this.stopAutoReading();
      }
    }
    return topicList;
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  async getNextTopic() {
    const generation = this.runGeneration;
    if (!this.isRunCurrent(generation)) return null;
    if (this.topicList.length === 0) {
      await this.getLatestTopics();
    }
    if (!this.isRunCurrent(generation)) return null;
    while (this.topicList.length > 0) {
      const topic = this.topicList.shift();
      if (this.settings.skipReadEnabled && this.isTopicRead(topic.id.toString())) {
        console.log(`跳过已读帖子: ${topic.title} (ID: ${topic.id})`);
        this.skippedReadCount++;
        this.session.set("skippedReadCount", this.skippedReadCount);
        this.session.set("topicList", this.topicList);
        this.view.updateReadingStatus();
        continue;
      }
      this.session.set("topicList", this.topicList);
      return topic;
    }
    return null;
  }

  async startScrolling() {
    if (this.isScrolling || !this.autoRunning || this.scope.disposed) return;
    const generation = ++this.scrollGeneration;
    const isActive = () =>
      !this.scope.disposed && this.autoRunning && this.isScrolling && generation === this.scrollGeneration;
    this.isScrolling = true;
    this.view.setReadingRunning(true);
    this.lastActionTime = Date.now();
    const shouldReadFullTopic = this.settings.fullTopicReadEnabled && this.isTopicPage;
    if (shouldReadFullTopic) {
      window.scrollTo({ top: 0, behavior: "auto" });
      await this.sleep(300);
      if (!isActive()) return;
    }
    if (this.isTopicPage) {
      this.hooks.onActive();
      if (shouldReadFullTopic) {
        window.scrollTo({ top: 0, behavior: "auto" });
        await this.sleep(300);
        if (!isActive()) return;
      }
    }
    this.scrollStartTime = Date.now();
    const maxScrollTime = shouldReadFullTopic ? null : 3e4;
    while (isActive()) {
      const scrollPlan = this.getScrollPlan(shouldReadFullTopic);
      window.scrollBy({
        top: scrollPlan.step,
        behavior: scrollPlan.behavior,
      });
      if (Utils.isNearBottom()) {
        await this.sleep(800);
        if (!isActive()) return;
        if (!this.autoRunning) break;
        const canNavigate = shouldReadFullTopic
          ? await this.isTopicFullyRead()
          : Utils.isNearBottom() && Utils.isPageLoaded();
        if (!isActive()) return;
        if (canNavigate) {
          console.log("已到达页面底部，准备导航到下一篇文章...");
          await this.sleep(1e3);
          if (!isActive()) return;
          if (!this.autoRunning) break;
          this.isScrolling = false;
          await this.navigateNextTopic();
          return;
        }
      }
      const scrolledTime = Date.now() - this.scrollStartTime;
      if (maxScrollTime !== null && scrolledTime > maxScrollTime) {
        if (this.isTopicPage && this.hasUnreadTimelineBlueDot()) {
          console.log("[阅读确认] 检测到楼层小蓝点未消失，取消本次强制跳转并继续等待...");
          this.nudgeScrollForReadConfirmation();
          this.scrollStartTime = Date.now();
          continue;
        }
        console.log(`已在当前页面滚动${Math.floor(scrolledTime / 1e3)}秒，强制跳转到下一篇文章...`);
        this.isScrolling = false;
        await this.navigateNextTopic();
        return;
      }
      await this.sleep(scrollPlan.delay);
      if (!isActive()) return;
      this.accumulateTime();
      if (!isActive()) return;
      if (scrollPlan.allowFastScroll && Math.random() < CONFIG.scroll.fastScrollChance) {
        const fastScroll = Utils.random(CONFIG.scroll.fastScrollMin, CONFIG.scroll.fastScrollMax);
        window.scrollBy({
          top: fastScroll,
          behavior: "smooth",
        });
        await this.sleep(200);
        if (!isActive()) return;
      }
    }
  }

  stopScrolling() {
    this.scrollGeneration++;
    this.isScrolling = false;
    this.hooks.onPause("reading_paused");
    this.view.setReadingRunning(false);
  }

  accumulateTime() {
    const now = Date.now();
    this.accumulatedTime += now - this.lastActionTime;
    this.session.set("accumulatedTime", this.accumulatedTime);
    this.lastActionTime = now;
    if (this.accumulatedTime >= CONFIG.time.browseTime) {
      this.accumulatedTime = 0;
      this.session.set("accumulatedTime", 0);
      this.pauseForRest();
    }
  }

  async pauseForRest() {
    if (!this.autoRunning || this.scope.disposed) return;
    const generation = this.runGeneration;
    this.stopScrolling();
    const restMinutes = Math.floor(CONFIG.time.restTime / 6e4);
    console.log(`休息${restMinutes}分钟...`);
    this.view.showNotification(`⏸️ ${this.t("restStart")} ${restMinutes} ${this.t("minutes")}`);
    await this.sleep(CONFIG.time.restTime);
    if (!this.isRunCurrent(generation)) return;
    console.log("休息结束，继续浏览...");
    this.view.showNotification(`✅ ${this.t("restEnd")}`);
    this.startScrolling();
  }

  getCurrentTopicIdFromLocation() {
    const match = window.location.pathname.match(/\/t\/topic\/(\d+)/);
    return match ? String(match[1]) : null;
  }

  async waitForTopicNavigation(targetTopicId, timeout = 8e3) {
    const generation = this.runGeneration;
    if (!this.isRunCurrent(generation)) return false;
    const start = Date.now();
    const target = String(targetTopicId);
    while (this.isRunCurrent(generation) && Date.now() - start < timeout) {
      const currentTopicId = this.getCurrentTopicIdFromLocation();
      if (currentTopicId === target) {
        await this.sleep(300);
        const topicContent = document.querySelector(
          ".topic-post article, article[data-post-id], .post-stream",
        );
        if (topicContent) return true;
      }
      await this.sleep(150);
    }
    return false;
  }

  async onTopicNavigated(targetTopicId) {
    const generation = this.runGeneration;
    if (!this.isRunCurrent(generation)) return;
    console.log(`[导航后] 开始处理新帖子: ${targetTopicId}`);
    this.isTopicPage = window.location.pathname.includes("/t/topic/");
    this.pageLoadTime = Date.now();
    this.lastPageContextKey = this.getPageContextKey(window.location.href);
    this._topicMaxPostNumberTopicId = null;
    this._topicMaxPostNumber = null;
    await this.sleep(800);
    if (!this.isRunCurrent(generation)) return;
    try {
      this.view.updateReadingStatus?.();
    } catch (error) {
      console.warn("[导航后] updateReadingStatus 失败:", error);
    }
    if (this.autoRunning && this.isTopicPage && !this.isScrolling) {
      console.log("[导航后] 自动阅读仍开启，恢复滚动");
      this.startScrolling();
    }
  }

  getPageWindow() {
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow;
    } catch (_) {}
    return window;
  }

  getDiscourseRouter() {
    const lookupNames = ["router:main", "service:router", "router:application"];
    const lookupFrom = (source, label) => {
      if (!source || typeof source.lookup !== "function") return null;
      for (const name of lookupNames) {
        try {
          const router = source.lookup(name);
          if (router) {
            console.log(`[导航] 已从 ${label} 获取 router: ${name}`);
            return router;
          }
        } catch (_) {}
      }
      return null;
    };
    try {
      const container = this.getPageWindow().Discourse?.__container__;
      const router = lookupFrom(container, "Discourse.__container__");
      if (router) return router;
    } catch (error) {
      console.warn("[导航] 从 Discourse.__container__ 获取 router 失败:", error);
    }
    try {
      const req = this.getPageWindow().require;
      const app = typeof req === "function" ? req("__DISCOURSE_APP__") : null;
      const router = lookupFrom(app, "__DISCOURSE_APP__");
      if (router) return router;
    } catch (error) {
      console.warn("[导航] 从 __DISCOURSE_APP__ 获取 router 失败:", error);
    }
    try {
      const api = this.getPageWindow().Discourse?.__container__?.lookup?.("api:main");
      const router = api?.container ? lookupFrom(api.container, "api:main.container") : null;
      if (router) return router;
    } catch (error) {
      console.warn("[导航] 从 api:main 获取 router 失败:", error);
    }
    console.warn("[导航] 未找到可用的 Discourse/Ember router");
    return null;
  }

  findTopicAnchor(targetTopicId) {
    const target = String(targetTopicId);
    return (
      Array.from(document.querySelectorAll("a[href]")).find((anchor) => {
        const href = anchor.getAttribute("href") || "";
        return href === `/t/topic/${target}` || href.startsWith(`/t/topic/${target}/`);
      }) ||
      Array.from(document.querySelectorAll("a[href]")).find((anchor) => {
        const href = anchor.getAttribute("href") || "";
        return href.includes(`/t/topic/${target}`);
      })
    );
  }

  async waitAfterSoftNavigation(mode, targetTopicId) {
    console.log(`[导航] 已发起跳转，方式: ${mode}`);
    const ok = await this.waitForTopicNavigation(targetTopicId, 8e3);
    if (!ok) {
      console.warn(`[导航] 在等待期内未确认进入目标帖子: ${targetTopicId}`);
      return false;
    }
    console.log(`[导航] 已确认进入目标帖子: ${targetTopicId}`);
    if (this.navigationTimeout) {
      this.scope.clearTimeout(this.navigationTimeout);
      this.navigationTimeout = null;
    }
    await this.onTopicNavigated(targetTopicId);
    return true;
  }

  async tryRouteToWithDiscourseURL(target, targetTopicId, label) {
    if (!this.getPageWindow().DiscourseURL || typeof this.getPageWindow().DiscourseURL.routeTo !== "function")
      return false;
    try {
      console.log(`[导航] 尝试 DiscourseURL.routeTo(${label}):`, target);
      this.getPageWindow().DiscourseURL.routeTo(target);
      return await this.waitAfterSoftNavigation(`DiscourseURL.routeTo(${label})`, targetTopicId);
    } catch (error) {
      console.warn(`[导航] DiscourseURL.routeTo(${label}) 失败:`, error);
      return false;
    }
  }

  async tryRouterTransition(router, target, targetTopicId, label) {
    if (!router || typeof router.transitionTo !== "function") return false;
    try {
      console.log(`[导航] 尝试 router.transitionTo(${label}):`, target);
      router.transitionTo(target);
      return await this.waitAfterSoftNavigation(`router.transitionTo(${label})`, targetTopicId);
    } catch (error) {
      console.warn(`[导航] router.transitionTo(${label}) 失败:`, error);
      return false;
    }
  }

  async clickTopicLinkElement(anchor, targetTopicId, mode) {
    if (!anchor) return false;
    console.log(`[导航] 尝试链接点击(${mode}):`, anchor.href || anchor.getAttribute("href"));
    try {
      anchor.click();
    } catch (error) {
      console.warn(`[导航] anchor.click(${mode}) 失败，尝试 dispatchEvent:`, error);
      const eventWindow = anchor.ownerDocument?.defaultView;
      const EventCtor = eventWindow?.MouseEvent || MouseEvent;
      anchor.dispatchEvent(
        new EventCtor("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    }
    return await this.waitAfterSoftNavigation(`link.click(${mode})`, targetTopicId);
  }

  async clickTemporaryTopicLink(path, url, targetTopicId) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.setAttribute("href", path);
    anchor.removeAttribute("target");
    anchor.setAttribute("data-auto-route", "true");
    anchor.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:auto;";
    document.body.appendChild(anchor);
    try {
      return await this.clickTopicLinkElement(anchor, targetTopicId, "temporary-anchor");
    } finally {
      anchor.remove();
    }
  }

  async tryHistoryPushState(path, targetTopicId) {
    try {
      const pageWindow = this.getPageWindow();
      console.log("[导航] 尝试 history.pushState:", path);
      pageWindow.history.pushState({}, "", path);
      const PopStateEventCtor = pageWindow.PopStateEvent || PopStateEvent;
      pageWindow.dispatchEvent(new PopStateEventCtor("popstate"));
      return await this.waitAfterSoftNavigation("history.pushState", targetTopicId);
    } catch (error) {
      console.warn("[导航] history.pushState 失败:", error);
      return false;
    }
  }

  async softNavigateToTopic(path, url, targetTopicId) {
    const generation = this.runGeneration;
    if (!this.isRunCurrent(generation)) return false;
    this.hooks.onPause("topic_changed");
    if (this.navigationTimeout) {
      this.scope.clearTimeout(this.navigationTimeout);
      this.navigationTimeout = null;
    }
    this.navigationTimeout = this.scope.setTimeout(() => {
      if (!this.isRunCurrent(generation)) return;
      const currentTopicId = this.getCurrentTopicIdFromLocation();
      if (currentTopicId !== String(targetTopicId)) {
        console.warn("⚠️ 路由跳转超时，fallback 到原生跳转:", url);
        window.location.assign(url);
      } else {
        console.log("✅ 已经进入目标帖子，取消 fallback");
      }
    }, 12e3);
    try {
      if (await this.tryRouteToWithDiscourseURL(path, targetTopicId, "path")) return true;
      if (!this.isRunCurrent(generation)) return false;
      if (await this.tryRouteToWithDiscourseURL(url, targetTopicId, "url")) return true;
      if (!this.isRunCurrent(generation)) return false;
      const router = this.getDiscourseRouter();
      if (await this.tryRouterTransition(router, path, targetTopicId, "path")) return true;
      if (!this.isRunCurrent(generation)) return false;
      if (await this.tryRouterTransition(router, url, targetTopicId, "url")) return true;
      if (!this.isRunCurrent(generation)) return false;
      const candidate = this.findTopicAnchor(targetTopicId);
      if (await this.clickTopicLinkElement(candidate, targetTopicId, "existing-anchor")) return true;
      if (!this.isRunCurrent(generation)) return false;
      if (await this.clickTemporaryTopicLink(path, url, targetTopicId)) return true;
      if (!this.isRunCurrent(generation)) return false;
      if (await this.tryHistoryPushState(path, targetTopicId)) return true;
      if (!this.isRunCurrent(generation)) return false;
      console.warn("[导航] 所有软跳转方案失败，使用原生跳转:", url);
      window.location.assign(url);
      return false;
    } catch (error) {
      if (!this.isRunCurrent(generation)) return false;
      console.error("[导航] 跳转异常，fallback 到原生跳转:", error);
      window.location.assign(url);
      return false;
    }
  }

  async navigateNextTopic() {
    const generation = this.runGeneration;
    if (!this.isRunCurrent(generation)) return;
    this.hooks.onPause("navigating");
    if (this.isTopicPage && !(await this.waitForTopicReadConfirmation())) {
      if (!this.isRunCurrent(generation)) return;
      console.log("[阅读确认] 楼层小蓝点未消失，已取消跳转下一篇");
      if (this.autoRunning && !this.isScrolling) this.startScrolling();
      return;
    }
    if (!this.isRunCurrent(generation)) return;
    if (
      this.settings.stopAfterReadEnabled &&
      this.currentSessionReadCount >= this.settings.stopAfterReadCount
    ) {
      console.log(
        `已达到阅读数量限制 (${this.currentSessionReadCount}/${this.settings.stopAfterReadCount})，自动停止`,
      );
      this.view.showNotification(this.t("stoppedByReadLimit"));
      this.stopAutoReading();
      return;
    }
    if (!this.hooks.canRead()) {
      this.stopAutoReading();
      return;
    }
    const nextTopic = await this.getNextTopic();
    if (!this.isRunCurrent(generation)) return;
    if (!nextTopic) {
      console.log("没有更多文章，返回首页");
      window.location.assign(`${BASE_URL}/latest`);
      return;
    }
    console.log("导航到新文章:", nextTopic.title);
    this.incrementTodayReadCount();
    this.currentSessionReadCount++;
    this.session.set("currentSessionReadCount", this.currentSessionReadCount);
    console.log(`当前会话已阅读: ${this.currentSessionReadCount}/${this.settings.stopAfterReadCount}`);
    this.view.updateReadingStatus();
    const currentMatch = window.location.pathname.match(/\/t\/topic\/(\d+)/);
    if (currentMatch) {
      const currentTopicId = currentMatch[1];
      await this.saveUserReadHistory(currentTopicId);
    }
    if (!this.isRunCurrent(generation)) return;
    const targetTopicId = String(nextTopic.id);
    const path = this.settings.fullTopicReadEnabled
      ? `/t/topic/${nextTopic.id}`
      : nextTopic.last_read_post_number
        ? `/t/topic/${nextTopic.id}/${nextTopic.last_read_post_number}`
        : `/t/topic/${nextTopic.id}`;
    const url = `${BASE_URL}${path}`;
    console.log("正在跳转到:", url);
    await this.softNavigateToTopic(path, url, targetTopicId);
  }

  stopAutoReading({ preserveSession = false } = {}) {
    this.runGeneration++;
    this.stopScrolling();
    this.stopNavigationGuard();
    this.autoRunning = false;
    if (!preserveSession) this.session.set("autoRunning", false);
    this.view.setReadingRunning(false);
    if (this.navigationTimeout) {
      this.scope.clearTimeout(this.navigationTimeout);
      this.navigationTimeout = null;
    }
    console.log("自动阅读已停止");
  }

  async loadUserReadHistory() {
    const username = await this.getCurrentUsername();
    if (!username) {
      console.log("未获取到用户名，无法加载阅读历史");
      this.readTopics = [];
      return;
    }
    const storageKey = `readTopics_${username}`;
    this.readTopics = Storage.get(storageKey, []);
    console.log(`已加载用户 ${username} 的阅读历史，共 ${this.readTopics.length} 篇帖子`);
    if (this.readTopics.length > this.totalReadCount) {
      console.log(`[数据同步] 总阅读数从 ${this.totalReadCount} 更新为 ${this.readTopics.length}`);
      this.totalReadCount = this.readTopics.length;
      Storage.set("totalReadCount", this.totalReadCount);
      this.view.updateReadStatsDisplay();
    }
  }

  async saveUserReadHistory(topicId) {
    const username = await this.getCurrentUsername();
    if (!username) {
      console.log("未获取到用户名，无法保存阅读历史");
      return;
    }
    if (!this.readTopics.includes(topicId)) {
      this.readTopics.push(topicId);
      if (this.readTopics.length > 1e3) {
        this.readTopics = this.readTopics.slice(-1e3);
      }
      const storageKey = `readTopics_${username}`;
      Storage.set(storageKey, this.readTopics);
      console.log(`已保存帖子 ${topicId} 到用户 ${username} 的阅读历史`);
    }
  }

  isTopicRead(topicId) {
    return this.readTopics.includes(topicId);
  }

  loadTodayReadCount() {
    const now = /* @__PURE__ */ new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const savedData = Storage.get("todayReadStats", null);
    console.log(`[今日阅读] 当前日期: ${today}, 保存的数据:`, savedData);
    if (savedData && savedData.date) {
      const savedDate = savedData.date;
      const isToday = savedDate === today || savedDate === now.toDateString();
      if (isToday) {
        console.log(`[今日阅读] 日期匹配，返回已保存的计数: ${savedData.count}`);
        return savedData.count;
      }
    }
    console.log(`[今日阅读] 新的一天或无数据，重置计数为0`);
    Storage.set("todayReadStats", { date: today, count: 0 });
    return 0;
  }

  incrementTodayReadCount() {
    const now = /* @__PURE__ */ new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const savedData = Storage.get("todayReadStats", null);
    if (savedData && savedData.date) {
      const savedDate = savedData.date;
      const isToday = savedDate === today || savedDate === now.toDateString();
      if (!isToday) {
        console.log(`[今日阅读] 检测到跨天！旧日期: ${savedDate}, 新日期: ${today}，重置今日计数`);
        this.todayReadCount = 0;
      }
    }
    this.todayReadCount++;
    this.totalReadCount++;
    Storage.set("todayReadStats", { date: today, count: this.todayReadCount });
    Storage.set("totalReadCount", this.totalReadCount);
    console.log(`今日已阅读 ${this.todayReadCount} 篇帖子，总阅读 ${this.totalReadCount} 篇`);
    this.view.updateReadStatsDisplay();
  }

  loadHistoricalMaxPage() {
    const today = /* @__PURE__ */ new Date().toDateString();
    const savedData = Storage.get("historicalMaxPageData", null);
    if (savedData) {
      if (savedData.date === today) {
        console.log(`[页码续读] 今日已读最大页码: ${savedData.maxPage}`);
        return savedData.maxPage;
      }
      console.log(`[页码续读] 新的一天，继承昨日最大页码: ${savedData.maxPage}`);
      return savedData.maxPage;
    }
    return 0;
  }

  saveHistoricalMaxPage(page) {
    const today = /* @__PURE__ */ new Date().toDateString();
    const currentMax = this.historicalMaxPage || 0;
    if (page > currentMax) {
      this.historicalMaxPage = page;
      Storage.set("historicalMaxPageData", { date: today, maxPage: page });
      console.log(`[页码续读] 更新历史最大页码: ${page}`);
    }
  }

  getStartPage() {
    if (this.lastFetchedPage > 0) {
      console.log(`[页码续读] 使用会话内上次页码: ${this.lastFetchedPage + 1}`);
      return this.lastFetchedPage + 1;
    }
    if (this.historicalMaxPage > 0) {
      console.log(`[页码续读] 使用历史最大页码: ${this.historicalMaxPage + 1}`);
      return this.historicalMaxPage + 1;
    }
    return 1;
  }

  resetPageProgress() {
    this.lastFetchedPage = 0;
    this.session.set("lastFetchedPage", 0);
    console.log("[页码续读] 已重置会话页码");
  }

  startNavigationGuard() {
    if (this.navigationGuardInterval) {
      this.scope.clearInterval(this.navigationGuardInterval);
    }
    this.pageLoadTime = Date.now();
    this.lastPageContextKey = this.getPageContextKey(window.location.href);
    this.navigationGuardInterval = this.scope.setInterval(() => {
      if (!this.autoRunning) return;
      const currentTime = Date.now();
      const timeOnPage = currentTime - this.pageLoadTime;
      const currentPageContextKey = this.getPageContextKey(window.location.href);
      if (currentPageContextKey !== this.lastPageContextKey) {
        console.log("✅ 页面已跳转，重置守护定时器");
        this.hooks.onPause("topic_changed");
        this.pageLoadTime = currentTime;
        this.lastPageContextKey = currentPageContextKey;
        this.isTopicPage = window.location.pathname.includes("/t/topic/");
        if (this.autoRunning && this.isTopicPage && !this.isScrolling) {
          console.log("🛡️ 守护检测到新文章页且未滚动，尝试恢复滚动");
          this.startScrolling();
        }
        return;
      }
      if (this.isPageLoadingStalled(timeOnPage)) {
        console.warn("⚠️ 检测到页面持续加载超时，停止自动阅读");
        this.view.showNotification(this.t("stoppedByPageLoading"));
        this.stopAutoReading();
        return;
      }
      if (this.isTopicPage && timeOnPage > 6e4 && !this.isScrolling) {
        console.warn("⚠️ 检测到页面可能卡住（60秒未跳转且未滚动），尝试恢复...");
        this.recoverFromStuck();
      }
      if (!this.isTopicPage && timeOnPage > 3e4) {
        console.warn("⚠️ 检测到在非文章页卡住，尝试恢复...");
        this.recoverFromStuck();
      }
    }, 5e3);
    console.log("🛡️ 导航守护程序已启动");
  }

  stopNavigationGuard() {
    if (this.navigationGuardInterval) {
      this.scope.clearInterval(this.navigationGuardInterval);
      this.navigationGuardInterval = null;
      console.log("🛡️ 导航守护程序已停止");
    }
  }
}
