import { Storage } from "../core/storage.js";

const creditMethods = {
  async loadCreditInfo(isManualRefresh = false) {
    if (!this.panel.creditContainer) return;
    if (!isManualRefresh && !this.shouldRefreshCreditInfo()) return;
    const now = Date.now();
    const MIN_INTERVAL = 30 * 60 * 1e3;
    const leaderboard429Until = Storage.get("leaderboard429Until", 0);
    if (leaderboard429Until > now) {
      const remainingMinutes = Math.ceil((leaderboard429Until - now) / 6e4);
      console.log(`[Credit] Leaderboard 429 冷却中，还需等待 ${remainingMinutes} 分钟`);
      const cachedData = Storage.get("creditCachedData", null);
      if (cachedData) {
        this.renderCreditInfo(cachedData.userData, cachedData.dailyStats, cachedData.leaderboardData);
        const footer = this.panel.creditContainer.querySelector(".credit-footer");
        if (footer) {
          footer.innerHTML = `
                      <a href="https://credit.linux.do/home" target="_blank" class="credit-link">${this.t("creditViewDetails")}</a>
                      <span class="credit-update-time" style="color: #ff9999;">🔥 冷却中 ${remainingMinutes}分钟</span>
                  `;
        }
      } else {
        this.renderCreditError(`请求过于频繁，请等待 ${remainingMinutes} 分钟后再试`);
      }
      return;
    }
    const lastCreditFetch = Storage.get("lastCreditFetch", 0);
    if (!isManualRefresh && lastCreditFetch > 0 && now - lastCreditFetch < MIN_INTERVAL) {
      const cachedData = Storage.get("creditCachedData", null);
      if (cachedData) {
        console.log("[Credit] 使用缓存数据（未到刷新间隔）");
        this.renderCreditInfo(cachedData.userData, cachedData.dailyStats, cachedData.leaderboardData);
        return;
      }
    }
    if (isManualRefresh) {
      const refreshBtn = this.panel.creditContainer.querySelector(".credit-refresh-btn");
      if (refreshBtn) {
        refreshBtn.textContent = refreshBtn.classList.contains("credit-auth-refresh")
          ? "…"
          : this.t("refreshing");
        refreshBtn.setAttribute("aria-busy", "true");
        refreshBtn.disabled = true;
      }
    } else {
      this.panel.creditContainer.innerHTML = `<div class="trust-level-loading">${this.t("loadingCredits")}</div>`;
    }
    try {
      const userData = await this.fetchCreditUserInfo();
      if (!userData) {
        this.renderCreditError(this.t("creditLoginRequired"), true);
        return;
      }
      const dailyStats = await this.fetchCreditDailyStats();
      const leaderboardData = await this.fetchLeaderboardData();
      Storage.set("creditCachedData", { userData, dailyStats, leaderboardData });
      Storage.set("lastCreditFetch", now);
      this.renderCreditInfo(userData, dailyStats, leaderboardData);
    } catch (error) {
      console.error("加载 Credit 信息失败:", error);
      this.renderCreditError("加载失败，请稍后重试");
    }
  },
  fetchCreditUserInfo() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://credit.linux.do/api/v1/oauth/user-info",
        anonymous: false,
        timeout: 15e3,
        headers: {
          Accept: "application/json",
          Referer: "https://credit.linux.do/home",
          Origin: "https://credit.linux.do",
        },
        onload: (response) => {
          console.log("[Credit] API 响应状态:", response.status);
          if (response.status === 200) {
            try {
              const json = JSON.parse(response.responseText);
              if (json && json.data) {
                resolve(json.data);
                return;
              }
            } catch (e) {
              console.error("Credit API 解析错误:", e);
            }
          } else if (response.status === 401 || response.status === 403) {
            console.log("[Credit] 未登录或无权限");
            resolve(null);
            return;
          }
          resolve(null);
        },
        onerror: (error) => {
          console.error("Credit API 请求错误:", error);
          resolve(null);
        },
        ontimeout: () => {
          console.error("Credit API 请求超时");
          resolve(null);
        },
      });
    });
  },
  fetchCreditDailyStats() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://credit.linux.do/api/v1/dashboard/stats/daily?days=7",
        anonymous: false,
        timeout: 15e3,
        headers: {
          Accept: "application/json",
          Referer: "https://credit.linux.do/home",
          Origin: "https://credit.linux.do",
        },
        onload: (response) => {
          if (response.status === 200) {
            try {
              const json = JSON.parse(response.responseText);
              if (json && json.data && Array.isArray(json.data)) {
                resolve(json.data);
                return;
              }
            } catch (e) {
              console.error("Credit 每日统计解析错误:", e);
            }
          }
          resolve([]);
        },
        onerror: () => resolve([]),
        ontimeout: () => resolve([]),
      });
    });
  },
  fetchLeaderboardData() {
    return new Promise((resolve) => {
      const now = Date.now();
      const leaderboard429Until = Storage.get("leaderboard429Until", 0);
      if (leaderboard429Until > now) {
        const remainMinutes = Math.ceil((leaderboard429Until - now) / 6e4);
        console.log(`[Leaderboard] 429 冷却期中，剩余 ${remainMinutes} 分钟`);
        const cachedLeaderboard = Storage.get("cachedLeaderboardData", null);
        resolve(cachedLeaderboard);
        return;
      }
      let got429 = false;
      Promise.all([
        fetch("https://linux.do/leaderboard/1?period=daily", {
          credentials: "include",
          headers: { Accept: "application/json" },
        })
          .then((r) => {
            if (r.status === 429) {
              got429 = true;
              return null;
            }
            return r.ok ? r.json() : null;
          })
          .catch(() => null),
        fetch("https://linux.do/leaderboard/1?period=all", {
          credentials: "include",
          headers: { Accept: "application/json" },
        })
          .then((r) => {
            if (r.status === 429) {
              got429 = true;
              return null;
            }
            return r.ok ? r.json() : null;
          })
          .catch(() => null),
      ])
        .then(([dailyData, allTimeData]) => {
          if (got429) {
            const cooldownUntil = Date.now() + 30 * 60 * 1e3;
            Storage.set("leaderboard429Until", cooldownUntil);
            console.warn("[Leaderboard] 检测到 429 错误，已设置 30 分钟冷却期");
          }
          let dailyScore = 0;
          let totalCredits = 0;
          let totalRank = 0;
          if (dailyData && dailyData.personal && dailyData.personal.user) {
            dailyScore = dailyData.personal.user.total_score || 0;
          }
          if (allTimeData && allTimeData.personal && allTimeData.personal.user) {
            totalCredits = allTimeData.personal.user.total_score || 0;
            totalRank = allTimeData.personal.position || allTimeData.personal.user.position || 0;
          }
          if (totalRank || totalCredits) {
            const result = {
              totalCredits,
              rank: totalRank,
              dailyScore,
            };
            Storage.set("cachedLeaderboardData", result);
            resolve(result);
          } else {
            const cachedLeaderboard = Storage.get("cachedLeaderboardData", null);
            resolve(cachedLeaderboard);
          }
        })
        .catch((error) => {
          console.error("获取排行榜数据失败:", error);
          resolve(null);
        });
    });
  },
  renderCreditInfo(userData, dailyStats, leaderboardData = null) {
    const credits = userData.available_balance || "0";
    const communityBalance = userData.community_balance || "0";
    const dailyLimit = userData.remain_quota || "0";
    const incomeTotal = userData.total_receive || "0";
    const expenseTotal = userData.total_payment || "0";
    const username = userData.nickname || userData.username || "User";
    let incomeList = [];
    let expenseList = [];
    if (dailyStats && dailyStats.length > 0) {
      dailyStats.forEach((item) => {
        const date = item.date.substring(5).replace("-", "/");
        const income = parseFloat(item.income) || 0;
        const expense = parseFloat(item.expense) || 0;
        if (income !== 0) {
          incomeList.push({
            date,
            amount: income > 0 ? "+" + income.toFixed(2) : income.toFixed(2),
            isNegative: income < 0,
          });
        }
        if (expense > 0) expenseList.push({ date, amount: "-" + expense.toFixed(2) });
      });
      incomeList.reverse();
      expenseList.reverse();
    }
    const updateTime = /* @__PURE__ */ new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    let html = `
          <div class="trust-level-header">
              <span>💰 ${this.escapeHtml(username)} ${this.t("userCredits")}</span>
              <button class="trust-level-refresh credit-refresh-btn" data-action="refresh-credit">${this.t("refresh")}</button>
          </div>
          <div class="credit-main-stat">
              <span class="credit-stat-label">${this.t("creditAvailable")}</span>
              <span class="credit-stat-value">${this.escapeHtml(credits)}</span>
          </div>
      `;
    if (leaderboardData) {
      const tomorrowCredits = (leaderboardData.totalCredits - communityBalance).toFixed(0);
      html += `
          <div class="credit-main-stat credit-tomorrow-stat">
              <span class="credit-stat-label">${this.t("creditTomorrow")}</span>
              <span class="credit-stat-value">${this.escapeHtml(tomorrowCredits)}</span>
          </div>
          `;
    }
    html += `<div class="credit-summary-list">`;
    if (leaderboardData) {
      html += `
          <div class="trust-level-item">
              <span class="trust-level-name">${this.t("creditCurrentPoints")}</span>
              <span class="trust-level-value credit-value-gold">
                  <span>${this.escapeHtml(leaderboardData.totalCredits)}</span>
                  <span class="credit-rank-badge">${this.t("creditRankLabel")}#${this.escapeHtml(leaderboardData.rank)}</span>
              </span>
          </div>
          <div class="trust-level-item">
              <span class="trust-level-name">${this.t("creditYesterdayPoints")}</span>
              <span class="trust-level-value credit-value-green">${this.escapeHtml(communityBalance)}</span>
          </div>
          `;
    }
    html += `
          <div class="trust-level-item">
              <span class="trust-level-name">${this.t("creditDailyLimit")}</span>
              <span class="trust-level-value credit-value-blue">${this.escapeHtml(dailyLimit)}</span>
          </div>
          <div class="trust-level-item">
              <span class="trust-level-name">${this.t("creditTotalIncome")}</span>
              <span class="trust-level-value credit-value-green">+${this.escapeHtml(incomeTotal)}</span>
          </div>
          <div class="trust-level-item">
              <span class="trust-level-name">${this.t("creditTotalExpense")}</span>
              <span class="trust-level-value credit-value-red">-${this.escapeHtml(expenseTotal)}</span>
          </div>
      `;
    html += `</div>`;
    if (incomeList.length > 0) {
      html += `
              <div class="credit-history-section">
                  <div class="credit-section-title">${this.t("creditRecentIncome")}</div>
                  <div class="credit-history-list">
          `;
      incomeList.slice(0, 5).forEach((item) => {
        const note = item.isNegative ? " (社区点数倒退扣除)" : "";
        html += `
                  <div class="trust-level-item">
                      <span class="trust-level-name">${this.escapeHtml(item.date)}${note}</span>
                      <span class="trust-level-value ${item.isNegative ? "credit-value-red" : "credit-value-green"}">${this.escapeHtml(item.amount)}</span>
                  </div>
              `;
      });
      html += `
                  </div>
              </div>
          `;
    }
    if (expenseList.length > 0) {
      html += `
              <div class="credit-history-section">
                  <div class="credit-section-title">${this.t("creditRecentExpense")}</div>
                  <div class="credit-history-list">
          `;
      expenseList.slice(0, 3).forEach((item) => {
        html += `
                  <div class="trust-level-item">
                      <span class="trust-level-name">${this.escapeHtml(item.date)}</span>
                      <span class="trust-level-value credit-value-red">${this.escapeHtml(item.amount)}</span>
                  </div>
              `;
      });
      html += `
                  </div>
              </div>
          `;
    }
    html += `
          <div class="credit-footer">
              <a href="https://credit.linux.do/home" target="_blank" class="credit-link">${this.t("creditViewDetails")}</a>
              <span class="credit-update-time">${this.t("update")}: ${this.escapeHtml(updateTime)}</span>
          </div>
      `;
    this.panel.creditContainer.innerHTML = html;
    setTimeout(() => {
      const refreshBtn = this.panel.creditContainer.querySelector(".credit-refresh-btn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.loadCreditInfo(true);
        });
      }
    }, 100);
  },
  renderCreditError(message, showLogin = false) {
    if (showLogin) {
      const html = `
              <div class="credit-auth-state" role="status">
                  <div class="credit-auth-header">
                      <span class="credit-auth-status">
                          <span class="credit-auth-dot" aria-hidden="true"></span>
                          ${this.t("notLoggedIn")}
                      </span>
                  </div>
                  <p class="credit-auth-message">${this.t("creditLoginDescription")}</p>
                  <div class="credit-auth-actions">
                      <a href="https://credit.linux.do" target="_blank" rel="noopener noreferrer" class="credit-login-btn">
                          <span>${this.t("creditGoLogin")}</span>
                          <span class="credit-login-arrow" aria-hidden="true">↗</span>
                      </a>
                      <button type="button" class="trust-level-refresh credit-refresh-btn credit-auth-refresh" data-action="refresh-credit" title="重新检查登录状态" aria-label="重新检查登录状态">↻</button>
                  </div>
              </div>
          `;
      this.panel.creditContainer.innerHTML = html;
    } else {
      const html = `
              <div class="credit-auth-state" role="status">
                  <div class="credit-auth-header">
                      <span class="credit-auth-status">
                          <span class="credit-auth-dot" aria-hidden="true"></span>
                          ${this.t("sectionCredit")}
                      </span>
                      <button type="button" class="trust-level-refresh credit-refresh-btn" data-action="refresh-credit">${this.t("refresh")}</button>
                  </div>
                  <p class="credit-auth-message">${this.escapeHtml(message)}</p>
              </div>
          `;
      this.panel.creditContainer.innerHTML = html;
    }
    setTimeout(() => {
      const refreshBtn = this.panel.creditContainer.querySelector(".credit-refresh-btn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.loadCreditInfo(true);
        });
      }
    }, 100);
  },
};

export { creditMethods };
