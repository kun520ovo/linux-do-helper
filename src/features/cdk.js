const cdkMethods = {
  async loadCdkInfo(isManualRefresh = false) {
    if (!this.panel.cdkContainer) return;
    if (!isManualRefresh && !this.shouldRefreshCdkInfo()) return;
    if (isManualRefresh) {
      const refreshBtn = this.panel.cdkContainer.querySelector(".cdk-refresh-btn");
      if (refreshBtn) {
        refreshBtn.textContent = refreshBtn.classList.contains("cdk-panel-refresh")
          ? "…"
          : this.t("refreshing");
        refreshBtn.setAttribute("aria-busy", "true");
        refreshBtn.disabled = true;
      }
    } else {
      this.panel.cdkContainer.innerHTML = `<div class="trust-level-loading">${this.t("loadingCdk")}</div>`;
    }
    try {
      const cdkData = await this.fetchCdkUserInfo();
      if (!cdkData) {
        this.renderCdkError(this.t("cdkNotAuth"), true);
        return;
      }
      this.renderCdkInfo(cdkData);
    } catch (error) {
      console.error("加载 CDK 信息失败:", error);
      this.renderCdkError(this.t("loadFailed"));
    }
  },
  ensureCdkBridge() {
    if (this.cdkBridgeInit) return;
    this.cdkBridgeInit = true;
    this.cdkWaiters = [];
    window.addEventListener("message", (event) => {
      if (event.origin !== "https://cdk.linux.do") return;
      const payload = event.data?.payload || event.data;
      if (!payload?.data) return;
      console.log("[CDK] 收到 Bridge 数据:", payload.data);
      GM_setValue("lda_cdk_cache", { data: payload.data, ts: Date.now() });
      const waiters = [...this.cdkWaiters];
      this.cdkWaiters = [];
      waiters.forEach((fn) => fn(payload.data));
    });
    const iframe = document.createElement("iframe");
    iframe.id = "lda-cdk-bridge";
    iframe.src = "https://cdk.linux.do/dashboard";
    iframe.style.cssText = "width:0;height:0;opacity:0;position:absolute;border:0;pointer-events:none;";
    document.body.appendChild(iframe);
    this.cdkBridgeFrame = iframe;
  },
  fetchCdkViaBridge() {
    return new Promise((resolve, reject) => {
      this.ensureCdkBridge();
      const timer = setTimeout(() => {
        this.cdkWaiters = this.cdkWaiters.filter((fn) => fn !== done);
        reject(new Error("CDK bridge timeout"));
      }, 8e3);
      const done = (data) => {
        clearTimeout(timer);
        resolve(data);
      };
      this.cdkWaiters.push(done);
      try {
        this.cdkBridgeFrame?.contentWindow?.postMessage({ type: "lda-cdk-request" }, "https://cdk.linux.do");
      } catch (_) {}
    });
  },
  async fetchCdkUserInfo() {
    const cache = GM_getValue("lda_cdk_cache", null);
    if (cache && cache.data && cache.ts && Date.now() - cache.ts < 5 * 60 * 1e3) {
      console.log("[CDK] 使用 GM 缓存数据");
      return cache.data;
    }
    try {
      const directResult = await this.fetchCdkDirect();
      if (directResult) {
        console.log("[CDK] 直接请求成功");
        const cacheData = { user: directResult, received: null };
        GM_setValue("lda_cdk_cache", { data: cacheData, ts: Date.now() });
        return cacheData;
      }
    } catch (e) {
      console.log("[CDK] 直接请求失败，尝试 Bridge 方式:", e.message);
    }
    try {
      const bridgeResult = await this.fetchCdkViaBridge();
      if (bridgeResult) {
        console.log("[CDK] Bridge 请求成功");
        return bridgeResult;
      }
    } catch (e) {
      console.log("[CDK] Bridge 请求失败:", e.message);
    }
    if (cache && cache.data) {
      console.log("[CDK] 使用旧缓存数据");
      return cache.data;
    }
    return null;
  },
  fetchCdkDirect() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://cdk.linux.do/api/v1/oauth/user-info",
        anonymous: false,
        timeout: 1e4,
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
        onload: (response) => {
          if (response.responseText && response.responseText.includes("Just a moment")) {
            reject(new Error("Cloudflare challenge"));
            return;
          }
          if (response.status === 401 || response.status === 403) {
            resolve(null);
            return;
          }
          if (response.status >= 200 && response.status < 300) {
            try {
              const json = JSON.parse(response.responseText);
              if (json && json.data) {
                resolve(json.data);
                return;
              }
              if (json && (json.username || json.score !== void 0)) {
                resolve(json);
                return;
              }
            } catch (e) {
              reject(new Error("JSON parse error"));
              return;
            }
          }
          resolve(null);
        },
        onerror: (error) => {
          reject(error);
        },
        ontimeout: () => {
          reject(new Error("请求超时"));
        },
      });
    });
  },
  fetchCdkReceived() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://cdk.linux.do/api/v1/projects/received?current=1&size=20&search=",
        anonymous: false,
        withCredentials: true,
        timeout: 15e3,
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Referer: "https://cdk.linux.do/received",
        },
        onload: (response) => {
          console.log("[CDK] 领取记录响应状态:", response.status);
          if (response.responseText && response.responseText.includes("Just a moment")) {
            console.log("[CDK] 领取记录被 Cloudflare 拦截");
            resolve({ total: 0, results: [], cloudflareBlocked: true });
            return;
          }
          if (response.status >= 200 && response.status < 300) {
            try {
              const json = JSON.parse(response.responseText);
              console.log("[CDK] 领取记录解析成功:", json);
              if (json && json.data) {
                resolve({
                  total: json.data.total || 0,
                  results: json.data.results || [],
                });
                return;
              }
              if (json && json.error_msg === "") {
                resolve({ total: 0, results: [] });
                return;
              }
            } catch (e) {
              console.error("[CDK] 解析领取记录失败:", e, response.responseText?.substring(0, 200));
            }
          } else {
            console.error("[CDK] 领取记录请求失败，状态码:", response.status);
          }
          resolve({ total: 0, results: [] });
        },
        onerror: (error) => {
          console.error("[CDK] 获取领取记录失败:", error);
          resolve({ total: 0, results: [] });
        },
        ontimeout: () => {
          console.error("[CDK] 获取领取记录超时");
          resolve({ total: 0, results: [] });
        },
      });
    });
  },
  renderCdkInfo(cdkData) {
    const userData = cdkData.user || cdkData;
    const receivedData = cdkData.received || null;
    const score = userData.score || 0;
    const trustLevel = userData.trust_level ?? userData.trustLevel ?? "-";
    const username = userData.username || "-";
    const nickname = userData.nickname || userData.name || username;
    const displayNickname = nickname || username || "-";
    const showUsername = username && username !== displayNickname && username !== "-";
    const updateTime = /* @__PURE__ */ new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    let html = `
          <div class="cdk-panel-header">
              <span class="cdk-panel-title">${this.t("cdkOverview")}</span>
              <button type="button" class="trust-level-refresh cdk-refresh-btn cdk-panel-refresh" data-action="refresh-cdk" title="${this.t("cdkRefreshTip")}" aria-label="${this.t("cdkRefreshTip")}">↻</button>
          </div>
          <div class="cdk-score-card">
              <span class="credit-stat-label">${this.t("cdkScore")}</span>
              <span class="cdk-score-value">${this.escapeHtml(score)}</span>
          </div>
          <div class="cdk-account-section">
              <div class="cdk-section-heading">${this.t("cdkAccountInfo")}</div>
              <div class="cdk-account-list">
                  <div class="cdk-account-item">
                      <span class="cdk-account-label">${this.t("cdkTrustLevel")}</span>
                      <span class="cdk-account-value cdk-trust-level-value">Lv${this.escapeHtml(trustLevel)}</span>
                  </div>
                  <div class="cdk-account-item">
                      <span class="cdk-account-label">${this.t("cdkNickname")}</span>
                      <span class="cdk-account-value cdk-account-name-value">
                          <span class="cdk-account-name">${this.escapeHtml(displayNickname)}</span>
                          ${showUsername ? `<span class="cdk-account-username">@${this.escapeHtml(username)}</span>` : ""}
                      </span>
                  </div>
              </div>
          </div>
          <div class="cdk-score-description">
              💡 ${this.t("cdkScoreDesc")}
          </div>
          <div class="cdk-received-section">
              <div class="cdk-received-header">
                  <span class="cdk-received-title">📦 ${this.t("cdkMyReceived")} <span class="cdk-received-limit">(${this.t("cdkRecentLimit")})</span></span>
                  <button type="button" class="trust-level-refresh cdk-received-refresh-btn" title="${this.t("cdkReceivedRefreshTip")}" aria-label="${this.t("cdkReceivedRefreshTip")}">↻</button>
              </div>
              <div id="cdk-received-list" class="cdk-received-list">
                  ${this.t("cdkLoadingReceived")}
              </div>
          </div>
          <div class="credit-footer cdk-footer">
              <a href="https://cdk.linux.do/dashboard" target="_blank" class="credit-link">${this.t("detailInfo")}</a>
              <span class="credit-update-time">${this.t("update")}: ${this.escapeHtml(updateTime)}</span>
          </div>
      `;
    this.panel.cdkContainer.innerHTML = html;
    setTimeout(() => {
      const refreshBtn = this.panel.cdkContainer.querySelector(".cdk-refresh-btn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.loadCdkInfo(true);
        });
      }
      const receivedRefreshBtn = this.panel.cdkContainer.querySelector(".cdk-received-refresh-btn");
      if (receivedRefreshBtn) {
        receivedRefreshBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.loadCdkReceived();
        });
      }
    }, 100);
    if (receivedData) {
      console.log("[CDK] 使用缓存的领取记录");
      this.renderCdkReceived(receivedData);
    } else {
      console.log("[CDK] 领取记录未缓存，尝试加载");
      this.loadCdkReceived();
    }
  },
  async loadCdkReceived() {
    const listContainer = document.getElementById("cdk-received-list");
    if (!listContainer) return;
    listContainer.innerHTML = `<div class="cdk-received-loading">${this.t("cdkLoadingReceived")}</div>`;
    try {
      const cache = GM_getValue("lda_cdk_cache", null);
      if (cache && cache.data && cache.data.received && cache.ts && Date.now() - cache.ts < 5 * 60 * 1e3) {
        console.log("[CDK] 使用缓存的领取记录");
        this.renderCdkReceived(cache.data.received);
        return;
      }
      try {
        const bridgeResult = await this.fetchCdkViaBridge();
        if (bridgeResult && bridgeResult.received) {
          console.log("[CDK] 通过 Bridge 获取到领取记录");
          this.renderCdkReceived(bridgeResult.received);
          return;
        }
      } catch (e) {
        console.log("[CDK] Bridge 获取领取记录失败:", e.message);
      }
      const data = await this.fetchCdkReceived();
      if (data.cloudflareBlocked) {
        listContainer.innerHTML = `<div class="cdk-received-empty">
                  ${this.t("cdkReceivedEmpty")}<br>
                  <span class="cdk-received-extra-tip">💡 请先访问 cdk.linux.do 刷新数据</span>
              </div>`;
        return;
      }
      this.renderCdkReceived(data);
    } catch (e) {
      console.error("[CDK] 加载领取记录失败:", e);
      listContainer.innerHTML = `<div class="cdk-received-empty">${this.t("cdkReceivedEmpty")}</div>`;
    }
  },
  renderCdkReceived(data) {
    const listContainer = document.getElementById("cdk-received-list");
    if (!listContainer) return;
    const { total, results } = data;
    if (!results || results.length === 0) {
      listContainer.innerHTML = `<div class="cdk-received-empty">${this.t("cdkReceivedEmpty")}</div>`;
      return;
    }
    const displayResults = results.slice(0, 20);
    const displayCount = Math.min(total, 20);
    const totalText = this.t("cdkTotal").replace("{count}", displayCount);
    let html = `
          <div class="cdk-received-total">${totalText}</div>
          <div class="cdk-received-items">
      `;
    displayResults.forEach((item, index) => {
      const projectName = this.escapeHtml(item.project_name || "-");
      const creator = this.escapeHtml(item.project_creator_nickname || item.project_creator || "-");
      const content = this.escapeHtml(item.content || "-");
      const receivedAt = item.received_at
        ? new Date(item.received_at).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "-";
      html += `
              <div class="cdk-received-item">
                  <div class="cdk-received-item-header">
                      <span class="cdk-project-name">${projectName}</span>
                      <span class="cdk-received-time">${receivedAt}</span>
                  </div>
                  <div class="cdk-received-creator">
                      ${this.t("cdkCreator")}: ${creator}
                  </div>
                  <div class="cdk-content-row">
                      <code class="cdk-content">${content}</code>
                      <button type="button" class="cdk-copy-btn" data-content="${content}" title="${this.t("cdkCopy")}" aria-label="${this.t("cdkCopy")}">⧉</button>
                  </div>
              </div>
          `;
    });
    html += "</div>";
    listContainer.innerHTML = html;
    const copyBtns = listContainer.querySelectorAll(".cdk-copy-btn");
    copyBtns.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const content = btn.getAttribute("data-content");
        try {
          await navigator.clipboard.writeText(content);
          const originalText = btn.textContent;
          const originalTitle = btn.getAttribute("title") || this.t("cdkCopy");
          btn.textContent = "✓";
          btn.classList.add("copied");
          btn.setAttribute("title", this.t("cdkCopied"));
          btn.setAttribute("aria-label", this.t("cdkCopied"));
          setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove("copied");
            btn.setAttribute("title", originalTitle);
            btn.setAttribute("aria-label", originalTitle);
          }, 1500);
        } catch (err) {
          console.error("[CDK] 复制失败:", err);
        }
      });
    });
  },
  renderCdkError(message, showLogin = false) {
    let html = `
          <div class="cdk-panel-header">
              <span class="cdk-panel-title">${this.t("cdkOverview")}</span>
              <button type="button" class="trust-level-refresh cdk-refresh-btn cdk-panel-refresh" data-action="refresh-cdk" title="${this.t("cdkRefreshTip")}" aria-label="${this.t("cdkRefreshTip")}">↻</button>
          </div>
          <div class="cdk-auth-state" role="status">
              <span class="cdk-auth-status">
                  <span class="cdk-auth-dot" aria-hidden="true"></span>
                  ${showLogin ? this.t("cdkNotAuth") : this.t("cdkScore")}
              </span>
              <p class="cdk-auth-message">${this.escapeHtml(showLogin ? this.t("cdkAuthTip") : message)}</p>
      `;
    if (showLogin) {
      html += `
              <div class="cdk-auth-actions">
                  <a href="https://cdk.linux.do" target="_blank" rel="noopener noreferrer" class="credit-login-btn">
                      <span>${this.t("cdkGoAuth")}</span>
                      <span class="credit-login-arrow" aria-hidden="true">↗</span>
                  </a>
              </div>
          `;
    }
    html += "</div>";
    this.panel.cdkContainer.innerHTML = html;
    setTimeout(() => {
      const refreshBtn = this.panel.cdkContainer.querySelector(".cdk-refresh-btn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.loadCdkInfo(true);
        });
      }
    }, 100);
  },
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  },
};

export { cdkMethods };
