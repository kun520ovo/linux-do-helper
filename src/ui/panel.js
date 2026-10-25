import { CURRENT_DOMAIN } from "../core/runtime-context.js";
import { Storage } from "../core/storage.js";
import {
  createToggleRow,
  createSliderRow,
  createSelectRow,
  createInnerCollapsibleSection,
} from "./controls.js";
import { installPanelStyles } from "./styles.js";
import { DisposableScope } from "../core/disposable-scope.js";

export class Panel {
  constructor({ settings, actions, getReadingState, getLikeCounter, t }) {
    this.settings = settings;
    this.actions = actions;
    this.getReadingState = getReadingState;
    this.getLikeCounter = getLikeCounter;
    this.t = t;
    this.scope = new DisposableScope();
    this.pendingNotifications = [];
    this.topicStatusMode = null;
    this.topicStatusHideTimer = null;
    this.topicStatusNotificationTimer = null;
  }

  get likeCounter() {
    return this.getLikeCounter();
  }

  destroy() {
    this.scope.dispose();
    this.container?.remove();
    this.pendingNotifications = [];
  }

  renderPanelSection(key, title, content = "", detailClass = "") {
    return `<div class="my-gift-tool-item" data-section-item="${key}">
      <button type="button" class="my-gift-tool" data-section="${key}" aria-expanded="false">
        <span class="my-gift-tool-text">${this.t(title)}</span><span class="my-gift-tool-arrow">›</span>
      </button>
      <div class="my-gift-tool-detail${detailClass}" data-section-content="${key}">${content}</div>
    </div>`;
  }

  createStoredToggleRow(labelKey, settingKey, logLabel, onChange = null) {
    return createToggleRow(this.t(labelKey), this.settings[settingKey], (checked) => {
      this.settings[settingKey] = checked;
      Storage.set(settingKey, this.settings[settingKey]);
      console.log(`${logLabel}: ${this.settings[settingKey] ? "开启" : "关闭"}`);
      if (onChange) onChange(checked);
    });
  }

  applyTopicAgeHighlightColors() {
    const root = document.documentElement;
    root.style.setProperty("--lda-topic-age-fresh", "#86efac");
    root.style.setProperty("--lda-topic-age-old", "#fdba74");
    root.style.setProperty("--lda-topic-age-ancient", "#fca5a5");
    root.style.setProperty("--lda-topic-age-enabled", this.settings.topicAgeColorEnabled ? "1" : "0");
  }

  createTopicAgeColorSettings() {
    const section = document.createElement("div");
    section.className = "topic-created-time-settings";
    const visibilityToggleRow = createToggleRow(
      this.t("topicCreatedTimeVisible"),
      this.settings.topicCreatedTimeVisible,
      (checked) => {
        this.settings.topicCreatedTimeVisible = checked;
        Storage.set("topicCreatedTimeVisible", checked);
        this.actions.renderTopicCreatedTimeInList();
        this.showNotification(
          checked ? this.t("topicCreatedTimeEnabled") : this.t("topicCreatedTimeDisabled"),
        );
      },
    );
    visibilityToggleRow.title = this.t("topicCreatedTimeVisibleTip");
    section.appendChild(visibilityToggleRow);
    const toggleRow = createToggleRow(
      this.t("topicAgeColorLabel"),
      this.settings.topicAgeColorEnabled,
      (checked) => {
        this.settings.topicAgeColorEnabled = checked;
        Storage.set("topicAgeColorEnabled", checked);
        this.applyTopicAgeHighlightColors();
        this.actions.renderTopicCreatedTimeInList();
        this.showNotification(checked ? this.t("topicAgeColorEnabled") : this.t("topicAgeColorDisabled"));
      },
    );
    toggleRow.title = this.t("topicAgeColorTip");
    section.appendChild(toggleRow);
    return section;
  }

