import { CURRENT_DOMAIN, BASE_URL } from "../core/runtime-context.js";
import { loadSettings } from "../core/settings.js";
import { createSessionStorage } from "../core/session-storage.js";
import { DisposableScope } from "../core/disposable-scope.js";
import { Panel } from "../ui/panel.js";
import { texts } from "../ui/texts.js";
import { Reader } from "../features/reader.js";
import { SmartLikes } from "../features/likes.js";
import { RateLimit } from "../features/rate-limit.js";
import { LikeCounter } from "../features/like-counter.js";
import { UserInfoHelper } from "../features/user-info.js";
import { AutomationCoordinator } from "./automation-coordinator.js";
import { lifecycleMethods } from "./lifecycle.js";
import { topicMethods } from "../features/topic.js";
import { modeMethods } from "../features/modes.js";
import { rankingMethods } from "../features/ranking.js";
import { cloudflareMethods } from "../features/cloudflare.js";
import { accountMethods } from "../features/account.js";
import { creditMethods } from "../features/credit.js";
import { cdkMethods } from "../features/cdk.js";

export class BrowseController {
  constructor() {
    this.settings = loadSettings();
    this.session = createSessionStorage();
    this.scope = new DisposableScope();
    this.texts = texts;
    this.t = (key) => this.texts[key] || key;
    this.currentUsername = null;
    this.lastDetectedUser = null;
    this.trustLevelMonitorInterval = null;
    this._topicCreatedTimeObserver = null;
    this.cfBypassObserver = null;
    this.cfBypassRedirectTimer = null;
    this.cfBypassRedirecting = false;
    this.CF_BYPASS_CONFIG = {
      ERROR_TEXTS: [
        "403 error",
        "该回应是很久以前创建的",
        "reaction was created too long ago",
        "我们无法加载该话题",
        "You are not allowed to react",
      ],
      DIALOG_SELECTOR: ".dialog-body",
      CHALLENGE_PATH: "/challenge",
      NOT_FOUND_REDIRECT_GUARD_KEY: "linux_do_auto_challenge_nf_guard",
      NOT_FOUND_REDIRECT_GUARD_MS: 5e3,
      REDIRECT_DELAY_MS: 120,
    };

    this.likeCounter = new LikeCounter({ autoStart: false });
    this.panel = new Panel({
      settings: this.settings,
      t: this.t,
      getReadingState: () => this.reader.getSnapshot(),
      getLikeCounter: () => this.likeCounter,
      actions: {
        handleButtonClick: () => this.reader.handleButtonClick(),
        resetTopicList: () => this.reader.resetTopicList(),
        resetSessionReadCount: () => this.reader.resetSessionReadCount(),
        setSmartLikeEnabled: (enabled) => this.likes.setSmartLikeEnabled(enabled),
        clearLikeCooldown: () => this.limits.clearLikeCooldown(),
        toggleCleanMode: () => this.toggleCleanMode(),
        toggleGrayscaleMode: () => this.toggleGrayscaleMode(),
        renderTopicCreatedTimeInList: () => this.renderTopicCreatedTimeInList(),
        loadUserTrustLevel: () => this.loadUserTrustLevel(),
        loadCreditInfo: () => this.loadCreditInfo(),
        loadCdkInfo: () => this.loadCdkInfo(),
        loadRankingData: () => this.loadRankingData(),
        initCloudFlareBypass: () => this.initCloudFlareBypass(),
        stopCloudFlareBypass: () => this.stopCloudFlareBypass(),
        manualTriggerCF: () => this.manualTriggerCF(),
      },
    });
    const notify = (message) => this.panel.showNotification(message);
    this.automation = new AutomationCoordinator({ settings: this.settings, notify, t: this.t });
    this.limits = new RateLimit({
      getAccountContext: () => this.automation.getAccountContext(),
      onLikeLimited: () => this.automation.onLikeLimited(),
      onCooldownChanged: () => this.automation.refreshCounter(),
      onIpLimited: () => this.automation.onIpLimited(),
      onIpRecovered: () => {
        window.location.href = BASE_URL + "/latest";
      },
      notify,
      t: this.t,
    });
    this.reader = new Reader({
      settings: this.settings,
      session: this.session,
      view: this.panel,
      getCurrentUsername: () => this.getCurrentUsername(),
      hooks: {
        canRead: () => this.automation.canRead(),
        onActive: () => this.automation.onReadingActive(),
        onPause: (reason) => this.automation.onReadingPaused(reason),
      },
    });
    this.likes = new SmartLikes({
      settings: this.settings,
      session: this.session,
      limits: this.limits,
      counter: this.likeCounter,
      getReadingState: () => this.reader.getSnapshot(),
      onEnabledChange: (enabled) => this.panel.updateSmartLikeUI(enabled),
      onAccountChanged: (account) => {
        this.currentUsername = account?.username || null;
      },
      notify,
      t: this.t,
    });
    this.automation.connect({
      reader: this.reader,
      likes: this.likes,
      limits: this.limits,
      counter: this.likeCounter,
    });

    this.limits.start();
    this.panel.setupButton();
    this.likes.start();
    this.initDataLoading();
    this.startUserSwitchMonitoring();
    this.initFloorNumberDisplay();
    this.applyCleanModeStyles();
    this.applyGrayscaleModeStyles();
    this.initTopicCreatedTimeEnhancer();
    this.reader.start();
    this.userInfoHelper = new UserInfoHelper();
    this.scope.add(this.likeCounter.onUIUpdate((status) => this.panel.updateLikeCounterUI(status)));
    this.likeCounter.start();
    this.scope.setTimeout(() => this.panel.updateLikeCounterUI(this.likeCounter.getStatus()), 500);
    this.startTrustLevelMonitor();
    this.panel.applyTopicAgeHighlightColors();
    if (CURRENT_DOMAIN === "linux.do") this.initCloudFlareBypass();
  }

  // Preserve the public stop entry points used by existing userscript callers.
  stopAutoReading() {
    return this.reader.stopAutoReading();
  }
  stopNavigation() {
    return this.stopAutoReading();
  }
  get autoRunning() {
    return this.reader.autoRunning;
  }
  get isScrolling() {
    return this.reader.isScrolling;
  }

  destroy() {
    if (this.scope.disposed) return;
    this.reader.destroy();
    this.likes.destroy();
    this.limits.destroy();
    this.likeCounter.destroy();
    this.userInfoHelper?.destroy();
    this.stopCloudFlareBypass();
    this._topicCreatedTimeObserver?.disconnect();
    this._floorMutationObserver?.disconnect();
    this.scope.dispose();
    this.panel.destroy();
  }
}

Object.assign(
  BrowseController.prototype,
  lifecycleMethods,
  topicMethods,
  modeMethods,
  rankingMethods,
  cloudflareMethods,
  accountMethods,
  creditMethods,
  cdkMethods,
);
