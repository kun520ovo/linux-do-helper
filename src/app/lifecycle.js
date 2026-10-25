const lifecycleMethods = {
  startTrustLevelMonitor() {
    if (this.trustLevelMonitorInterval) {
      this.scope.clearInterval(this.trustLevelMonitorInterval);
    }
    this.trustLevelMonitorInterval = this.scope.setInterval(
      () => {
        if (this.shouldRefreshAccountInfo()) {
          console.log("自动刷新等级信息...");
          this.loadUserTrustLevel(false);
        }
      },
      30 * 60 * 1e3,
    );
    console.log("等级监控已启动（30分钟刷新一次，仅在可见时）");
  },
  shouldRefreshAccountInfo() {
    return Boolean(
      this.panel.accountSection &&
        this.panel.accountSectionContent &&
        this.panel.accountSection.getAttribute("aria-expanded") === "true",
    );
  },
  shouldRefreshCreditInfo() {
    return Boolean(
      this.panel.creditSection && this.panel.creditSection.getAttribute("aria-expanded") === "true",
    );
  },
  shouldRefreshRankInfo() {
    return Boolean(this.panel.rankSection && this.panel.rankSection.getAttribute("aria-expanded") === "true");
  },
  shouldRefreshCdkInfo() {
    return Boolean(this.panel.cdkSection && this.panel.cdkSection.getAttribute("aria-expanded") === "true");
  },
  initDataLoading() {
    if (this.panel.accountSection && this.panel.accountSection.getAttribute("aria-expanded") === "true") {
      this.loadUserTrustLevel();
    }
  },
  startUserSwitchMonitoring() {
    this.getCurrentUsername().then((username) => {
      this.lastDetectedUser = username;
    });
    this.scope.setInterval(async () => {
      const currentDetectedUser = await this.getCurrentUsername();
      if (currentDetectedUser && this.lastDetectedUser && currentDetectedUser !== this.lastDetectedUser) {
        console.log(`检测到账号切换: ${this.lastDetectedUser} -> ${currentDetectedUser}`);
        this.lastDetectedUser = currentDetectedUser;
        this.currentUsername = currentDetectedUser;
        this.scope.setTimeout(() => {
          console.log("账号切换后重新加载等级信息");
          this.loadUserTrustLevel(true);
        }, 1e3);
      } else if (currentDetectedUser) {
        this.lastDetectedUser = currentDetectedUser;
      }
    }, 5e3);
  },
};

export { lifecycleMethods };
