import { CURRENT_DOMAIN } from "../core/runtime-context.js";

const cloudflareMethods = {
  isChallengePage() {
    return window.location.pathname.startsWith(this.CF_BYPASS_CONFIG.CHALLENGE_PATH);
  },
  isNotFoundPage() {
    return Boolean(document.querySelector(".page-not-found"));
  },
  getRedirectParamUrl() {
    try {
      const raw = new URLSearchParams(window.location.search).get("redirect");
      if (!raw) return void 0;
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return void 0;
      return url.href;
    } catch (_) {
      return void 0;
    }
  },
  getNotFoundRedirectGuardTs() {
    try {
      const raw = sessionStorage.getItem(this.CF_BYPASS_CONFIG.NOT_FOUND_REDIRECT_GUARD_KEY);
      const timestamp = raw ? Number(raw) : 0;
      return Number.isFinite(timestamp) ? timestamp : 0;
    } catch (_) {
      return 0;
    }
  },
  setNotFoundRedirectGuardTs(timestamp) {
    try {
      sessionStorage.setItem(this.CF_BYPASS_CONFIG.NOT_FOUND_REDIRECT_GUARD_KEY, String(timestamp));
    } catch (_) {}
  },
  scheduleCFRedirect(url, replace, message) {
    if (this.cfBypassRedirecting) return false;
    this.cfBypassRedirecting = true;
    const navigate = () => {
      this.cfBypassRedirectTimer = null;
      try {
        if (replace) {
          window.location.replace(url);
        } else {
          window.location.href = url;
        }
      } catch (error) {
        this.cfBypassRedirecting = false;
        console.warn("[CF Challenge] 重定向失败:", error);
      }
    };
    try {
      this.cfBypassRedirectTimer = setTimeout(navigate, this.CF_BYPASS_CONFIG.REDIRECT_DELAY_MS);
    } catch (error) {
      this.cfBypassRedirecting = false;
      console.warn("[CF Challenge] 安排重定向失败:", error);
      return false;
    }
    try {
      if (message) this.panel.showNotification(message);
    } catch (error) {
      console.warn("[CF Challenge] 显示通知失败:", error);
    }
    return true;
  },
  redirectFromNotFoundPage() {
    const fallback = `${window.location.origin}/`;
    const target = this.getRedirectParamUrl() || fallback;
    const now = Date.now();
    const guardTimestamp = this.getNotFoundRedirectGuardTs();
    if (guardTimestamp && now - guardTimestamp < this.CF_BYPASS_CONFIG.NOT_FOUND_REDIRECT_GUARD_MS) {
      return false;
    }
    this.setNotFoundRedirectGuardTs(now);
    const destination = target === window.location.href ? fallback : target;
    return this.scheduleCFRedirect(destination, true, this.t("cfBypassNotFoundRedirecting"));
  },
  isChallengeFailure() {
    if (this.isChallengePage()) return false;
    try {
      const dialogElement = document.querySelector(this.CF_BYPASS_CONFIG.DIALOG_SELECTOR);
      if (!dialogElement) return false;
      const text = dialogElement.textContent || "";
      return this.CF_BYPASS_CONFIG.ERROR_TEXTS.some((errorText) => text.includes(errorText));
    } catch (error) {
      console.warn("[CF Challenge] 检测失败页面时出错:", error);
      return false;
    }
  },
  redirectToChallenge(message = this.t("cfBypassDetected")) {
    if (this.isChallengePage()) return false;
    if (this.reader.autoRunning || this.reader.isScrolling) {
      // Resume from the existing session after returning from the challenge.
      this.reader.stopAutoReading({ preserveSession: true });
    }
    const url = `${this.CF_BYPASS_CONFIG.CHALLENGE_PATH}?redirect=${encodeURIComponent(window.location.href)}`;
    return this.scheduleCFRedirect(url, false, message);
  },
  checkAndRedirectCF(observer = null) {
    if (!this.isChallengeFailure()) return false;
    observer?.disconnect();
    if (observer === this.cfBypassObserver) this.cfBypassObserver = null;
    this.redirectToChallenge();
    return true;
  },
  stopCloudFlareBypass() {
    if (this.cfBypassObserver) {
      this.cfBypassObserver.disconnect();
      this.cfBypassObserver = null;
    }
    if (this.cfBypassRedirectTimer !== null) {
      clearTimeout(this.cfBypassRedirectTimer);
      this.cfBypassRedirectTimer = null;
    }
    this.cfBypassRedirecting = false;
  },
  initCloudFlareBypass() {
    if (CURRENT_DOMAIN !== "linux.do") return;
    if (!this.settings.cfBypassEnabled) {
      this.stopCloudFlareBypass();
      return;
    }
    if (this.cfBypassObserver) {
      this.cfBypassObserver.disconnect();
      this.cfBypassObserver = null;
    }
    if (this.isChallengePage()) {
      if (this.isNotFoundPage()) this.redirectFromNotFoundPage();
      return;
    }
    if (this.checkAndRedirectCF()) return;
    if (!document.body) {
      setTimeout(() => this.initCloudFlareBypass(), 0);
      return;
    }
    const observer = new MutationObserver((_mutations, obs) => {
      if (this.isChallengePage()) {
        if (this.isNotFoundPage() && this.redirectFromNotFoundPage()) obs.disconnect();
        return;
      }
      this.checkAndRedirectCF(obs);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.cfBypassObserver = observer;
  },
  manualTriggerCF() {
    if (this.isChallengePage()) {
      if (this.isNotFoundPage()) {
        this.redirectFromNotFoundPage();
      } else {
        this.panel.showNotification(this.t("cfBypassAlreadyOnChallenge"));
      }
      return;
    }
    this.redirectToChallenge(this.t("cfBypassRedirecting"));
  },
};

export { cloudflareMethods };
