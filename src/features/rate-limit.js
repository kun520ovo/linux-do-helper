import { isHeartToggleUrl } from "../core/runtime-context.js";
import { Storage } from "../core/storage.js";
import { LikeCooldown } from "../core/like-cooldown.js";
import { networkInterceptor } from "../core/network-interceptor.js";
import { DisposableScope } from "../core/disposable-scope.js";

export class RateLimit {
  constructor({
    getAccountContext,
    onLikeLimited,
    onCooldownChanged,
    onIpLimited,
    onIpRecovered,
    notify,
    t,
  }) {
    this.getAccountContext = getAccountContext;
    this.onLikeLimited = onLikeLimited;
    this.onCooldownChanged = onCooldownChanged;
    this.onIpLimited = onIpLimited;
    this.onIpRecovered = onIpRecovered;
    this.notify = notify;
    this.t = t;
    this.scope = new DisposableScope();
    this.ipRateLimitResumeTime = Storage.get("ipRateLimitResumeTime", null);
    this.ipRateLimitCheckInterval = null;
    this.likePeriods = new Map();
  }

  start() {
    if (this.started || this.scope.disposed) return;
    this.started = true;
    this.checkLikeResumeTime();
    this.observeLikeLimit();
    this.checkIpRateLimitStatus();
    this.detectIpRateLimit();
  }

  getLikeResumeTime() {
    return LikeCooldown.read(this.getAccountContext().key);
  }

  isLikeCoolingDown() {
    const until = this.getLikeResumeTime();
    return !!(until && Date.now() < until);
  }

  isIpRateLimited() {
    return !!(this.ipRateLimitResumeTime && Date.now() < this.ipRateLimitResumeTime);
  }

  clearLikeCooldown() {
    const context = this.getAccountContext();
    const primaryKey = context.counterKey || context.key;
    if (!primaryKey) return false;
    const keys = new Set([primaryKey]);
    const usernames = [];
    if (context.counterKey === primaryKey) usernames.push(context.counterUsername);
    if (context.key === primaryKey) usernames.push(context.username);
    for (const username of usernames) {
      const normalized = String(username || "")
        .trim()
        .replace(/^@/, "")
        .trim()
        .toLowerCase();
      if (normalized) keys.add(`username:${normalized}`);
    }
    if (!LikeCooldown.clear([...keys])) return false;
    for (const key of keys) this.likePeriods.delete(key || "legacy");
    this.onCooldownChanged();
    return true;
  }

  destroy() {
    this._likeLimitInterceptorUnsubscribe?.();
    this.scope.dispose();
  }

  checkLikeResumeTime() {
    if (!Number.isFinite(this.getLikeResumeTime())) {
      console.warn("[点赞冷却] 状态暂不可用，智能点赞保持暂停");
      return;
    }
    if (this.getLikeResumeTime() > Date.now()) {
      console.log(
        `[点赞冷却] 将于 ${new Date(this.getLikeResumeTime()).toLocaleString()} 结束，结束后需手动开启智能点赞`,
      );
    }
  }

  detectIpRateLimit() {
    const isNormalPage =
      document.querySelector("#main-outlet") ||
      document.querySelector(".topic-list") ||
      document.querySelector(".topic-post") ||
      document.querySelector(".d-header") ||
      document.querySelector(".ember-application") ||
      document.querySelector("[data-discourse-helper]");
    if (isNormalPage) {
      if (this.ipRateLimitResumeTime) {
        console.log("[IP限流] 检测到正常页面，清除之前的限流状态");
        this.ipRateLimitResumeTime = null;
        Storage.set("ipRateLimitResumeTime", null);
        this.stopIpRateLimitRecoveryCheck();
      }
      return false;
    }
    const pageText = document.body?.innerText || "";
    const rateLimitIndicators = [
      "You are being rate limited",
      "We have banned you temporarily",
      "Too Many Requests",
      "Error 429",
      "HTTP 429",
    ];
    const isRateLimited = rateLimitIndicators.some((indicator) => pageText.includes(indicator));
    const pageTitle = document.title || "";
    const titleRateLimited =
      pageTitle.includes("Rate Limited") || pageTitle.includes("429") || pageTitle.includes("Banned");
    const isShortPage = pageText.length < 2e3;
    if ((isRateLimited || titleRateLimited) && isShortPage) {
      console.warn("🚫 [IP限流] 检测到 IP 被限流！");
      this.handleIpRateLimit();
      return true;
    }
    return false;
  }

