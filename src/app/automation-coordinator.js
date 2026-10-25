// Cross-feature decisions live here; features do not mutate each other's state.
export class AutomationCoordinator {
  constructor({ settings, notify, t }) {
    this.settings = settings;
    this.notify = notify;
    this.t = t;
  }

  connect({ reader, likes, limits, counter }) {
    this.reader = reader;
    this.likes = likes;
    this.limits = limits;
    this.counter = counter;
  }

  getAccountContext() {
    return {
      key: this.likes?.smartLikeAccountKey || this.counter?.accountKey || null,
      username: this.likes?.currentAccount?.username || this.likes?.currentUsername,
      counterKey: this.counter?.accountKey,
      counterUsername: this.counter?.currentUser?.username,
    };
  }

  canRead() {
    if (this.limits.isIpRateLimited()) {
      this.notify(this.t("ipRateLimitWait"));
      return false;
    }
    if (!this.settings.stopOnLikeLimitEnabled) return true;
    const status = this.counter?.getStatus();
    if (this.limits.isLikeCoolingDown() || status?.isInCooldown || status?.remaining === 0) {
      this.notify(this.t("stoppedByLikeLimit"));
      return false;
    }
    return true;
  }

  onReadingActive() {
    this.likes.bindSmartLikeScroll();
    if (this.settings.smartLikeEnabled) this.likes.scanSmartLikePosts();
  }

  onReadingPaused(reason) {
    this.likes.cancelSmartLikeTasks(reason);
  }

  onLikeLimited() {
    this.likes.pauseForRateLimit();
    this.refreshCounter();
    if (this.settings.stopOnLikeLimitEnabled && this.reader.autoRunning) this.reader.stopAutoReading();
  }

  refreshCounter() {
    this.counter?.loadState();
    this.counter?.notifyUIUpdate();
  }

  onIpLimited() {
    this.reader.stopAutoReading();
  }
}