  setupButton() {
    this.container = document.createElement("div");
    this.container.id = "my-gift-panel";
    this.container.className = "collapsed";
    this.container.innerHTML = `
          <svg id="my-gift-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6h-3V4c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v3h2v9c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-9h2V8c0-1.1-.9-2-2-2zm-9-2h2v2h-2V4zm0 16H6v-9h5v9zm6 0h-5v-9h5v9z" />
          </svg>
          <div id="my-gift-content">
              <div id="my-gift-header">
                  <div id="my-gift-title"><span>${this.t("panelTitle")}</span></div>
                  <span id="my-gift-close" title="关闭" role="button" aria-label="关闭">×</span>
              </div>
              <div id="my-gift-body">
                  ${this.renderPanelSection("auto", "sectionAutoRead")}
                  ${this.renderPanelSection(
                    "account-data",
                    "sectionAccountData",
                    `<div class="account-data-sections">${[
                      ["account", "sectionAccountInfo"],
                      ["credit", "sectionCredit"],
                      ["cdk", "sectionCdk"],
                      ["rank", "sectionRanking"],
                    ]
                      .map(([key, title]) => this.renderPanelSection(key, title))
                      .join("")}</div>`,
                    " account-data-detail",
                  )}
                  ${this.renderPanelSection("settings", "sectionPluginSettings")}
              </div>
          </div>
      `;
    installPanelStyles();
    document.body.appendChild(this.container);
    const closeBtn = this.container.querySelector("#my-gift-close");
    const autoButton = this.container.querySelector('[data-section="auto"]');
    const autoContent = this.container.querySelector('[data-section-content="auto"]');
    const sectionMap = {
      auto: [autoButton, autoContent],
      accountData: [
        this.container.querySelector('[data-section="account-data"]'),
        this.container.querySelector('[data-section-content="account-data"]'),
      ],
      account: [
        this.container.querySelector('[data-section="account"]'),
        this.container.querySelector('[data-section-content="account"]'),
      ],
      credit: [
        this.container.querySelector('[data-section="credit"]'),
        this.container.querySelector('[data-section-content="credit"]'),
      ],
      cdk: [
        this.container.querySelector('[data-section="cdk"]'),
        this.container.querySelector('[data-section-content="cdk"]'),
      ],
      rank: [
        this.container.querySelector('[data-section="rank"]'),
        this.container.querySelector('[data-section-content="rank"]'),
      ],
      settings: [
        this.container.querySelector('[data-section="settings"]'),
        this.container.querySelector('[data-section-content="settings"]'),
      ],
    };
    const setSectionExpanded = (button, sectionContent, expanded) => {
      button.setAttribute("aria-expanded", String(expanded));
    };
    this.setSectionExpanded = setSectionExpanded;
    const bindSection = (key, onExpand) => {
      const [button, sectionContent] = sectionMap[key];
      this.scope.listen(button, "click", (event) => {
        event.stopPropagation();
        const expanded = button.getAttribute("aria-expanded") === "true";
        setSectionExpanded(button, sectionContent, !expanded);
        if (!expanded && onExpand) onExpand();
        const rect = this.container.getBoundingClientRect();
        applyPosition(rect.left, rect.top);
        savePosition();
      });
    };
    const applyPosition = (left, top, dimensions = null) => {
      const width = dimensions?.width || this.container.offsetWidth;
      const height = dimensions?.height || this.container.offsetHeight;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const maxLeft = Math.max(0, viewportWidth - width);
      const maxTop = Math.max(0, viewportHeight - height);
      this.container.style.right = "auto";
      this.container.style.bottom = "auto";
      this.container.style.left = `${Math.max(0, Math.min(left, maxLeft))}px`;
      this.container.style.top = `${Math.max(0, Math.min(top, maxTop))}px`;
    };
    const savePosition = () => {
      const rect = this.container.getBoundingClientRect();
      localStorage.setItem("my-gift-position", JSON.stringify({ left: rect.left, top: rect.top }));
    };
    const hasSavedPosition = () => {
      try {
        return Boolean(localStorage.getItem("my-gift-position"));
      } catch (_) {
        return false;
      }
    };
    const restorePosition = (dimensions = null) => {
      try {
        const saved = JSON.parse(localStorage.getItem("my-gift-position") || "null");
        if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
          applyPosition(saved.left, saved.top, dimensions);
        }
      } catch (_) {}
    };
    const measurePanelSize = (collapsed) => {
      const wasCollapsed = this.container.classList.contains("collapsed");
      const transition = this.container.style.transition;
      this.container.style.transition = "none";
      this.container.classList.toggle("collapsed", collapsed);
      const size = { width: this.container.offsetWidth, height: this.container.offsetHeight };
      this.container.classList.toggle("collapsed", wasCollapsed);
      this.container.style.transition = transition;
      return size;
    };
    const getExpandedPosition = (rect, size) => {
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      let left = rect.left;
      let top = rect.top;
      if (left + size.width > viewportWidth) left = rect.right - size.width;
      if (top + size.height > viewportHeight) top = rect.bottom - size.height;
      return { left, top };
    };
    const openPanel = () => {
      const collapsedRect = this.container.getBoundingClientRect();
      const expandedSize = measurePanelSize(false);
      const expandedPosition = getExpandedPosition(collapsedRect, expandedSize);
      this.container.classList.remove("collapsed");
      applyPosition(expandedPosition.left, expandedPosition.top, expandedSize);
    };
    const closePanel = () => {
      const expandedRect = this.container.getBoundingClientRect();
      const collapsedSize = measurePanelSize(true);
      this.container.classList.add("collapsed");
      if (hasSavedPosition()) {
        restorePosition(collapsedSize);
      } else {
        applyPosition(
          expandedRect.right - collapsedSize.width,
          expandedRect.bottom - collapsedSize.height,
          collapsedSize,
        );
      }
    };
    const frame = requestAnimationFrame(() => {
      if (!this.scope.disposed) restorePosition();
    });
    this.scope.add(() => cancelAnimationFrame(frame));
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    this.scope.listen(this.container, "mousedown", (event) => {
      if (event.button !== 0 || event.target.closest?.('button, a, input, select, textarea, [role="button"]'))
        return;
      const rect = this.container.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      applyPosition(startLeft, startTop);
      this.container.classList.add("dragging");
      event.preventDefault();
    });
    this.scope.listen(document, "mousemove", (event) => {
      if (!dragging) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) moved = true;
      applyPosition(startLeft + deltaX, startTop + deltaY);
    });
    this.scope.listen(document, "mouseup", () => {
      if (!dragging) return;
      dragging = false;
      this.container.classList.remove("dragging");
      if (moved) savePosition();
    });
    this.scope.listen(this.container, "click", (event) => {
      if (moved) {
        moved = false;
        event.stopPropagation();
        return;
      }
      if (this.container.classList.contains("collapsed")) openPanel();
    });
    this.scope.listen(closeBtn, "click", (event) => {
      event.stopPropagation();
      closePanel();
    });
    this.scope.listen(document, "keydown", (event) => {
      if (event.key === "Escape" && !this.container.classList.contains("collapsed")) closePanel();
    });
    this.scope.listen(window, "resize", () => {
      const rect = this.container.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
      savePosition();
    });
    const observer = new MutationObserver(() => {
      if (document.body && !document.getElementById("my-gift-panel")) {
        document.body.appendChild(this.container);
        restorePosition();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    this.scope.add(() => observer.disconnect());
    this.button = document.createElement("button");
    this.button.className = "main-action-btn" + (this.getReadingState().autoRunning ? " running" : "");
    this.button.innerHTML = this.getReadingState().autoRunning
      ? `<span class="btn-icon">⏸</span><span class="btn-text">${this.t("stopReading")}</span>`
      : `<span class="btn-icon">▶</span><span class="btn-text">${this.t("startReading")}</span>`;
    this.scope.listen(this.button, "click", () => this.actions.handleButtonClick());
    this.readStatsContainer = document.createElement("div");
    this.readStatsContainer.className = "read-stats-container";

    this.updateReadStatsDisplay();
    this.likeCounterContainer = document.createElement("div");
    this.likeCounterContainer.className = "like-counter-container";

    this.likeCounterContainer.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between;">
              <span class="like-counter-label">❤️ ${this.t("likeRemaining")}</span>
              <span class="like-counter-value" style="font-weight: 600;">-- / --</span>
          </div>
      `;
    this.likeCounterContainer.style.cursor = "pointer";
    this.likeCounterContainer.title = this.t("likeCountMismatch");
    this.scope.listen(this.likeCounterContainer, "click", () => {
      if (this.likeCounter) {
        this.showNotification(this.t("likeSyncing"));
        this.likeCounter.manualSync().then(() => {
          this.showNotification(this.t("likeSyncSuccess"));
        });
      }
    });
    const smartLikeRow = createToggleRow(this.t("smartLike"), this.settings.smartLikeEnabled, (checked) =>
      this.actions.setSmartLikeEnabled(checked),
    );
    this.smartLikeToggleInput = smartLikeRow.querySelector('input[type="checkbox"]');
    const smartLikeSpeedRow = createSelectRow(
      this.t("smartLikeSpeed"),
      [
        { value: "slow", label: this.t("smartLikeSpeedSlow") },
        { value: "normal", label: this.t("smartLikeSpeedNormal") },
        { value: "fast", label: this.t("smartLikeSpeedFast") },
      ],
      this.settings.smartLikeSpeed,
      (value) => {
        this.settings.smartLikeSpeed = ["slow", "normal", "fast"].includes(value) ? value : "normal";
        Storage.set("smartLikeSpeed", this.settings.smartLikeSpeed);
      },
    );
    const cleanModeRow = this.createStoredToggleRow(
      "cleanMode",
      "cleanModeEnabled",
      "清爽模式",
      (checked) => {
        this.actions.toggleCleanMode();
      },
    );
    const grayscaleModeRow = this.createStoredToggleRow(
      "grayscaleMode",
      "grayscaleModeEnabled",
      "黑白灰模式",
      (checked) => {
        this.actions.toggleGrayscaleMode();
      },
    );
    const readUnreadRow = this.createStoredToggleRow(
      "readUnread",
      "readUnreadEnabled",
      "读取未读帖子",
      (checked) => {
        this.actions.resetTopicList();
        console.log(
          "已清空话题列表，下次将获取" + (this.settings.readUnreadEnabled ? "未读" : "最新") + "帖子",
        );
      },
    );
    const randomOrderRow = this.createStoredToggleRow(
      "randomOrder",
      "randomOrderEnabled",
      "随机顺序阅读",
      (checked) => {
        this.actions.resetTopicList();
      },
    );
    randomOrderRow.title = this.t("randomOrderTip");
    const skipReadRow = this.createStoredToggleRow(
      "skipRead",
      "skipReadEnabled",
      "跳过已读帖子",
      (checked) => {
        this.actions.resetTopicList();
      },
    );
    skipReadRow.title = this.t("skipReadTip");
    const fullTopicReadRow = this.createStoredToggleRow(
      "fullTopicRead",
      "fullTopicReadEnabled",
      "完整阅读帖子",
    );
    fullTopicReadRow.title = this.t("fullTopicReadTip");
    const topicLimitRow = createSliderRow(
      this.t("topicLimit"),
      this.settings.topicLimitCount,
      10,
      500,
      10,
      (value) => {
        this.settings.topicLimitCount = value;
        Storage.set("topicLimitCount", this.settings.topicLimitCount);
        console.log(`获取帖子数量: ${this.settings.topicLimitCount}`);
        this.actions.resetTopicList();
      },
    );
    topicLimitRow.title = this.t("topicLimitTip");
    const restTimeRow = createSliderRow(
      this.t("restTimeLabel"),
      this.settings.restTimeMinutes,
      1,
      30,
      1,
      (value) => {
        this.settings.restTimeMinutes = value;
        Storage.set("restTimeMinutes", this.settings.restTimeMinutes);
        console.log(`休息时间: ${this.settings.restTimeMinutes} 分钟`);
      },
    );
    restTimeRow.title = this.t("restTimeTip");
    const stopAfterReadRow = this.createStoredToggleRow(
      "stopAfterRead",
      "stopAfterReadEnabled",
      "阅读数量限制",
      (checked) => {
        if (checked) {
          this.actions.resetSessionReadCount();
        }
      },
    );
    stopAfterReadRow.title = this.t("stopAfterReadTip");
    const stopAfterReadCountRow = createSliderRow(
      this.t("stopAfterReadCount"),
      this.settings.stopAfterReadCount,
      5,
      100,
      5,
      (value) => {
        this.settings.stopAfterReadCount = value;
        Storage.set("stopAfterReadCount", this.settings.stopAfterReadCount);
        console.log(`阅读数量限制: ${this.settings.stopAfterReadCount} 篇`);
      },
    );
    stopAfterReadCountRow.title = this.t("stopAfterReadCountTip");
    const stopOnLikeLimitRow = this.createStoredToggleRow(
      "stopOnLikeLimit",
      "stopOnLikeLimitEnabled",
      "点赞上限停止阅读",
    );
    stopOnLikeLimitRow.title = this.t("stopOnLikeLimitTip");
    this.trustLevelContainer = document.createElement("div");
    this.trustLevelContainer.className = "trust-level-row";
    this.trustLevelContainer.innerHTML = `<div class="trust-level-loading">${this.t("loadingLevel")}</div>`;
    this.autoSection = autoButton;
    this.autoSectionContent = autoContent;
    const accountButton = sectionMap.account[0];
    const accountContent = sectionMap.account[1];
    const creditButton = sectionMap.credit[0];
    const creditContent = sectionMap.credit[1];
    const cdkButton = sectionMap.cdk[0];
    const cdkContent = sectionMap.cdk[1];
    const rankButton = sectionMap.rank[0];
    const rankContent = sectionMap.rank[1];
    const settingsContent = sectionMap.settings[1];
    this.accountSection = accountButton;
    this.accountSectionContent = accountContent;
    this.accountDataSection = this.container.querySelector('[data-section="account-data"]');
    this.accountDataSectionContent = this.container.querySelector('[data-section-content="account-data"]');
    this.accountSectionContent.appendChild(this.trustLevelContainer);
    this.creditSection = creditButton;
    this.creditSectionContent = creditContent;
    this.cdkSection = cdkButton;
    this.cdkSectionContent = cdkContent;
    this.rankSection = rankButton;
    this.rankSectionContent = rankContent;
    this.settingsPluginSectionContent = settingsContent;
    if (CURRENT_DOMAIN !== "linux.do") {
      this.container.querySelector('[data-section-item="credit"]').style.display = "none";
      this.container.querySelector('[data-section-item="cdk"]').style.display = "none";
    }
    bindSection("auto");
    bindSection("accountData");
    bindSection("account", () => this.actions.loadUserTrustLevel());
    bindSection("credit", () => this.actions.loadCreditInfo());
    bindSection("cdk", () => this.actions.loadCdkInfo());
    bindSection("rank", () => this.actions.loadRankingData());
    bindSection("settings");
    if (this.getReadingState().autoRunning) setSectionExpanded(autoButton, autoContent, true);
    autoContent.appendChild(this.button);
    autoContent.appendChild(this.readStatsContainer);
    autoContent.appendChild(this.likeCounterContainer);
    const toggleGrid = document.createElement("div");
    toggleGrid.className = "toggle-grid";
    toggleGrid.appendChild(smartLikeRow);
    toggleGrid.classList.add("smart-like-controls");
    toggleGrid.appendChild(smartLikeSpeedRow);
    toggleGrid.appendChild(readUnreadRow);
    toggleGrid.appendChild(randomOrderRow);
    toggleGrid.appendChild(skipReadRow);
    toggleGrid.appendChild(fullTopicReadRow);
    toggleGrid.appendChild(stopAfterReadRow);
    toggleGrid.appendChild(stopOnLikeLimitRow);
    autoContent.appendChild(toggleGrid);
    const readParameterSection = document.createElement("div");
    readParameterSection.className = "auto-read-parameter-settings";
    readParameterSection.appendChild(topicLimitRow);
    readParameterSection.appendChild(restTimeRow);
    readParameterSection.appendChild(stopAfterReadCountRow);
    autoContent.appendChild(
      createInnerCollapsibleSection(this.t("readParameterSettingsLabel"), readParameterSection, true),
    );
    this.topicStatusContainer = document.createElement("div");
    this.topicStatusContainer.className = "topic-status-container";
    this.topicStatusContainer.style.display = "none";
    this.topicStatusContent = document.createElement("div");
    this.topicStatusContent.className = "topic-status-content";
    this.topicStatusContainer.appendChild(this.topicStatusContent);
    this.topicStatusNotification = document.createElement("div");
    this.topicStatusNotification.className = "topic-status-notification";
    this.topicStatusNotification.setAttribute("role", "status");
    this.topicStatusNotification.setAttribute("aria-live", "polite");
    this.topicStatusNotification.style.display = "none";
    this.topicStatusContainer.appendChild(this.topicStatusNotification);
    autoContent.appendChild(this.topicStatusContainer);
    this.flushPendingNotifications();
    creditContent.appendChild((this.creditContainer = document.createElement("div")));
    this.creditContainer.className = "credit-info-row";
    this.creditContainer.innerHTML = `<div class="trust-level-loading">${this.t("clickToLoadCredits")}</div>`;
    cdkContent.appendChild((this.cdkContainer = document.createElement("div")));
    this.cdkContainer.className = "cdk-info-row";
    this.cdkContainer.innerHTML = `<div class="trust-level-loading">${this.t("clickToLoadCdk")}</div>`;
    rankContent.appendChild((this.rankDataContainer = document.createElement("div")));
    this.rankDataContainer.className = "rank-data-container";
    this.rankDataContainer.innerHTML = `<div class="trust-level-loading">${this.t("clickToLoadRank")}</div>`;
    const modeSubSection = document.createElement("div");
    modeSubSection.className = "mode-settings-options";
    modeSubSection.appendChild(cleanModeRow);
    modeSubSection.appendChild(grayscaleModeRow);
    settingsContent.appendChild(
      createInnerCollapsibleSection(`🎨 ${this.t("modeSettingsLabel")}`, modeSubSection, true),
    );
    settingsContent.appendChild(
      createInnerCollapsibleSection(
        this.t("topicCreatedTimeLabel"),
        this.createTopicAgeColorSettings(),
        true,
      ),
    );
    if (CURRENT_DOMAIN === "linux.do") {
      const cfSection = document.createElement("div");
      cfSection.className = "cf-bypass-section";
      const cfDescription = document.createElement("div");
      cfDescription.className = "cf-bypass-description";
      cfDescription.textContent = this.t("cfBypassTip");
      cfSection.appendChild(cfDescription);
      const cfToggleRow = createToggleRow("", this.settings.cfBypassEnabled, (checked) => {
        this.settings.cfBypassEnabled = checked;
        Storage.set("cfBypassEnabled", checked);
        this.showNotification(checked ? this.t("cfBypassEnabled") : this.t("cfBypassDisabled"));
        if (checked) {
          this.actions.initCloudFlareBypass();
        } else {
          this.actions.stopCloudFlareBypass();
        }
      });
      const manualCfBtn = document.createElement("button");
      manualCfBtn.type = "button";
      manualCfBtn.className = "reveal-users-btn";
      manualCfBtn.textContent = `🛡️ ${this.t("cfBypassManual")}`;
      manualCfBtn.title = this.t("cfBypassManualTip");
      this.scope.listen(manualCfBtn, "click", () => this.actions.manualTriggerCF());
      cfSection.appendChild(manualCfBtn);
      settingsContent.appendChild(
        createInnerCollapsibleSection(
          this.t("cfBypassLabel"),
          cfSection,
          true,
          cfToggleRow.querySelector(".toggle-switch"),
        ),
      );
    }
  }

  updateTopicStatus(status) {
    if (!this.topicStatusContainer || !this.topicStatusContent) return;
    this.topicStatusContainer.style.display = "block";
    if (this.topicStatusHideTimer) {
      this.scope.clearTimeout(this.topicStatusHideTimer);
      this.topicStatusHideTimer = null;
    }
    const progressPercent =
      status.target > 0 ? Math.min(100, Math.round((status.current / status.target) * 100)) : 0;
    let html = "";
    if (status.fetching) {
      this.topicStatusMode = "fetching";
      const startPageInfo = status.startPage > 1 ? `从第${status.startPage}页` : "";
      const pageInfo = status.page
        ? `（${startPageInfo ? startPageInfo + "起，" : ""}当前第${status.page}页）`
        : "";
      html = `
              <div class="topic-status-heading">
                  ${this.t("fetchingTopics")} <span class="topic-status-type">${status.type}</span> ${pageInfo}
              </div>
              <div class="topic-status-progress-row">
                  <div class="topic-status-progress-track">
                      <div class="topic-status-progress-fill" style="width: ${progressPercent}%;"></div>
                  </div>
                  <span class="topic-status-percent">${progressPercent}%</span>
              </div>
              <div class="topic-status-meta">
                  <span>${this.t("totalFetched")}: <span class="topic-status-remaining">${status.current}</span>/${status.target}</span>
                  ${status.skipped > 0 ? `<span>${this.t("skippedRead")}: <span class="topic-status-skipped">${status.skipped}</span></span>` : ""}
              </div>
          `;
    } else if (status.ready) {
      this.topicStatusMode = "ready";
      const pagesInfo =
        status.startPage && status.endPage
          ? `（第${status.startPage}-${status.endPage}页，共${status.totalPages}页）`
          : status.totalPages
            ? `（共${status.totalPages}页）`
            : "";
      const reachedMaxInfo = status.reachedMaxPages
        ? `<div class="topic-status-warning">⚠️ 已达最大翻页数，未能获取足够帖子</div>`
        : "";
      html = `
              <div class="topic-status-ready">
                  ✅ ${this.t("topicsReady")} ${pagesInfo}
              </div>
              <div class="topic-status-meta">
                  <span>${status.type}: <span class="topic-status-current">${status.current}</span> 篇</span>
                  ${status.skipped > 0 ? `<span>${this.t("skippedRead")}: <span class="topic-status-skipped">${status.skipped}</span></span>` : ""}
              </div>
              ${reachedMaxInfo}
          `;
      this.topicStatusHideTimer = this.scope.setTimeout(() => {
        this.topicStatusHideTimer = null;
        if (
          !this.getReadingState().isScrolling &&
          this.topicStatusContainer &&
          !this.hasTopicStatusNotification()
        ) {
          this.topicStatusContainer.style.display = "none";
        }
      }, 3e3);
    } else {
      this.topicStatusMode = null;
    }
    this.topicStatusContent.innerHTML = html;
  }

  updateReadingStatus() {
    if (!this.topicStatusContainer || !this.topicStatusContent || !this.getReadingState().autoRunning) return;
    if (this.topicStatusHideTimer) {
      this.scope.clearTimeout(this.topicStatusHideTimer);
      this.topicStatusHideTimer = null;
    }
    this.topicStatusMode = "reading";
    const remaining = this.getReadingState().topicList.length;
    const topicType = this.settings.readUnreadEnabled ? this.t("unreadTopics") : this.t("latestTopics");
    const skipped = this.getReadingState().skippedReadCount || 0;
    const todayRead = this.getReadingState().todayReadCount || 0;
    this.topicStatusContainer.style.display = "block";
    this.topicStatusContent.innerHTML = `
          <div class="topic-status-reading-row">
              <span>${this.t("currentReading")}: <span class="topic-status-type">${topicType}</span></span>
              <span>${this.t("remainingTopics")}: <span class="topic-status-remaining">${remaining}</span></span>
          </div>
          <div class="topic-status-meta">
              <span>📅 ${this.t("todayRead")}: <span class="topic-status-today">${todayRead}</span></span>
              ${skipped > 0 ? `<span>⏭️ ${this.t("skippedRead")}: <span class="topic-status-skipped">${skipped}</span></span>` : ""}
          </div>
      `;
  }

  updateReadStatsDisplay() {
    if (!this.readStatsContainer) return;
    const todayCount = this.getReadingState().todayReadCount || 0;
    let totalCount = this.getReadingState().totalReadCount || 0;
    totalCount = Math.max(totalCount, todayCount);
    this.readStatsContainer.innerHTML = `
          <div class="read-stat">
              <div class="read-stat-label">📅 ${this.t("todayRead")}</div>
              <div class="read-stat-value read-stat-today">${todayCount}</div>
          </div>
          <div class="read-stat-divider"></div>
          <div class="read-stat">
              <div class="read-stat-label">📚 ${this.t("totalRead")}</div>
              <div class="read-stat-value read-stat-total">${totalCount}</div>
          </div>
      `;
  }

  updateLikeCounterUI(status) {
    if (!this.likeCounterContainer) return;
    const { remaining, used, limit, isInCooldown, cooldownFormatted, matched } = status;
    if (isInCooldown && this.likeCounterCooldownTimer) {
      const timeSpan = this.likeCounterContainer.querySelector(".like-cooldown-time");
      if (timeSpan && cooldownFormatted) {
        timeSpan.textContent = cooldownFormatted;
        return;
      }
    }
    if (this.likeCounterCooldownTimer) {
      this.scope.clearInterval(this.likeCounterCooldownTimer);
      this.likeCounterCooldownTimer = null;
    }
    let html = "";
    if (isInCooldown && cooldownFormatted) {
      html = `
              <div class="like-cooldown-row">
                  <div class="like-cooldown-status">
                      <span class="like-cooldown-label">🔥 ${this.t("likeCooldown")}</span>
                      <span class="like-cooldown-time">${cooldownFormatted}</span>
                  </div>
                  <button type="button" class="like-cooldown-clear-btn" title="${this.t("likeClearCooldownTip")}">${this.t("likeClearCooldown")}</button>
              </div>
          `;
      this.likeCounterContainer.style.background = "linear-gradient(135deg, #fff1f2 0%, #fff7f7 100%)";
      this.likeCounterContainer.style.borderColor = "#fecdd3";
      if (!this.likeCounterCooldownTimer) {
        this.likeCounterCooldownTimer = this.scope.setInterval(() => {
          if (!this.likeCounter) return;
          const newFormatted = this.likeCounter.formatCooldown();
          const timeSpan = this.likeCounterContainer?.querySelector(".like-cooldown-time");
          if (timeSpan && newFormatted) {
            timeSpan.textContent = newFormatted;
          } else if (!newFormatted) {
            this.scope.clearInterval(this.likeCounterCooldownTimer);
            this.likeCounterCooldownTimer = null;
            this.updateLikeCounterUI(this.likeCounter.getStatus());
          }
        }, 1e3);
      }
    } else {
      const percentage = limit > 0 ? Math.round((remaining / limit) * 100) : 0;
      const color = percentage > 50 ? "#15803d" : percentage > 20 ? "#b7791f" : "#dc2626";
      html = `
              <div class="like-status-row">
                  <div class="like-status-label">
                      ${!matched ? `<span class="like-sync-btn" title="${this.t("likeCountMismatch")}">⚠️</span>` : ""}
                      <span>❤️ ${this.t("likeRemaining")}</span>
                  </div>
                  <div>
                      <span class="like-status-value" style="color: ${color};">${remaining}</span>
                      <span class="like-status-limit">/ ${limit}</span>
                  </div>
              </div>
              <div class="like-progress-track">
                  <div class="like-progress-fill" style="width: ${percentage}%; background: ${color};"></div>
              </div>
          `;
      this.likeCounterContainer.style.background = "#f5f8fb";
      this.likeCounterContainer.style.borderColor = "#e1e6eb";
    }
    this.likeCounterContainer.innerHTML = html;
    const syncBtn = this.likeCounterContainer.querySelector(".like-sync-btn");
    if (syncBtn) {
      syncBtn.onclick = async (e) => {
        e.stopPropagation();
        syncBtn.textContent = "🔄";
        syncBtn.style.animation = "spin 1s linear infinite";
        await this.likeCounter.manualSync();
        syncBtn.style.animation = "";
      };
    }
    const clearCooldownBtn = this.likeCounterContainer.querySelector(".like-cooldown-clear-btn");
    if (clearCooldownBtn) {
      clearCooldownBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearCooldownBtn.disabled = true;
        const cleared = this.actions.clearLikeCooldown();
        if (!cleared) {
          clearCooldownBtn.disabled = false;
          this.showNotification(this.t("likeCooldownClearFailed"));
          return;
        }
        this.showNotification(this.t("likeCooldownCleared"));
      };
    }
  }

  flushPendingNotifications() {
    if (!this.topicStatusNotification || !this.pendingNotifications?.length) return;
    const latestMessage = this.pendingNotifications[this.pendingNotifications.length - 1];
    this.pendingNotifications = [];
    if (latestMessage) this.showNotification(latestMessage);
  }

  hasTopicStatusNotification() {
    return !!(
      this.topicStatusNotification &&
      this.topicStatusNotification.style.display !== "none" &&
      this.topicStatusNotification.textContent
    );
  }

  revealTopicStatus() {
    if (!this.container || this.container.classList.contains("collapsed")) return;
    if (!this.autoSection || !this.autoSectionContent) return;
    if (this.autoSection.getAttribute("aria-expanded") !== "true") {
      this.setSectionExpanded?.(this.autoSection, this.autoSectionContent, true);
    }
  }

  hideTopicStatusIfIdle() {
    if (!this.topicStatusContainer || this.getReadingState().isScrolling || this.hasTopicStatusNotification())
      return;
    if (this.topicStatusMode === "fetching" || this.topicStatusMode === "reading") return;
    if (this.topicStatusMode === "ready") {
      if (this.topicStatusHideTimer) return;
      this.topicStatusHideTimer = this.scope.setTimeout(() => {
        this.topicStatusHideTimer = null;
        if (
          !this.getReadingState().isScrolling &&
          this.topicStatusContainer &&
          !this.hasTopicStatusNotification()
        ) {
          this.topicStatusContainer.style.display = "none";
        }
      }, 3e3);
      return;
    }
    if (this.topicStatusHideTimer) return;
    this.topicStatusContainer.style.display = "none";
  }

  showNotification(message) {
    const text = String(message ?? "").trim();
    if (!text) return;
    if (!this.topicStatusContainer || !this.topicStatusNotification) {
      this.pendingNotifications = [text];
      return;
    }
    if (this.topicStatusNotificationTimer) {
      this.scope.clearTimeout(this.topicStatusNotificationTimer);
      this.topicStatusNotificationTimer = null;
    }
    if (this.topicStatusHideTimer) {
      this.scope.clearTimeout(this.topicStatusHideTimer);
      this.topicStatusHideTimer = null;
    }
    this.topicStatusNotification.textContent = text;
    this.topicStatusNotification.style.display = "block";
    this.topicStatusContainer.style.display = "block";
    this.revealTopicStatus();
    const notification = this.topicStatusNotification;
    this.topicStatusNotificationTimer = this.scope.setTimeout(() => {
      if (notification !== this.topicStatusNotification) return;
      notification.textContent = "";
      notification.style.display = "none";
      this.topicStatusNotificationTimer = null;
      this.hideTopicStatusIfIdle();
    }, 3e3);
  }

  setReadingRunning(running) {
    if (!this.button) return;
    this.button.innerHTML = running
      ? `<span class="btn-icon">⏸</span><span class="btn-text">${this.t("stopReading")}</span>`
      : `<span class="btn-icon">▶</span><span class="btn-text">${this.t("startReading")}</span>`;
    this.button.classList.toggle("running", running);
  }

  prepareForReading() {
    if (this.accountDataSection)
      this.setSectionExpanded(this.accountDataSection, this.accountDataSectionContent, false);
    if (this.accountSection) this.setSectionExpanded(this.accountSection, this.accountSectionContent, false);
    if (this.autoSection) this.setSectionExpanded(this.autoSection, this.autoSectionContent, true);
  }

  updateSmartLikeUI(enabled) {
    if (this.smartLikeToggleInput) this.smartLikeToggleInput.checked = enabled;
  }
}