  handleIpRateLimit() {
    if (this.ipRateLimitResumeTime && Date.now() < this.ipRateLimitResumeTime) {
      console.log("[IP限流] 已在等待恢复中，跳过");
      return;
    }
    const waitTime = 30 * 60 * 1e3;
    this.ipRateLimitResumeTime = Date.now() + waitTime;
    Storage.set("ipRateLimitResumeTime", this.ipRateLimitResumeTime);
    this.onIpLimited();
    const resumeTime = new Date(this.ipRateLimitResumeTime);
    this.notify(`${this.t("ipRateLimited")}
${this.t("ipRateLimitWait")} (${resumeTime.toLocaleTimeString()})`);
    console.log(`[IP限流] 自动阅读已暂停，将在 ${resumeTime.toLocaleString()} 后自动恢复`);
    this.startIpRateLimitRecoveryCheck();
  }

  checkIpRateLimitStatus() {
    if (this.ipRateLimitResumeTime) {
      const now = Date.now();
      const isNormalPage =
        document.querySelector("#main-outlet") ||
        document.querySelector(".topic-list") ||
        document.querySelector(".topic-post") ||
        document.querySelector(".d-header") ||
        document.querySelector(".ember-application");
      if (isNormalPage) {
        console.log("[IP限流] 当前是正常页面，清除之前的限流状态（可能是误判）");
        this.ipRateLimitResumeTime = null;
        Storage.set("ipRateLimitResumeTime", null);
        return;
      }
      if (now >= this.ipRateLimitResumeTime) {
        console.log("[IP限流] 限流时间已过，清除状态");
        this.ipRateLimitResumeTime = null;
        Storage.set("ipRateLimitResumeTime", null);
      } else {
        const remainingMinutes = Math.ceil((this.ipRateLimitResumeTime - now) / (1e3 * 60));
        const resumeTime = new Date(this.ipRateLimitResumeTime);
        console.log(
          `[IP限流] IP 限流中，还需约 ${remainingMinutes} 分钟，将在 ${resumeTime.toLocaleString()} 后恢复`,
        );
        this.onIpLimited();
        this.startIpRateLimitRecoveryCheck();
      }
    }
  }

  startIpRateLimitRecoveryCheck() {
    if (this.ipRateLimitCheckInterval) {
      this.scope.clearInterval(this.ipRateLimitCheckInterval);
    }
    this.ipRateLimitCheckInterval = this.scope.setInterval(() => {
      if (!this.ipRateLimitResumeTime) {
        this.scope.clearInterval(this.ipRateLimitCheckInterval);
        this.ipRateLimitCheckInterval = null;
        return;
      }
      const now = Date.now();
      if (now >= this.ipRateLimitResumeTime) {
        console.log("[IP限流] 限流时间到，尝试恢复...");
        this.tryResumeAfterIpRateLimit();
      } else {
        const remainingMinutes = Math.ceil((this.ipRateLimitResumeTime - now) / (1e3 * 60));
        console.log(`[IP限流] 等待恢复中，还需 ${remainingMinutes} 分钟`);
      }
    }, 6e4);
    console.log("[IP限流] 恢复检测定时器已启动");
  }

