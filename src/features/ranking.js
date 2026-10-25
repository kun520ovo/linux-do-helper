import { BASE_URL } from "../core/runtime-context.js";

const rankingMethods = {
  async loadRankingData(isManualRefresh = false) {
    if (!this.panel.rankDataContainer) return;
    if (!isManualRefresh && !this.shouldRefreshRankInfo()) return;
    if (isManualRefresh) {
      const refreshBtn = this.panel.rankDataContainer.querySelector(".rank-refresh-btn");
      if (refreshBtn) {
        refreshBtn.textContent = this.t("refreshing");
        refreshBtn.disabled = true;
      }
    } else {
      this.panel.rankDataContainer.innerHTML = `<div class="trust-level-loading">${this.t("loadingRank")}</div>`;
    }
    try {
      const periods = [
        { key: "daily", name: this.t("dailyRank"), icon: "📅" },
        { key: "weekly", name: this.t("weeklyRank"), icon: "📆" },
        { key: "monthly", name: this.t("monthlyRank"), icon: "🗓️" },
        { key: "quarterly", name: this.t("quarterlyRank"), icon: "📊" },
        { key: "yearly", name: this.t("yearlyRank"), icon: "📈" },
        { key: "all", name: this.t("allTimeRank"), icon: "🏅" },
      ];
      const rankPromises = periods.map((period) => this.fetchRankingByPeriod(period.key));
      const rankResults = await Promise.all(rankPromises);
      this.renderRankingData(periods, rankResults);
    } catch (error) {
      console.error("加载排名数据失败:", error);
      this.panel.rankDataContainer.innerHTML = `
              <div class="trust-level-header">
                  <span>${this.t("sectionRanking").replace(/^\s*🏆\s*/, "")}</span>
                  <button class="trust-level-refresh rank-refresh-btn">${this.t("refresh")}</button>
              </div>
              <div class="trust-level-loading">${this.t("loadFailed")}</div>
          `;
      this.bindRankRefreshBtn();
    }
  },
  fetchRankingByPeriod(period) {
    return new Promise((resolve) => {
      fetch(`${BASE_URL}/leaderboard/1?period=${period}`, {
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      })
        .then((response) => {
          if (response.ok) {
            return response.json();
          }
          throw new Error("请求失败");
        })
        .then((data) => {
          if (data && data.personal && data.personal.user) {
            resolve({
              score: data.personal.user.total_score || 0,
              position: data.personal.position || data.personal.user.position || 0,
            });
          } else {
            resolve({ score: 0, position: "-" });
          }
        })
        .catch((error) => {
          console.error(`获取${period}排名失败:`, error);
          resolve({ score: 0, position: "-" });
        });
    });
  },
  renderRankingData(periods, results) {
    const updateTime = /* @__PURE__ */ new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    let html = `
          <div class="trust-level-header">
              <span>${this.t("myRanking")}</span>
              <button class="trust-level-refresh rank-refresh-btn">${this.t("refresh")}</button>
          </div>
      `;
    periods.forEach((period, index) => {
      const result = results[index];
      const positionText = result.position === "-" ? "-" : `#${result.position}`;
      const scoreText = result.score || 0;
      html += `
              <div class="rank-item">
                  <span class="rank-period">
                      <span>${period.icon}</span>
                      <span class="rank-period-label">${period.name}</span>
                  </span>
                  <span class="rank-values">
                      <span class="rank-score">${scoreText}${this.t("points")}</span>
                      <span class="rank-position">${positionText}</span>
                  </span>
              </div>
          `;
    });
    html += `
          <div class="rank-footer">
              <a href="${BASE_URL}/leaderboard" target="_blank" class="rank-detail-link">${this.t("detailInfo")}</a>
              <span class="rank-update-time">${this.t("update")}: ${this.escapeHtml(updateTime)}</span>
          </div>
      `;
    this.panel.rankDataContainer.innerHTML = html;
    this.bindRankRefreshBtn();
  },
  bindRankRefreshBtn() {
    setTimeout(() => {
      const refreshBtn = this.panel.rankDataContainer?.querySelector(".rank-refresh-btn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.loadRankingData(true);
        });
      }
    }, 100);
  },
};

export { rankingMethods };
