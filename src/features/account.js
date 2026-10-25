import { CURRENT_DOMAIN, BASE_URL } from "../core/runtime-context.js";
import { CONFIG } from "../core/config.js";
import { Storage } from "../core/storage.js";

const accountMethods = {
  simplifyTrustLevelName(name) {
    return name
      .replace("已读帖子（所有时间）", "已读帖子")
      .replace("浏览的话题（所有时间）", "浏览话题")
      .replace("访问次数（过去", "访问次数(")
      .replace("个月）", "月)")
      .replace("回复次数（最近", "回复(近")
      .replace("天内）", "天)");
  },
  renderTrustLevelItem(name, fillClass, progress, current, required, changeIndicator = "") {
    return `
              <div class="trust-level-item">
                  <span class="trust-level-name">${name}</span>
                  <div class="trust-level-progress">
                      <div class="trust-level-bar">
                          <div class="trust-level-bar-fill ${fillClass}" style="width: ${progress}%"></div>
                      </div>
                      <span class="trust-level-value">${current}/${required}${changeIndicator}</span>
                  </div>
              </div>
          `;
  },
  renderTrustLevelResult(allMet, targetLevel, achievedCount, totalCount) {
    if (allMet) {
      return `
              <div style="background: rgba(255, 255, 255, 0.25); padding: 6px 8px; border-radius: 6px; margin: 6px 0 0 0;">
                  <div style="color: #fff; font-size: 11px; font-weight: 600; text-align: center;">
                      ✅ 已满足 Lv${targetLevel} 要求
                  </div>
              </div>
          `;
    } else {
      const unmetCount = totalCount - achievedCount;
      return `
              <div style="background: rgba(255, 255, 255, 0.15); padding: 6px 8px; border-radius: 6px; margin: 6px 0 0 0;">
                  <div style="color: rgba(255, 255, 255, 0.9); font-size: 11px; font-weight: 500; text-align: center;">
                      还需完成 ${unmetCount} 项升级到 Lv${targetLevel}
                  </div>
              </div>
          `;
    }
  },
  bindTrustLevelRefresh() {
    setTimeout(() => {
      const refreshBtn = this.panel.trustLevelContainer.querySelector(".trust-level-refresh");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", () => this.loadUserTrustLevel(true));
      }
    }, 100);
  },
  async getCurrentUsername() {
    if (this.currentUsername) return this.currentUsername;
    if (CURRENT_DOMAIN === "cdk.linux.do") {
      return null;
    }
    try {
      try {
        const currentUser =
          window.Discourse?.User?.current?.() || window.Discourse?.currentUser || window.User?.current?.();
        if (currentUser?.username) {
          this.currentUsername = currentUser.username;
          return this.currentUsername;
        }
      } catch (e) {}
      try {
        const preloadData = document.getElementById("data-preloaded");
        if (preloadData) {
          const data = JSON.parse(preloadData.dataset.preloaded);
          if (data?.currentUser) {
            const cu = JSON.parse(data.currentUser);
            if (cu?.username) {
              this.currentUsername = cu.username;
              return this.currentUsername;
            }
          }
        }
      } catch (e) {}
      const userMenuBtn = document.querySelector(".header-dropdown-toggle.current-user");
      if (userMenuBtn) {
        const img = userMenuBtn.querySelector("img[alt]");
        if (img && img.alt) {
          this.currentUsername = img.alt.trim().replace(/^@/, "");
          return this.currentUsername;
        }
      }
      const userAvatar = document.querySelector(".current-user img[title]");
      if (userAvatar && userAvatar.title) {
        this.currentUsername = userAvatar.title.trim().replace(/^@/, "");
        return this.currentUsername;
      }
      const currentUserLink = document.querySelector(
        "a.current-user, .header-dropdown-toggle.current-user a",
      );
      if (currentUserLink) {
        const href = currentUserLink.getAttribute("href");
        if (href && href.includes("/u/")) {
          const username = href.split("/u/")[1].split("/")[0];
          if (username) {
            this.currentUsername = username.trim().replace(/^@/, "");
            return this.currentUsername;
          }
        }
      }
      try {
        const avatarLink = document.querySelector('#current-user a[href*="/u/"]');
        if (avatarLink) {
          const match = avatarLink.href.match(/\/u\/([^\/]+)/);
          if (match) {
            this.currentUsername = match[1].trim().replace(/^@/, "");
            return this.currentUsername;
          }
        }
      } catch (e) {}
      try {
        const stored = localStorage.getItem("discourse_current_user");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.username) {
            this.currentUsername = parsed.username;
            return this.currentUsername;
          }
        }
      } catch (e) {}
      try {
        const userLinks = document.querySelectorAll('a[href*="/u/"]');
        for (const link of userLinks) {
          if (link.closest(".topic-list") || link.closest(".post-stream")) continue;
          const href = link.getAttribute("href");
          if (href && href.includes("/u/")) {
            const username = href.split("/u/")[1].split("/")[0];
            if (username) {
              this.currentUsername = username.trim().replace(/^@/, "");
              return this.currentUsername;
            }
          }
        }
      } catch (e) {}
      if (window.location.pathname.includes("/u/")) {
        const username = window.location.pathname.split("/u/")[1].split("/")[0];
        if (username) {
          this.currentUsername = username.trim().replace(/^@/, "");
          return this.currentUsername;
        }
      }
      if (CURRENT_DOMAIN === "linux.do" || CURRENT_DOMAIN === "idcflare.com") {
        const session429Until = Storage.get("session429Until", 0);
        if (session429Until > Date.now()) {
          const remainMinutes = Math.ceil((session429Until - Date.now()) / 6e4);
          console.log(`[Session] session/current 429 冷却期中，剩余 ${remainMinutes} 分钟，跳过请求`);
          return null;
        }
        const response = await fetch(`${BASE_URL}/session/current.json`);
        if (response.status === 429) {
          console.warn("[Session] session/current 遇到 429，设置 30 分钟冷却");
          Storage.set("session429Until", Date.now() + 30 * 60 * 1e3);
          return null;
        }
        if (response.ok) {
          const data = await response.json();
          if (data.current_user && data.current_user.username) {
            this.currentUsername = data.current_user.username;
            return this.currentUsername;
          }
        }
      }
    } catch (error) {
      console.error("获取用户名失败:", error);
    }
    return null;
  },
  async loadUserTrustLevel(isManualRefresh = false) {
    const username = await this.getCurrentUsername();
    if (!username) {
      this.panel.trustLevelContainer.innerHTML = '<div class="trust-level-loading">未登录</div>';
      return;
    }
    const now = Date.now();
    const TRUST_LEVEL_CACHE_INTERVAL = 30 * 60 * 1e3;
    const cacheKey = `trustLevelCache_${CURRENT_DOMAIN}_${username}`;
    const lastFetchKey = `lastTrustLevelFetch_${CURRENT_DOMAIN}_${username}`;
    const lastFetch = Storage.get(lastFetchKey, 0);
    if (!isManualRefresh && lastFetch > 0 && now - lastFetch < TRUST_LEVEL_CACHE_INTERVAL) {
      const cachedData = Storage.get(cacheKey, null);
      if (cachedData) {
        console.log("使用缓存的等级数据，距上次获取:", Math.round((now - lastFetch) / 1e3 / 60), "分钟");
        this.renderCachedTrustLevel(cachedData, lastFetch);
        return;
      }
    }
    if (isManualRefresh) {
      const refreshBtn = this.panel.trustLevelContainer.querySelector(".trust-level-refresh");
      if (refreshBtn) {
        refreshBtn.textContent = this.t("refreshing");
        refreshBtn.disabled = true;
      }
    }
    try {
      if (CURRENT_DOMAIN === "idcflare.com") {
        const summaryResponse = await fetch(`${BASE_URL}/u/${username}/summary.json`);
        if (summaryResponse.ok) {
          const data = await summaryResponse.json();
          if (data.user_summary) {
            this.renderTrustLevel(data, username);
            return;
          }
        }
        throw new Error("无法获取等级数据");
      } else if (CURRENT_DOMAIN === "linux.do") {
        await this.fetchLinuxDoDataWithGM(username);
      }
    } catch (error) {
      console.error("加载信任等级失败:", error);
      this.panel.trustLevelContainer.innerHTML = `
              <div class="trust-level-header">
                  📊 信任等级
                  <button class="trust-level-refresh" onclick="window.browseController.loadUserTrustLevel(true)">🔄 刷新</button>
              </div>
              <div class="trust-level-loading">加载失败，请点击刷新重试</div>
          `;
    } finally {
      if (isManualRefresh) {
        setTimeout(() => {
          const refreshBtn = this.panel.trustLevelContainer.querySelector(".trust-level-refresh");
          if (refreshBtn) {
            refreshBtn.textContent = "🔄 刷新";
            refreshBtn.disabled = false;
          }
        }, 1e3);
      }
    }
  },
  saveTrustLevelCache(username, data) {
    const cacheKey = `trustLevelCache_${CURRENT_DOMAIN}_${username}`;
    const lastFetchKey = `lastTrustLevelFetch_${CURRENT_DOMAIN}_${username}`;
    Storage.set(cacheKey, data);
    Storage.set(lastFetchKey, Date.now());
    console.log(`等级数据已缓存 (${CURRENT_DOMAIN})`);
    this.saveDailySnapshot(username, data);
  },
  saveDailySnapshot(username, data) {
    const today = /* @__PURE__ */ new Date().toISOString().split("T")[0];
    const historyKey = `trustLevelHistory_${CURRENT_DOMAIN}_${username}`;
    const history = Storage.get(historyKey, {});
    const snapshot = {
      date: today,
      timestamp: Date.now(),
      type: data.type,
      currentLevel: data.currentLevel,
      targetLevel: data.targetLevel,
      items: (data.items || data.requirements || []).map((item) => {
        let currentNum = item.current;
        let requiredNum = item.required;
        if (typeof item.current === "string") {
          const match = item.current.match(/(\d+)/);
          currentNum = match ? parseInt(match[1]) : 0;
        }
        if (typeof item.required === "string") {
          const match = item.required.match(/(\d+)/);
          requiredNum = match ? parseInt(match[1]) : 0;
        }
        let simpleName = this.simplifyTrustLevelName(item.name);
        return {
          name: simpleName,
          current: currentNum,
          required: requiredNum,
          isMet: item.isMet,
        };
      }),
    };
    history[today] = snapshot;
    const dates = Object.keys(history).sort().reverse();
    if (dates.length > 30) {
      dates.slice(30).forEach((d) => delete history[d]);
    }
    Storage.set(historyKey, history);
    console.log(`等级历史快照已保存 (${today})`);
  },
  getYesterdaySnapshot(username) {
    const historyKey = `trustLevelHistory_${CURRENT_DOMAIN}_${username}`;
    const history = Storage.get(historyKey, {});
    const yesterday = /* @__PURE__ */ new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    return history[yesterdayStr] || null;
  },
  calculateDataChange(currentValue, yesterdaySnapshot, itemName) {
    if (!yesterdaySnapshot || !yesterdaySnapshot.items) return null;
    const yesterdayItem = yesterdaySnapshot.items.find((item) => item.name === itemName);
    if (!yesterdayItem) return null;
    const diff = currentValue - yesterdayItem.current;
    return diff;
  },
  generateChangeIndicator(diff) {
    if (diff === null || diff === void 0) return "";
    if (diff > 0) {
      return `<span class="change-indicator change-up" title="较昨日 +${diff}">↑${diff}</span>`;
    } else if (diff < 0) {
      return `<span class="change-indicator change-down" title="较昨日 ${diff}">↓${Math.abs(diff)}</span>`;
    }
    return "";
  },
  renderCachedTrustLevel(cachedData, lastFetch) {
    if (!cachedData) return;
    const {
      type,
      username,
      currentLevel,
      targetLevel,
      items,
      requirements,
      achievedCount,
      totalCount,
      allMet,
    } = cachedData;
    const cacheAge = Date.now() - lastFetch;
    const cacheMinutes = Math.floor(cacheAge / 1e3 / 60);
    const cacheTimeText = cacheMinutes < 1 ? "刚刚" : `${cacheMinutes}分钟前`;
    const levelNames = {
      0: "Lv0 → Lv1",
      1: "Lv1 → Lv2",
      2: "Lv1 → Lv2",
      3: "Lv2 → Lv3",
      4: "Lv3 → Lv4",
    };
    const yesterdaySnapshot = this.getYesterdaySnapshot(username);
    const isAllMetForHeader = type === "low_level" ? allMet : achievedCount === totalCount;
    const headerTitle = isAllMetForHeader
      ? `Lv${targetLevel} ✓`
      : levelNames[type === "low_level" ? currentLevel : targetLevel] ||
        `Lv${currentLevel} → Lv${targetLevel}`;
    let html = `
          <div class="trust-level-header">
              <span>📊 ${headerTitle} (${username})</span>
              <button class="trust-level-refresh" data-action="refresh">🔄 刷新</button>
          </div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 4px; text-align: right;">缓存: ${cacheTimeText}</div>
      `;
    const displayItems = type === "low_level" ? items : requirements;
    displayItems.forEach((req) => {
      let currentNum, requiredNum, displayCurrent, displayRequired;
      if (type === "low_level") {
        currentNum = req.current;
        requiredNum = req.required;
        displayCurrent = req.current;
        displayRequired = req.required;
      } else {
        const currentMatch = req.current.match(/(\d+)/);
        const requiredMatch = req.required.match(/(\d+)/);
        currentNum = currentMatch ? parseInt(currentMatch[1]) : 0;
        requiredNum = requiredMatch ? parseInt(requiredMatch[1]) : 1;
        displayCurrent = req.current;
        displayRequired = req.required;
      }
      const progress = Math.min((currentNum / requiredNum) * 100, 100);
      const isCompleted = req.isMet;
      const fillClass = isCompleted ? "completed" : "";
      let simpleName = this.simplifyTrustLevelName(req.name);
      const diff = this.calculateDataChange(currentNum, yesterdaySnapshot, simpleName);
      const changeIndicator = this.generateChangeIndicator(diff);
      html += this.renderTrustLevelItem(
        simpleName,
        fillClass,
        progress,
        displayCurrent,
        displayRequired,
        changeIndicator,
      );
    });
    const isAllMet = type === "low_level" ? allMet : achievedCount === totalCount;
    html += this.renderTrustLevelResult(isAllMet, targetLevel, achievedCount, totalCount);
    this.panel.trustLevelContainer.innerHTML = html;
    this.bindTrustLevelRefresh();
  },
  async fetchLinuxDoDataWithGM(username) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://connect.linux.do/",
        timeout: 15e3,
        onload: (response) => {
          if (response.status === 200) {
            const responseText = response.responseText;
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = responseText;
            let globalUsername = username;
            let currentLevel = "未知";
            const h1 = tempDiv.querySelector("h1");
            if (h1) {
              const h1Text = h1.textContent.trim();
              const welcomeMatch = h1Text.match(/你好，\s*([^(\s]*)\s*\(?([^)]*)\)?\s*(\d+)级用户/i);
              if (welcomeMatch) {
                globalUsername = welcomeMatch[2] || welcomeMatch[1] || username;
                currentLevel = welcomeMatch[3];
                console.log(`从<h1>解析: 用户名='${globalUsername}', 当前等级='${currentLevel}'`);
              }
            }
            let userLevel = parseInt(currentLevel);
            if (isNaN(userLevel)) {
              const pageText = tempDiv.textContent || "";
              const levelRequirementMatch = pageText.match(/信任级别\s*(\d+)\s*的要求\s*(已达到|未达到)/);
              if (levelRequirementMatch) {
                const targetLevel = parseInt(levelRequirementMatch[1]);
                const status = levelRequirementMatch[2];
                if (status === "已达到") {
                  userLevel = targetLevel;
                  console.log(`检测到"已达到信任级别${targetLevel}的要求"，用户等级: ${userLevel}`);
                } else {
                  userLevel = targetLevel - 1;
                  console.log(`检测到"未达到信任级别${targetLevel}的要求"，用户等级: ${userLevel}`);
                }
                currentLevel = String(userLevel);
              }
              if (isNaN(userLevel)) {
                const statusMatch = pageText.match(/(已达到|不符合)信任级别\s*(\d+)\s*要求/);
                if (statusMatch) {
                  const status = statusMatch[1];
                  const targetLevel = parseInt(statusMatch[2]);
                  if (status === "已达到") {
                    userLevel = targetLevel;
                    console.log(`检测到"已达到信任级别${targetLevel}要求"，用户等级: ${userLevel}`);
                  } else {
                    userLevel = targetLevel - 1;
                    console.log(`检测到"不符合信任级别${targetLevel}要求"，用户等级: ${userLevel}`);
                  }
                  currentLevel = String(userLevel);
                }
              }
            }
            if (userLevel === 0 || userLevel === 1) {
              console.log(`检测到${userLevel}级用户，使用summary.json获取数据`);
              this.fetchLowLevelUserData(username, userLevel).then(resolve).catch(reject);
            } else if (userLevel >= 2) {
              console.log(`检测到${userLevel}级用户，使用connect.linux.do页面数据`);
              this.processHighLevelUserData(tempDiv, globalUsername, currentLevel);
              resolve();
            } else {
              console.log("无法从 connect.linux.do 解析等级，回退到 summary.json");
              this.fetchLowLevelUserData(username, 1).then(resolve).catch(reject);
            }
          } else {
            console.warn(`[信任等级] connect.linux.do 请求失败(${response.status})，降级到 summary.json`);
            this.fetchSummaryTrustLevelFallback(username)
              .then(resolve)
              .catch((fallbackErr) => {
                reject(new Error(`请求失败，状态码: ${response.status}；降级也失败: ${fallbackErr.message}`));
              });
          }
        },
        onerror: (error) => {
          console.error("GM_xmlhttpRequest 错误:", error);
          this.fetchSummaryTrustLevelFallback(username)
            .then(resolve)
            .catch((fallbackErr) => {
              reject(new Error(`网络请求错误；降级也失败: ${fallbackErr.message}`));
            });
        },
        ontimeout: () => {
          console.error("GM_xmlhttpRequest 超时");
          this.fetchSummaryTrustLevelFallback(username)
            .then(resolve)
            .catch((fallbackErr) => {
              reject(new Error(`请求超时；降级也失败: ${fallbackErr.message}`));
            });
        },
      });
    });
  },
  async fetchLowLevelUserData(username, currentLevel) {
    const summaryResponse = await fetch(`${BASE_URL}/u/${username}/summary.json`);
    if (summaryResponse.ok) {
      const data = await summaryResponse.json();
      const userSummary = data.user_summary;
      this.renderTrustLevelNew(username, currentLevel, userSummary);
    } else {
      throw new Error("无法获取用户summary数据");
    }
  },
  async fetchSummaryTrustLevelFallback(username) {
    const safeUsername = encodeURIComponent(username || "");
    const summaryResponse = await fetch(`${BASE_URL}/u/${safeUsername}/summary.json`, {
      credentials: "include",
    });
    if (!summaryResponse.ok) {
      throw new Error(`summary.json 请求失败(${summaryResponse.status})`);
    }
    const data = await summaryResponse.json();
    if (!data || !data.user_summary) {
      throw new Error("summary.json 返回数据不完整");
    }
    this.renderTrustLevel(data, username);
  },
  processHighLevelUserData(tempDiv, globalUsername, currentLevel) {
    let targetInfoDiv = null;
    const cardDivs = tempDiv.querySelectorAll("div.card");
    for (let i = 0; i < cardDivs.length; i++) {
      const div = cardDivs[i];
      const h22 = div.querySelector("h2.card-title");
      if (h22 && h22.textContent.includes("信任级别") && h22.textContent.includes("的要求")) {
        targetInfoDiv = div;
        break;
      }
    }
    if (!targetInfoDiv) {
      const potentialDivs = tempDiv.querySelectorAll("div.bg-white.p-6.rounded-lg");
      for (let i = 0; i < potentialDivs.length; i++) {
        const div = potentialDivs[i];
        const h22 = div.querySelector("h2");
        if (h22 && h22.textContent.includes("信任级别")) {
          targetInfoDiv = div;
          break;
        }
      }
    }
    if (!targetInfoDiv) {
      const allDivs = tempDiv.querySelectorAll("div");
      for (let i = 0; i < allDivs.length; i++) {
        const div = allDivs[i];
        const headings = div.querySelectorAll("h1, h2, h3");
        for (let j = 0; j < headings.length; j++) {
          if (headings[j].textContent.includes("信任级别") && headings[j].textContent.includes("的要求")) {
            targetInfoDiv = div;
            break;
          }
        }
        if (targetInfoDiv) break;
      }
    }
    if (!targetInfoDiv) {
      console.log("未找到信任级别数据块，回退到使用summary.json");
      this.fetchLowLevelUserData(globalUsername, parseInt(currentLevel));
      return;
    }
    const h2 = targetInfoDiv.querySelector("h2");
    const titleMatch = h2.textContent.match(/信任级别\s*(\d+)\s*的要求/);
    const targetLevel = titleMatch ? titleMatch[1] : "未知";
    const requirements = [];
    const rings = targetInfoDiv.querySelectorAll(".tl3-ring");
    rings.forEach((ring) => {
      const label = ring.querySelector(".tl3-ring-label");
      const circle = ring.querySelector(".tl3-ring-circle");
      const currentEl = ring.querySelector(".tl3-ring-current");
      const targetEl = ring.querySelector(".tl3-ring-target");
      if (label && currentEl) {
        const name = label.textContent.trim();
        const current = currentEl.textContent.trim();
        const required = targetEl ? targetEl.textContent.replace(/^[\s/]+/, "").trim() : "";
        const isMet = circle ? circle.classList.contains("met") : false;
        requirements.push({ name, current, required, isMet });
      }
    });
    const bars = targetInfoDiv.querySelectorAll(".tl3-bar-item");
    bars.forEach((bar) => {
      const labelEl = bar.querySelector(".tl3-bar-label");
      const numsEl = bar.querySelector(".tl3-bar-nums");
      if (labelEl && numsEl) {
        const name = labelEl.textContent.trim();
        const numsText = numsEl.textContent.trim();
        const parts = numsText.split("/");
        const current = parts[0] ? parts[0].trim() : numsText;
        const required = parts[1] ? parts[1].trim() : "";
        const isMet = numsEl.classList.contains("met");
        requirements.push({ name, current, required, isMet });
      }
    });
    const quotas = targetInfoDiv.querySelectorAll(".tl3-quota-card");
    quotas.forEach((quota) => {
      const labelEl = quota.querySelector(".tl3-quota-label");
      const numsEl = quota.querySelector(".tl3-quota-nums");
      if (labelEl && numsEl) {
        const name = labelEl.textContent.trim();
        const numsText = numsEl.textContent.trim();
        const parts = numsText.split("/");
        const current = parts[0] ? parts[0].trim() : numsText;
        const required = parts[1] ? parts[1].trim() : "";
        const isMet = quota.classList.contains("met");
        requirements.push({ name, current, required, isMet });
      }
    });
    const vetos = targetInfoDiv.querySelectorAll(".tl3-veto-item");
    vetos.forEach((veto) => {
      const labelEl = veto.querySelector(".tl3-veto-label");
      const valueEls = veto.querySelectorAll(".tl3-veto-value");
      if (labelEl && valueEls.length) {
        const name = labelEl.textContent.trim();
        const isMet = veto.classList.contains("met");
        let current = "0";
        const required = "0";
        if (isMet) {
          current = valueEls[0].textContent.trim() || "0";
        } else {
          current = valueEls[valueEls.length - 1].textContent.trim() || "0";
        }
        requirements.push({ name, current, required, isMet });
      }
    });
    if (requirements.length === 0) {
      const tableRows = targetInfoDiv.querySelectorAll("table tbody tr");
      tableRows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          const name = cells[0].textContent.trim();
          const required = cells[1].textContent.trim();
          const current = cells[2].textContent.trim();
          const isMet =
            cells[2].classList.contains("status-met") || cells[2].classList.contains("text-green-500");
          requirements.push({ name, current, required, isMet });
        }
      });
    }
    this.renderAdvancedTrustLevel(globalUsername, targetLevel, requirements);
  },
  renderTrustLevelNew(username, currentLevel, userSummary) {
    const targetLevel = currentLevel + 1;
    const requirements = CONFIG.levelRequirements[currentLevel];
    if (!requirements) {
      this.panel.trustLevelContainer.innerHTML = '<div class="trust-level-loading">无配置数据</div>';
      return;
    }
    const trustLevelDetails = {
      items: [],
      achievedCount: 0,
      totalCount: 0,
    };
    Object.entries(requirements).forEach(([key, requiredValue]) => {
      let currentValue = 0;
      let label = "";
      let isMet = false;
      switch (key) {
        case "topics_entered":
          currentValue = userSummary.topics_entered || 0;
          label = "浏览的话题";
          isMet = currentValue >= requiredValue;
          break;
        case "posts_read_count":
          currentValue = userSummary.posts_read_count || 0;
          label = "已读帖子";
          isMet = currentValue >= requiredValue;
          break;
        case "time_read":
          currentValue = Math.floor((userSummary.time_read || 0) / 60);
          label = "阅读时长(分)";
          isMet = (userSummary.time_read || 0) >= requiredValue;
          requiredValue = Math.floor(requiredValue / 60);
          break;
        case "days_visited":
          currentValue = userSummary.days_visited || 0;
          label = "访问天数";
          isMet = currentValue >= requiredValue;
          break;
        case "likes_given":
          currentValue = userSummary.likes_given || 0;
          label = "给出的赞";
          isMet = currentValue >= requiredValue;
          break;
        case "likes_received":
          currentValue = userSummary.likes_received || 0;
          label = "收到的赞";
          isMet = currentValue >= requiredValue;
          break;
        case "post_count":
          currentValue = userSummary.post_count || 0;
          label = "帖子数量";
          isMet = currentValue >= requiredValue;
          break;
      }
      if (label) {
        trustLevelDetails.items.push({
          name: label,
          current: currentValue,
          required: requiredValue,
          isMet,
        });
        if (isMet) {
          trustLevelDetails.achievedCount++;
        }
        trustLevelDetails.totalCount++;
      }
    });
    const achievedCount = trustLevelDetails.achievedCount;
    const totalCount = trustLevelDetails.totalCount;
    const allMet = achievedCount === totalCount;
    const levelNames = {
      0: "Lv0 → Lv1",
      1: "Lv1 → Lv2",
    };
    const yesterdaySnapshot = this.getYesterdaySnapshot(username);
    const headerTitle = allMet
      ? `Lv${targetLevel} ✓`
      : levelNames[currentLevel] || `Lv${currentLevel} → Lv${targetLevel}`;
    let html = `
          <div class="trust-level-header">
              <span>📊 ${headerTitle} (${username})</span>
              <button class="trust-level-refresh" data-action="refresh">🔄 刷新</button>
          </div>
      `;
    trustLevelDetails.items.forEach((req) => {
      const progress = Math.min((req.current / req.required) * 100, 100);
      const isCompleted = req.isMet;
      const fillClass = isCompleted ? "completed" : "";
      const diff = this.calculateDataChange(req.current, yesterdaySnapshot, req.name);
      const changeIndicator = this.generateChangeIndicator(diff);
      const isNegativeIndicator =
        req.name.includes("被禁言") ||
        req.name.includes("被封禁") ||
        req.name.includes("被举报的帖子") ||
        req.name.includes("发起举报的用户");
      const currentValueHtml = isNegativeIndicator
        ? `<span style="color: #ff6b6b;">${req.current}</span>`
        : req.current;
      html += this.renderTrustLevelItem(
        req.name,
        fillClass,
        progress,
        currentValueHtml,
        req.required,
        changeIndicator,
      );
    });
    html += this.renderTrustLevelResult(allMet, targetLevel, achievedCount, totalCount);
    this.panel.trustLevelContainer.innerHTML = html;
    this.saveTrustLevelCache(username, {
      type: "low_level",
      username,
      currentLevel,
      targetLevel,
      items: trustLevelDetails.items,
      achievedCount,
      totalCount,
      allMet,
    });
    this.bindTrustLevelRefresh();
  },
  renderTrustLevel(data, username) {
    const summary = data.user_summary;
    if (!summary) {
      this.panel.trustLevelContainer.innerHTML = '<div class="trust-level-loading">无数据</div>';
      return;
    }
    const currentLevel =
      summary.trust_level !== void 0
        ? summary.trust_level
        : data.user && data.user.trust_level !== void 0
          ? data.user.trust_level
          : 1;
    const targetLevel = currentLevel + 1;
    const levelConfig = CONFIG.levelRequirements[currentLevel];
    if (!levelConfig) {
      this.renderDefaultTrustLevel(summary, username);
      return;
    }
    const requirements = [];
    Object.entries(levelConfig).forEach(([key, requiredValue]) => {
      let currentValue = 0;
      let label = "";
      switch (key) {
        case "topics_entered":
          currentValue = summary.topics_entered || 0;
          label = "浏览的话题";
          break;
        case "posts_read_count":
          currentValue = summary.posts_read_count || 0;
          label = "已读帖子";
          break;
        case "time_read":
          currentValue = Math.floor((summary.time_read || 0) / 60);
          label = "阅读时长(分)";
          requiredValue = Math.floor(requiredValue / 60);
          break;
        case "days_visited":
          currentValue = summary.days_visited || 0;
          label = "访问天数";
          break;
        case "likes_given":
          currentValue = summary.likes_given || 0;
          label = "给出的赞";
          break;
        case "likes_received":
          currentValue = summary.likes_received || 0;
          label = "收到的赞";
          break;
        case "post_count":
          currentValue = summary.post_count || 0;
          label = "帖子数量";
          break;
      }
      if (label) {
        requirements.push({
          name: label,
          current: currentValue,
          required: requiredValue,
        });
      }
    });
    const achievedCount = requirements.filter((req) => req.current >= req.required).length;
    const totalCount = requirements.length;
    const allMet = achievedCount === totalCount;
    const levelNames = {
      0: "Lv0 → Lv1",
      1: "Lv1 → Lv2",
      2: "Lv2 → Lv3",
      3: "Lv3 → Lv4",
    };
    const yesterdaySnapshot = this.getYesterdaySnapshot(username);
    let html = `
          <div class="trust-level-header">
              <span>📊 ${levelNames[currentLevel] || `Lv${currentLevel} → Lv${targetLevel}`} (${username})</span>
              <button class="trust-level-refresh" data-action="refresh">🔄 刷新</button>
          </div>
      `;
    requirements.forEach((req) => {
      const progress = Math.min((req.current / req.required) * 100, 100);
      const isCompleted = req.current >= req.required;
      const fillClass = isCompleted ? "completed" : "";
      const diff = this.calculateDataChange(req.current, yesterdaySnapshot, req.name);
      const changeIndicator = this.generateChangeIndicator(diff);
      const isNegativeIndicator =
        req.name.includes("被禁言") ||
        req.name.includes("被封禁") ||
        req.name.includes("被举报的帖子") ||
        req.name.includes("发起举报的用户");
      const currentValueHtml = isNegativeIndicator
        ? `<span style="color: #ff6b6b;">${req.current}</span>`
        : req.current;
      html += this.renderTrustLevelItem(
        req.name,
        fillClass,
        progress,
        currentValueHtml,
        req.required,
        changeIndicator,
      );
    });
    html += this.renderTrustLevelResult(allMet, targetLevel, achievedCount, totalCount);
    this.panel.trustLevelContainer.innerHTML = html;
    const cacheItems = requirements.map((req) => ({
      name: req.name,
      current: req.current,
      required: req.required,
      isMet: req.current >= req.required,
    }));
    this.saveTrustLevelCache(username, {
      type: "low_level",
      username,
      currentLevel,
      targetLevel,
      items: cacheItems,
      achievedCount,
      totalCount,
      allMet,
    });
    this.bindTrustLevelRefresh();
  },
  renderDefaultTrustLevel(summary, username) {
    const requirements = [
      { name: "访问天数", current: summary.days_visited, required: 15 },
      { name: "给出的赞", current: summary.likes_given, required: 1 },
      { name: "收到的赞", current: summary.likes_received, required: 1 },
      { name: "帖子数量", current: summary.post_count, required: 3 },
      { name: "进入主题", current: summary.topics_entered, required: 20 },
      { name: "阅读帖子", current: summary.posts_read_count, required: 100 },
      { name: "阅读时长(分)", current: Math.floor(summary.time_read / 60), required: 60 },
    ];
    const achievedCount = requirements.filter((req) => req.current >= req.required).length;
    const totalCount = requirements.length;
    const allMet = achievedCount === totalCount;
    let html = `
          <div class="trust-level-header">
              <span>📊 等级 (L2+) (${username || ""})</span>
              <button class="trust-level-refresh" data-action="refresh">🔄 刷新</button>
          </div>
      `;
    if (allMet) {
      html += `
              <div style="background: rgba(16, 185, 129, 0.2); padding: 6px 8px; border-radius: 6px; margin: 6px 0;">
                  <div style="color: #10b981; font-size: 11px; font-weight: 600; text-align: center;">
                      🎉 所有要求已达标！
                  </div>
              </div>
          `;
    } else {
      const unmetCount = totalCount - achievedCount;
      html += `
              <div style="background: rgba(251, 146, 60, 0.2); padding: 6px 8px; border-radius: 6px; margin: 6px 0;">
                  <div style="color: #ea580c; font-size: 11px; font-weight: 600; text-align: center;">
                      还需完成 ${unmetCount} 项要求
                  </div>
              </div>
          `;
    }
    requirements.forEach((req) => {
      const progress = Math.min((req.current / req.required) * 100, 100);
      const isCompleted = req.current >= req.required;
      const fillClass = isCompleted ? "completed" : "";
      const isNegativeIndicator =
        req.name.includes("被禁言") ||
        req.name.includes("被封禁") ||
        req.name.includes("被举报的帖子") ||
        req.name.includes("发起举报的用户");
      const currentValueHtml = isNegativeIndicator
        ? `<span style="color: #ff6b6b;">${req.current}</span>`
        : req.current;
      html += this.renderTrustLevelItem(req.name, fillClass, progress, currentValueHtml, req.required);
    });
    this.panel.trustLevelContainer.innerHTML = html;
    this.bindTrustLevelRefresh();
  },
  renderAdvancedTrustLevel(username, targetLevel, requirements) {
    const achievedCount = requirements.filter((r) => r.isMet).length;
    const totalCount = requirements.length;
    const currentLevel = parseInt(targetLevel) - 1;
    const levelNames = {
      2: "Lv1 → Lv2",
      3: "Lv2 → Lv3",
      4: "Lv3 → Lv4",
    };
    const yesterdaySnapshot = this.getYesterdaySnapshot(username);
    const allRequirementsMet = achievedCount === totalCount;
    const headerTitle = allRequirementsMet
      ? `Lv${targetLevel} ✓`
      : levelNames[targetLevel] || `Lv${currentLevel} → Lv${targetLevel}`;
    let html = `
          <div class="trust-level-header">
              <span>📊 ${headerTitle} (${username})</span>
              <button class="trust-level-refresh" data-action="refresh">🔄 刷新</button>
          </div>
      `;
    requirements.forEach((req) => {
      const currentMatch = req.current.match(/(\d+)/);
      const requiredMatch = req.required.match(/(\d+)/);
      const currentNum = currentMatch ? parseInt(currentMatch[1]) : 0;
      const requiredNum = requiredMatch ? parseInt(requiredMatch[1]) : 1;
      const progress = Math.min((currentNum / requiredNum) * 100, 100);
      const isCompleted = req.isMet;
      const fillClass = isCompleted ? "completed" : "";
      let simpleName = this.simplifyTrustLevelName(req.name);
      const diff = this.calculateDataChange(currentNum, yesterdaySnapshot, simpleName);
      const changeIndicator = this.generateChangeIndicator(diff);
      const isNegativeIndicator =
        req.name.includes("被禁言") ||
        req.name.includes("被封禁") ||
        req.name.includes("被举报的帖子") ||
        req.name.includes("发起举报的用户");
      const currentValueHtml = isNegativeIndicator
        ? `<span style="color: #ff6b6b;">${req.current}</span>`
        : req.current;
      html += this.renderTrustLevelItem(
        simpleName,
        fillClass,
        progress,
        currentValueHtml,
        req.required,
        changeIndicator,
      );
    });
    html += this.renderTrustLevelResult(achievedCount === totalCount, targetLevel, achievedCount, totalCount);
    this.panel.trustLevelContainer.innerHTML = html;
    this.saveTrustLevelCache(username, {
      type: "high_level",
      username,
      targetLevel,
      currentLevel,
      requirements,
      achievedCount,
      totalCount,
    });
    this.bindTrustLevelRefresh();
  },
};

export { accountMethods };