  tryResumeAfterIpRateLimit() {
    this.ipRateLimitResumeTime = null;
    Storage.set("ipRateLimitResumeTime", null);
    if (this.ipRateLimitCheckInterval) {
      this.scope.clearInterval(this.ipRateLimitCheckInterval);
      this.ipRateLimitCheckInterval = null;
    }
    this.notify(this.t("ipRateLimitResume"));
    console.log("[IP限流] IP 限流已解除，可以恢复自动阅读");
    this.onIpRecovered();
  }

  stopIpRateLimitRecoveryCheck() {
    if (this.ipRateLimitCheckInterval) {
      this.scope.clearInterval(this.ipRateLimitCheckInterval);
      this.ipRateLimitCheckInterval = null;
      console.log("[IP限流] 恢复检测定时器已停止");
    }
  }

  observeLikeLimit() {
    this._likeLimitHandledByAPI = false;
    this._lastLikeLimitTime = 0;
    this._likeLimitPopupLastTime = 0;
    this._likeLimitPopupTimeout = null;
    this.interceptFetchForLikeLimit();
    const self = this;
    const observer = new MutationObserver((mutations) => {
      const now = Date.now();
      if (now - self._likeLimitPopupLastTime < 500) {
        return;
      }
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            const isModalElement =
              node.classList.contains("modal") ||
              node.classList.contains("d-modal") ||
              node.classList.contains("bootbox") ||
              node.classList.contains("dialog-body") ||
              node.classList.contains("popup-menu") ||
              node.closest?.(".modal, .d-modal, .bootbox, .dialog-container, .fk-d-modal") ||
              node.querySelector?.(".modal, .d-modal, .bootbox, .dialog-body, .fk-d-modal__inner");
            if (!isModalElement) {
              continue;
            }
            const text = node.textContent || "";
            const isLikeLimit =
              (text.includes("点赞上限") ||
                text.includes("分享很多爱") ||
                (text.includes("点赞") && /(?:小时|分钟)后再次点赞/.test(text))) &&
              !text.includes("回复") &&
              !text.includes("创建更多新回复");
            if (isLikeLimit) {
              self._likeLimitPopupLastTime = now;
              if (self._likeLimitPopupTimeout) {
                this.scope.clearTimeout(self._likeLimitPopupTimeout);
              }
              self._likeLimitPopupTimeout = this.scope.setTimeout(() => {
                const currentTime = Date.now();
                if (self._likeLimitHandledByAPI && currentTime - self._lastLikeLimitTime < 2e3) {
                  console.log("[点赞限制] XHR 已处理，DOM 监听器仅关闭弹窗");
                } else {
                  console.log("[点赞限制] XHR 未处理，使用 DOM 解析作为备用");
                  self.handleLikeLimit(text);
                }
                self.closeLikeLimitPopup();
              }, 300);
              return;
            }
          }
        }
      }
    });
    this.scope.add(() => observer.disconnect());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  interceptFetchForLikeLimit() {
    if (this._likeLimitInterceptorsInstalled) return;
    this._likeLimitInterceptorsInstalled = true;
    const self = this;
    const captureRequest = (url, method) => {
      if (!isHeartToggleUrl(url, method)) return null;
      self._likeLimitHandledByAPI = false;
      self._lastLikeLimitTime = 0;
      const context = {
        url,
        method,
        accountKey: self.getAccountContext().key,
        startedAt: Date.now(),
      };
      self._lastHeartRequestContext = context;
      return context;
    };
    const handleResponse = (context, status, data, retryAfter) => {
      if (status >= 200 && status < 300) return;
      if (status !== 429 && data?.error_type !== "rate_limit") return;
      context.retryAfter = retryAfter;
      context.rateLimited = true;
      self.handleSmartLike429(
        data?.extras?.wait_seconds,
        data?.extras?.time_left,
        context.url,
        context.method,
        {
          accountKey: context.accountKey,
          retryAfter,
          responseAt: context.responseAt,
        },
      );
    };
    this._likeLimitInterceptorUnsubscribe?.();
    this._likeLimitInterceptorUnsubscribe = networkInterceptor.register({
      beforeRequest(request) {
        return captureRequest(request.url, request.method);
      },
      async afterResponse({ request, response, context }) {
        if (!context) return;
        context.responseAt = Date.now();
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
        const retryAfter =
          request.transport === "fetch"
            ? response.headers?.get?.("Retry-After")
            : response.getResponseHeader?.("Retry-After");
        handleResponse(context, response.status, data, retryAfter);
      },
    });
    console.log("[点赞限制] 已启用共享网络拦截器");
  }

  handleSmartLike429(waitSeconds, timeLeft, sourceUrl, sourceMethod = "PUT", options = {}) {
    if (this.scope.disposed) return false;
    if (!isHeartToggleUrl(sourceUrl, sourceMethod)) return false;
    const now = Date.now();
    const accountKey = Object.prototype.hasOwnProperty.call(options, "accountKey")
      ? options.accountKey
      : this.getAccountContext().key;
    const seconds = Number(waitSeconds);
    let nextResumeTime = Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1e3 : 0;
    let dialogDisplayTime = "";
    if (!nextResumeTime && options.fromDialog) {
      const text = String(timeLeft || "");
      let waitMinutes = 0;
      let parsed = false;
      const minuteMatch = text.match(/(?:在|可以在)\s*(\d+)\s*分钟后/);
      if (minuteMatch) {
        waitMinutes = parseInt(minuteMatch[1], 10);
        parsed = true;
      } else {
        const hourMatch = text.match(/(?:在|可以在)\s*(\d+)\s*小时后/);
        if (hourMatch) {
          waitMinutes = parseInt(hourMatch[1], 10) * 60;
          parsed = true;
        } else {
          const allMinuteMatches = text.match(/(\d+)\s*分钟/g);
          const allHourMatches = text.match(/(\d+)\s*小时/g);
          if (allMinuteMatches?.length) {
            const match = allMinuteMatches[allMinuteMatches.length - 1].match(/(\d+)/);
            if (match) {
              waitMinutes = parseInt(match[1], 10);
              parsed = true;
            }
          } else if (allHourMatches?.length) {
            const match = allHourMatches[allHourMatches.length - 1].match(/(\d+)/);
            if (match) {
              waitMinutes = parseInt(match[1], 10) * 60;
              parsed = true;
            }
          }
        }
      }
      if (!parsed) {
        waitMinutes = 10 * 60;
        console.log(`[点赞限制] 未能提取等待时间，使用默认值: 10 小时 = ${waitMinutes} 分钟`);
      }
      nextResumeTime = now + waitMinutes * 60 * 1e3;
      dialogDisplayTime =
        waitMinutes >= 60
          ? `${Math.floor(waitMinutes / 60)}${this.t("hours")}${waitMinutes % 60 > 0 ? (waitMinutes % 60) + this.t("minutes") : ""}`.trim()
          : `${waitMinutes}${this.t("minutes")}`;
    }
    if (!nextResumeTime) return false;
    nextResumeTime = Math.max(now + 1e3, nextResumeTime);
    const storedUntil = LikeCooldown.read(accountKey);
    this.likePeriods || (this.likePeriods = /* @__PURE__ */ new Map());
    const periodKey = accountKey || "legacy";
    const previous = this.likePeriods.get(periodKey);
    const alreadyCleaned = !!(previous?.cleaned && previous.until > now && storedUntil > now);
    const resumeTime = LikeCooldown.extend(accountKey, nextResumeTime);
    const period = { until: resumeTime, cleaned: alreadyCleaned };
    this.likePeriods.set(periodKey, period);
    if (accountKey !== this.getAccountContext().key) return resumeTime;
    if (!options.fromDialog) {
      this._likeLimitHandledByAPI = true;
      this._lastLikeLimitTime = now;
    }
    if (alreadyCleaned) {
      this.onCooldownChanged();
      return resumeTime;
    }
    period.cleaned = true;
    this.onLikeLimited({ accountKey, resumeTime });
    if (Number.isFinite(resumeTime)) {
      const display =
        options.fromDialog && dialogDisplayTime
          ? dialogDisplayTime
          : timeLeft || `${Math.ceil((resumeTime - now) / 6e4)}${this.t("minutes")}`;
      this.notify(`${this.t("likeLimitReached")}${display}`);
      console.warn(`[点赞限制] 已进入冷却，至 ${new Date(resumeTime).toLocaleString()}`);
    } else {
      this.notify("点赞状态暂不可用，智能点赞已关闭");
    }
    return resumeTime;
  }

  handleLikeLimit(text) {
    const context = this._lastHeartRequestContext;
    if (
      !context?.accountKey ||
      context.accountKey !== this.getAccountContext().key ||
      !isHeartToggleUrl(context.url, context.method) ||
      Date.now() - (context.responseAt || context.startedAt) > 3e3
    )
      return false;
    if (!/(点赞上限|分享很多爱|点赞.*(?:分钟|小时).*点赞)/.test(String(text || ""))) return false;
    return this.handleSmartLike429(null, text, context.url, context.method, {
      accountKey: context.accountKey,
      retryAfter: context.retryAfter,
      responseAt: context.responseAt,
      fromDialog: true,
    });
  }

  closeLikeLimitPopup() {
    console.log("[点赞限制] 尝试关闭弹窗...");
    const buttonSelectors = [
      ".dialog-footer .btn-primary",
      ".modal-footer .btn-primary",
      ".d-modal__footer .btn-primary",
      ".bootbox .btn-primary",
      "button.btn-primary",
      "button.btn-default",
      ".modal-close",
      ".close-modal",
      ".d-modal__dismiss",
      'button[aria-label="关闭"]',
      'button[aria-label="Close"]',
      ".dialog-close",
      ".d-modal__dismiss-icon",
      ".modal-header .close",
    ];
    for (const selector of buttonSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (element.offsetParent === null) continue;
        const text = (element.textContent || "").trim();
        if (
          selector.includes("btn-primary") ||
          text.includes("确定") ||
          text.includes("OK") ||
          text.includes("关闭") ||
          text.includes("好") ||
          element.classList.contains("modal-close") ||
          element.classList.contains("close-modal") ||
          element.classList.contains("d-modal__dismiss")
        ) {
          console.log(`[点赞限制] 找到关闭按钮: ${selector}, 文本: "${text}"`);
          try {
            element.click();
            console.log("[点赞限制] 已点击关闭按钮");
            return;
          } catch (e) {
            console.error("[点赞限制] 点击按钮失败:", e);
          }
        }
      }
    }
    const modalSelectors = [".modal", ".d-modal", ".bootbox", ".dialog-body", '[role="dialog"]'];
    for (const modalSelector of modalSelectors) {
      const modal = document.querySelector(modalSelector);
      if (modal && modal.offsetParent !== null) {
        const buttons = modal.querySelectorAll("button");
        for (const btn of buttons) {
          const text = (btn.textContent || "").trim();
          if (
            text.includes("确定") ||
            text.includes("OK") ||
            text.includes("关闭") ||
            text.includes("好") ||
            btn.classList.contains("btn-primary")
          ) {
            console.log(`[点赞限制] 在弹窗内找到按钮: "${text}"`);
            try {
              btn.click();
              console.log("[点赞限制] 已点击弹窗内按钮");
              return;
            } catch (e) {
              console.error("[点赞限制] 点击弹窗内按钮失败:", e);
            }
          }
        }
      }
    }
    console.log("[点赞限制] 未找到关闭按钮，尝试按 Escape 键");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
      }),
    );
    this.scope.setTimeout(() => {
      const visibleButtons = document.querySelectorAll(".dialog-footer button, .modal-footer button");
      for (const btn of visibleButtons) {
        if (btn.offsetParent !== null) {
          console.log(`[点赞限制] 延迟后找到按钮: "${btn.textContent}"`);
          btn.click();
          return;
        }
      }
    }, 500);
  }
}
