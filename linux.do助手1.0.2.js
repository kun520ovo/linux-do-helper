// ==UserScript==
// @name        linux.do助手
// @namespace    https://scriptcat.org/zh-CN/users/212527
// @version     1.0.2
// @description 自动阅读、智能点赞、查询账号信息等功能
// @author      kun&gpt-6-astra
// @icon        https://cdn3.ldstatic.com/optimized/4X/6/a/6/6a6affc7b1ce8140279e959d32671304db06d5ab_2_180x180.png
// @downloadURL https://scriptcat.org/scripts/code/8000/linux.do%E5%8A%A9%E6%89%8B.user.js
// @updateURL https://scriptcat.org/scripts/code/8000/linux.do%E5%8A%A9%E6%89%8B.user.js
// @license     MIT
// @match       https://linux.do/*
// @match       https://idcflare.com/*
// @match       https://cdk.linux.do/*
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_getTab
// @grant       GM_saveTab
// @grant       unsafeWindow
// @connect     connect.linux.do
// @connect     credit.linux.do
// @connect     cdk.linux.do
// @connect     linux.do
// @connect     *
// @run-at      document-idle
// ==/UserScript==
(() => {
  var resolveWindow = (candidate) => {
    if (candidate) return candidate;
    if (typeof window !== "undefined") return window;
    return typeof globalThis !== "undefined" ? globalThis : void 0;
  };
  var resolveLocation = (windowRef, candidate) => {
    if (candidate) return candidate;
    return windowRef?.location || (typeof location !== "undefined" ? location : void 0);
  };
  var resolveFetch = (windowRef, candidate) => {
    if (typeof candidate === "function") return candidate;
    if (typeof windowRef?.fetch === "function") return windowRef.fetch.bind(windowRef);
    if (typeof globalThis?.fetch === "function") return globalThis.fetch.bind(globalThis);
    return void 0;
  };
  var resolveTimer = (windowRef, name) => {
    if (typeof windowRef?.[name] === "function") return windowRef[name].bind(windowRef);
    if (typeof globalThis?.[name] === "function") return globalThis[name].bind(globalThis);
    return void 0;
  };
  var resolveStorage = (windowRef, name) => {
    try {
      return windowRef?.[name] || (typeof globalThis !== "undefined" ? globalThis[name] : void 0);
    } catch (_) {
      return void 0;
    }
  };
  var resolveGlobal = (windowRef) => {
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow;
    } catch (_) {
    }
    return windowRef;
  };
  var createRuntimeContext = (options = {}) => {
    const windowRef = resolveWindow(options.windowRef || options.window);
    const documentRef = options.documentRef || options.document || windowRef?.document;
    const locationRef = resolveLocation(windowRef, options.locationRef || options.location);
    const currentDomain = String(options.currentDomain ?? locationRef?.hostname ?? "");
    const baseUrl = String(
      options.baseUrl ?? (currentDomain ? `https://${currentDomain}` : locationRef?.origin || "")
    );
    const fetchFn = resolveFetch(windowRef, options.fetchFn || options.fetch);
    const setTimeoutFn = options.setTimeoutFn || options.setTimeout || resolveTimer(windowRef, "setTimeout");
    const clearTimeoutFn = options.clearTimeoutFn || options.clearTimeout || resolveTimer(windowRef, "clearTimeout");
    const setIntervalFn = options.setIntervalFn || options.setInterval || resolveTimer(windowRef, "setInterval");
    const clearIntervalFn = options.clearIntervalFn || options.clearInterval || resolveTimer(windowRef, "clearInterval");
    const isHeartToggleUrl2 = (url, method = "PUT") => {
      try {
        const parsed = new URL(url, baseUrl);
        return String(method || "GET").toUpperCase() === "PUT" && parsed.origin === baseUrl && /^\/discourse-reactions\/posts\/\d+\/custom-reactions\/heart\/toggle\.json$/.test(parsed.pathname);
      } catch (_) {
        return false;
      }
    };
    return {
      window: windowRef,
      document: documentRef,
      location: locationRef,
      pageWindow: resolveGlobal(windowRef),
      fetch: fetchFn,
      XMLHttpRequest: windowRef?.XMLHttpRequest,
      localStorage: options.localStorage || resolveStorage(windowRef, "localStorage"),
      sessionStorage: options.sessionStorage || resolveStorage(windowRef, "sessionStorage"),
      navigator: options.navigator || windowRef?.navigator,
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
      gm: options.gm || {
        xmlHttpRequest: typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : void 0,
        addStyle: typeof GM_addStyle === "function" ? GM_addStyle : void 0,
        getValue: typeof GM_getValue === "function" ? GM_getValue : void 0,
        setValue: typeof GM_setValue === "function" ? GM_setValue : void 0,
        getTab: typeof GM_getTab === "function" ? GM_getTab : void 0,
        saveTab: typeof GM_saveTab === "function" ? GM_saveTab : void 0
      },
      CURRENT_DOMAIN: currentDomain,
      BASE_URL: baseUrl,
      isCDKPage: currentDomain === "cdk.linux.do",
      isHeartToggleUrl: isHeartToggleUrl2
    };
  };
  var defaultRuntime = createRuntimeContext();
  var CURRENT_DOMAIN = defaultRuntime.CURRENT_DOMAIN;
  var BASE_URL = defaultRuntime.BASE_URL;
  var isCDKPage = defaultRuntime.isCDKPage;
  var isHeartToggleUrl = defaultRuntime.isHeartToggleUrl;

  var STATE_KEY = /* @__PURE__ */ Symbol.for("linux-do-assistant.network-interceptor");
  var requestInfo = (args, transport) => {
    const request = args?.[0];
    return {
      transport,
      url: typeof request === "string" ? request : request?.url || request?.href || "",
      method: String(args?.[1]?.method || request?.method || "GET").toUpperCase(),
      args
    };
  };
  var callSafely = (callback, payload) => {
    if (typeof callback !== "function") return void 0;
    try {
      return callback(payload);
    } catch (error) {
      console.error("[NetworkInterceptor] subscriber error:", error);
      return void 0;
    }
  };
  var NetworkInterceptor = class {
    constructor(runtime = defaultRuntime) {
      this.runtime = runtime;
      this.subscribers = /* @__PURE__ */ new Set();
      this.installed = false;
      this.originalFetch = null;
      this.originalXhrOpen = null;
      this.originalXhrSend = null;
    }
    register(subscriber = {}) {
      this.subscribers.add(subscriber);
      this.install();
      return () => this.subscribers.delete(subscriber);
    }
    install() {
      if (this.installed) return true;
      const win = this.runtime.window || (typeof window !== "undefined" ? window : null);
      if (!win) return false;
      if (typeof win.fetch === "function") {
        this.originalFetch = win.fetch;
        const service = this;
        win.fetch = async function(...args) {
          const request = requestInfo(args, "fetch");
          const contexts = service.collectContexts(request);
          let response;
          try {
            response = await service.originalFetch.apply(this, args);
          } catch (error) {
            service.dispatchError({ request, contexts, error });
            throw error;
          }
          await service.dispatchResponse({ request, contexts, response });
          return response;
        };
      }
      const XHR = win.XMLHttpRequest;
      if (XHR?.prototype) {
        this.originalXhrOpen = XHR.prototype.open;
        this.originalXhrSend = XHR.prototype.send;
        const service = this;
        XHR.prototype.open = function(method, url, ...rest) {
          this.__ldaNetworkRequest = {
            transport: "xhr",
            url,
            method: String(method || "GET").toUpperCase()
          };
          return service.originalXhrOpen.apply(this, [method, url, ...rest]);
        };
        XHR.prototype.send = function(body) {
          const request = {
            ...this.__ldaNetworkRequest || {},
            transport: "xhr",
            url: this.__ldaNetworkRequest?.url || "",
            method: this.__ldaNetworkRequest?.method || "GET",
            xhr: this,
            body
          };
          const contexts = service.collectContexts(request);
          const hasMatchingSubscriber = contexts.some(({ value }) => value !== null && value !== void 0);
          if (hasMatchingSubscriber) {
            this.addEventListener(
              "load",
              () => {
                service.dispatchResponse({ request, contexts, response: this });
              },
              { once: true }
            );
            this.addEventListener(
              "error",
              (event) => {
                service.dispatchError({ request, contexts, error: event });
              },
              { once: true }
            );
          }
          return service.originalXhrSend.apply(this, [body]);
        };
      }
      this.installed = true;
      return true;
    }
    collectContexts(request) {
      return [...this.subscribers].map((subscriber) => ({
        subscriber,
        value: callSafely(subscriber.beforeRequest, request)
      }));
    }
    async dispatchResponse({ request, contexts, response }) {
      for (const { subscriber, value } of contexts) {
        if (typeof subscriber.afterResponse !== "function") continue;
        try {
          await subscriber.afterResponse({ request, response, context: value });
        } catch (error) {
          console.error("[NetworkInterceptor] async subscriber error:", error);
        }
      }
    }
    dispatchError({ request, contexts, error }) {
      for (const { subscriber, value } of contexts) {
        callSafely(subscriber.onError, { request, context: value, error });
      }
    }
  };
  var getNetworkInterceptor = (runtime = defaultRuntime) => {
    const win = runtime.window || (typeof window !== "undefined" ? window : null);
    if (win) {
      if (!win[STATE_KEY]) win[STATE_KEY] = new NetworkInterceptor(runtime);
      return win[STATE_KEY];
    }
    return new NetworkInterceptor(runtime);
  };
  var networkInterceptor = getNetworkInterceptor();

  function initCDKBridgePage() {
    if (!isCDKPage || typeof window === "undefined") return;
    const bridgeKey = /* @__PURE__ */ Symbol.for("linux-do-assistant.cdk-bridge");
    if (window[bridgeKey]) return window[bridgeKey];
    const cacheAndNotify = async () => {
      try {
        const [userRes, receivedRes] = await Promise.all([
          fetch("https://cdk.linux.do/api/v1/oauth/user-info", {
            credentials: "include"
          }),
          fetch("https://cdk.linux.do/api/v1/projects/received?current=1&size=20&search=", {
            credentials: "include"
          })
        ]);
        const userData = userRes.ok ? await userRes.json() : null;
        const receivedData = receivedRes.ok ? await receivedRes.json() : null;
        if (!userData?.data) return;
        const cacheData = {
          user: userData.data,
          received: receivedData?.data || null
        };
        if (typeof GM_setValue === "function") {
          GM_setValue("lda_cdk_cache", { data: cacheData, ts: Date.now() });
        }
        try {
          window.parent?.postMessage(
            {
              type: "lda-cdk-data",
              payload: { data: cacheData }
            },
            "*"
          );
        } catch (_) {
        }
        console.log("[CDK Bridge] 数据已缓存:", cacheData);
      } catch (error) {
        console.error("[CDK Bridge] 获取数据失败:", error);
      }
    };
    cacheAndNotify();
    window.addEventListener("message", (event) => {
      if (event.data?.type === "lda-cdk-request") cacheAndNotify();
    });
    window[bridgeKey] = { refresh: cacheAndNotify };
    return window[bridgeKey];
  }

  var resolveStorageArea = (storageArea) => {
    if (storageArea) return storageArea;
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (_) {
    }
    return void 0;
  };
  var createStorage = (storageArea) => {
    const area = resolveStorageArea(storageArea);
    return {
      get: (key, defaultValue = null) => {
        try {
          const value = area?.getItem(key);
          return value ? JSON.parse(value) : defaultValue;
        } catch (_) {
          return defaultValue;
        }
      },
      set: (key, value) => {
        try {
          if (!area?.setItem) return false;
          area.setItem(key, JSON.stringify(value));
          return true;
        } catch (error) {
          console.error("Storage error:", error);
          return false;
        }
      },
      remove: (key) => {
        try {
          if (!area?.removeItem) return false;
          area.removeItem(key);
          return true;
        } catch (error) {
          console.error("Storage error:", error);
          return false;
        }
      },
      raw: area
    };
  };
  var Storage = createStorage();

  var defaults = {
    smartLikeEnabled: false,
    smartLikeSpeed: "normal",
    cleanModeEnabled: false,
    grayscaleModeEnabled: false,
    readUnreadEnabled: false,
    randomOrderEnabled: false,
    skipReadEnabled: true,
    fullTopicReadEnabled: false,
    topicLimitCount: 100,
    restTimeMinutes: 10,
    topicCreatedTimeVisible: true,
    topicAgeColorEnabled: true,
    stopAfterReadEnabled: false,
    stopAfterReadCount: 10,
    stopOnLikeLimitEnabled: false,
    cfBypassEnabled: true
  };
  function loadSettings(storage = Storage) {
    const settings = Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [key, storage.get(key, value)])
    );
    settings.smartLikeEnabled = settings.smartLikeEnabled === true;
    if (!["slow", "normal", "fast"].includes(settings.smartLikeSpeed)) settings.smartLikeSpeed = "normal";
    return settings;
  }

  function createSessionStorage(storageArea = globalThis.sessionStorage) {
    return {
      get(key, defaultValue = null) {
        try {
          const value = storageArea.getItem(key);
          return value ? JSON.parse(value) : defaultValue;
        } catch {
          return defaultValue;
        }
      },
      set(key, value) {
        try {
          storageArea.setItem(key, JSON.stringify(value));
          return true;
        } catch (error) {
          console.error("SessionStorage error:", error);
          return false;
        }
      }
    };
  }

  var DisposableScope = class {
    constructor() {
      this.disposed = false;
      this.cleanups = /* @__PURE__ */ new Set();
      this.timeouts = /* @__PURE__ */ new Set();
      this.intervals = /* @__PURE__ */ new Set();
    }
    add(cleanup) {
      if (this.disposed) cleanup();
      else this.cleanups.add(cleanup);
      return cleanup;
    }
    listen(target, type, callback, options) {
      if (this.disposed) return;
      target.addEventListener(type, callback, options);
      return this.add(() => target.removeEventListener(type, callback, options));
    }
    setTimeout(callback, delay) {
      if (this.disposed) return null;
      const id = setTimeout(() => {
        this.timeouts.delete(id);
        if (!this.disposed) callback();
      }, delay);
      this.timeouts.add(id);
      return id;
    }
    clearTimeout(id) {
      clearTimeout(id);
      this.timeouts.delete(id);
    }
    setInterval(callback, delay) {
      if (this.disposed) return null;
      const id = setInterval(() => {
        if (!this.disposed) callback();
      }, delay);
      this.intervals.add(id);
      return id;
    }
    clearInterval(id) {
      clearInterval(id);
      this.intervals.delete(id);
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (const id of this.timeouts) clearTimeout(id);
      for (const id of this.intervals) clearInterval(id);
      for (const cleanup of this.cleanups) cleanup();
      this.timeouts.clear();
      this.intervals.clear();
      this.cleanups.clear();
    }
  };

  function createToggleRow(label, checked, onChange) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    const labelEl = document.createElement("span");
    labelEl.className = "toggle-label";
    labelEl.textContent = label;
    const toggleSwitch = document.createElement("label");
    toggleSwitch.className = "toggle-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", (e) => {
      onChange(e.target.checked);
    });
    const slider = document.createElement("span");
    slider.className = "toggle-slider";
    toggleSwitch.appendChild(input);
    toggleSwitch.appendChild(slider);
    row.appendChild(labelEl);
    row.appendChild(toggleSwitch);
    return row;
  }
  function createSliderRow(label, value, min, max, step, onChange) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    row.classList.add("panel-range-row");
    const topRow = document.createElement("div");
    topRow.className = "panel-range-heading";
    const labelEl = document.createElement("span");
    labelEl.className = "toggle-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "toggle-label";
    valueEl.classList.add("panel-range-value");
    valueEl.textContent = value;
    topRow.appendChild(labelEl);
    topRow.appendChild(valueEl);
    const sliderContainer = document.createElement("div");
    sliderContainer.className = "panel-range-track";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.className = "panel-slider-input";
    const percentage = (value - min) / (max - min) * 100;
    slider.style.background = `linear-gradient(to right, #0078d4 0%, #0078d4 ${percentage}%, #dfe7ef ${percentage}%, #dfe7ef 100%)`;
    slider.addEventListener("input", (e) => {
      const newValue = parseInt(e.target.value);
      valueEl.textContent = newValue;
      const newPercentage = (newValue - min) / (max - min) * 100;
      slider.style.background = `linear-gradient(to right, #0078d4 0%, #0078d4 ${newPercentage}%, #dfe7ef ${newPercentage}%, #dfe7ef 100%)`;
      onChange(newValue);
    });
    sliderContainer.appendChild(slider);
    row.appendChild(topRow);
    row.appendChild(sliderContainer);
    return row;
  }
  function createSelectRow(label, options, selectedValue, onChange) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    const labelEl = document.createElement("span");
    labelEl.className = "toggle-label";
    labelEl.textContent = label;
    const selectWrapper = document.createElement("div");
    selectWrapper.className = "panel-select-wrapper";
    const select = document.createElement("select");
    select.className = "panel-select-input";
    select.addEventListener("mouseenter", () => {
      select.style.background = "#f8fbfe";
      select.style.borderColor = "#9cc9e7";
    });
    select.addEventListener("mouseleave", () => {
      if (document.activeElement !== select) {
        select.style.background = "#fff";
        select.style.borderColor = "#cbd5df";
      }
    });
    select.addEventListener("focus", () => {
      select.style.background = "#f8fbfe";
      select.style.borderColor = "#70b7e4";
      select.style.boxShadow = "0 0 0 2px rgba(0, 120, 212, 0.15)";
    });
    select.addEventListener("blur", () => {
      select.style.background = "#fff";
      select.style.borderColor = "#cbd5df";
      select.style.boxShadow = "none";
    });
    const arrow = document.createElement("span");
    arrow.innerHTML = "▼";
    arrow.className = "panel-select-arrow";
    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      option.selected = opt.value === selectedValue;
      option.className = "panel-select-option";
      select.appendChild(option);
    });
    select.addEventListener("change", (e) => {
      onChange(e.target.value);
    });
    selectWrapper.appendChild(select);
    selectWrapper.appendChild(arrow);
    row.appendChild(labelEl);
    row.appendChild(selectWrapper);
    return row;
  }
  function createInnerCollapsibleSection(title, contentNode, collapsed = true, headerControl = null) {
    const wrapper = document.createElement("div");
    wrapper.className = `settings-inner-collapsible${collapsed ? " collapsed" : ""}`;
    const header = document.createElement("div");
    header.className = "settings-inner-collapsible-header";
    const titleElement = document.createElement("span");
    titleElement.textContent = title;
    const collapseIcon = document.createElement("span");
    collapseIcon.className = "collapse-icon";
    collapseIcon.setAttribute("aria-hidden", "true");
    header.appendChild(titleElement);
    if (headerControl) {
      const controls = document.createElement("span");
      controls.className = "settings-inner-collapsible-controls";
      headerControl.addEventListener("click", (event) => event.stopPropagation());
      controls.appendChild(headerControl);
      controls.appendChild(collapseIcon);
      header.appendChild(controls);
    } else {
      header.appendChild(collapseIcon);
    }
    const body = document.createElement("div");
    body.className = "settings-inner-collapsible-content";
    if (contentNode) body.appendChild(contentNode);
    header.addEventListener("click", () => wrapper.classList.toggle("collapsed"));
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  var panel_default = '#my-gift-panel {\n  position: fixed !important;\n  right: 20px;\n  bottom: 20px;\n  z-index: 2147483647 !important;\n  width: fit-content;\n  min-width: 280px;\n  max-width: 450px;\n  background: #fff !important;\n  border: 1px solid #e0e0e0 !important;\n  border-radius: 12px;\n  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);\n  max-height: calc(100vh - 40px);\n  box-sizing: border-box;\n  overflow-x: hidden;\n  overflow-y: auto;\n  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", Arial, sans-serif;\n  color: #333;\n  line-height: normal !important;\n  transform-origin: bottom right;\n  transition:\n    width 0.22s ease,\n    height 0.22s ease,\n    border-radius 0.22s ease,\n    box-shadow 0.22s ease;\n  user-select: none;\n}\n#my-gift-panel.collapsed {\n  width: 50px !important;\n  height: 50px !important;\n  min-width: 50px !important;\n  max-width: 50px !important;\n  padding: 0 !important;\n  border-radius: 50% !important;\n  display: flex !important;\n  justify-content: center;\n  align-items: center;\n  cursor: grab;\n  background: #fff !important;\n  color: #0078d4 !important;\n  border: 1px solid #e0e0e0 !important;\n  box-shadow: 0 4px 16px rgba(0, 120, 212, 0.3) !important;\n  transition:\n    width 0.22s ease,\n    height 0.22s ease,\n    transform 0.18s ease,\n    box-shadow 0.18s ease;\n}\n#my-gift-panel.collapsed:hover {\n  transform: scale(1.08);\n  box-shadow: 0 7px 22px rgba(0, 120, 212, 0.4) !important;\n}\n#my-gift-panel.dragging {\n  cursor: grabbing !important;\n  transition: none !important;\n  transform: none !important;\n  box-shadow: 0 10px 28px rgba(0, 120, 212, 0.35) !important;\n}\n#my-gift-panel.collapsed > #my-gift-icon {\n  display: block !important;\n  width: 31px !important;\n  height: 31px !important;\n  margin: 0 !important;\n  padding: 0 !important;\n  fill: currentColor !important;\n  pointer-events: none !important;\n  flex-shrink: 0;\n}\n#my-gift-panel:not(.collapsed) {\n  width: fit-content !important;\n  min-width: 280px;\n  max-width: 450px;\n  min-height: 180px;\n}\n#my-gift-panel:not(.collapsed) > #my-gift-icon {\n  display: none !important;\n}\n#my-gift-content {\n  width: 100%;\n  min-width: 0;\n}\n#my-gift-panel.collapsed #my-gift-content {\n  display: none !important;\n}\n#my-gift-header {\n  height: 52px;\n  padding: 0 10px 0 16px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  background: linear-gradient(135deg, #f8fbfe, #f4f7fa) !important;\n  border-bottom: 1px solid #eeeeee;\n  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.01);\n  user-select: none;\n}\n#my-gift-title {\n  display: flex;\n  align-items: center;\n  font-size: 14px;\n  font-weight: 600;\n  color: #30343b;\n}\n#my-gift-close {\n  width: 30px;\n  height: 30px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 50%;\n  color: #8a9199;\n  font-size: 21px;\n  line-height: 1;\n  cursor: pointer;\n  transition:\n    background 0.18s ease,\n    color 0.18s ease,\n    transform 0.18s ease;\n}\n#my-gift-close:hover {\n  background: #e9edf1;\n  color: #343a40;\n  transform: rotate(90deg);\n}\n#my-gift-body {\n  padding: 8px 12px;\n  min-width: 0;\n}\n.my-gift-tool {\n  width: 100%;\n  min-height: 41px;\n  margin: 0;\n  padding: 0 12px;\n  display: flex;\n  align-items: center;\n  gap: 0;\n  border: 0 !important;\n  border-radius: 0 !important;\n  background: #fff !important;\n  color: #333 !important;\n  font-family: inherit;\n  font-size: 13px;\n  text-align: left;\n  cursor: pointer;\n  outline: none;\n  transition:\n    background 0.18s ease,\n    color 0.18s ease;\n}\n.my-gift-tool:hover {\n  background: #f8fbfe !important;\n}\n.my-gift-tool:active {\n  background: #f1f6fa !important;\n}\n.my-gift-tool-text {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.my-gift-tool-arrow {\n  color: #a0a7af;\n  font-size: 16px;\n  flex-shrink: 0;\n  transition: transform 0.18s ease;\n}\n.my-gift-tool[aria-expanded="true"] .my-gift-tool-arrow {\n  transform: rotate(90deg);\n}\n.my-gift-tool-item {\n  margin-bottom: 8px;\n  min-width: 0;\n  overflow: hidden;\n  border: 1px solid #e1e6eb;\n  border-radius: 9px;\n  background: #fff;\n}\n.my-gift-tool-item:last-child {\n  margin-bottom: 0;\n}\n.my-gift-tool-detail {\n  display: none;\n  padding: 10px 0;\n  min-width: 0;\n  border: 0;\n  border-top: 1px solid #e1e6eb;\n  border-radius: 0;\n  background: #f5f8fb;\n  color: #8a9199;\n  font-size: 12px;\n  line-height: 1.5;\n}\n.my-gift-tool[aria-expanded="true"] {\n  border-radius: 0 !important;\n}\n.my-gift-tool[aria-expanded="true"] + .my-gift-tool-detail {\n  display: block;\n}\n#my-gift-panel .account-data-detail {\n  padding: 4px 0 8px;\n}\n#my-gift-panel .account-data-sections > .my-gift-tool-item {\n  margin: 0;\n  overflow: visible;\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n}\n#my-gift-panel .account-data-sections > .my-gift-tool-item > .my-gift-tool {\n  min-height: 34px;\n  padding: 0 12px;\n  border-radius: 0 !important;\n  background: transparent !important;\n}\n#my-gift-panel .account-data-sections > .my-gift-tool-item > .my-gift-tool:hover {\n  background: #edf4f9 !important;\n}\n#my-gift-panel .account-data-sections > .my-gift-tool-item > .my-gift-tool-detail {\n  margin: 0 8px 6px;\n  padding: 0;\n  border: 0;\n  background: transparent;\n}\n#my-gift-panel .account-data-sections > .my-gift-tool-item:last-child > .my-gift-tool-detail {\n  margin-bottom: 0;\n}\n@media screen and (max-width: 400px) {\n  #my-gift-panel:not(.collapsed) {\n    width: calc(100vw - 30px) !important;\n    min-width: min(220px, calc(100vw - 30px));\n    max-width: calc(100vw - 30px) !important;\n  }\n  #my-gift-panel.collapsed {\n    right: 10px !important;\n    bottom: 10px !important;\n  }\n}\n#my-gift-panel .my-gift-tool-item {\n  user-select: none;\n}\n#my-gift-panel .toggle-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-height: 34px;\n  margin: 0 0 6px;\n  padding: 7px 8px;\n  box-sizing: border-box;\n  border: 1px solid #e1e6eb;\n  border-radius: 7px;\n  background: #fff;\n  color: #333;\n}\n#my-gift-panel .toggle-label {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .toggle-label,\n#my-gift-panel .section-title,\n#my-gift-panel .trust-level-header,\n#my-gift-panel .trust-level-name,\n#my-gift-panel .trust-level-loading {\n  color: #333;\n}\n#my-gift-panel .toggle-switch {\n  position: relative;\n  display: inline-block;\n  width: 34px;\n  height: 18px;\n  flex-shrink: 0;\n}\n#my-gift-panel .toggle-switch input {\n  width: 0;\n  height: 0;\n  opacity: 0;\n}\n#my-gift-panel .toggle-slider {\n  position: absolute;\n  inset: 0;\n  border-radius: 18px;\n  background: #cbd5df;\n  cursor: pointer;\n  transition: background 0.18s ease;\n}\n#my-gift-panel .toggle-slider:before {\n  position: absolute;\n  width: 14px;\n  height: 14px;\n  left: 2px;\n  top: 2px;\n  border-radius: 50%;\n  background: #fff;\n  content: "";\n  transition: transform 0.18s ease;\n}\n#my-gift-panel .toggle-switch input:checked + .toggle-slider {\n  background: #0078d4;\n}\n#my-gift-panel .toggle-switch input:checked + .toggle-slider:before {\n  transform: translateX(16px);\n}\n#my-gift-panel .toggle-grid {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 6px;\n  margin-top: 8px;\n}\n#my-gift-panel .toggle-grid .toggle-row {\n  margin: 0;\n}\n@media screen and (max-width: 400px) {\n  #my-gift-panel .toggle-grid.smart-like-controls {\n    grid-template-columns: minmax(0, 1fr);\n  }\n}\n#my-gift-panel .main-action-btn,\n#my-gift-panel .read-action-btn,\n#my-gift-panel .reveal-users-btn {\n  width: 100%;\n  min-height: 38px;\n  margin: 0 0 6px;\n  padding: 8px 12px;\n  border: 1px solid #d7e1e9;\n  border-radius: 7px;\n  background: #0078d4;\n  color: #fff;\n  font: inherit;\n  cursor: pointer;\n}\n#my-gift-panel .main-action-btn.running {\n  background: #d9534f;\n}\n#my-gift-panel .main-action-btn:hover,\n#my-gift-panel .read-action-btn:hover,\n#my-gift-panel .reveal-users-btn:hover {\n  filter: brightness(0.96);\n}\n#my-gift-panel .read-stats-container,\n#my-gift-panel .like-counter-container,\n#my-gift-panel .trust-level-row,\n#my-gift-panel .credit-info-row,\n#my-gift-panel .cdk-info-row,\n#my-gift-panel .rank-data-container,\n#my-gift-panel .topic-status-container {\n  box-sizing: border-box;\n  margin-top: 6px;\n  padding: 8px;\n  border: 1px solid #e1e6eb;\n  border-radius: 8px;\n  background: #f5f8fb;\n  color: #333;\n}\n#my-gift-panel .cdk-info-row .credit-main-stat {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin: 0 0 8px;\n  padding: 8px 10px;\n  border: 1px solid #cfe3f1 !important;\n  border-radius: 7px;\n  background: #eaf4fb !important;\n}\n#my-gift-panel .cdk-info-row {\n  margin-top: 0;\n  padding: 0;\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n}\n#my-gift-panel .cdk-panel-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  min-height: 27px;\n  margin-bottom: 8px;\n}\n#my-gift-panel .cdk-panel-title {\n  min-width: 0;\n  overflow: hidden;\n  color: #334155;\n  font-size: 12px;\n  font-weight: 600;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-panel-refresh,\n#my-gift-panel .cdk-received-refresh-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 27px;\n  min-width: 27px;\n  height: 27px;\n  min-height: 27px;\n  padding: 0;\n  border-radius: 6px;\n  font-size: 15px;\n  line-height: 1;\n}\n#my-gift-panel .cdk-score-card {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  height: 50px;\n  min-height: 50px;\n  margin: 0 0 8px;\n  padding: 6px 10px;\n  box-sizing: border-box;\n  border: 1px solid #cfe3f1;\n  border-radius: 6px;\n  background: #eaf4fb;\n  text-align: left;\n}\n#my-gift-panel .cdk-score-card .credit-stat-label {\n  min-width: 0;\n  overflow: hidden;\n  color: #64748b !important;\n  font-size: 12px;\n  font-weight: 500;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-score-card .cdk-score-value {\n  display: block;\n  flex: 0 0 auto;\n  margin-top: 0;\n  color: #0783b5 !important;\n  font-size: 32px;\n  font-weight: 700;\n  line-height: 1;\n  text-shadow: none !important;\n}\n#my-gift-panel .cdk-account-section {\n  min-width: 0;\n}\n#my-gift-panel .cdk-section-heading {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  margin: 0 0 3px;\n  color: #64748b;\n  font-size: 10px;\n  font-weight: 600;\n  line-height: 1.3;\n}\n#my-gift-panel .cdk-account-list {\n  min-width: 0;\n}\n#my-gift-panel .cdk-account-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  min-width: 0;\n  margin: 0;\n  padding: 5px 0;\n  border-bottom: 1px solid #edf2f7;\n  color: #475569;\n  font-size: 11px;\n  line-height: 1.4;\n}\n#my-gift-panel .cdk-account-item:last-child {\n  border-bottom: 0;\n}\n#my-gift-panel .cdk-account-label {\n  flex: 1 1 auto;\n  min-width: 0;\n  color: #64748b;\n}\n#my-gift-panel .cdk-account-value {\n  display: inline-flex;\n  align-items: center;\n  justify-content: flex-end;\n  flex: 0 0 auto;\n  min-width: 0;\n  gap: 5px;\n  color: #334155;\n  font-weight: 600;\n  text-align: right;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-account-value.cdk-account-name-value {\n  flex: 0 1 72%;\n  max-width: 72%;\n  overflow: hidden;\n}\n#my-gift-panel .cdk-account-name,\n#my-gift-panel .cdk-account-username {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-account-username {\n  color: #94a3b8;\n  font-size: 10px;\n  font-weight: 400;\n}\n#my-gift-panel .cdk-account-value.cdk-trust-level-value {\n  color: #0078d4 !important;\n}\n#my-gift-panel .cdk-info-row .cdk-score-description {\n  display: flex;\n  align-items: center;\n  box-sizing: border-box;\n  margin-top: 6px;\n  min-height: 32px;\n  padding: 4px 2px;\n  border: 0;\n  border-top: 1px solid #e1e6eb;\n  border-radius: 0;\n  background: transparent;\n  color: #64748b;\n  font-size: 12px;\n  font-weight: 500;\n  line-height: 1.4;\n  text-align: left;\n}\n#my-gift-panel .cdk-info-row .cdk-received-section {\n  margin-top: 7px;\n  padding-top: 7px;\n  border-top: 1px solid #e1e6eb;\n}\n#my-gift-panel .cdk-info-row .cdk-received-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  min-height: 27px;\n  margin-bottom: 6px;\n}\n#my-gift-panel .cdk-received-title {\n  min-width: 0;\n  overflow: hidden;\n  color: #475569;\n  font-size: 11px;\n  font-weight: 600;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-received-limit {\n  color: #94a3b8;\n  font-size: 10px;\n  font-weight: 400;\n}\n#my-gift-panel .cdk-info-row .cdk-received-total {\n  margin: 0 0 5px;\n  color: #94a3b8;\n  font-size: 10px;\n}\n#my-gift-panel .cdk-info-row .cdk-received-items {\n  max-height: 200px;\n  padding-right: 2px;\n  overflow-y: auto;\n}\n#my-gift-panel .cdk-info-row .cdk-received-item {\n  margin-bottom: 5px;\n  padding: 7px 8px;\n  border-color: #e1e6eb;\n  border-radius: 6px;\n  background: #fff;\n}\n#my-gift-panel .cdk-info-row .cdk-received-item:last-child {\n  margin-bottom: 0;\n}\n#my-gift-panel .cdk-info-row .cdk-content-row {\n  border: 1px solid #edf2f7;\n  background: #f8fafc;\n}\n#my-gift-panel .cdk-info-row .cdk-copy-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 26px;\n  min-width: 26px;\n  height: 24px;\n  min-height: 24px;\n  padding: 0;\n  border: 1px solid #b9d9ef;\n  border-radius: 4px;\n  background: #eaf4fb;\n  color: #0078d4;\n  font-size: 14px;\n  line-height: 1;\n}\n#my-gift-panel .cdk-info-row .cdk-copy-btn:hover {\n  border-color: #8fc1e4;\n  background: #dceefa;\n}\n#my-gift-panel .cdk-info-row .cdk-copy-btn.copied {\n  border-color: #b7e4c7;\n  background: #eaf8ef;\n  color: #15803d;\n}\n#my-gift-panel .cdk-auth-state {\n  display: flex;\n  flex-direction: column;\n  gap: 9px;\n  padding: 2px 0 0;\n}\n#my-gift-panel .cdk-auth-status {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  color: #334155;\n  font-size: 12px;\n  font-weight: 600;\n}\n#my-gift-panel .cdk-auth-dot {\n  width: 7px;\n  height: 7px;\n  flex: 0 0 auto;\n  border-radius: 50%;\n  background: #94a3b8;\n}\n#my-gift-panel .cdk-auth-message {\n  margin: 0;\n  color: #64748b;\n  font-size: 11px;\n  line-height: 1.5;\n}\n#my-gift-panel .cdk-auth-actions {\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;\n  gap: 8px;\n  padding-top: 8px;\n  border-top: 1px solid #e1e6eb;\n}\n#my-gift-panel .cdk-info-row .credit-stat-label {\n  color: #64748b !important;\n  font-size: 11px;\n}\n#my-gift-panel .cdk-info-row .cdk-score-value {\n  color: #0891b2 !important;\n  font-size: 32px;\n  font-weight: 700;\n  line-height: 1;\n  text-shadow: none !important;\n}\n#my-gift-panel .cdk-info-row > .trust-level-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  margin: 4px 0;\n  padding: 3px 0;\n  color: #475569 !important;\n  font-size: 11px;\n  line-height: 1.35;\n}\n#my-gift-panel .cdk-info-row > .trust-level-item .trust-level-name {\n  min-width: 0;\n  color: #475569 !important;\n}\n#my-gift-panel .cdk-info-row > .trust-level-item .trust-level-value {\n  flex-shrink: 0;\n  color: #334155 !important;\n  text-align: right;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-info-row > .trust-level-item .cdk-trust-level-value {\n  color: #0078d4 !important;\n  font-weight: 700;\n}\n#my-gift-panel .cdk-score-description {\n  margin-top: 8px;\n  padding: 6px 8px;\n  border: 1px solid #e1e6eb;\n  border-radius: 6px;\n  background: #f8fafc;\n  color: #475569;\n  font-size: 11px;\n  font-weight: 500;\n  line-height: 1.5;\n}\n#my-gift-panel .cdk-received-section {\n  margin-top: 12px;\n  padding-top: 12px;\n  border-top: 1px solid #e1e6eb;\n}\n#my-gift-panel .cdk-received-header {\n  margin-bottom: 8px;\n}\n#my-gift-panel .cdk-recent-limit {\n  color: #94a3b8;\n  font-size: 10px;\n}\n#my-gift-panel .cdk-received-list {\n  color: #475569;\n  font-size: 11px;\n}\n#my-gift-panel .cdk-received-loading,\n#my-gift-panel .cdk-received-empty {\n  padding: 10px;\n  color: #64748b;\n  text-align: center;\n}\n#my-gift-panel .cdk-received-extra-tip {\n  color: #94a3b8;\n  font-size: 9px;\n}\n#my-gift-panel .cdk-received-total {\n  margin-bottom: 8px;\n  color: #64748b;\n  font-size: 10px;\n}\n#my-gift-panel .cdk-received-items {\n  max-height: 200px;\n  overflow-y: auto;\n}\n#my-gift-panel .cdk-received-item {\n  box-sizing: border-box;\n  margin-bottom: 6px;\n  padding: 8px;\n  border: 1px solid #e1e6eb;\n  border-radius: 6px;\n  background: #fff;\n}\n#my-gift-panel .cdk-received-item-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  margin-bottom: 4px;\n}\n#my-gift-panel .cdk-project-name {\n  min-width: 0;\n  overflow: hidden;\n  color: #0078d4;\n  font-size: 11px;\n  font-weight: 600;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-received-time {\n  flex-shrink: 0;\n  color: #64748b;\n  font-size: 9px;\n}\n#my-gift-panel .cdk-received-creator {\n  margin-bottom: 4px;\n  color: #64748b;\n  font-size: 10px;\n}\n#my-gift-panel .cdk-content-row {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 4px 8px;\n  border-radius: 4px;\n  background: #f1f5f9;\n}\n#my-gift-panel .cdk-content {\n  flex: 1;\n  min-width: 0;\n  color: #a16207;\n  font-family: monospace;\n  font-size: 11px;\n  word-break: break-all;\n}\n#my-gift-panel .cdk-copy-btn {\n  flex-shrink: 0;\n  padding: 2px 8px;\n  border: 1px solid #b9d9ef;\n  border-radius: 4px;\n  background: #eaf4fb;\n  color: #0078d4;\n  font-size: 10px;\n  cursor: pointer;\n  transition:\n    background 0.18s ease,\n    border-color 0.18s ease;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-copy-btn:hover {\n  border-color: #8fc1e4;\n  background: #dceefa;\n}\n#my-gift-panel .cdk-auth-tip {\n  margin-bottom: 8px;\n  color: #64748b;\n  font-size: 11px;\n  text-align: center;\n}\n#my-gift-panel .cdk-auth-block {\n  margin-top: 10px;\n  text-align: center;\n}\n#my-gift-panel .trust-level-item,\n#my-gift-panel .rank-item {\n  color: #333 !important;\n}\n#my-gift-panel .trust-level-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-height: 24px;\n  margin-bottom: 8px;\n  color: #334155 !important;\n  font-size: 12px;\n  font-weight: 600;\n}\n#my-gift-panel .trust-level-header > span {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .trust-level-refresh {\n  flex-shrink: 0;\n  min-height: 24px;\n  padding: 3px 8px;\n  border: 1px solid #cfe3f1;\n  border-radius: 5px;\n  background: #eaf4fb;\n  color: #0078d4;\n  font: inherit;\n  font-size: 10px;\n  cursor: pointer;\n  transition:\n    background 0.18s ease,\n    border-color 0.18s ease,\n    transform 0.18s ease;\n}\n#my-gift-panel .trust-level-refresh:hover {\n  background: #dceefa;\n  border-color: #9cc9e7;\n  transform: translateY(-1px);\n}\n#my-gift-panel .trust-level-refresh:disabled {\n  opacity: 0.55;\n  cursor: not-allowed;\n  transform: none;\n}\n#my-gift-panel .trust-level-row .trust-level-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 4px;\n  min-width: 0;\n  margin: 4px 0;\n  padding: 3px 0;\n  color: #475569 !important;\n  font-size: 11px;\n  line-height: 1.35;\n  white-space: nowrap;\n}\n#my-gift-panel .trust-level-row .trust-level-name {\n  flex-shrink: 0;\n  width: 110px;\n  min-width: 110px;\n  margin-right: 4px;\n  overflow: hidden;\n  color: #475569 !important;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .trust-level-row .trust-level-progress {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  flex: 1;\n  min-width: 0;\n  gap: 4px;\n}\n#my-gift-panel .trust-level-row .trust-level-bar {\n  display: none;\n}\n#my-gift-panel .trust-level-row .trust-level-value {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  flex-shrink: 0;\n  min-width: 75px;\n  gap: 3px;\n  color: #334155 !important;\n  text-align: right;\n  white-space: nowrap;\n}\n#my-gift-panel .trust-level-row .change-indicator {\n  flex-shrink: 0;\n  font-size: 9px;\n  font-weight: 600;\n  line-height: 1;\n}\n#my-gift-panel .trust-level-row .change-up {\n  color: #15803d;\n}\n#my-gift-panel .trust-level-row .change-down {\n  color: #dc2626;\n}\n#my-gift-panel .trust-level-row [style*="background: rgba(255, 255, 255, 0.25)"] {\n  background: #eaf8ef !important;\n  border: 1px solid #b7e4c7;\n}\n#my-gift-panel .trust-level-row [style*="background: rgba(255, 255, 255, 0.15)"] {\n  background: #fff7ed !important;\n  border: 1px solid #fed7aa;\n}\n#my-gift-panel .trust-level-row [style*="color: #fff"] {\n  color: #15803d !important;\n}\n#my-gift-panel .trust-level-row [style*="color: rgba(255, 255, 255, 0.9)"] {\n  color: #b45309 !important;\n}\n#my-gift-panel .trust-level-row [style*="color: rgba(255,255,255,0.6)"] {\n  color: #64748b !important;\n}\n#my-gift-panel .rank-data-container .rank-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  margin: 2px 0;\n  padding: 6px 8px;\n  border: 1px solid #e1e6eb;\n  border-radius: 6px;\n  background: #fff;\n  color: #334155 !important;\n}\n#my-gift-panel .rank-period,\n#my-gift-panel .rank-values {\n  display: flex;\n  align-items: center;\n  min-width: 0;\n}\n#my-gift-panel .rank-period {\n  flex: 1;\n  gap: 4px;\n  color: #334155 !important;\n  font-size: 11px;\n}\n#my-gift-panel .rank-period-label {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .rank-values {\n  flex-shrink: 0;\n  gap: 8px;\n  font-size: 11px;\n}\n#my-gift-panel .rank-score {\n  color: #a16207;\n  font-weight: 600;\n  white-space: nowrap;\n}\n#my-gift-panel .rank-position {\n  min-width: 45px;\n  color: #0078d4;\n  text-align: right;\n  white-space: nowrap;\n}\n#my-gift-panel .rank-footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  margin-top: 6px;\n  padding-top: 4px;\n  border-top: 1px solid #e1e6eb;\n}\n#my-gift-panel .rank-detail-link {\n  overflow: hidden;\n  color: #0078d4;\n  font-size: 10px;\n  text-overflow: ellipsis;\n  text-decoration: none;\n  white-space: nowrap;\n}\n#my-gift-panel .rank-update-time {\n  flex-shrink: 0;\n  color: #64748b;\n  font-size: 9px;\n  white-space: nowrap;\n}\n#my-gift-panel .read-stats-container {\n  display: flex;\n  align-items: center;\n  justify-content: space-around;\n  gap: 8px;\n  min-width: 0;\n  background: #f5f8fb !important;\n  border: 1px solid #e1e6eb;\n  color: #334155;\n}\n#my-gift-panel .read-stat {\n  flex: 1;\n  min-width: 0;\n  text-align: center;\n}\n#my-gift-panel .read-stat-label {\n  overflow: hidden;\n  color: #64748b;\n  font-size: 10px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .read-stat-value {\n  font-size: 16px;\n  font-weight: 700;\n}\n#my-gift-panel .read-stat-today {\n  color: #15803d;\n}\n#my-gift-panel .read-stat-total {\n  color: #a16207;\n}\n#my-gift-panel .read-stat-divider {\n  width: 1px;\n  height: 24px;\n  flex-shrink: 0;\n  background: #d5dee7;\n}\n#my-gift-panel .like-counter-container {\n  background: #f5f8fb !important;\n  border-color: #e1e6eb !important;\n  color: #475569 !important;\n}\n#my-gift-panel .like-status-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n  min-width: 0;\n}\n#my-gift-panel .like-status-label {\n  display: flex;\n  align-items: center;\n  min-width: 0;\n  gap: 4px;\n  color: #475569;\n  font-size: 11px;\n}\n#my-gift-panel .like-status-label span:last-child {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .like-sync-btn {\n  flex-shrink: 0;\n  cursor: pointer;\n  opacity: 0.7;\n}\n#my-gift-panel .like-status-value {\n  flex-shrink: 0;\n  color: #0078d4;\n  font-size: 16px;\n  font-weight: 700;\n}\n#my-gift-panel .like-status-limit {\n  flex-shrink: 0;\n  color: #64748b;\n  font-size: 11px;\n}\n#my-gift-panel .like-progress-track {\n  width: 100%;\n  height: 4px;\n  margin-top: 4px;\n  overflow: hidden;\n  border-radius: 2px;\n  background: #dfe7ef;\n}\n#my-gift-panel .like-progress-fill {\n  height: 100%;\n  border-radius: 2px;\n  transition: width 0.3s;\n}\n#my-gift-panel .like-cooldown-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  min-width: 0;\n  gap: 6px;\n}\n#my-gift-panel .like-cooldown-status {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  min-width: 0;\n  gap: 6px;\n}\n#my-gift-panel .like-cooldown-label,\n#my-gift-panel .like-cooldown-time {\n  color: #dc2626;\n}\n#my-gift-panel .like-cooldown-label {\n  font-size: 11px;\n}\n#my-gift-panel .like-cooldown-time {\n  font-size: 13px;\n  font-weight: 700;\n  white-space: nowrap;\n}\n#my-gift-panel .like-cooldown-clear-btn {\n  flex: 0 0 auto;\n  margin-left: auto;\n  min-height: 24px;\n  padding: 3px 6px;\n  border: 1px solid #fecaca;\n  border-radius: 4px;\n  background: #fff;\n  color: #b91c1c;\n  cursor: pointer;\n  font-size: 11px;\n  line-height: 1.2;\n}\n#my-gift-panel .like-cooldown-clear-btn:hover {\n  background: #fff1f2;\n  border-color: #fca5a5;\n}\n#my-gift-panel .like-cooldown-clear-btn:disabled {\n  cursor: default;\n  opacity: 0.55;\n}\n#my-gift-panel .like-cooldown-clear-btn:focus-visible {\n  outline: 2px solid #dc2626;\n  outline-offset: 1px;\n}\n#my-gift-panel .topic-status-container {\n  min-width: 0;\n  color: #475569;\n  font-size: 10px;\n  line-height: 1.4;\n}\n#my-gift-panel .topic-status-heading {\n  margin-bottom: 6px;\n  overflow-wrap: anywhere;\n  color: #334155;\n  font-size: 11px;\n}\n#my-gift-panel .topic-status-type {\n  color: #0078d4;\n  font-weight: 600;\n}\n#my-gift-panel .topic-status-progress-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n  margin-bottom: 4px;\n}\n#my-gift-panel .topic-status-progress-track {\n  flex: 1;\n  min-width: 0;\n  height: 6px;\n  overflow: hidden;\n  border-radius: 3px;\n  background: #dfe7ef;\n}\n#my-gift-panel .topic-status-progress-fill {\n  height: 100%;\n  border-radius: 3px;\n  background: linear-gradient(90deg, #48bb78 0%, #68d391 100%);\n  transition: width 0.3s;\n}\n#my-gift-panel .topic-status-percent {\n  flex-shrink: 0;\n  min-width: 35px;\n  color: #64748b;\n  text-align: right;\n}\n#my-gift-panel .topic-status-meta,\n#my-gift-panel .topic-status-reading-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n  flex-wrap: wrap;\n  color: #64748b;\n}\n#my-gift-panel .topic-status-reading-row {\n  margin-bottom: 4px;\n  color: #475569;\n  font-size: 11px;\n}\n#my-gift-panel .topic-status-ready {\n  margin-bottom: 4px;\n  color: #15803d;\n  font-size: 11px;\n}\n#my-gift-panel .topic-status-current,\n#my-gift-panel .topic-status-remaining,\n#my-gift-panel .topic-status-today {\n  font-weight: 700;\n}\n#my-gift-panel .topic-status-current {\n  color: #a16207;\n}\n#my-gift-panel .topic-status-remaining {\n  color: #15803d;\n}\n#my-gift-panel .topic-status-today {\n  color: #0078d4;\n}\n#my-gift-panel .topic-status-skipped,\n#my-gift-panel .topic-status-warning {\n  color: #b45309;\n}\n#my-gift-panel .topic-status-warning {\n  margin-top: 2px;\n  font-size: 9px;\n}\n#my-gift-panel .topic-status-notification {\n  display: block;\n  margin-top: 6px;\n  padding-top: 6px;\n  border-top: 1px solid #dfe7ef;\n  color: #0078d4 !important;\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 1.45;\n  white-space: pre-line;\n  overflow-wrap: anywhere;\n}\n#my-gift-panel .topic-status-content:empty + .topic-status-notification {\n  margin-top: 0;\n  padding-top: 0;\n  border-top: 0;\n}\n#my-gift-panel [data-section-content="auto"] .toggle-row > .toggle-label:first-child,\n#my-gift-panel [data-section-content="auto"] .toggle-row > div:first-child > .toggle-label:first-child,\n#my-gift-panel [data-section-content="auto"] .read-stat-label,\n#my-gift-panel [data-section-content="auto"] .like-status-label,\n#my-gift-panel [data-section-content="auto"] .like-status-limit,\n#my-gift-panel [data-section-content="auto"] .topic-status-container,\n#my-gift-panel [data-section-content="auto"] .topic-status-heading,\n#my-gift-panel [data-section-content="auto"] .topic-status-meta,\n#my-gift-panel [data-section-content="auto"] .topic-status-reading-row {\n  color: #475569 !important;\n}\n#my-gift-panel .settings-inner-collapsible {\n  margin-top: 0;\n  padding-top: 0;\n  border-top: 1px dashed #dfe5eb;\n}\n#my-gift-panel [data-section-content="auto"] > .settings-inner-collapsible {\n  border-top: 0;\n}\n#my-gift-panel .topic-created-time-settings,\n#my-gift-panel .mode-settings-options {\n  box-sizing: border-box;\n  margin: 0 8px;\n  padding: 0;\n  border: 1px solid #e1e6eb;\n  border-radius: 8px;\n  background: #fff;\n  overflow: hidden;\n}\n#my-gift-panel .topic-created-time-settings > .toggle-row,\n#my-gift-panel .mode-settings-options > .toggle-row {\n  margin: 0;\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n}\n#my-gift-panel .my-gift-tool-detail[data-section-content="auto"] {\n  padding-left: 8px;\n  padding-right: 8px;\n  padding-bottom: 4px;\n}\n#my-gift-panel .cf-bypass-section {\n  margin: 0 8px;\n}\n#my-gift-panel .my-gift-tool-detail[data-section-content="settings"] {\n  padding-top: 0;\n  padding-bottom: 0;\n}\n#my-gift-panel [data-section-content="settings"] > .settings-inner-collapsible:first-child {\n  margin-top: 0;\n  padding-top: 0;\n  border-top: 0;\n}\n#my-gift-panel .settings-inner-collapsible:not(.collapsed) + .settings-inner-collapsible {\n  border-top: 0;\n}\n#my-gift-panel .settings-inner-collapsible-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  min-height: 41px;\n  box-sizing: border-box;\n  padding: 0 12px;\n  color: #555;\n  font-size: 12px;\n  cursor: pointer;\n}\n#my-gift-panel .settings-inner-collapsible-header > span:first-child {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .settings-inner-collapsible-controls {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-height: 18px;\n  flex-shrink: 0;\n}\n#my-gift-panel .settings-inner-collapsible-header .collapse-icon {\n  display: inline-block;\n  width: 0;\n  height: 0;\n  border-top: 4px solid transparent;\n  border-bottom: 4px solid transparent;\n  border-left: 5px solid #8a9199;\n  font-size: 0;\n  line-height: 0;\n  flex-shrink: 0;\n  transform: rotate(90deg);\n  transition: transform 0.18s ease;\n}\n#my-gift-panel .settings-inner-collapsible.collapsed .collapse-icon {\n  transform: rotate(0deg);\n}\n#my-gift-panel .settings-inner-collapsible-content {\n  margin-top: 8px;\n}\n#my-gift-panel .settings-inner-collapsible.collapsed .settings-inner-collapsible-content {\n  display: none;\n}\n#my-gift-panel .auto-read-parameter-settings > .toggle-row:last-child {\n  margin-bottom: 0;\n}\n#my-gift-panel .cf-bypass-description {\n  box-sizing: border-box;\n  margin-bottom: 8px;\n  padding: 8px 10px;\n  border: 1px solid #e1e6eb;\n  border-radius: 8px;\n  background: #f5f8fb;\n  color: #8a9199;\n  font-size: 12px;\n  line-height: 1.6;\n  text-align: center;\n  white-space: normal;\n  overflow-wrap: anywhere;\n}\n#my-gift-panel .cf-bypass-section .reveal-users-btn {\n  background: #0078d4;\n  color: #fff;\n  white-space: nowrap;\n}\n#my-gift-panel .section-divider {\n  display: none;\n}\n#my-gift-panel .credit-footer {\n  display: flex;\n  justify-content: space-between;\n  gap: 8px;\n  margin-top: 8px;\n  padding-top: 8px;\n  border-top: 1px solid #e1e6eb;\n}\n#my-gift-panel .cdk-info-row .cdk-footer {\n  align-items: center;\n  margin-top: 6px;\n  padding: 5px 0 6px;\n  border-top: 0;\n  border-bottom: 1px solid #e1e6eb;\n}\n#my-gift-panel .cdk-info-row .cdk-footer .credit-link {\n  display: inline-flex;\n  align-items: center;\n  min-width: 0;\n  overflow: hidden;\n  color: #0078d4 !important;\n  font-size: 11px;\n  line-height: 1.4;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n#my-gift-panel .cdk-info-row .cdk-footer .credit-update-time {\n  flex: 0 0 auto;\n  color: #64748b !important;\n  font-size: 10px;\n  line-height: 1.4;\n  white-space: nowrap;\n}\n#my-gift-panel .credit-info-row {\n  margin-top: 0;\n  padding: 0;\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n}\n#my-gift-panel .credit-info-row .credit-main-stat {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin: 0 0 8px;\n  padding: 8px 10px;\n  border: 1px solid #d9e4ec;\n  border-radius: 7px;\n  background: #fff;\n}\n#my-gift-panel .credit-info-row .credit-stat-value {\n  color: #0078d4;\n  font-size: 24px;\n  font-weight: 700;\n  line-height: 1;\n}\n#my-gift-panel .credit-info-row .credit-tomorrow-stat {\n  border-color: #ead9ad;\n  background: #fffaf0;\n}\n#my-gift-panel .credit-info-row .credit-tomorrow-stat .credit-stat-label {\n  color: #926c1e !important;\n}\n#my-gift-panel .credit-info-row .credit-tomorrow-stat .credit-stat-value {\n  color: #b7791f;\n  font-size: 22px;\n}\n#my-gift-panel .credit-info-row .credit-summary-list,\n#my-gift-panel .credit-info-row .credit-history-list {\n  min-width: 0;\n}\n#my-gift-panel .credit-info-row .trust-level-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  min-width: 0;\n  margin: 0;\n  padding: 5px 0;\n  border-bottom: 1px solid #edf2f7;\n  color: #475569 !important;\n  font-size: 11px;\n  line-height: 1.4;\n}\n#my-gift-panel .credit-info-row .trust-level-item:last-child {\n  border-bottom: 0;\n}\n#my-gift-panel .credit-info-row .trust-level-name {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow-wrap: anywhere;\n  color: #64748b !important;\n}\n#my-gift-panel .credit-info-row .trust-level-value {\n  display: inline-flex;\n  align-items: center;\n  justify-content: flex-end;\n  flex: 0 0 auto;\n  min-width: 0;\n  gap: 5px;\n  color: #334155 !important;\n  font-weight: 600;\n  text-align: right;\n  white-space: nowrap;\n}\n#my-gift-panel .credit-info-row .credit-value-blue {\n  color: #0078d4 !important;\n}\n#my-gift-panel .credit-info-row .credit-value-gold {\n  color: #a16207 !important;\n}\n#my-gift-panel .credit-info-row .credit-value-green {\n  color: #15803d !important;\n}\n#my-gift-panel .credit-info-row .credit-value-red {\n  color: #dc2626 !important;\n}\n#my-gift-panel .credit-info-row .credit-rank-badge {\n  padding: 2px 5px;\n  border: 1px solid #cfe3f1;\n  border-radius: 4px;\n  background: #eaf4fb;\n  color: #0078d4;\n  font-size: 10px;\n  font-weight: 500;\n}\n#my-gift-panel .credit-info-row .credit-history-section {\n  margin-top: 10px;\n}\n#my-gift-panel .credit-info-row .credit-section-title {\n  margin: 0 0 3px;\n  padding-top: 8px;\n  border-top: 1px solid #e1e6eb;\n  color: #64748b !important;\n  font-size: 10px;\n  font-weight: 600;\n  line-height: 1.3;\n}\n#my-gift-panel .credit-info-row .credit-history-list .trust-level-item {\n  padding: 4px 0;\n}\n#my-gift-panel .credit-auth-state {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 2px 0 0;\n}\n#my-gift-panel .credit-auth-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-width: 0;\n}\n#my-gift-panel .credit-auth-status {\n  display: inline-flex;\n  align-items: center;\n  min-width: 0;\n  gap: 6px;\n  color: #334155;\n  font-size: 12px;\n  font-weight: 600;\n}\n#my-gift-panel .credit-auth-dot {\n  width: 7px;\n  height: 7px;\n  flex: 0 0 auto;\n  border-radius: 50%;\n  background: #94a3b8;\n}\n#my-gift-panel .credit-auth-message {\n  margin: 0;\n  color: #64748b;\n  font-size: 11px;\n  line-height: 1.5;\n}\n#my-gift-panel .credit-auth-actions {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding-top: 8px;\n  border-top: 1px solid #e1e6eb;\n}\n#my-gift-panel .credit-auth-refresh {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 27px;\n  min-width: 27px;\n  height: 27px;\n  min-height: 27px;\n  padding: 0;\n  border-radius: 6px;\n  font-size: 15px;\n  line-height: 1;\n}\n#my-gift-panel .credit-link {\n  color: #0078d4 !important;\n}\n#my-gift-panel .credit-info-row .credit-stat-label,\n#my-gift-panel .credit-info-row .credit-section-title,\n#my-gift-panel .credit-info-row .credit-update-time {\n  color: #475569 !important;\n}\n#my-gift-panel .credit-info-row .trust-level-value[style*="color: #fff"] {\n  color: #64748b !important;\n}\n#my-gift-panel .credit-login-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 5px;\n  min-height: 26px;\n  padding: 4px 10px;\n  border: 1px solid #0078d4;\n  border-radius: 6px;\n  background: #0078d4 !important;\n  color: #fff !important;\n  font: inherit;\n  font-size: 10px;\n  font-weight: 600;\n  line-height: 1.2;\n  text-decoration: none;\n  cursor: pointer;\n  transition:\n    background 0.18s ease,\n    border-color 0.18s ease;\n}\n#my-gift-panel .credit-login-arrow {\n  font-size: 13px;\n  line-height: 1;\n}\n#my-gift-panel .credit-login-btn:hover {\n  border-color: #005a9e;\n  background: #005a9e !important;\n}\n@media screen and (max-width: 400px) {\n  #my-gift-panel .trust-level-row .trust-level-name {\n    width: 90px;\n    min-width: 90px;\n  }\n  #my-gift-panel .trust-level-row .trust-level-value {\n    min-width: 64px;\n  }\n}\n.lda-topic-created-time {\n  margin-left: 8px;\n  color: #64748b;\n  font-size: 11px;\n  line-height: 1;\n  white-space: nowrap;\n  vertical-align: middle;\n  opacity: 1;\n}\n.lda-topic-created-label {\n  color: rgba(255, 255, 255, 0.86);\n  background: rgba(255, 255, 255, 0.1);\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  border-radius: 999px;\n  padding: 2px 8px;\n  font-weight: 700;\n  white-space: nowrap;\n  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.03) inset;\n}\n.lda-topic-created-time[data-age-level="neutral"] .lda-topic-created-label {\n  color: rgba(255, 255, 255, 0.86);\n  background: rgba(255, 255, 255, 0.1);\n  border-color: rgba(255, 255, 255, 0.18);\n  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.03) inset;\n}\n.lda-topic-created-time[data-age-level="old"] .lda-topic-created-label {\n  color: var(--lda-topic-age-old, #fdba74);\n  background: rgba(251, 146, 60, 0.16);\n  border-color: rgba(251, 146, 60, 0.34);\n  box-shadow: 0 0 0 1px rgba(251, 146, 60, 0.05) inset;\n}\n.lda-topic-created-time[data-age-level="ancient"] .lda-topic-created-label {\n  color: var(--lda-topic-age-ancient, #fca5a5);\n  background: rgba(239, 68, 68, 0.16);\n  border-color: rgba(239, 68, 68, 0.36);\n  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.05) inset;\n}\n.lda-topic-created-time[data-age-level="fresh"] .lda-topic-created-label {\n  color: var(--lda-topic-age-fresh, #86efac);\n  background: rgba(134, 239, 172, 0.14);\n  border-color: rgba(134, 239, 172, 0.32);\n  box-shadow: 0 0 0 1px rgba(134, 239, 172, 0.04) inset;\n}\n#my-gift-panel .read-stats-container {\n  display: flex;\n  justify-content: space-around;\n  align-items: center;\n  background: #f5f8fb;\n  padding: 6px 10px;\n  border-radius: 8px;\n  margin-top: 6px;\n  border: 1px solid #e1e6eb;\n  color: #334155;\n}\n#my-gift-panel .like-counter-container {\n  display: flex;\n  flex-direction: column;\n  background: #f5f8fb;\n  padding: 8px 12px;\n  border-radius: 8px;\n  margin-top: 6px;\n  border: 1px solid #e1e6eb;\n  font-size: 12px;\n  color: #475569;\n}\n';

  var controls_default = "#my-gift-panel .panel-range-row {\n  flex-direction: column;\n  align-items: stretch;\n  gap: 6px;\n}\n#my-gift-panel .panel-range-heading {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n}\n#my-gift-panel .panel-range-value {\n  color: #a16207;\n  font-weight: bold;\n  min-width: 40px;\n  text-align: right;\n}\n#my-gift-panel .panel-range-track {\n  width: 100%;\n  padding: 0 2px;\n}\n#my-gift-panel .panel-slider-input {\n  width: 100%;\n  height: 4px;\n  border-radius: 2px;\n  outline: none;\n  -webkit-appearance: none;\n  -moz-appearance: none;\n  appearance: none;\n  cursor: pointer;\n}\n.panel-slider-input {\n  -webkit-appearance: none;\n  -moz-appearance: none;\n  appearance: none;\n}\n.panel-slider-input::-webkit-slider-runnable-track {\n  height: 4px;\n  border-radius: 2px;\n  background: transparent;\n}\n.panel-slider-input::-webkit-slider-thumb {\n  -webkit-appearance: none;\n  appearance: none;\n  width: 14px;\n  height: 14px;\n  border-radius: 50%;\n  background: linear-gradient(135deg, #fff 0%, #f0f0f0 100%);\n  cursor: pointer;\n  box-shadow:\n    0 1px 3px rgba(0, 0, 0, 0.3),\n    0 0 0 1px rgba(0, 120, 212, 0.35);\n  border: none;\n  margin-top: -5px;\n  transition:\n    transform 0.15s ease,\n    box-shadow 0.15s ease;\n}\n.panel-slider-input::-webkit-slider-thumb:hover {\n  transform: scale(1.15);\n  box-shadow:\n    0 2px 5px rgba(0, 0, 0, 0.4),\n    0 0 0 2px rgba(0, 120, 212, 0.5);\n}\n.panel-slider-input::-webkit-slider-thumb:active {\n  transform: scale(1.05);\n  background: linear-gradient(135deg, #0078d4 0%, #005a9e 100%);\n}\n.panel-slider-input::-moz-range-track {\n  height: 4px;\n  border-radius: 2px;\n  background: transparent;\n  border: none;\n}\n.panel-slider-input::-moz-range-thumb {\n  width: 14px;\n  height: 14px;\n  border-radius: 50%;\n  background: linear-gradient(135deg, #fff 0%, #f0f0f0 100%);\n  cursor: pointer;\n  border: none;\n  box-shadow:\n    0 1px 3px rgba(0, 0, 0, 0.3),\n    0 0 0 1px rgba(0, 120, 212, 0.35);\n}\n.panel-slider-input::-moz-range-thumb:hover {\n  transform: scale(1.15);\n}\n.panel-slider-input::-moz-range-progress {\n  background: #0078d4;\n  border-radius: 2px;\n  height: 4px;\n}\n.panel-slider-input:focus {\n  outline: none;\n}\n#my-gift-panel .panel-select-wrapper {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  height: 100%;\n}\n#my-gift-panel .panel-select-input {\n  appearance: none;\n  -webkit-appearance: none;\n  -moz-appearance: none;\n  background: #fff;\n  border: 1px solid #cbd5df;\n  border-radius: 4px;\n  color: #334155;\n  padding: 5px 22px 5px 8px;\n  font-size: 11px;\n  cursor: pointer;\n  outline: none;\n  transition: all 0.2s ease;\n  text-align: center;\n  text-align-last: center;\n  min-width: auto;\n  width: auto;\n  white-space: nowrap;\n  overflow: visible;\n  text-overflow: clip;\n  margin-bottom: 0;\n}\n#my-gift-panel .panel-select-arrow {\n  position: absolute;\n  right: 6px;\n  top: 50%;\n  transform: translateY(-50%);\n  font-size: 8px;\n  color: #64748b;\n  pointer-events: none;\n}\n#my-gift-panel .panel-select-option {\n  background: #fff;\n  color: #333;\n  padding: 4px 8px;\n  text-align: center;\n}\n";

  var styledDocuments = /* @__PURE__ */ new WeakSet();
  function installPanelStyles(documentRef = document) {
    if (styledDocuments.has(documentRef) || documentRef.getElementById("linux-do-assistant-panel-style"))
      return;
    const css = panel_default + "\n" + controls_default;
    if (typeof GM_addStyle === "function") {
      const style2 = GM_addStyle(css);
      if (style2?.nodeType === 1) style2.id = "linux-do-assistant-panel-style";
      styledDocuments.add(documentRef);
      return;
    }
    const style = documentRef.createElement("style");
    style.id = "linux-do-assistant-panel-style";
    style.textContent = css;
    (documentRef.head || documentRef.documentElement).appendChild(style);
    styledDocuments.add(documentRef);
  }

  var Panel = class {
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
            checked ? this.t("topicCreatedTimeEnabled") : this.t("topicCreatedTimeDisabled")
          );
        }
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
        }
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
          ["rank", "sectionRanking"]
        ].map(([key, title]) => this.renderPanelSection(key, title)).join("")}</div>`,
        " account-data-detail"
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
          this.container.querySelector('[data-section-content="account-data"]')
        ],
        account: [
          this.container.querySelector('[data-section="account"]'),
          this.container.querySelector('[data-section-content="account"]')
        ],
        credit: [
          this.container.querySelector('[data-section="credit"]'),
          this.container.querySelector('[data-section-content="credit"]')
        ],
        cdk: [
          this.container.querySelector('[data-section="cdk"]'),
          this.container.querySelector('[data-section-content="cdk"]')
        ],
        rank: [
          this.container.querySelector('[data-section="rank"]'),
          this.container.querySelector('[data-section-content="rank"]')
        ],
        settings: [
          this.container.querySelector('[data-section="settings"]'),
          this.container.querySelector('[data-section-content="settings"]')
        ]
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
        } catch (_) {
        }
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
            collapsedSize
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
      this.button.innerHTML = this.getReadingState().autoRunning ? `<span class="btn-icon">⏸</span><span class="btn-text">${this.t("stopReading")}</span>` : `<span class="btn-icon">▶</span><span class="btn-text">${this.t("startReading")}</span>`;
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
      const smartLikeRow = createToggleRow(
        this.t("smartLike"),
        this.settings.smartLikeEnabled,
        (checked) => this.actions.setSmartLikeEnabled(checked)
      );
      this.smartLikeToggleInput = smartLikeRow.querySelector('input[type="checkbox"]');
      const smartLikeSpeedRow = createSelectRow(
        this.t("smartLikeSpeed"),
        [
          { value: "slow", label: this.t("smartLikeSpeedSlow") },
          { value: "normal", label: this.t("smartLikeSpeedNormal") },
          { value: "fast", label: this.t("smartLikeSpeedFast") }
        ],
        this.settings.smartLikeSpeed,
        (value) => {
          this.settings.smartLikeSpeed = ["slow", "normal", "fast"].includes(value) ? value : "normal";
          Storage.set("smartLikeSpeed", this.settings.smartLikeSpeed);
        }
      );
      const cleanModeRow = this.createStoredToggleRow(
        "cleanMode",
        "cleanModeEnabled",
        "清爽模式",
        (checked) => {
          this.actions.toggleCleanMode();
        }
      );
      const grayscaleModeRow = this.createStoredToggleRow(
        "grayscaleMode",
        "grayscaleModeEnabled",
        "黑白灰模式",
        (checked) => {
          this.actions.toggleGrayscaleMode();
        }
      );
      const readUnreadRow = this.createStoredToggleRow(
        "readUnread",
        "readUnreadEnabled",
        "读取未读帖子",
        (checked) => {
          this.actions.resetTopicList();
          console.log(
            "已清空话题列表，下次将获取" + (this.settings.readUnreadEnabled ? "未读" : "最新") + "帖子"
          );
        }
      );
      const randomOrderRow = this.createStoredToggleRow(
        "randomOrder",
        "randomOrderEnabled",
        "随机顺序阅读",
        (checked) => {
          this.actions.resetTopicList();
        }
      );
      randomOrderRow.title = this.t("randomOrderTip");
      const skipReadRow = this.createStoredToggleRow(
        "skipRead",
        "skipReadEnabled",
        "跳过已读帖子",
        (checked) => {
          this.actions.resetTopicList();
        }
      );
      skipReadRow.title = this.t("skipReadTip");
      const fullTopicReadRow = this.createStoredToggleRow(
        "fullTopicRead",
        "fullTopicReadEnabled",
        "完整阅读帖子"
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
        }
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
        }
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
        }
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
        }
      );
      stopAfterReadCountRow.title = this.t("stopAfterReadCountTip");
      const stopOnLikeLimitRow = this.createStoredToggleRow(
        "stopOnLikeLimit",
        "stopOnLikeLimitEnabled",
        "点赞上限停止阅读"
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
        createInnerCollapsibleSection(this.t("readParameterSettingsLabel"), readParameterSection, true)
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
      creditContent.appendChild(this.creditContainer = document.createElement("div"));
      this.creditContainer.className = "credit-info-row";
      this.creditContainer.innerHTML = `<div class="trust-level-loading">${this.t("clickToLoadCredits")}</div>`;
      cdkContent.appendChild(this.cdkContainer = document.createElement("div"));
      this.cdkContainer.className = "cdk-info-row";
      this.cdkContainer.innerHTML = `<div class="trust-level-loading">${this.t("clickToLoadCdk")}</div>`;
      rankContent.appendChild(this.rankDataContainer = document.createElement("div"));
      this.rankDataContainer.className = "rank-data-container";
      this.rankDataContainer.innerHTML = `<div class="trust-level-loading">${this.t("clickToLoadRank")}</div>`;
      const modeSubSection = document.createElement("div");
      modeSubSection.className = "mode-settings-options";
      modeSubSection.appendChild(cleanModeRow);
      modeSubSection.appendChild(grayscaleModeRow);
      settingsContent.appendChild(
        createInnerCollapsibleSection(`🎨 ${this.t("modeSettingsLabel")}`, modeSubSection, true)
      );
      settingsContent.appendChild(
        createInnerCollapsibleSection(
          this.t("topicCreatedTimeLabel"),
          this.createTopicAgeColorSettings(),
          true
        )
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
            cfToggleRow.querySelector(".toggle-switch")
          )
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
      const progressPercent = status.target > 0 ? Math.min(100, Math.round(status.current / status.target * 100)) : 0;
      let html = "";
      if (status.fetching) {
        this.topicStatusMode = "fetching";
        const startPageInfo = status.startPage > 1 ? `从第${status.startPage}页` : "";
        const pageInfo = status.page ? `（${startPageInfo ? startPageInfo + "起，" : ""}当前第${status.page}页）` : "";
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
        const pagesInfo = status.startPage && status.endPage ? `（第${status.startPage}-${status.endPage}页，共${status.totalPages}页）` : status.totalPages ? `（共${status.totalPages}页）` : "";
        const reachedMaxInfo = status.reachedMaxPages ? `<div class="topic-status-warning">⚠️ 已达最大翻页数，未能获取足够帖子</div>` : "";
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
          if (!this.getReadingState().isScrolling && this.topicStatusContainer && !this.hasTopicStatusNotification()) {
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
        const percentage = limit > 0 ? Math.round(remaining / limit * 100) : 0;
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
      return !!(this.topicStatusNotification && this.topicStatusNotification.style.display !== "none" && this.topicStatusNotification.textContent);
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
          if (!this.getReadingState().isScrolling && this.topicStatusContainer && !this.hasTopicStatusNotification()) {
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
      this.button.innerHTML = running ? `<span class="btn-icon">⏸</span><span class="btn-text">${this.t("stopReading")}</span>` : `<span class="btn-icon">▶</span><span class="btn-text">${this.t("startReading")}</span>`;
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
  };

  var texts = {
    panelTitle: "Linux.do 助手",
    sectionAutoRead: "⚡ 自动阅读",
    sectionAccountData: "👤 账号与数据",
    sectionAccountInfo: "📋 账号信息",
    sectionCredit: "💎 Credit 积分",
    sectionRanking: "🏅 排行榜",
    sectionPluginSettings: "⚙️ 插件设置",
    startReading: "开始阅读",
    stopReading: "停止阅读",
    refresh: "🔄 刷新",
    refreshing: "刷新中...",
    detailInfo: "📊 详细信息 →",
    smartLike: "❤️ 智能点赞",
    smartLikeSpeed: "点赞速度",
    smartLikeSpeedSlow: "慢速",
    smartLikeSpeedNormal: "正常",
    smartLikeSpeedFast: "快速",
    cleanMode: "🌟 清爽模式",
    grayscaleMode: "🎨 黑白灰模式",
    readUnread: "📬 读取未读",
    myRanking: "我的排名",
    dailyRank: "日榜",
    weeklyRank: "周榜",
    monthlyRank: "月榜",
    quarterlyRank: "季榜",
    yearlyRank: "年榜",
    allTimeRank: "总榜",
    points: "分",
    modeSettingsLabel: "模式设置",
    readParameterSettingsLabel: "🎛️ 阅读参数",
    userCredits: "的积分",
    loading: "加载中...",
    loadingRank: "加载排名数据...",
    loadingCredits: "加载积分...",
    loadingLevel: "加载等级信息...",
    clickToLoad: "点击展开加载...",
    clickToLoadRank: "点击展开加载排名...",
    clickToLoadCredits: "点击展开加载积分...",
    loadFailed: "加载失败，请点击刷新重试",
    notLoggedIn: "未登录",
    notSupported: "当前站点不支持此功能",
    update: "更新",
    remaining: "剩余",
    hours: "小时",
    minutes: "分",
    seconds: "秒",
    ipRateLimited: "🚫 IP 被限流，自动阅读已暂停",
    ipRateLimitWait: "将在 30 分钟后自动恢复",
    ipRateLimitResume: "✅ IP 限流已解除，恢复自动阅读",
    ipRateLimitDetected: "检测到 IP 限流",
    loadingComplete: "加载完成",
    loadingFailed: "加载失败",
    noUnreadPosts: "📭 没有未读帖子，将切换到最新帖子",
    creditAvailable: "可用积分",
    creditTomorrow: "🌟 明日积分",
    creditTodayRank: "📊 今日排名",
    creditCurrentPoints: "📈 当前点数",
    creditYesterdayPoints: "📅 昨日点数",
    creditRankLabel: "排名",
    creditCommunityBalance: "社区积分",
    creditDailyLimit: "今日剩余额度",
    creditTotalIncome: "总收入",
    creditTotalExpense: "总支出",
    creditRecentIncome: "近7天收入",
    creditRecentExpense: "近7天支出",
    creditViewDetails: "查看详情 →",
    creditLoginRequired: "请先登录 credit.linux.do",
    creditLoginDescription: "登录 credit.linux.do 后查看积分与账户数据",
    creditGoLogin: "去登录",
    restStart: "开始休息",
    restEnd: "休息结束，继续浏览",
    likeLimitReached: "点赞已达上限，将在 ",
    likeCoolingDown: "点赞功能冷却中",
    likeRemaining: "剩余点赞",
    likeUsed: "已用",
    likeCooldown: "冷却中",
    likeClearCooldown: "清除冷却",
    likeClearCooldownTip: "仅清除脚本本地冷却记录",
    likeCooldownCleared: "本地冷却已清除；服务器仍限流时会再次进入冷却",
    likeCooldownClearFailed: "清除点赞冷却失败",
    likeCountMismatch: "计数可能不准确，点击同步",
    likeSyncing: "同步中...",
    likeSyncSuccess: "同步成功",
    randomOrder: "🔀 随机阅读",
    randomOrderTip: "打乱帖子顺序，随机阅读",
    skipRead: "⏭️ 跳过已读",
    skipReadTip: "自动跳过已经阅读过的帖子",
    fullTopicRead: "📜 完整阅读",
    fullTopicReadTip: "从帖子开头开始，滚动到页面底部后再切换下一篇",
    topicLimit: "📚 获取数量",
    topicLimitTip: "每次获取的帖子数量",
    restTimeLabel: "⏸️ 休息时间",
    restTimeTip: "连续阅读1小时后休息的时间（分钟）",
    stopAfterRead: "🛑 阅读限制",
    stopAfterReadTip: "阅读指定数量帖子后自动停止",
    stopAfterReadCount: "📖 阅读数量",
    stopAfterReadCountTip: "阅读多少帖子后停止",
    stopOnLikeLimit: "❤️ 点赞停止",
    stopOnLikeLimitTip: "点赞达到上限后自动停止阅读",
    stoppedByReadLimit: "✅ 已达到阅读数量限制，自动停止",
    stoppedByLikeLimit: "❤️ 点赞已达上限，自动停止阅读",
    stoppedByServerBusy: "⚠️ 检测到 502，已停止自动阅读，避免负载过高",
    stoppedByPageLoading: "⚠️ 页面加载超时，已停止自动阅读，请稍后重试",
    sessionReadCount: "本次已读",
    fetchingTopics: "📥 获取帖子中...",
    fetchProgress: "获取进度",
    totalFetched: "已获取",
    skippedRead: "跳过已读",
    unreadTopics: "未读帖子",
    latestTopics: "最新帖子",
    topicsReady: "帖子已就绪",
    currentReading: "📖 当前阅读",
    remainingTopics: "剩余帖子",
    todayRead: "今日阅读",
    totalRead: "总阅读",
    pageRange: "页码范围",
    startFromPage: "从第",
    pageUnit: "页",
    continueFetching: "续读中",
    sectionCdk: "🎮 CDK 分数",
    cdkScore: "CDK 分数",
    cdkTrustLevel: "信任等级",
    cdkUsername: "用户名",
    cdkNickname: "昵称",
    cdkAccountInfo: "账户信息",
    cdkOverview: "账户概览",
    cdkRefreshTip: "刷新 CDK 数据",
    cdkReceivedRefreshTip: "刷新领取记录",
    cdkNotAuth: "尚未登录 CDK",
    cdkAuthTip: "需先完成授权才能查看社区分数",
    cdkGoAuth: "前往登录",
    cdkScoreDesc: "基于徽章计算的社区信誉分",
    cdkMyReceived: "我的领取",
    cdkReceivedEmpty: "暂无领取记录",
    cdkProjectName: "项目",
    cdkCreator: "发布者",
    cdkContent: "内容",
    cdkReceivedAt: "领取时间",
    cdkCopy: "复制",
    cdkCopied: "已复制",
    cdkTotal: "共 {count} 条",
    cdkLoadingReceived: "加载领取记录...",
    loadingCdk: "加载 CDK 数据...",
    clickToLoadCdk: "点击展开加载 CDK 分数...",
    cdkRecentLimit: "最近20条",
    topicCreatedTimeLabel: "⏰ 创建时间标签",
    topicCreatedTimeVisible: "👁️ 显示创建时间",
    topicCreatedTimeVisibleTip: "开启显示/关闭隐藏帖子创建时间标签",
    topicCreatedTimeEnabled: "创建时间标签已显示",
    topicCreatedTimeDisabled: "创建时间标签已隐藏",
    topicAgeColorLabel: "🎯 帖龄高亮",
    topicAgeColorTip: "控制创建时间标签是否按帖龄着色",
    topicAgeColorEnabled: "帖龄高亮已启用",
    topicAgeColorDisabled: "帖龄高亮已禁用",
    cfBypassLabel: "🛡️ CF 5秒盾",
    cfBypassTip: "检测到 Cloudflare 验证失败时自动打开验证页",
    cfBypassEnabled: "CF 5秒盾自动跳转已启用",
    cfBypassDisabled: "CF 5秒盾自动跳转已禁用",
    cfBypassDetected: "🛡️ 检测到 CF 验证失败，正在跳转...",
    cfBypassManual: "手动触发CF验证",
    cfBypassManualTip: "手动跳转到 CloudFlare challenge 页面",
    cfBypassRedirecting: "正在跳转到 Cloudflare Challenge 页面...",
    cfBypassAlreadyOnChallenge: "已在 Challenge 页面，无需跳转",
    cfBypassNotFoundRedirecting: "Challenge 页面无效，正在返回原页面..."
  };

  var CONFIG = {
    scroll: {
      minSpeed: 10,
      maxSpeed: 15,
      minDistance: 2,
      maxDistance: 4,
      stepMultiplier: 2.5,
      fastScrollChance: 0.08,
      fastScrollMin: 80,
      fastScrollMax: 200,
      fullTopicBacktrackChance: 8,
      fullTopicSlowChance: 24,
      fullTopicSmallStepMinRatio: 0.05,
      fullTopicSmallStepMaxRatio: 0.09,
      fullTopicNormalStepMinRatio: 0.09,
      fullTopicNormalStepMaxRatio: 0.18,
      fullTopicBacktrackMinRatio: 0.02,
      fullTopicBacktrackMaxRatio: 0.05,
      fullTopicMinStep: 160,
      fullTopicNormalMinSpeed: 260,
      fullTopicNormalMaxSpeed: 520,
      fullTopicSlowMinSpeed: 520,
      fullTopicSlowMaxSpeed: 900,
      fullTopicBacktrackMinSpeed: 180,
      fullTopicBacktrackMaxSpeed: 360,
      bottomSettleChecks: 3,
      bottomSettleDelay: 800,
      readConfirmationChecks: 12,
      readConfirmationDelay: 1e3,
      readConfirmationClearChecks: 2,
      readConfirmationNudgePixels: 6
    },
    time: {
      browseTime: 36e5,
      restTime: 6e5,
      topicLoadingTimeout: 25e3
    },
    article: {
      commentLimit: 5e3,
      retryLimit: 3
    },
    levelRequirements: {
      0: {
        topics_entered: 5,
        posts_read_count: 30,
        time_read: 600
      },
      1: {
        days_visited: 15,
        likes_given: 1,
        likes_received: 1,
        post_count: 3,
        topics_entered: 20,
        posts_read_count: 100,
        time_read: 3600
      }
    },
    mustRead: {
      posts: [
        { id: "1051", url: "https://linux.do/t/topic/1051/" },
        { id: "5973", url: "https://linux.do/t/topic/5973" },
        { id: "102770", url: "https://linux.do/t/topic/102770" },
        { id: "154010", url: "https://linux.do/t/topic/154010" },
        { id: "149576", url: "https://linux.do/t/topic/149576" },
        { id: "22118", url: "https://linux.do/t/topic/22118" }
      ]
    },
    likeAllowedCategories: {
      allowed: [
        "开发调优",
        "国产替代",
        "资源荟萃",
        "文档共建",
        "非我莫属",
        "读书成诗",
        "前沿快讯",
        "福利羊毛",
        "搞七捻三",
        "运营反馈"
      ],
      excluded: ["网盘资源", "跳蚤市场", "深海幽域", "积分乐园", "扬帆起航", "社区孵化"]
    }
  };

  var createUtils = (runtime = defaultRuntime) => {
    const documentRef = runtime.document;
    const setTimeoutFn = runtime.setTimeout || ((callback, ms) => setTimeout(callback, ms));
    return {
      random: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
      sleep: (ms) => new Promise((resolve) => setTimeoutFn(resolve, ms)),
      isPageLoaded: () => {
        if (!documentRef?.querySelectorAll) return true;
        const loadingElements = documentRef.querySelectorAll(".loading, .infinite-scroll");
        return loadingElements.length === 0;
      },
      isNearBottom: () => {
        const root = documentRef?.documentElement;
        if (!root) return false;
        const { scrollHeight, clientHeight, scrollTop } = root;
        return scrollTop + clientHeight >= scrollHeight - 200;
      }
    };
  };
  var Utils = createUtils();

  var Reader = class {
    constructor({ settings, session, view, getCurrentUsername, hooks, sleep = Utils.sleep }) {
      this.settings = settings;
      this.session = session;
      this.view = view;
      this.getCurrentUsername = getCurrentUsername;
      this.hooks = hooks;
      this.sleep = sleep;
      this.scope = new DisposableScope();
      this.runGeneration = 0;
      this.scrollGeneration = 0;
      this.isScrolling = false;
      this.navigationTimeout = null;
      this.navigationGuardInterval = null;
      this.accumulatedTime = session.get("accumulatedTime", 0);
      this.lastActionTime = Date.now();
      this.isTopicPage = window.location.href.includes("/t/topic/");
      this.onChallengePage = CURRENT_DOMAIN === "linux.do" && window.location.pathname.startsWith("/challenge");
      if (window.opener !== null) {
        this.autoRunning = false;
        session.set("autoRunning", false);
        this.topicList = [];
        session.set("topicList", []);
        console.log("[窗口独立] 检测到新开窗口，已清除继承的自动阅读状态");
      } else {
        this.autoRunning = this.onChallengePage ? false : session.get("autoRunning", false);
        this.topicList = session.get("topicList", []);
      }
      this.firstUseChecked = Storage.get("firstUseChecked", false);
      this.selectedPost = Storage.get("selectedPost", null);
      this.currentSessionReadCount = session.get("currentSessionReadCount", 0);
      this.readTopics = [];
      this.skippedReadCount = session.get("skippedReadCount", 0);
      this.todayReadCount = this.loadTodayReadCount();
      this.totalReadCount = Storage.get("totalReadCount", 0);
      if (this.totalReadCount < this.todayReadCount) {
        this.totalReadCount = this.todayReadCount;
        Storage.set("totalReadCount", this.totalReadCount);
      }
      this.lastFetchedPage = session.get("lastFetchedPage", 0);
      this.historicalMaxPage = this.loadHistoricalMaxPage();
      this.t = view.t;
    }
    isRunCurrent(generation) {
      return !this.scope.disposed && this.autoRunning && generation === this.runGeneration;
    }
    getSnapshot() {
      return {
        autoRunning: this.autoRunning,
        isScrolling: this.isScrolling,
        topicList: this.topicList,
        currentSessionReadCount: this.currentSessionReadCount,
        skippedReadCount: this.skippedReadCount,
        todayReadCount: this.todayReadCount,
        totalReadCount: this.totalReadCount,
        lastFetchedPage: this.lastFetchedPage,
        historicalMaxPage: this.historicalMaxPage
      };
    }
    start() {
      if (this.onChallengePage || this.scope.disposed) return;
      if (!this.hooks.canRead()) {
        this.stopAutoReading();
        return;
      }
      if (!this.firstUseChecked) {
        this.handleFirstUse();
      } else if (this.autoRunning) {
        this.loadUserReadHistory().then(() => {
          if (this.scope.disposed || !this.autoRunning) return;
          if (this.topicList.length > 0) this.scope.setTimeout(() => this.view.updateReadingStatus(), 100);
          if (this.isTopicPage) this.startScrolling();
          else
            this.getLatestTopics().then(() => {
              if (this.autoRunning && !this.scope.disposed) this.navigateNextTopic();
            });
        });
      } else this.loadUserReadHistory();
      this.startNavigationGuard();
    }
    resetTopicList() {
      this.topicList = [];
      this.session.set("topicList", []);
    }
    resetSessionReadCount() {
      this.currentSessionReadCount = 0;
      this.session.set("currentSessionReadCount", 0);
    }
    destroy() {
      this.stopAutoReading();
      this.scope.dispose();
    }
    getPageContextKey(urlString = window.location.href) {
      try {
        const base = window.location?.origin || BASE_URL;
        const url = new URL(urlString, base);
        const topicMatch = url.pathname.match(/^\/t\/topic\/(\d+)(?:\/\d+)?\/?$/);
        if (topicMatch) return `topic:${topicMatch[1]}`;
        return `${url.pathname}${url.search}`;
      } catch (_) {
        return String(urlString || "");
      }
    }
    getTopicProgressSnapshot() {
      const { scrollHeight } = document.documentElement || {};
      return {
        scrollHeight: scrollHeight || 0,
        postCount: document.querySelectorAll(".topic-post").length,
        maxLoadedPostNumber: this.getLoadedMaxPostNumber()
      };
    }
    parseCssPixels(value) {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    isBlueTimelineColor(value) {
      const rgb = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
      if (!rgb) return false;
      const red = Number(rgb[1]);
      const green = Number(rgb[2]);
      const blue = Number(rgb[3]);
      const alpha = rgb[4] === void 0 ? 1 : Number(rgb[4]);
      return alpha > 0.35 && blue >= 120 && green >= 90 && red <= 80;
    }
    isBlueDotStyle(style, fallbackRect = null) {
      if (!style || style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity || 1) < 0.2) return false;
      const width = this.parseCssPixels(style.width) || fallbackRect?.width || 0;
      const height = this.parseCssPixels(style.height) || fallbackRect?.height || 0;
      const radius = this.parseCssPixels(style.borderTopLeftRadius);
      const isSmallRound = width >= 4 && width <= 18 && height >= 4 && height <= 18 && Math.abs(width - height) <= 6 && radius >= Math.min(width, height) * 0.35;
      if (!isSmallRound) return false;
      return [style.backgroundColor, style.borderColor, style.color].some(
        (color) => this.isBlueTimelineColor(color)
      );
    }
    hasUnreadTimelineBlueDot() {
      const containers = Array.from(
        document.querySelectorAll(
          [
            ".topic-timeline",
            ".timeline-scrollarea",
            ".timeline-container",
            ".timeline-replies",
            ".topic-navigation"
          ].join(",")
        )
      );
      if (containers.length === 0) return false;
      return containers.some(
        (container) => Array.from(container.querySelectorAll("*")).some((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const directStyle = window.getComputedStyle(element);
          if (this.isBlueDotStyle(directStyle, rect)) return true;
          return ["::before", "::after"].some((pseudo) => {
            const pseudoStyle = window.getComputedStyle(element, pseudo);
            if (!pseudoStyle || pseudoStyle.content === "none") return false;
            return this.isBlueDotStyle(pseudoStyle);
          });
        })
      );
    }
    nudgeScrollForReadConfirmation() {
      const pixels = CONFIG.scroll.readConfirmationNudgePixels;
      window.dispatchEvent(new Event("scroll"));
      window.scrollBy({ top: -pixels, behavior: "auto" });
      window.scrollBy({ top: pixels * 2, behavior: "smooth" });
    }
    async waitForTopicReadConfirmation() {
      if (!this.isTopicPage) return true;
      let clearChecks = 0;
      for (let attempt = 0; attempt < CONFIG.scroll.readConfirmationChecks; attempt++) {
        if (!this.autoRunning) return false;
        if (!this.hasUnreadTimelineBlueDot()) {
          clearChecks++;
          if (clearChecks >= CONFIG.scroll.readConfirmationClearChecks) return true;
        } else {
          clearChecks = 0;
          console.log("[完整阅读] 检测到楼层小蓝点未消失，继续等待阅读确认...");
          this.nudgeScrollForReadConfirmation();
        }
        await this.sleep(CONFIG.scroll.readConfirmationDelay);
      }
      return !this.hasUnreadTimelineBlueDot();
    }
    getLoadedMaxPostNumber() {
      const posts = Array.from(document.querySelectorAll(".topic-post[data-post-number]"));
      return posts.reduce((max, post) => {
        const number = Number.parseInt(post.getAttribute("data-post-number") || "0", 10);
        return Number.isFinite(number) ? Math.max(max, number) : max;
      }, 0);
    }
    async getCurrentTopicMaxPostNumber() {
      const topicIdMatch = window.location.pathname.match(/\/t\/topic\/(\d+)/);
      const topicId = topicIdMatch ? topicIdMatch[1] : null;
      if (!topicId) return this.getLoadedMaxPostNumber();
      if (this._topicMaxPostNumberTopicId === topicId && Number.isFinite(this._topicMaxPostNumber)) {
        return this._topicMaxPostNumber;
      }
      const url = new URL(window.location.href);
      url.hash = "";
      const jsonUrl = url.toString().replace(/\/$/, "") + ".json";
      try {
        const response = await fetch(jsonUrl, { credentials: "include" });
        const data = response && response.ok ? await response.json() : null;
        const maxPostNumber = Number(data?.highest_post_number || data?.posts_count || 0);
        this._topicMaxPostNumberTopicId = topicId;
        this._topicMaxPostNumber = Number.isFinite(maxPostNumber) && maxPostNumber > 0 ? maxPostNumber : this.getLoadedMaxPostNumber();
        return this._topicMaxPostNumber;
      } catch (_) {
        return this.getLoadedMaxPostNumber();
      }
    }
    hasTopicProgressChanged(previous, current) {
      return current.scrollHeight > previous.scrollHeight + 50 || current.postCount > previous.postCount || current.maxLoadedPostNumber > previous.maxLoadedPostNumber;
    }
    async isTopicFullyRead() {
      const settleChecks = CONFIG.scroll.bottomSettleChecks;
      const settleDelay = CONFIG.scroll.bottomSettleDelay;
      const targetMaxPostNumber = await this.getCurrentTopicMaxPostNumber();
      let previous = this.getTopicProgressSnapshot();
      for (let attempt = 0; attempt < settleChecks; attempt++) {
        await this.sleep(settleDelay);
        if (!this.autoRunning || !this.isScrolling) return false;
        if (!Utils.isNearBottom() || !Utils.isPageLoaded()) return false;
        const current = this.getTopicProgressSnapshot();
        if (targetMaxPostNumber > 0 && current.maxLoadedPostNumber < targetMaxPostNumber) return false;
        if (this.hasTopicProgressChanged(previous, current)) return false;
        if (this.hasUnreadTimelineBlueDot()) {
          console.log("[完整阅读] 楼层小蓝点仍存在，暂不跳转下一篇");
          this.nudgeScrollForReadConfirmation();
          return false;
        }
        previous = current;
      }
      const reachedLastPost = targetMaxPostNumber <= 0 || previous.maxLoadedPostNumber >= targetMaxPostNumber;
      return reachedLastPost && await this.waitForTopicReadConfirmation();
    }
    isPageLoadingStalled(timeOnPage) {
      return this.isTopicPage && timeOnPage > CONFIG.time.topicLoadingTimeout && !Utils.isPageLoaded();
    }
    getScrollPlan(shouldReadFullTopic) {
      if (!shouldReadFullTopic) {
        const delay = Utils.random(CONFIG.scroll.minSpeed, CONFIG.scroll.maxSpeed);
        const distance = Utils.random(CONFIG.scroll.minDistance, CONFIG.scroll.maxDistance);
        return {
          step: distance * CONFIG.scroll.stepMultiplier,
          behavior: "smooth",
          delay,
          allowFastScroll: true
        };
      }
      const viewportHeight = Math.max(
        window.innerHeight || 0,
        document.documentElement?.clientHeight || 0,
        CONFIG.scroll.fullTopicMinStep
      );
      const getStepRange = (minRatio, maxRatio) => {
        const minStep2 = Math.max(12, Math.floor(viewportHeight * minRatio));
        const maxStep2 = Math.max(minStep2, Math.floor(viewportHeight * maxRatio));
        return [minStep2, maxStep2];
      };
      const roll = Utils.random(1, 100);
      if (roll <= CONFIG.scroll.fullTopicBacktrackChance) {
        const [minStep2, maxStep2] = getStepRange(
          CONFIG.scroll.fullTopicBacktrackMinRatio,
          CONFIG.scroll.fullTopicBacktrackMaxRatio
        );
        return {
          step: -Utils.random(minStep2, maxStep2),
          behavior: "smooth",
          delay: Utils.random(
            CONFIG.scroll.fullTopicBacktrackMinSpeed,
            CONFIG.scroll.fullTopicBacktrackMaxSpeed
          ),
          allowFastScroll: false
        };
      }
      const useSlowStep = roll <= CONFIG.scroll.fullTopicSlowChance;
      const [minStep, maxStep] = useSlowStep ? getStepRange(CONFIG.scroll.fullTopicSmallStepMinRatio, CONFIG.scroll.fullTopicSmallStepMaxRatio) : getStepRange(CONFIG.scroll.fullTopicNormalStepMinRatio, CONFIG.scroll.fullTopicNormalStepMaxRatio);
      const [minDelay, maxDelay] = useSlowStep ? [CONFIG.scroll.fullTopicSlowMinSpeed, CONFIG.scroll.fullTopicSlowMaxSpeed] : [CONFIG.scroll.fullTopicNormalMinSpeed, CONFIG.scroll.fullTopicNormalMaxSpeed];
      return {
        step: Utils.random(minStep, maxStep),
        behavior: "smooth",
        delay: Utils.random(minDelay, maxDelay),
        allowFastScroll: false
      };
    }
    async recoverFromStuck() {
      const generation = this.runGeneration;
      if (!this.isRunCurrent(generation)) return;
      console.log("🔧 开始恢复流程...");
      this.stopScrolling();
      await this.sleep(1e3);
      if (!this.isRunCurrent(generation)) return;
      if (this.isTopicPage) {
        console.log("📖 在文章页，重新开始滚动");
        this.startScrolling();
      } else {
        console.log("📋 在列表页，尝试导航到下一篇");
        if (this.topicList.length === 0) {
          await this.getLatestTopics();
          if (!this.isRunCurrent(generation)) return;
        }
        await this.navigateNextTopic();
      }
      this.pageLoadTime = Date.now();
    }
    handleButtonClick() {
      if (this.scope.disposed) return;
      if (this.isScrolling || this.autoRunning) {
        this.stopAutoReading();
      } else {
        if (!this.hooks.canRead()) return;
        const generation = ++this.runGeneration;
        this.autoRunning = true;
        this.session.set("autoRunning", true);
        this.view.setReadingRunning(true);
        this.startNavigationGuard();
        this.view.prepareForReading();
        if (!this.firstUseChecked) {
          this.handleFirstUse();
        } else if (this.isTopicPage) {
          this.startScrolling();
        } else {
          this.getLatestTopics().then(() => {
            if (!this.isRunCurrent(generation)) return;
            this.navigateNextTopic();
          });
        }
      }
    }
    async handleFirstUse() {
      if (!this.autoRunning) return;
      if (CURRENT_DOMAIN !== "linux.do") {
        console.log("非 linux.do 域名，跳过新手教程");
        Storage.set("firstUseChecked", true);
        this.firstUseChecked = true;
        await this.getLatestTopics();
        if (!this.autoRunning) return;
        await this.navigateNextTopic();
        return;
      }
      if (!this.selectedPost) {
        const randomIndex = Math.floor(Math.random() * CONFIG.mustRead.posts.length);
        this.selectedPost = CONFIG.mustRead.posts[randomIndex];
        Storage.set("selectedPost", this.selectedPost);
        console.log(`随机选择文章: ${this.selectedPost.url}`);
        window.location.href = this.selectedPost.url;
        return;
      }
      const currentUrl = window.location.href;
      if (currentUrl.includes(this.selectedPost.url)) {
        Storage.set("firstUseChecked", true);
        this.firstUseChecked = true;
        if (this.isTopicPage) this.startScrolling();
        else {
          await this.getLatestTopics();
          if (this.autoRunning) await this.navigateNextTopic();
        }
      } else {
        window.location.href = this.selectedPost.url;
      }
    }
    async getLatestTopics() {
      const generation = this.runGeneration;
      if (!this.isRunCurrent(generation)) return [];
      let topicList = [];
      let retryCount = 0;
      let totalSkipped = 0;
      let emptyPageCount = 0;
      let topicLimit = this.settings.topicLimitCount || 100;
      if (this.settings.stopAfterReadEnabled) {
        const remainingToRead = this.settings.stopAfterReadCount - this.currentSessionReadCount;
        if (remainingToRead > 0) {
          topicLimit = remainingToRead;
          console.log(
            `[阅读限制] 开启阅读限制，本次只获取 ${topicLimit} 篇帖子（限制${this.settings.stopAfterReadCount}篇，已读${this.currentSessionReadCount}篇）`
          );
        } else {
          console.log(`[阅读限制] 已达到阅读限制，不再获取新帖子`);
          topicLimit = 0;
        }
      }
      const maxPagesPerFetch = Math.max(50, Math.ceil(topicLimit / 5));
      let startPage = this.getStartPage();
      let page = startPage;
      const maxPage = startPage + maxPagesPerFetch - 1;
      const endpoint = this.settings.readUnreadEnabled ? "unread" : "latest";
      const topicType = this.settings.readUnreadEnabled ? this.t("unreadTopics") : this.t("latestTopics");
      console.log(
        `[页码续读] 从第${startPage}页开始获取${this.settings.readUnreadEnabled ? "未读" : "最新"}帖子（限制：${topicLimit}篇，最大翻到第${maxPage}页）...`
      );
      this.view.updateTopicStatus({
        fetching: true,
        type: topicType,
        current: 0,
        target: topicLimit,
        skipped: 0,
        startPage
      });
      while (topicList.length < topicLimit && retryCount < CONFIG.article.retryLimit && page <= maxPage) {
        try {
          const response = await fetch(`${BASE_URL}/${endpoint}.json?no_definitions=true&page=${page}`);
          if (!this.isRunCurrent(generation)) return topicList;
          if (response.status === 502) {
            this.view.showNotification(this.t("stoppedByServerBusy"));
            this.stopAutoReading();
            return topicList;
          }
          const data = await response.json();
          if (!this.isRunCurrent(generation)) return topicList;
          if (data?.topic_list?.topics && data.topic_list.topics.length > 0) {
            emptyPageCount = 0;
            let filteredTopics = data.topic_list.topics.filter(
              (topic) => topic.posts_count < CONFIG.article.commentLimit
            );
            if (this.settings.skipReadEnabled) {
              const beforeCount = filteredTopics.length;
              filteredTopics = filteredTopics.filter((topic) => !this.isTopicRead(topic.id.toString()));
              const skippedCount = beforeCount - filteredTopics.length;
              if (skippedCount > 0) {
                totalSkipped += skippedCount;
                console.log(
                  `第${page}页：跳过了 ${skippedCount} 篇已读帖子，获取 ${filteredTopics.length} 篇未读`
                );
              }
            }
            topicList.push(...filteredTopics);
            if (topicList.length > 1) {
              const seenTopicIds = /* @__PURE__ */ new Set();
              const beforeDedupCount = topicList.length;
              topicList = topicList.filter((topic) => {
                const topicId = String(topic?.id ?? "");
                if (!topicId) return false;
                if (seenTopicIds.has(topicId)) {
                  return false;
                }
                seenTopicIds.add(topicId);
                return true;
              });
              const dedupedCount = beforeDedupCount - topicList.length;
              if (dedupedCount > 0) {
                console.log(`[去重] 第${page}页合并后移除了 ${dedupedCount} 篇重复 topic`);
              }
            }
            page++;
            this.view.updateTopicStatus({
              fetching: true,
              type: topicType,
              current: topicList.length,
              target: topicLimit,
              skipped: totalSkipped,
              page: page - 1,
              maxPages: maxPage,
              startPage
            });
            if (this.settings.readUnreadEnabled && data.topic_list.topics.length === 0) {
              console.log("未读帖子模式：API返回空数据，没有更多未读帖子");
              break;
            }
          } else {
            emptyPageCount++;
            console.log(`第${page}页：API返回空数据（连续${emptyPageCount}页为空）`);
            if (emptyPageCount >= 3) {
              if (startPage > 1 && topicList.length < topicLimit) {
                console.log(`[页码续读] 连续${emptyPageCount}页为空，从第1页重新扫描...`);
                page = 1;
                startPage = 1;
                emptyPageCount = 0;
                this.lastFetchedPage = 0;
                this.session.set("lastFetchedPage", 0);
                continue;
              }
              break;
            }
            page++;
          }
        } catch (error) {
          console.error("获取文章列表失败:", error);
          retryCount++;
          await this.sleep(1e3);
          if (!this.isRunCurrent(generation)) return topicList;
        }
      }
      const finalPage = page - 1;
      this.lastFetchedPage = finalPage;
      this.session.set("lastFetchedPage", finalPage);
      this.saveHistoricalMaxPage(finalPage);
      const reachedMaxPages = page > maxPage && topicList.length < topicLimit;
      if (reachedMaxPages) {
        console.log(
          `[页码续读] 已达到本次最大页数 ${maxPage} 页，获取到 ${topicList.length}/${topicLimit} 篇帖子`
        );
      }
      if (topicList.length > topicLimit) {
        topicList = topicList.slice(0, topicLimit);
      }
      if (topicList.length > 1) {
        const seenTopicIds = /* @__PURE__ */ new Set();
        const beforeDedupCount = topicList.length;
        topicList = topicList.filter((topic) => {
          const topicId = String(topic?.id ?? "");
          if (!topicId) return false;
          if (seenTopicIds.has(topicId)) {
            return false;
          }
          seenTopicIds.add(topicId);
          return true;
        });
        const dedupedCount = beforeDedupCount - topicList.length;
        if (dedupedCount > 0) {
          console.log(`[去重] 最终列表移除了 ${dedupedCount} 篇重复 topic`);
        }
      }
      if (this.settings.randomOrderEnabled && topicList.length > 1) {
        topicList = this.shuffleArray(topicList);
        console.log("已随机打乱帖子顺序");
      }
      this.topicList = topicList;
      this.session.set("topicList", topicList);
      console.log(
        `[页码续读] 已获取 ${topicList.length} 篇${this.settings.readUnreadEnabled ? "未读" : "最新"}文章${this.settings.randomOrderEnabled ? "（随机顺序）" : ""}（第${startPage}-${finalPage}页）`
      );
      this.view.updateTopicStatus({
        fetching: false,
        type: topicType,
        current: topicList.length,
        target: topicLimit,
        skipped: totalSkipped,
        ready: true,
        reachedMaxPages,
        totalPages: finalPage - startPage + 1,
        startPage,
        endPage: finalPage
      });
      if (topicList.length === 0) {
        if (this.settings.readUnreadEnabled) {
          this.view.showNotification(this.t("noUnreadPosts"));
          this.settings.readUnreadEnabled = false;
          Storage.set("readUnreadEnabled", false);
          this.resetPageProgress();
          await this.getLatestTopics();
          if (!this.isRunCurrent(generation)) return topicList;
        } else if (this.settings.skipReadEnabled && startPage > 1) {
          console.log("[页码续读] 高页码无未读帖子，从第1页重新开始");
          this.resetPageProgress();
          this.historicalMaxPage = 0;
          Storage.set("historicalMaxPageData", null);
          await this.getLatestTopics();
          if (!this.isRunCurrent(generation)) return topicList;
        } else if (this.settings.skipReadEnabled) {
          this.view.showNotification("所有帖子都已读过，停止阅读");
          this.stopAutoReading();
        }
      }
      return topicList;
    }
    shuffleArray(array) {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
    async getNextTopic() {
      const generation = this.runGeneration;
      if (!this.isRunCurrent(generation)) return null;
      if (this.topicList.length === 0) {
        await this.getLatestTopics();
      }
      if (!this.isRunCurrent(generation)) return null;
      while (this.topicList.length > 0) {
        const topic = this.topicList.shift();
        if (this.settings.skipReadEnabled && this.isTopicRead(topic.id.toString())) {
          console.log(`跳过已读帖子: ${topic.title} (ID: ${topic.id})`);
          this.skippedReadCount++;
          this.session.set("skippedReadCount", this.skippedReadCount);
          this.session.set("topicList", this.topicList);
          this.view.updateReadingStatus();
          continue;
        }
        this.session.set("topicList", this.topicList);
        return topic;
      }
      return null;
    }
    async startScrolling() {
      if (this.isScrolling || !this.autoRunning || this.scope.disposed) return;
      const generation = ++this.scrollGeneration;
      const isActive = () => !this.scope.disposed && this.autoRunning && this.isScrolling && generation === this.scrollGeneration;
      this.isScrolling = true;
      this.view.setReadingRunning(true);
      this.lastActionTime = Date.now();
      const shouldReadFullTopic = this.settings.fullTopicReadEnabled && this.isTopicPage;
      if (shouldReadFullTopic) {
        window.scrollTo({ top: 0, behavior: "auto" });
        await this.sleep(300);
        if (!isActive()) return;
      }
      if (this.isTopicPage) {
        this.hooks.onActive();
        if (shouldReadFullTopic) {
          window.scrollTo({ top: 0, behavior: "auto" });
          await this.sleep(300);
          if (!isActive()) return;
        }
      }
      this.scrollStartTime = Date.now();
      const maxScrollTime = shouldReadFullTopic ? null : 3e4;
      while (isActive()) {
        const scrollPlan = this.getScrollPlan(shouldReadFullTopic);
        window.scrollBy({
          top: scrollPlan.step,
          behavior: scrollPlan.behavior
        });
        if (Utils.isNearBottom()) {
          await this.sleep(800);
          if (!isActive()) return;
          if (!this.autoRunning) break;
          const canNavigate = shouldReadFullTopic ? await this.isTopicFullyRead() : Utils.isNearBottom() && Utils.isPageLoaded();
          if (!isActive()) return;
          if (canNavigate) {
            console.log("已到达页面底部，准备导航到下一篇文章...");
            await this.sleep(1e3);
            if (!isActive()) return;
            if (!this.autoRunning) break;
            this.isScrolling = false;
            await this.navigateNextTopic();
            return;
          }
        }
        const scrolledTime = Date.now() - this.scrollStartTime;
        if (maxScrollTime !== null && scrolledTime > maxScrollTime) {
          if (this.isTopicPage && this.hasUnreadTimelineBlueDot()) {
            console.log("[阅读确认] 检测到楼层小蓝点未消失，取消本次强制跳转并继续等待...");
            this.nudgeScrollForReadConfirmation();
            this.scrollStartTime = Date.now();
            continue;
          }
          console.log(`已在当前页面滚动${Math.floor(scrolledTime / 1e3)}秒，强制跳转到下一篇文章...`);
          this.isScrolling = false;
          await this.navigateNextTopic();
          return;
        }
        await this.sleep(scrollPlan.delay);
        if (!isActive()) return;
        this.accumulateTime();
        if (!isActive()) return;
        if (scrollPlan.allowFastScroll && Math.random() < CONFIG.scroll.fastScrollChance) {
          const fastScroll = Utils.random(CONFIG.scroll.fastScrollMin, CONFIG.scroll.fastScrollMax);
          window.scrollBy({
            top: fastScroll,
            behavior: "smooth"
          });
          await this.sleep(200);
          if (!isActive()) return;
        }
      }
    }
    stopScrolling() {
      this.scrollGeneration++;
      this.isScrolling = false;
      this.hooks.onPause("reading_paused");
      this.view.setReadingRunning(false);
    }
    accumulateTime() {
      const now = Date.now();
      this.accumulatedTime += now - this.lastActionTime;
      this.session.set("accumulatedTime", this.accumulatedTime);
      this.lastActionTime = now;
      if (this.accumulatedTime >= CONFIG.time.browseTime) {
        this.accumulatedTime = 0;
        this.session.set("accumulatedTime", 0);
        this.pauseForRest();
      }
    }
    async pauseForRest() {
      if (!this.autoRunning || this.scope.disposed) return;
      const generation = this.runGeneration;
      this.stopScrolling();
      const restMinutes = Math.floor(CONFIG.time.restTime / 6e4);
      console.log(`休息${restMinutes}分钟...`);
      this.view.showNotification(`⏸️ ${this.t("restStart")} ${restMinutes} ${this.t("minutes")}`);
      await this.sleep(CONFIG.time.restTime);
      if (!this.isRunCurrent(generation)) return;
      console.log("休息结束，继续浏览...");
      this.view.showNotification(`✅ ${this.t("restEnd")}`);
      this.startScrolling();
    }
    getCurrentTopicIdFromLocation() {
      const match = window.location.pathname.match(/\/t\/topic\/(\d+)/);
      return match ? String(match[1]) : null;
    }
    async waitForTopicNavigation(targetTopicId, timeout = 8e3) {
      const generation = this.runGeneration;
      if (!this.isRunCurrent(generation)) return false;
      const start = Date.now();
      const target = String(targetTopicId);
      while (this.isRunCurrent(generation) && Date.now() - start < timeout) {
        const currentTopicId = this.getCurrentTopicIdFromLocation();
        if (currentTopicId === target) {
          await this.sleep(300);
          const topicContent = document.querySelector(
            ".topic-post article, article[data-post-id], .post-stream"
          );
          if (topicContent) return true;
        }
        await this.sleep(150);
      }
      return false;
    }
    async onTopicNavigated(targetTopicId) {
      const generation = this.runGeneration;
      if (!this.isRunCurrent(generation)) return;
      console.log(`[导航后] 开始处理新帖子: ${targetTopicId}`);
      this.isTopicPage = window.location.pathname.includes("/t/topic/");
      this.pageLoadTime = Date.now();
      this.lastPageContextKey = this.getPageContextKey(window.location.href);
      this._topicMaxPostNumberTopicId = null;
      this._topicMaxPostNumber = null;
      await this.sleep(800);
      if (!this.isRunCurrent(generation)) return;
      try {
        this.view.updateReadingStatus?.();
      } catch (error) {
        console.warn("[导航后] updateReadingStatus 失败:", error);
      }
      if (this.autoRunning && this.isTopicPage && !this.isScrolling) {
        console.log("[导航后] 自动阅读仍开启，恢复滚动");
        this.startScrolling();
      }
    }
    getPageWindow() {
      try {
        if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow;
      } catch (_) {
      }
      return window;
    }
    getDiscourseRouter() {
      const lookupNames = ["router:main", "service:router", "router:application"];
      const lookupFrom = (source, label) => {
        if (!source || typeof source.lookup !== "function") return null;
        for (const name of lookupNames) {
          try {
            const router = source.lookup(name);
            if (router) {
              console.log(`[导航] 已从 ${label} 获取 router: ${name}`);
              return router;
            }
          } catch (_) {
          }
        }
        return null;
      };
      try {
        const container = this.getPageWindow().Discourse?.__container__;
        const router = lookupFrom(container, "Discourse.__container__");
        if (router) return router;
      } catch (error) {
        console.warn("[导航] 从 Discourse.__container__ 获取 router 失败:", error);
      }
      try {
        const req = this.getPageWindow().require;
        const app = typeof req === "function" ? req("__DISCOURSE_APP__") : null;
        const router = lookupFrom(app, "__DISCOURSE_APP__");
        if (router) return router;
      } catch (error) {
        console.warn("[导航] 从 __DISCOURSE_APP__ 获取 router 失败:", error);
      }
      try {
        const api = this.getPageWindow().Discourse?.__container__?.lookup?.("api:main");
        const router = api?.container ? lookupFrom(api.container, "api:main.container") : null;
        if (router) return router;
      } catch (error) {
        console.warn("[导航] 从 api:main 获取 router 失败:", error);
      }
      console.warn("[导航] 未找到可用的 Discourse/Ember router");
      return null;
    }
    findTopicAnchor(targetTopicId) {
      const target = String(targetTopicId);
      return Array.from(document.querySelectorAll("a[href]")).find((anchor) => {
        const href = anchor.getAttribute("href") || "";
        return href === `/t/topic/${target}` || href.startsWith(`/t/topic/${target}/`);
      }) || Array.from(document.querySelectorAll("a[href]")).find((anchor) => {
        const href = anchor.getAttribute("href") || "";
        return href.includes(`/t/topic/${target}`);
      });
    }
    async waitAfterSoftNavigation(mode, targetTopicId) {
      console.log(`[导航] 已发起跳转，方式: ${mode}`);
      const ok = await this.waitForTopicNavigation(targetTopicId, 8e3);
      if (!ok) {
        console.warn(`[导航] 在等待期内未确认进入目标帖子: ${targetTopicId}`);
        return false;
      }
      console.log(`[导航] 已确认进入目标帖子: ${targetTopicId}`);
      if (this.navigationTimeout) {
        this.scope.clearTimeout(this.navigationTimeout);
        this.navigationTimeout = null;
      }
      await this.onTopicNavigated(targetTopicId);
      return true;
    }
    async tryRouteToWithDiscourseURL(target, targetTopicId, label) {
      if (!this.getPageWindow().DiscourseURL || typeof this.getPageWindow().DiscourseURL.routeTo !== "function")
        return false;
      try {
        console.log(`[导航] 尝试 DiscourseURL.routeTo(${label}):`, target);
        this.getPageWindow().DiscourseURL.routeTo(target);
        return await this.waitAfterSoftNavigation(`DiscourseURL.routeTo(${label})`, targetTopicId);
      } catch (error) {
        console.warn(`[导航] DiscourseURL.routeTo(${label}) 失败:`, error);
        return false;
      }
    }
    async tryRouterTransition(router, target, targetTopicId, label) {
      if (!router || typeof router.transitionTo !== "function") return false;
      try {
        console.log(`[导航] 尝试 router.transitionTo(${label}):`, target);
        router.transitionTo(target);
        return await this.waitAfterSoftNavigation(`router.transitionTo(${label})`, targetTopicId);
      } catch (error) {
        console.warn(`[导航] router.transitionTo(${label}) 失败:`, error);
        return false;
      }
    }
    async clickTopicLinkElement(anchor, targetTopicId, mode) {
      if (!anchor) return false;
      console.log(`[导航] 尝试链接点击(${mode}):`, anchor.href || anchor.getAttribute("href"));
      try {
        anchor.click();
      } catch (error) {
        console.warn(`[导航] anchor.click(${mode}) 失败，尝试 dispatchEvent:`, error);
        const eventWindow = anchor.ownerDocument?.defaultView;
        const EventCtor = eventWindow?.MouseEvent || MouseEvent;
        anchor.dispatchEvent(
          new EventCtor("click", {
            bubbles: true,
            cancelable: true,
            button: 0
          })
        );
      }
      return await this.waitAfterSoftNavigation(`link.click(${mode})`, targetTopicId);
    }
    async clickTemporaryTopicLink(path, url, targetTopicId) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.setAttribute("href", path);
      anchor.removeAttribute("target");
      anchor.setAttribute("data-auto-route", "true");
      anchor.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:auto;";
      document.body.appendChild(anchor);
      try {
        return await this.clickTopicLinkElement(anchor, targetTopicId, "temporary-anchor");
      } finally {
        anchor.remove();
      }
    }
    async tryHistoryPushState(path, targetTopicId) {
      try {
        const pageWindow = this.getPageWindow();
        console.log("[导航] 尝试 history.pushState:", path);
        pageWindow.history.pushState({}, "", path);
        const PopStateEventCtor = pageWindow.PopStateEvent || PopStateEvent;
        pageWindow.dispatchEvent(new PopStateEventCtor("popstate"));
        return await this.waitAfterSoftNavigation("history.pushState", targetTopicId);
      } catch (error) {
        console.warn("[导航] history.pushState 失败:", error);
        return false;
      }
    }
    async softNavigateToTopic(path, url, targetTopicId) {
      const generation = this.runGeneration;
      if (!this.isRunCurrent(generation)) return false;
      this.hooks.onPause("topic_changed");
      if (this.navigationTimeout) {
        this.scope.clearTimeout(this.navigationTimeout);
        this.navigationTimeout = null;
      }
      this.navigationTimeout = this.scope.setTimeout(() => {
        if (!this.isRunCurrent(generation)) return;
        const currentTopicId = this.getCurrentTopicIdFromLocation();
        if (currentTopicId !== String(targetTopicId)) {
          console.warn("⚠️ 路由跳转超时，fallback 到原生跳转:", url);
          window.location.assign(url);
        } else {
          console.log("✅ 已经进入目标帖子，取消 fallback");
        }
      }, 12e3);
      try {
        if (await this.tryRouteToWithDiscourseURL(path, targetTopicId, "path")) return true;
        if (!this.isRunCurrent(generation)) return false;
        if (await this.tryRouteToWithDiscourseURL(url, targetTopicId, "url")) return true;
        if (!this.isRunCurrent(generation)) return false;
        const router = this.getDiscourseRouter();
        if (await this.tryRouterTransition(router, path, targetTopicId, "path")) return true;
        if (!this.isRunCurrent(generation)) return false;
        if (await this.tryRouterTransition(router, url, targetTopicId, "url")) return true;
        if (!this.isRunCurrent(generation)) return false;
        const candidate = this.findTopicAnchor(targetTopicId);
        if (await this.clickTopicLinkElement(candidate, targetTopicId, "existing-anchor")) return true;
        if (!this.isRunCurrent(generation)) return false;
        if (await this.clickTemporaryTopicLink(path, url, targetTopicId)) return true;
        if (!this.isRunCurrent(generation)) return false;
        if (await this.tryHistoryPushState(path, targetTopicId)) return true;
        if (!this.isRunCurrent(generation)) return false;
        console.warn("[导航] 所有软跳转方案失败，使用原生跳转:", url);
        window.location.assign(url);
        return false;
      } catch (error) {
        if (!this.isRunCurrent(generation)) return false;
        console.error("[导航] 跳转异常，fallback 到原生跳转:", error);
        window.location.assign(url);
        return false;
      }
    }
    async navigateNextTopic() {
      const generation = this.runGeneration;
      if (!this.isRunCurrent(generation)) return;
      this.hooks.onPause("navigating");
      if (this.isTopicPage && !await this.waitForTopicReadConfirmation()) {
        if (!this.isRunCurrent(generation)) return;
        console.log("[阅读确认] 楼层小蓝点未消失，已取消跳转下一篇");
        if (this.autoRunning && !this.isScrolling) this.startScrolling();
        return;
      }
      if (!this.isRunCurrent(generation)) return;
      if (this.settings.stopAfterReadEnabled && this.currentSessionReadCount >= this.settings.stopAfterReadCount) {
        console.log(
          `已达到阅读数量限制 (${this.currentSessionReadCount}/${this.settings.stopAfterReadCount})，自动停止`
        );
        this.view.showNotification(this.t("stoppedByReadLimit"));
        this.stopAutoReading();
        return;
      }
      if (!this.hooks.canRead()) {
        this.stopAutoReading();
        return;
      }
      const nextTopic = await this.getNextTopic();
      if (!this.isRunCurrent(generation)) return;
      if (!nextTopic) {
        console.log("没有更多文章，返回首页");
        window.location.assign(`${BASE_URL}/latest`);
        return;
      }
      console.log("导航到新文章:", nextTopic.title);
      this.incrementTodayReadCount();
      this.currentSessionReadCount++;
      this.session.set("currentSessionReadCount", this.currentSessionReadCount);
      console.log(`当前会话已阅读: ${this.currentSessionReadCount}/${this.settings.stopAfterReadCount}`);
      this.view.updateReadingStatus();
      const currentMatch = window.location.pathname.match(/\/t\/topic\/(\d+)/);
      if (currentMatch) {
        const currentTopicId = currentMatch[1];
        await this.saveUserReadHistory(currentTopicId);
      }
      if (!this.isRunCurrent(generation)) return;
      const targetTopicId = String(nextTopic.id);
      const path = this.settings.fullTopicReadEnabled ? `/t/topic/${nextTopic.id}` : nextTopic.last_read_post_number ? `/t/topic/${nextTopic.id}/${nextTopic.last_read_post_number}` : `/t/topic/${nextTopic.id}`;
      const url = `${BASE_URL}${path}`;
      console.log("正在跳转到:", url);
      await this.softNavigateToTopic(path, url, targetTopicId);
    }
    stopAutoReading({ preserveSession = false } = {}) {
      this.runGeneration++;
      this.stopScrolling();
      this.stopNavigationGuard();
      this.autoRunning = false;
      if (!preserveSession) this.session.set("autoRunning", false);
      this.view.setReadingRunning(false);
      if (this.navigationTimeout) {
        this.scope.clearTimeout(this.navigationTimeout);
        this.navigationTimeout = null;
      }
      console.log("自动阅读已停止");
    }
    async loadUserReadHistory() {
      const username = await this.getCurrentUsername();
      if (!username) {
        console.log("未获取到用户名，无法加载阅读历史");
        this.readTopics = [];
        return;
      }
      const storageKey = `readTopics_${username}`;
      this.readTopics = Storage.get(storageKey, []);
      console.log(`已加载用户 ${username} 的阅读历史，共 ${this.readTopics.length} 篇帖子`);
      if (this.readTopics.length > this.totalReadCount) {
        console.log(`[数据同步] 总阅读数从 ${this.totalReadCount} 更新为 ${this.readTopics.length}`);
        this.totalReadCount = this.readTopics.length;
        Storage.set("totalReadCount", this.totalReadCount);
        this.view.updateReadStatsDisplay();
      }
    }
    async saveUserReadHistory(topicId) {
      const username = await this.getCurrentUsername();
      if (!username) {
        console.log("未获取到用户名，无法保存阅读历史");
        return;
      }
      if (!this.readTopics.includes(topicId)) {
        this.readTopics.push(topicId);
        if (this.readTopics.length > 1e3) {
          this.readTopics = this.readTopics.slice(-1e3);
        }
        const storageKey = `readTopics_${username}`;
        Storage.set(storageKey, this.readTopics);
        console.log(`已保存帖子 ${topicId} 到用户 ${username} 的阅读历史`);
      }
    }
    isTopicRead(topicId) {
      return this.readTopics.includes(topicId);
    }
    loadTodayReadCount() {
      const now = /* @__PURE__ */ new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const savedData = Storage.get("todayReadStats", null);
      console.log(`[今日阅读] 当前日期: ${today}, 保存的数据:`, savedData);
      if (savedData && savedData.date) {
        const savedDate = savedData.date;
        const isToday = savedDate === today || savedDate === now.toDateString();
        if (isToday) {
          console.log(`[今日阅读] 日期匹配，返回已保存的计数: ${savedData.count}`);
          return savedData.count;
        }
      }
      console.log(`[今日阅读] 新的一天或无数据，重置计数为0`);
      Storage.set("todayReadStats", { date: today, count: 0 });
      return 0;
    }
    incrementTodayReadCount() {
      const now = /* @__PURE__ */ new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const savedData = Storage.get("todayReadStats", null);
      if (savedData && savedData.date) {
        const savedDate = savedData.date;
        const isToday = savedDate === today || savedDate === now.toDateString();
        if (!isToday) {
          console.log(`[今日阅读] 检测到跨天！旧日期: ${savedDate}, 新日期: ${today}，重置今日计数`);
          this.todayReadCount = 0;
        }
      }
      this.todayReadCount++;
      this.totalReadCount++;
      Storage.set("todayReadStats", { date: today, count: this.todayReadCount });
      Storage.set("totalReadCount", this.totalReadCount);
      console.log(`今日已阅读 ${this.todayReadCount} 篇帖子，总阅读 ${this.totalReadCount} 篇`);
      this.view.updateReadStatsDisplay();
    }
    loadHistoricalMaxPage() {
      const today = /* @__PURE__ */ (/* @__PURE__ */ new Date()).toDateString();
      const savedData = Storage.get("historicalMaxPageData", null);
      if (savedData) {
        if (savedData.date === today) {
          console.log(`[页码续读] 今日已读最大页码: ${savedData.maxPage}`);
          return savedData.maxPage;
        }
        console.log(`[页码续读] 新的一天，继承昨日最大页码: ${savedData.maxPage}`);
        return savedData.maxPage;
      }
      return 0;
    }
    saveHistoricalMaxPage(page) {
      const today = /* @__PURE__ */ (/* @__PURE__ */ new Date()).toDateString();
      const currentMax = this.historicalMaxPage || 0;
      if (page > currentMax) {
        this.historicalMaxPage = page;
        Storage.set("historicalMaxPageData", { date: today, maxPage: page });
        console.log(`[页码续读] 更新历史最大页码: ${page}`);
      }
    }
    getStartPage() {
      if (this.lastFetchedPage > 0) {
        console.log(`[页码续读] 使用会话内上次页码: ${this.lastFetchedPage + 1}`);
        return this.lastFetchedPage + 1;
      }
      if (this.historicalMaxPage > 0) {
        console.log(`[页码续读] 使用历史最大页码: ${this.historicalMaxPage + 1}`);
        return this.historicalMaxPage + 1;
      }
      return 1;
    }
    resetPageProgress() {
      this.lastFetchedPage = 0;
      this.session.set("lastFetchedPage", 0);
      console.log("[页码续读] 已重置会话页码");
    }
    startNavigationGuard() {
      if (this.navigationGuardInterval) {
        this.scope.clearInterval(this.navigationGuardInterval);
      }
      this.pageLoadTime = Date.now();
      this.lastPageContextKey = this.getPageContextKey(window.location.href);
      this.navigationGuardInterval = this.scope.setInterval(() => {
        if (!this.autoRunning) return;
        const currentTime = Date.now();
        const timeOnPage = currentTime - this.pageLoadTime;
        const currentPageContextKey = this.getPageContextKey(window.location.href);
        if (currentPageContextKey !== this.lastPageContextKey) {
          console.log("✅ 页面已跳转，重置守护定时器");
          this.hooks.onPause("topic_changed");
          this.pageLoadTime = currentTime;
          this.lastPageContextKey = currentPageContextKey;
          this.isTopicPage = window.location.pathname.includes("/t/topic/");
          if (this.autoRunning && this.isTopicPage && !this.isScrolling) {
            console.log("🛡️ 守护检测到新文章页且未滚动，尝试恢复滚动");
            this.startScrolling();
          }
          return;
        }
        if (this.isPageLoadingStalled(timeOnPage)) {
          console.warn("⚠️ 检测到页面持续加载超时，停止自动阅读");
          this.view.showNotification(this.t("stoppedByPageLoading"));
          this.stopAutoReading();
          return;
        }
        if (this.isTopicPage && timeOnPage > 6e4 && !this.isScrolling) {
          console.warn("⚠️ 检测到页面可能卡住（60秒未跳转且未滚动），尝试恢复...");
          this.recoverFromStuck();
        }
        if (!this.isTopicPage && timeOnPage > 3e4) {
          console.warn("⚠️ 检测到在非文章页卡住，尝试恢复...");
          this.recoverFromStuck();
        }
      }, 5e3);
      console.log("🛡️ 导航守护程序已启动");
    }
    stopNavigationGuard() {
      if (this.navigationGuardInterval) {
        this.scope.clearInterval(this.navigationGuardInterval);
        this.navigationGuardInterval = null;
        console.log("🛡️ 导航守护程序已停止");
      }
    }
  };

  var createLikeCooldown = ({ storageArea, key = "likeResumeTime" } = {}) => {
    const area = resolveStorageArea(storageArea);
    return {
      load() {
        try {
          if (!area?.getItem) throw new Error("Storage unavailable");
          const raw = area?.getItem(key);
          const stored = raw ? JSON.parse(raw) : null;
          const state = { accounts: {}, legacyUntil: 0 };
          const validUntil = (value) => {
            const until = Number(value ?? 0);
            if (!Number.isFinite(until) || until < 0) {
              throw new Error("Invalid like cooldown timestamp");
            }
            return until;
          };
          if (stored && typeof stored === "object" && !Array.isArray(stored)) {
            state.legacyUntil = validUntil(stored.legacyUntil);
            if (stored.accounts != null) {
              if (typeof stored.accounts !== "object" || Array.isArray(stored.accounts)) {
                throw new Error("Invalid like cooldown accounts");
              }
              for (const [accountKey, until] of Object.entries(stored.accounts)) {
                if (/^(id|username):/.test(accountKey)) {
                  state.accounts[accountKey] = validUntil(until);
                }
              }
            }
          } else if (stored === null || typeof stored === "number") {
            state.legacyUntil = validUntil(stored);
          } else {
            throw new Error("Invalid like cooldown state");
          }
          return state;
        } catch (error) {
          console.error("[点赞冷却] 存储不可读，暂停点赞:", error);
          return null;
        }
      },
      read(accountKey) {
        const state = this.load();
        if (!state) return Infinity;
        return Math.max(state.legacyUntil, accountKey ? Number(state.accounts[accountKey]) || 0 : 0);
      },
      extend(accountKey, until) {
        const state = this.load();
        if (!state) return Infinity;
        const nextUntil = Number(until);
        if (!Number.isFinite(nextUntil) || nextUntil < 0) return Infinity;
        if (nextUntil > 0) {
          if (accountKey) {
            state.accounts[accountKey] = Math.max(Number(state.accounts[accountKey]) || 0, nextUntil);
          } else {
            state.legacyUntil = Math.max(state.legacyUntil, nextUntil);
          }
        }
        try {
          if (!area?.setItem) return Infinity;
          area.setItem(key, JSON.stringify(state));
        } catch (error) {
          console.error("[点赞冷却] 存储不可写，暂停点赞:", error);
          return Infinity;
        }
        return Math.max(state.legacyUntil, accountKey ? Number(state.accounts[accountKey]) || 0 : 0);
      },
      clear(accountKeys) {
        const state = this.load();
        if (!state) return false;
        try {
          state.legacyUntil = 0;
          const keys = Array.isArray(accountKeys) ? accountKeys : [accountKeys];
          for (const accountKey of keys) {
            if (/^(id|username):/.test(String(accountKey || ""))) {
              delete state.accounts[accountKey];
            }
          }
          if (!area?.setItem) return false;
          area.setItem(key, JSON.stringify(state));
          return true;
        } catch (error) {
          console.error("[点赞冷却] 清除失败:", error);
          return false;
        }
      },
      key,
      raw: area
    };
  };
  var LikeCooldown = createLikeCooldown();

  var SmartLikes = class {
    constructor({
      settings,
      session,
      limits,
      counter,
      getReadingState,
      onEnabledChange,
      onAccountChanged,
      notify,
      t,
      sleep = Utils.sleep
    }) {
      this.settings = settings;
      this.session = session;
      this.limits = limits;
      this.counter = counter;
      this.getReadingState = getReadingState;
      this.onEnabledChange = onEnabledChange;
      this.onAccountChanged = onAccountChanged;
      this.notify = notify;
      this.t = t;
      this.sleep = sleep;
      this.scope = new DisposableScope();
      this.currentAccount = null;
      this.currentUsername = null;
      this.smartLikeSessionId = session.get("smartLikeSessionId", null) || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
      this.smartLikeGeneration = 0;
      this.smartLikeCheckedPostIds = {};
      this.smartLikeFailedPostIds = /* @__PURE__ */ new Set();
      this.smartLikedPostIds = /* @__PURE__ */ new Map();
      this.smartLikeStorageReady = true;
      this.smartLikeActiveTask = null;
      this.smartLikeRunToken = 0;
      this.smartLikeIsScanning = false;
      this.smartLikeLastScanAt = 0;
      const lastLikeAt = Number(session.get("smartLikeLastLikeAt", 0));
      this.smartLikeLastLikeAt = Number.isFinite(lastLikeAt) && lastLikeAt > 0 ? lastLikeAt : 0;
      this.smartLikeAccountKey = null;
    }
    start() {
      if (this.smartLikeReady || this.scope.disposed) return;
      this.smartLikeReady = this.initializeSmartLikeTab();
      this.bindSmartLikeScroll();
      this.smartLikeReady.then(() => {
        if (!this.scope.disposed) this.resolveSmartLikeAccount();
      });
    }
    pauseForRateLimit() {
      this.settings.smartLikeEnabled = false;
      Storage.set("smartLikeEnabled", false);
      if (this.smartLikeActiveTask) this.smartLikeActiveTask.pendingReleased = true;
      this.cancelSmartLikeTasks("rate_limited");
      this.persistSmartLikeSession();
      this.updateSmartLikeUI();
    }
    destroy() {
      this.cancelSmartLikeTasks("destroyed");
      this.scope.dispose();
    }
    async initializeSmartLikeTab() {
      try {
        let tab = {};
        if (typeof GM_getTab === "function") {
          tab = await new Promise((resolve) => {
            const timeout = this.scope.setTimeout(() => resolve({}), 3e3);
            try {
              GM_getTab((value) => {
                this.scope.clearTimeout(timeout);
                resolve(value || {});
              });
            } catch (_) {
              this.scope.clearTimeout(timeout);
              resolve({});
            }
          });
        }
        const tabId = tab.smartLikeTabId || this.smartLikeSessionId;
        const sameTab = tabId === this.smartLikeSessionId;
        this.smartLikeSessionId = tabId;
        if (typeof GM_saveTab === "function") {
          try {
            GM_saveTab({ ...tab, smartLikeTabId: tabId });
          } catch (_) {
          }
        }
        const readObject = (key) => {
          const value = this.session.get(key, {});
          return value && typeof value === "object" && !Array.isArray(value) ? value : {};
        };
        const generation = this.session.get("smartLikeGeneration", 0);
        this.smartLikeGeneration = (Number.isSafeInteger(generation) && generation >= 0 ? generation : 0) + 1;
        if (sameTab) {
          this.smartLikeCheckedPostIds = readObject("smartLikeProcessedPostIds");
          const failed = this.session.get("smartLikeFailedPostIds", []);
          this.smartLikeFailedPostIds = new Set(
            Array.isArray(failed) ? failed.filter((key) => typeof key === "string") : []
          );
          const pending = this.session.get("smartLikePendingPostIds", []);
          if (Array.isArray(pending)) {
            for (const task of pending) {
              if (task?.phase === "requesting" && task.accountKey && task.postId) {
                this.smartLikeFailedPostIds.add(this.smartLikeDecisionKey(task.postId, task.accountKey));
              }
            }
          }
        } else {
          this.smartLikeLastLikeAt = 0;
        }
        if (!this.session.set("smartLikeSessionId", this.smartLikeSessionId) || !this.session.set("smartLikeGeneration", this.smartLikeGeneration) || !this.persistSmartLikeSession() || !this.persistSmartLikePending()) {
          throw new Error("Session storage write failed");
        }
        this.updateSmartLikeUI();
      } catch (error) {
        this.smartLikeStorageReady = false;
        this.settings.smartLikeEnabled = false;
        this.updateSmartLikeUI();
        console.error("[智能点赞] 会话存储不可用，已暂停发送:", error);
      }
    }
    smartLikeDecisionKey(postId, accountKey = this.smartLikeAccountKey) {
      return accountKey + "|" + postId;
    }
    persistSmartLikePending() {
      if (!this.isSmartLikeGenerationCurrent()) return false;
      const task = this.smartLikeActiveTask;
      const pending = task && !task.pendingReleased && this.isSmartLikeGenerationCurrent(task) ? [{ postId: task.postId, topicId: task.topicId, accountKey: task.accountKey, phase: task.phase }] : [];
      if (!this.session.set("smartLikePendingPostIds", pending)) this.smartLikeStorageReady = false;
      return this.smartLikeStorageReady;
    }
    updateSmartLikeUI() {
      this.onEnabledChange(this.settings.smartLikeEnabled);
    }
    setSmartLikeEnabled(enabled) {
      if (this.scope.disposed) return false;
      const next = !!enabled;
      if (next && this.limits.isLikeCoolingDown()) {
        this.settings.smartLikeEnabled = false;
        Storage.set("smartLikeEnabled", false);
        this.updateSmartLikeUI();
        this.notify(
          Number.isFinite(this.limits.getLikeResumeTime()) ? `${this.t("likeCoolingDown")}，${new Date(this.limits.getLikeResumeTime()).toLocaleTimeString()}` : "点赞状态暂不可用，智能点赞已关闭"
        );
        return false;
      }
      if (next && !this.smartLikeStorageReady) {
        this.notify("点赞会话存储不可用，请恢复存储后刷新页面");
        this.updateSmartLikeUI();
        return false;
      }
      this.settings.smartLikeEnabled = next;
      Storage.set("smartLikeEnabled", next);
      if (!next) this.cancelSmartLikeTasks("disabled");
      this.updateSmartLikeUI();
      if (next && this.getReadingState().autoRunning && this.getSmartLikeTopicId())
        this.scheduleSmartLikeScan();
      return true;
    }
    getSmartLikeSpeedConfig() {
      const probability = { slow: 0.05, normal: 0.15, fast: 0.25 }[this.settings.smartLikeSpeed] ?? 0.15;
      return { probability, minWait: 200, maxWait: 500 };
    }
    persistSmartLikeSession() {
      if (!this.isSmartLikeGenerationCurrent()) return false;
      const results = [
        this.session.set("smartLikeProcessedPostIds", this.smartLikeCheckedPostIds),
        this.session.set("smartLikeFailedPostIds", Array.from(this.smartLikeFailedPostIds)),
        this.session.set("smartLikeLastLikeAt", this.smartLikeLastLikeAt)
      ];
      if (results.some((result) => !result)) this.smartLikeStorageReady = false;
      return this.smartLikeStorageReady;
    }
    getSmartLikePostId(post) {
      const id = post?.dataset?.postId || post?.querySelector("article[data-post-id]")?.dataset.postId;
      return /^\d+$/.test(String(id || "")) ? String(id) : "";
    }
    getSmartLikeTopicId() {
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts[0] !== "t") return "";
      const id = /^\d+$/.test(parts[1] || "") ? parts[1] : parts[2];
      return /^\d+$/.test(id || "") ? id : "";
    }
    async resolveSmartLikeAccount(force = false) {
      if (this.scope.disposed) return null;
      if (this.smartLikeAccountRequest) return this.smartLikeAccountRequest;
      const now = Date.now();
      if (!force && now - (this.smartLikeAccountCheckedAt || 0) < 3e4) return this.currentAccount;
      if (Storage.get("session429Until", 0) > now) return null;
      this.smartLikeAccountRequest = (async () => {
        let user = null;
        try {
          const response = await fetch(`${BASE_URL}/session/current.json`, {
            credentials: "include",
            cache: "no-store",
            signal: AbortSignal.timeout(1e4)
          });
          if (response.status === 429) Storage.set("session429Until", Date.now() + 30 * 60 * 1e3);
          if (response.ok) user = (await response.json())?.current_user || null;
        } catch (_) {
        }
        if (this.scope.disposed) return null;
        const id = Number(user?.id ?? user?.user_id);
        const username = typeof user?.username === "string" ? user.username.trim().replace(/^@/, "").trim().toLowerCase() : "";
        const key = Number.isSafeInteger(id) && id > 0 ? `id:${id}` : username ? `username:${username}` : null;
        if (this.smartLikeAccountKey !== key) {
          this.cancelSmartLikeTasks("account_changed");
        }
        this.smartLikeAccountKey = key;
        this.currentAccount = key ? { id, username, key } : null;
        this.smartLikeAccountCheckedAt = Date.now();
        if (key?.startsWith("id:") && username) {
          const usernameKey = `username:${username}`;
          const usernameUntil = LikeCooldown.read(usernameKey);
          if (usernameUntil > LikeCooldown.read(key)) LikeCooldown.extend(key, usernameUntil);
          const prefix = `${usernameKey}|`;
          let merged = false;
          for (const [oldKey, value] of Object.entries(this.smartLikeCheckedPostIds)) {
            const newKey = `${key}|${oldKey.slice(prefix.length)}`;
            if (oldKey.startsWith(prefix) && !Object.hasOwn(this.smartLikeCheckedPostIds, newKey)) {
              this.smartLikeCheckedPostIds[newKey] = { ...value };
              merged = true;
            }
          }
          for (const oldKey of Array.from(this.smartLikeFailedPostIds)) {
            const newKey = `${key}|${oldKey.slice(prefix.length)}`;
            if (oldKey.startsWith(prefix) && !this.smartLikeFailedPostIds.has(newKey)) {
              this.smartLikeFailedPostIds.add(newKey);
              merged = true;
            }
          }
          if (merged) this.persistSmartLikeSession();
        }
        this.counter?.setCurrentUser(key ? user : null);
        this.currentUsername = key ? username : null;
        this.onAccountChanged(this.currentAccount);
        if (key) {
          this.loadSmartLikedPosts();
          if (this.limits.isLikeCoolingDown() && this.settings.smartLikeEnabled)
            this.setSmartLikeEnabled(false);
        }
        return this.currentAccount;
      })();
      try {
        return await this.smartLikeAccountRequest;
      } catch (error) {
        this.smartLikeStorageReady = false;
        console.error("[智能点赞] 账号记录不可用，已暂停发送:", error);
        return null;
      } finally {
        this.smartLikeAccountRequest = null;
      }
    }
    getSmartLikeStorageKey() {
      return this.smartLikeAccountKey ? `smartLikedPostIds_${encodeURIComponent(this.smartLikeAccountKey)}` : null;
    }
    loadSmartLikedPosts() {
      this.smartLikedPostIds = /* @__PURE__ */ new Map();
      const key = this.getSmartLikeStorageKey();
      if (!key) return;
      const entries = this.readSmartLikedRecords(this.smartLikeAccountKey);
      const kept = entries.sort((a, b) => a.recordedAt - b.recordedAt).slice(-5e3);
      this.smartLikedPostIds = new Map(kept.map((item) => [item.postId, item.recordedAt]));
    }
    readSmartLikedRecords(accountKey) {
      if (!accountKey) return [];
      const keys = [`smartLikedPostIds_${encodeURIComponent(accountKey)}`];
      if (accountKey === this.currentAccount?.key && accountKey.startsWith("id:") && this.currentAccount.username) {
        keys.push(`smartLikedPostIds_${encodeURIComponent(`username:${this.currentAccount.username}`)}`);
      }
      const records = /* @__PURE__ */ new Map();
      for (const key of keys) {
        const entries = JSON.parse(localStorage.getItem(key) || "[]");
        if (!Array.isArray(entries)) throw new Error("Invalid liked post history");
        for (const item of entries) {
          const postId = String(item?.postId || "");
          const recordedAt = Number(item?.recordedAt);
          if (/^\d+$/.test(postId) && Number.isFinite(recordedAt) && recordedAt > 0 && (!records.has(postId) || recordedAt < records.get(postId))) {
            records.set(postId, recordedAt);
          }
        }
      }
      return Array.from(records, ([postId, recordedAt]) => ({ postId, recordedAt }));
    }
    recordLikedPost(postId, accountKey = this.smartLikeAccountKey) {
      if (!accountKey || !postId) return false;
      const key = `smartLikedPostIds_${encodeURIComponent(accountKey)}`;
      let entries;
      try {
        entries = this.readSmartLikedRecords(accountKey);
      } catch (error) {
        this.smartLikeStorageReady = false;
        console.error("[智能点赞] 无法读取成功记录，已暂停后续发送:", error);
        return false;
      }
      const map = /* @__PURE__ */ new Map();
      for (const item of [...entries, { postId: String(postId), recordedAt: Date.now() }]) {
        const id = String(item?.postId || "");
        const time = Number(item?.recordedAt);
        if (!/^\d+$/.test(id) || !Number.isFinite(time) || time <= 0) continue;
        if (!map.has(id) || time < map.get(id)) map.set(id, time);
      }
      const kept = Array.from(map.entries()).filter(([post, time]) => post && Number.isFinite(time)).sort((a, b) => a[1] - b[1]).slice(-5e3).map(([post, time]) => ({ postId: post, recordedAt: time }));
      const saved = Storage.set(key, kept);
      if (!saved) {
        this.smartLikeStorageReady = false;
        console.error("[智能点赞] 成功记录保存失败，已暂停后续发送");
      }
      if (accountKey === this.smartLikeAccountKey)
        this.smartLikedPostIds = new Map(kept.map((item) => [item.postId, item.recordedAt]));
      return saved;
    }
    markSmartLikeChecked(postId, decision, reason = "", accountKey = this.smartLikeAccountKey) {
      this.smartLikeCheckedPostIds[this.smartLikeDecisionKey(postId, accountKey)] = {
        decision,
        reason,
        at: Date.now()
      };
      this.persistSmartLikeSession();
    }
    getSmartLikeReactionState(post) {
      if (!post?.isConnected) return "unknown";
      const actions = post.querySelector(".discourse-reactions-actions");
      const button = post.querySelector(
        'button[title="点赞此帖子"], button[title="Like this post"], button.btn-toggle-reaction-like'
      );
      if (actions?.classList.contains("has-used-main-reaction") || button && (button.getAttribute("aria-pressed") === "true" || ["has-like", "my-likes", "liked"].some((name) => button.classList.contains(name))))
        return "heart_active";
      if (actions && /reacted/i.test(actions.className)) return "other_reaction";
      if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return "unknown";
      return "none";
    }
    isSmartLikeGenerationCurrent(task = { sessionId: this.smartLikeSessionId, generation: this.smartLikeGeneration }) {
      return task.sessionId === this.smartLikeSessionId && task.generation === this.smartLikeGeneration && task.sessionId === this.session.get("smartLikeSessionId") && task.generation === this.session.get("smartLikeGeneration");
    }
    canRunLikeFlow(task = null) {
      if (this.scope.disposed || !this.smartLikeStorageReady || !this.isSmartLikeGenerationCurrent() || !this.settings.smartLikeEnabled || !this.getReadingState().autoRunning || !this.getReadingState().isScrolling || !this.smartLikeAccountKey || !this.getSmartLikeTopicId() || this.limits.isLikeCoolingDown())
        return false;
      if (task && (!this.isSmartLikeGenerationCurrent(task) || task.runToken !== this.smartLikeRunToken || task.accountKey !== this.smartLikeAccountKey || task.topicId !== this.getSmartLikeTopicId()))
        return false;
      return true;
    }
    shouldLikePost() {
      return this.settings.smartLikeEnabled && Date.now() - this.smartLikeLastLikeAt >= 2e3 && Math.random() < this.getSmartLikeSpeedConfig().probability;
    }
    async tryLikePost(post, task) {
      const key = this.smartLikeDecisionKey(task.postId, task.accountKey);
      const canAttempt = () => this.canRunLikeFlow(task) && post.isConnected && this.getSmartLikePostId(post) === task.postId && this.isLikeAllowedInCurrentCategory()?.allowed === true;
      const run = async () => {
        this.loadSmartLikedPosts();
        if (!canAttempt() || this.smartLikedPostIds.has(task.postId) || this.smartLikeFailedPostIds.has(key))
          return;
        const state = this.getSmartLikeReactionState(post);
        if (state !== "none") {
          if (state !== "unknown") this.markSmartLikeChecked(task.postId, "skip", state);
          return;
        }
        const { minWait, maxWait } = this.getSmartLikeSpeedConfig();
        await this.sleep(Utils.random(minWait, maxWait));
        if (!canAttempt() || this.getSmartLikeReactionState(post) !== "none") return;
        this.loadSmartLikedPosts();
        if (this.smartLikedPostIds.has(task.postId)) return;
        this.smartLikeActiveTask = task;
        task.phase = "requesting";
        if (!this.persistSmartLikePending()) return;
        const result = await this.sendLikeRequest(task.postId, task);
        const sameSession = this.isSmartLikeGenerationCurrent(task);
        if (result.success) {
          this.recordLikedPost(task.postId, task.accountKey);
          if (sameSession) {
            this.smartLikeLastLikeAt = Date.now();
            this.markSmartLikeChecked(task.postId, "success", "http_success", task.accountKey);
          }
          console.log("[智能点赞] 点赞成功，帖子 ID=" + task.postId);
        } else if (result.rateLimited) {
          this.limits.handleSmartLike429(result.waitSeconds, result.timeLeft, result.url, "PUT", {
            accountKey: task.accountKey,
            retryAfter: result.retryAfter,
            responseAt: result.responseAt
          });
        } else if (sameSession && !result.cancelled) {
          this.smartLikeFailedPostIds.add(key);
          this.markSmartLikeChecked(task.postId, "failed", result.reason || "request_failed", task.accountKey);
          console.warn("[智能点赞] 点赞请求失败，帖子 ID=" + task.postId);
        }
      };
      try {
        if (typeof navigator.locks?.request === "function") {
          await navigator.locks.request("smart-like:" + task.accountKey, { mode: "exclusive" }, run);
        } else {
          await run();
        }
      } catch (error) {
        if (task.phase === "requesting" && this.isSmartLikeGenerationCurrent(task)) {
          this.smartLikeFailedPostIds.add(key);
          this.persistSmartLikeSession();
        }
        console.error("[智能点赞] 处理帖子失败:", error);
      } finally {
        if (this.smartLikeActiveTask === task) this.smartLikeActiveTask = null;
        this.persistSmartLikePending();
      }
    }
    async sendLikeRequest(postId, task) {
      if (!this.canRunLikeFlow(task)) return { success: false, cancelled: true };
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
      if (!csrfToken) return { success: false, cancelled: true };
      const url = BASE_URL + "/discourse-reactions/posts/" + encodeURIComponent(postId) + "/custom-reactions/heart/toggle.json";
      if (!isHeartToggleUrl(url, "PUT")) return { success: false, cancelled: true };
      const controller = new AbortController();
      const timeout = this.scope.setTimeout(() => controller.abort(), 15e3);
      try {
        const response = await fetch(url, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          signal: controller.signal
        });
        if (response.ok) return { success: true };
        const data = await response.json().catch(() => ({}));
        if (response.status === 429 || data?.error_type === "rate_limit") {
          return {
            success: false,
            rateLimited: true,
            url,
            waitSeconds: data?.extras?.wait_seconds,
            timeLeft: data?.extras?.time_left,
            retryAfter: response.headers?.get?.("Retry-After"),
            responseAt: Date.now()
          };
        }
        return { success: false, reason: "http_" + response.status };
      } catch (error) {
        return { success: false, reason: error?.name === "AbortError" ? "timeout" : "network_error" };
      } finally {
        this.scope.clearTimeout(timeout);
      }
    }
    async scanSmartLikePosts() {
      await this.smartLikeReady;
      if (this.scope.disposed || this.smartLikeIsScanning || !this.smartLikeStorageReady || !this.isSmartLikeGenerationCurrent() || !this.settings.smartLikeEnabled || !this.getReadingState().autoRunning || !this.getReadingState().isScrolling || !this.getSmartLikeTopicId())
        return;
      this.smartLikeIsScanning = true;
      this.smartLikeLastScanAt = Date.now();
      try {
        await this.resolveSmartLikeAccount();
        if (!this.canRunLikeFlow() || this.isLikeAllowedInCurrentCategory()?.allowed !== true) return;
        const topicId = this.getSmartLikeTopicId();
        const runToken = this.smartLikeRunToken;
        const height = window.innerHeight || document.documentElement.clientHeight;
        for (const post of document.querySelectorAll('article[id^="post_"]')) {
          if (!this.canRunLikeFlow() || runToken !== this.smartLikeRunToken || topicId !== this.getSmartLikeTopicId())
            break;
          const postId = this.getSmartLikePostId(post);
          const key = this.smartLikeDecisionKey(postId);
          if (!postId || this.smartLikeCheckedPostIds[key] || this.smartLikeFailedPostIds.has(key) || this.smartLikedPostIds?.has(postId))
            continue;
          const rect = post.getBoundingClientRect();
          if (rect.top >= height * 0.9 || rect.bottom <= height * 0.1) continue;
          const state = this.getSmartLikeReactionState(post);
          if (state === "unknown") continue;
          if (state !== "none") {
            this.markSmartLikeChecked(postId, "skip", state);
            continue;
          }
          this.markSmartLikeChecked(postId, "viewed", "probability_or_interval");
          if (!this.shouldLikePost()) continue;
          await this.tryLikePost(post, {
            postId,
            topicId,
            accountKey: this.smartLikeAccountKey,
            sessionId: this.smartLikeSessionId,
            generation: this.smartLikeGeneration,
            runToken,
            createdAt: Date.now(),
            phase: "waiting"
          });
        }
      } catch (error) {
        console.error("[智能点赞] 扫描帖子失败:", error);
      } finally {
        this.smartLikeIsScanning = false;
      }
    }
    cancelSmartLikeTasks() {
      this.smartLikeRunToken++;
      this.scope.clearTimeout(this.smartLikeScanTimer);
      this.smartLikeScanTimer = null;
      this.persistSmartLikePending();
    }
    scheduleSmartLikeScan() {
      if (this.scope.disposed || this.smartLikeScanTimer) return;
      const delay = Math.max(0, 2e3 - (Date.now() - this.smartLikeLastScanAt));
      this.smartLikeScanTimer = this.scope.setTimeout(() => {
        this.smartLikeScanTimer = null;
        this.scanSmartLikePosts();
      }, delay);
    }
    bindSmartLikeScroll() {
      if (this.smartLikeScrollBound) return;
      this.smartLikeScrollBound = true;
      this.scope.listen(
        window,
        "scroll",
        () => {
          if (this.settings.smartLikeEnabled && this.getReadingState().autoRunning && this.getReadingState().isScrolling)
            this.scheduleSmartLikeScan();
        },
        { passive: true }
      );
      this.scope.listen(window, "pagehide", () => this.cancelSmartLikeTasks("pagehide"));
      this.scope.listen(window, "storage", (event) => {
        if (event.key === "likeResumeTime") {
          this.counter?.loadState();
          this.counter?.notifyUIUpdate();
          if (this.limits.isLikeCoolingDown()) this.setSmartLikeEnabled(false);
        } else if (event.key === "smartLikeEnabled" && event.newValue === "false") {
          this.setSmartLikeEnabled(false);
        }
      });
    }
    isLikeAllowedInCurrentCategory() {
      if (CURRENT_DOMAIN === "idcflare.com") {
        return { allowed: true, reason: "idcflare_no_restriction" };
      }
      const config = CONFIG.likeAllowedCategories;
      if (!config || !config.allowed || config.allowed.length === 0) {
        return { allowed: true, reason: "no_config" };
      }
      let subcategory = null;
      let parentCategory = null;
      const topicCategory = document.querySelector(".topic-category");
      if (topicCategory) {
        const badges = topicCategory.querySelectorAll(".badge-category__name, .category-name");
        const names = [];
        badges.forEach((badge) => {
          const name = badge.textContent?.trim();
          if (name) names.push(name);
        });
        if (names.length >= 2) {
          subcategory = names[0];
          parentCategory = names[1];
        } else if (names.length === 1) {
          parentCategory = names[0];
        }
      }
      if (!parentCategory) {
        const headerCategory = document.querySelector(".extra-info-wrapper .badge-category__name");
        if (headerCategory) {
          parentCategory = headerCategory.textContent?.trim();
        }
      }
      const detectedCategories = [];
      if (subcategory) detectedCategories.push(subcategory);
      if (parentCategory) detectedCategories.push(parentCategory);
      if (detectedCategories.length === 0) {
        console.log("[板块检查] 无法获取当前板块信息，默认不允许点赞");
        return { allowed: false, reason: "category_not_found", categories: [] };
      }
      if (detectedCategories.some((name) => config.excluded?.includes(name))) {
        return { allowed: false, reason: "excluded", categories: detectedCategories };
      }
      console.log(
        "[板块检查] 检测到板块:",
        detectedCategories.join(" > "),
        subcategory ? `(子版块: ${subcategory}, 父版块: ${parentCategory})` : `(顶级板块: ${parentCategory})`
      );
      if (subcategory) {
        if (config.excluded && config.excluded.includes(subcategory)) {
          console.log(`[板块检查] 子版块 "${subcategory}" 在排除列表中，不允许点赞`);
          return {
            allowed: false,
            reason: "subcategory_excluded",
            category: subcategory,
            categories: detectedCategories
          };
        }
        if (config.allowed.includes(subcategory)) {
          console.log(`[板块检查] 子版块 "${subcategory}" 在允许列表中，允许点赞`);
          return {
            allowed: true,
            reason: "subcategory_allowed",
            category: subcategory,
            categories: detectedCategories
          };
        }
        if (parentCategory && config.allowed.includes(parentCategory)) {
          console.log(
            `[板块检查] 子版块 "${subcategory}" 不在允许列表，父版块 "${parentCategory}" 在允许列表中，允许点赞`
          );
          return {
            allowed: true,
            reason: "parent_allowed",
            category: parentCategory,
            subcategory,
            categories: detectedCategories
          };
        }
        console.log(
          `[板块检查] 子版块 "${subcategory}" 和父版块 "${parentCategory}" 都不在允许列表中，不允许点赞`
        );
        return { allowed: false, reason: "not_in_allowed_list", categories: detectedCategories };
      } else {
        if (config.excluded && config.excluded.includes(parentCategory)) {
          console.log(`[板块检查] 板块 "${parentCategory}" 在排除列表中，不允许点赞`);
          return {
            allowed: false,
            reason: "excluded",
            category: parentCategory,
            categories: detectedCategories
          };
        }
        if (config.allowed.includes(parentCategory)) {
          console.log(`[板块检查] 板块 "${parentCategory}" 在允许列表中，允许点赞`);
          return { allowed: true, reason: "allowed", category: parentCategory, categories: detectedCategories };
        }
        console.log(`[板块检查] 板块 "${parentCategory}" 不在允许列表中，不允许点赞`);
        return { allowed: false, reason: "not_in_allowed_list", categories: detectedCategories };
      }
    }
  };

  var RateLimit = class {
    constructor({
      getAccountContext,
      onLikeLimited,
      onCooldownChanged,
      onIpLimited,
      onIpRecovered,
      notify,
      t
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
      this.likePeriods = /* @__PURE__ */ new Map();
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
      const keys = /* @__PURE__ */ new Set([primaryKey]);
      const usernames = [];
      if (context.counterKey === primaryKey) usernames.push(context.counterUsername);
      if (context.key === primaryKey) usernames.push(context.username);
      for (const username of usernames) {
        const normalized = String(username || "").trim().replace(/^@/, "").trim().toLowerCase();
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
          `[点赞冷却] 将于 ${new Date(this.getLikeResumeTime()).toLocaleString()} 结束，结束后需手动开启智能点赞`
        );
      }
    }
    detectIpRateLimit() {
      const isNormalPage = document.querySelector("#main-outlet") || document.querySelector(".topic-list") || document.querySelector(".topic-post") || document.querySelector(".d-header") || document.querySelector(".ember-application") || document.querySelector("[data-discourse-helper]");
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
        "HTTP 429"
      ];
      const isRateLimited = rateLimitIndicators.some((indicator) => pageText.includes(indicator));
      const pageTitle = document.title || "";
      const titleRateLimited = pageTitle.includes("Rate Limited") || pageTitle.includes("429") || pageTitle.includes("Banned");
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
        const isNormalPage = document.querySelector("#main-outlet") || document.querySelector(".topic-list") || document.querySelector(".topic-post") || document.querySelector(".d-header") || document.querySelector(".ember-application");
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
            `[IP限流] IP 限流中，还需约 ${remainingMinutes} 分钟，将在 ${resumeTime.toLocaleString()} 后恢复`
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
              const isModalElement = node.classList.contains("modal") || node.classList.contains("d-modal") || node.classList.contains("bootbox") || node.classList.contains("dialog-body") || node.classList.contains("popup-menu") || node.closest?.(".modal, .d-modal, .bootbox, .dialog-container, .fk-d-modal") || node.querySelector?.(".modal, .d-modal, .bootbox, .dialog-body, .fk-d-modal__inner");
              if (!isModalElement) {
                continue;
              }
              const text = node.textContent || "";
              const isLikeLimit = (text.includes("点赞上限") || text.includes("分享很多爱") || text.includes("点赞") && /(?:小时|分钟)后再次点赞/.test(text)) && !text.includes("回复") && !text.includes("创建更多新回复");
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
        subtree: true
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
          startedAt: Date.now()
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
            responseAt: context.responseAt
          }
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
            } catch (_) {
            }
          } else {
            try {
              data = response.responseType === "json" ? response.response : JSON.parse(response.responseText);
            } catch (_) {
            }
          }
          const retryAfter = request.transport === "fetch" ? response.headers?.get?.("Retry-After") : response.getResponseHeader?.("Retry-After");
          handleResponse(context, response.status, data, retryAfter);
        }
      });
      console.log("[点赞限制] 已启用共享网络拦截器");
    }
    handleSmartLike429(waitSeconds, timeLeft, sourceUrl, sourceMethod = "PUT", options = {}) {
      if (this.scope.disposed) return false;
      if (!isHeartToggleUrl(sourceUrl, sourceMethod)) return false;
      const now = Date.now();
      const accountKey = Object.prototype.hasOwnProperty.call(options, "accountKey") ? options.accountKey : this.getAccountContext().key;
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
        dialogDisplayTime = waitMinutes >= 60 ? `${Math.floor(waitMinutes / 60)}${this.t("hours")}${waitMinutes % 60 > 0 ? waitMinutes % 60 + this.t("minutes") : ""}`.trim() : `${waitMinutes}${this.t("minutes")}`;
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
        const display = options.fromDialog && dialogDisplayTime ? dialogDisplayTime : timeLeft || `${Math.ceil((resumeTime - now) / 6e4)}${this.t("minutes")}`;
        this.notify(`${this.t("likeLimitReached")}${display}`);
        console.warn(`[点赞限制] 已进入冷却，至 ${new Date(resumeTime).toLocaleString()}`);
      } else {
        this.notify("点赞状态暂不可用，智能点赞已关闭");
      }
      return resumeTime;
    }
    handleLikeLimit(text) {
      const context = this._lastHeartRequestContext;
      if (!context?.accountKey || context.accountKey !== this.getAccountContext().key || !isHeartToggleUrl(context.url, context.method) || Date.now() - (context.responseAt || context.startedAt) > 3e3)
        return false;
      if (!/(点赞上限|分享很多爱|点赞.*(?:分钟|小时).*点赞)/.test(String(text || ""))) return false;
      return this.handleSmartLike429(null, text, context.url, context.method, {
        accountKey: context.accountKey,
        retryAfter: context.retryAfter,
        responseAt: context.responseAt,
        fromDialog: true
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
        ".modal-header .close"
      ];
      for (const selector of buttonSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element.offsetParent === null) continue;
          const text = (element.textContent || "").trim();
          if (selector.includes("btn-primary") || text.includes("确定") || text.includes("OK") || text.includes("关闭") || text.includes("好") || element.classList.contains("modal-close") || element.classList.contains("close-modal") || element.classList.contains("d-modal__dismiss")) {
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
            if (text.includes("确定") || text.includes("OK") || text.includes("关闭") || text.includes("好") || btn.classList.contains("btn-primary")) {
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
          bubbles: true
        })
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
  };

  var RequestManagerClass = class {
    constructor({ storage = Storage, utils = Utils } = {}) {
      this.storage = storage;
      this.utils = utils;
      this._lastRequestAt = /* @__PURE__ */ new Map();
      this._inFlight = /* @__PURE__ */ new Map();
    }
    async run(key, requestFn, options = {}) {
      const {
        minInterval = 1200,
        retries = 1,
        backoffBase = 1200,
        jitter = 250,
        cooldownKey = null,
        cooldownMs = 30 * 60 * 1e3
      } = options;
      if (this._inFlight.has(key)) {
        return this._inFlight.get(key);
      }
      const runner = (async () => {
        if (cooldownKey) {
          const cooldownUntil = this.storage.get(cooldownKey, 0);
          if (cooldownUntil > Date.now()) return null;
        }
        const lastAt = this._lastRequestAt.get(key) || 0;
        const elapsed = Date.now() - lastAt;
        const waitMs = minInterval - elapsed + this.utils.random(0, jitter);
        if (waitMs > 0) await this.utils.sleep(waitMs);
        let attempt = 0;
        while (attempt <= retries) {
          try {
            this._lastRequestAt.set(key, Date.now());
            return await requestFn();
          } catch (error) {
            const msg = String(error?.message || "");
            const is429 = msg.includes("429") || msg.toLowerCase().includes("rate");
            if (is429 && cooldownKey) {
              this.storage.set(cooldownKey, Date.now() + cooldownMs);
            }
            if (attempt >= retries) throw error;
            const backoff = backoffBase * Math.pow(2, attempt) + this.utils.random(100, 600);
            await this.utils.sleep(backoff);
            attempt++;
          }
        }
        return null;
      })();
      this._inFlight.set(key, runner);
      try {
        return await runner;
      } finally {
        this._inFlight.delete(key);
      }
    }
    clear(key) {
      if (key === void 0) {
        this._lastRequestAt.clear();
        this._inFlight.clear();
        return;
      }
      this._lastRequestAt.delete(key);
      this._inFlight.delete(key);
    }
  };
  var RequestManager = new RequestManagerClass();

  var LikeCounter = class {
    constructor({ autoStart = true } = {}) {
      this.scope = new DisposableScope();
      this.CONFIG = {
        STORAGE_KEY: `linuxdo_likes_counter_${CURRENT_DOMAIN}`,
        SYNC_INTERVAL: 30 * 60 * 1e3,
        MAX_STORED_ITEMS: 500,
        LIMITS: { 0: 50, 1: 50, 2: 75, 3: 100, 4: 150 }
      };
      this.state = {
        timestamps: [],
        cooldownUntil: 0,
        lastSync: 0,
        matched: true,
        userTrustLevel: null
      };
      this.currentUser = null;
      this.accountKey = null;
      this.accountGeneration = 0;
      this.uiUpdateCallbacks = [];
      this.syncTimer = null;
      this.loadState();
      if (autoStart) this.start();
    }
    start() {
      if (this.started || this.scope.disposed) return;
      this.started = true;
      this.installInterceptors();
      this.startPeriodicSync();
    }
    destroy() {
      this.accountGeneration++;
      this._likeInterceptorUnsubscribe?.();
      this.scope.dispose();
      this.uiUpdateCallbacks = [];
    }
    getAccountKey(user) {
      const id = Number(user?.id ?? user?.user_id);
      if (Number.isSafeInteger(id) && id > 0) return `id:${id}`;
      const username = String(user?.username || "").trim().replace(/^@/, "").trim().toLowerCase();
      return username ? `username:${username}` : null;
    }
    getAccountStorageKey() {
      return this.accountKey ? `${this.CONFIG.STORAGE_KEY}_${encodeURIComponent(this.accountKey)}` : null;
    }
    createEmptyState() {
      return { timestamps: [], cooldownUntil: 0, lastSync: 0, matched: false, userTrustLevel: null };
    }
    loadState() {
      this.state = this.createEmptyState();
      const storageKey = this.getAccountStorageKey();
      if (!storageKey) return;
      try {
        const stored = GM_getValue(storageKey, "{}");
        const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
        this.state.timestamps = Array.isArray(parsed?.timestamps) ? parsed.timestamps.filter((ts) => Number.isFinite(ts) && ts > 0).slice(0, this.CONFIG.MAX_STORED_ITEMS) : [];
        this.state.lastSync = Number(parsed?.lastSync) || 0;
        this.state.matched = parsed?.matched === true;
        this.state.userTrustLevel = parsed?.userTrustLevel ?? null;
      } catch (e) {
        console.error("[LikeCounter] 加载状态失败:", e);
      }
      this.cleanOldEntries();
    }
    saveState() {
      const storageKey = this.getAccountStorageKey();
      if (!storageKey) return false;
      try {
        const { timestamps, lastSync, matched, userTrustLevel } = this.state;
        GM_setValue(storageKey, JSON.stringify({ timestamps, lastSync, matched, userTrustLevel }));
        return true;
      } catch (e) {
        console.error("[LikeCounter] 保存状态失败:", e);
        return false;
      }
    }
    cleanOldEntries() {
      const now = Date.now();
      const cutoff = now - 24 * 60 * 60 * 1e3;
      this.state.cooldownUntil = this.accountKey ? LikeCooldown.read(this.accountKey) : 0;
      this.state.timestamps = this.state.timestamps.filter((ts) => ts > cutoff);
      this.state.timestamps.sort((a, b) => b - a);
      if (this.state.cooldownUntil > 0 && this.state.cooldownUntil < now) {
        const expectedBase = this.state.cooldownUntil - 24 * 60 * 60 * 1e3;
        const beforeCount = this.state.timestamps.length;
        this.state.timestamps = this.state.timestamps.filter(
          (ts) => ts < expectedBase || ts >= expectedBase + 5e3
        );
        if (this.state.timestamps.length < beforeCount) {
          this.checkAndUpdateMismatch();
        }
        this.state.cooldownUntil = 0;
      }
    }
    checkAndUpdateMismatch() {
      const limit = this.getDailyLimit();
      const count = this.state.timestamps.length;
      this.state.matched = count >= limit || this.state.lastSync === 0 || this.state.lastSync > 0 && count === 0;
    }
    getDailyLimit() {
      if (this.currentUser && this.CONFIG.LIMITS[this.currentUser.trust_level] !== void 0) {
        return this.CONFIG.LIMITS[this.currentUser.trust_level];
      }
      if (this.state.userTrustLevel !== null && this.CONFIG.LIMITS[this.state.userTrustLevel] !== void 0) {
        return this.CONFIG.LIMITS[this.state.userTrustLevel];
      }
      try {
        const username = this.currentUser?.username;
        if (username) {
          const cacheKey = `trustLevelCache_${CURRENT_DOMAIN}_${username}`;
          const cachedData = Storage.get(cacheKey, null);
          if (cachedData?.currentLevel !== void 0) {
            const level = parseInt(cachedData.currentLevel);
            if (this.CONFIG.LIMITS[level] !== void 0) {
              return this.CONFIG.LIMITS[level];
            }
          }
        }
      } catch (e) {
      }
      return 50;
    }
    getRemainingLikes() {
      this.cleanOldEntries();
      const limit = this.getDailyLimit();
      const used = this.state.timestamps.length;
      return Math.max(0, limit - used);
    }
    getUsedLikes() {
      this.cleanOldEntries();
      return this.state.timestamps.length;
    }
    isInCooldown() {
      return this.state.cooldownUntil > Date.now();
    }
    getCooldownRemaining() {
      if (!this.isInCooldown()) return 0;
      return Math.max(0, this.state.cooldownUntil - Date.now());
    }
    formatCooldown() {
      const diff = this.getCooldownRemaining();
      if (!Number.isFinite(diff)) return "暂不可用";
      if (diff <= 0) return null;
      const h = Math.floor(diff / 36e5);
      const m = Math.floor(diff % 36e5 / 6e4);
      const s = Math.floor(diff % 6e4 / 1e3);
      if (h > 0) {
        return `${h}小时${String(m).padStart(2, "0")}分${String(s).padStart(2, "0")}秒`;
      }
      return `${String(m).padStart(2, "0")}分${String(s).padStart(2, "0")}秒`;
    }
    processToggleResponse(url, data, method = "PUT", accountKey = this.accountKey, accountGeneration = this.accountGeneration, status = 0) {
      if (!isHeartToggleUrl(url, method) || !accountKey || accountKey !== this.accountKey || accountGeneration !== this.accountGeneration)
        return;
      this.loadState();
      const now = Date.now();
      const succeeded = status >= 200 && status < 300;
      const hasReaction = data != null && Object.prototype.hasOwnProperty.call(data, "current_user_reaction");
      if (!succeeded && (status === 429 || data?.error_type === "rate_limit")) {
        const waitSeconds = data?.extras?.wait_seconds || 0;
        if (waitSeconds > 0) {
          const cooldownUntil = now + waitSeconds * 1e3;
          this.state.cooldownUntil = LikeCooldown.extend(accountKey, cooldownUntil);
          console.log(`[LikeCounter] 触发限流，冷却 ${waitSeconds} 秒`);
        }
        const limit = this.getDailyLimit();
        const currentCount = this.state.timestamps.length;
        this.state.matched = currentCount >= limit;
        if (currentCount < limit && waitSeconds > 0) {
          const needed = limit - currentCount;
          const placeholderBaseTime = now + waitSeconds * 1e3 - 24 * 60 * 60 * 1e3;
          const safeNeeded = Math.min(needed, 200);
          for (let i = 0; i < safeNeeded; i++) {
            this.state.timestamps.push(placeholderBaseTime + i);
          }
          this.state.timestamps.sort((a, b) => b - a);
        }
      } else if (succeeded && (!hasReaction || !!data.current_user_reaction)) {
        this.state.timestamps.push(now);
        console.log(`[LikeCounter] 记录点赞，当前已用 ${this.state.timestamps.length}/${this.getDailyLimit()}`);
      } else {
        console.log("[LikeCounter] 请求失败或心形反应未激活，忽略本次响应");
      }
      this.saveState();
      this.notifyUIUpdate();
    }
    installInterceptors() {
      const self = this;
      this._likeInterceptorUnsubscribe?.();
      this._likeInterceptorUnsubscribe = networkInterceptor.register({
        beforeRequest(request) {
          if (!isHeartToggleUrl(request.url, request.method)) return null;
          return {
            accountKey: self.accountKey,
            accountGeneration: self.accountGeneration
          };
        },
        async afterResponse({ request, response, context }) {
          if (!context || !isHeartToggleUrl(request.url, request.method)) return;
          try {
            let data = null;
            if (request.transport === "fetch") {
              try {
                data = await response.clone().json();
              } catch (_) {
              }
            } else {
              try {
                data = response.responseType === "json" ? response.response : JSON.parse(response.responseText);
              } catch (_) {
              }
            }
            self.processToggleResponse(
              request.url,
              data,
              request.method,
              context.accountKey,
              context.accountGeneration,
              response.status
            );
          } catch (_) {
          }
        }
      });
      console.log("[LikeCounter] 拦截器已安装");
    }
    async syncRemote(force = false) {
      if (!this.accountKey) {
        const discoveryGeneration = this.accountGeneration;
        let user = null;
        try {
          const currentUser = window.Discourse?.User?.current?.() || window.Discourse?.currentUser || window.User?.current?.();
          if (this.getAccountKey(currentUser)) user = currentUser;
        } catch (e) {
        }
        if (!user) {
          try {
            const preloadData = document.getElementById("data-preloaded");
            if (preloadData) {
              const data = JSON.parse(preloadData.dataset.preloaded);
              if (data?.currentUser) {
                const cu = typeof data.currentUser === "string" ? JSON.parse(data.currentUser) : data.currentUser;
                if (this.getAccountKey(cu)) user = cu;
              }
            }
          } catch (e) {
          }
        }
        if (!user) {
          const session429Until = Storage.get("session429Until", 0);
          if (session429Until > Date.now()) {
            const remainMinutes = Math.ceil((session429Until - Date.now()) / 6e4);
            console.log(`[LikeCounter] session/current 429 冷却期中，剩余 ${remainMinutes} 分钟，跳过同步`);
            return;
          }
          try {
            const response = await fetch(`${BASE_URL}/session/current.json`);
            if (response.status === 429) {
              console.warn("[LikeCounter] session/current 遇到 429，设置 30 分钟冷却");
              Storage.set("session429Until", Date.now() + 30 * 60 * 1e3);
              return;
            }
            if (response.ok) {
              const data = await response.json();
              if (this.getAccountKey(data.current_user)) user = data.current_user;
            }
          } catch (e) {
            console.error("[LikeCounter] 获取用户信息失败:", e);
          }
        }
        if (discoveryGeneration !== this.accountGeneration || !user) return;
        this.setCurrentUser(user);
      }
      const accountKey = this.accountKey;
      const accountGeneration = this.accountGeneration;
      const username = this.currentUser?.username;
      if (!accountKey || !username) return;
      this.loadState();
      if (!force) {
        const timeSinceLastSync = Date.now() - (this.state.lastSync || 0);
        const minSyncInterval = 30 * 60 * 1e3;
        if (timeSinceLastSync < minSyncInterval) {
          const remainMinutes = Math.ceil((minSyncInterval - timeSinceLastSync) / 6e4);
          console.log(
            `[LikeCounter] 距离上次同步仅 ${Math.floor(timeSinceLastSync / 6e4)} 分钟，跳过本次同步（剩余 ${remainMinutes} 分钟）`
          );
          this.notifyUIUpdate();
          return;
        }
      }
      console.log(`[LikeCounter] 开始同步用户 ${username} 的点赞数据...`);
      try {
        const limit = this.getDailyLimit();
        const cutoffTime = Date.now() - 24 * 60 * 60 * 1e3;
        console.log(`[LikeCounter] 只读取 API 点赞历史，窗口起点: ${new Date(cutoffTime).toLocaleString()}`);
        const reactions = await this.fetchUserActions(username, cutoffTime, accountKey, accountGeneration);
        if (accountKey !== this.accountKey || accountGeneration !== this.accountGeneration) return;
        const postMap = /* @__PURE__ */ new Map();
        for (const item of reactions) {
          if (!postMap.has(item.post_id) || postMap.get(item.post_id) < item.timestamp) {
            postMap.set(item.post_id, item.timestamp);
          }
        }
        const dedupedTimestamps = Array.from(postMap.values());
        console.log(`[LikeCounter] 用户信任等级: ${this.currentUser?.trust_level}, 限额: ${limit}`);
        console.log(
          `[LikeCounter] 从 API 获取到 ${reactions.length} 条反应记录，去重后 ${dedupedTimestamps.length} 个不同帖子`
        );
        this.state.cooldownUntil = LikeCooldown.read(accountKey);
        this.state.timestamps = dedupedTimestamps;
        this.state.lastSync = Date.now();
        this.state.matched = true;
        this.cleanOldEntries();
        if (this.state.timestamps.length >= limit) {
          const oldestTs = Math.min(...this.state.timestamps);
          const estimatedCooldown = oldestTs + 24 * 60 * 60 * 1e3;
          if (estimatedCooldown > Date.now() && estimatedCooldown > this.state.cooldownUntil) {
            this.state.cooldownUntil = LikeCooldown.extend(accountKey, estimatedCooldown);
            console.log(
              `[LikeCounter] API 数据达到限额，估算冷却时间: ${new Date(estimatedCooldown).toLocaleString()}`
            );
          }
        }
        if (this.currentUser?.trust_level !== void 0) {
          this.state.userTrustLevel = this.currentUser.trust_level;
        }
        this.saveState();
        this.notifyUIUpdate();
        console.log(`[LikeCounter] 同步完成，已用 ${this.state.timestamps.length}/${limit}`);
      } catch (e) {
        console.error("[LikeCounter] 同步失败:", e);
      }
    }
    async fetchUserActions(username, cutoffTime, accountKey = this.accountKey, accountGeneration = this.accountGeneration) {
      const allItems = [];
      const cutoff = cutoffTime || Date.now() - 24 * 60 * 60 * 1e3;
      let offset = 0;
      let pages = 0;
      console.log(
        `[LikeCounter] 开始获取 ${username} 的点赞历史，窗口起点: ${new Date(cutoff).toLocaleString()}`
      );
      while (pages < 5) {
        if (accountKey !== this.accountKey || accountGeneration !== this.accountGeneration) break;
        try {
          const url = `${BASE_URL}/user_actions.json?limit=50&username=${username}&filter=1&offset=${offset}`;
          const response = await RequestManager.run(
            `user-actions-${CURRENT_DOMAIN}-${username}`,
            async () => {
              const r = await fetch(url, { credentials: "include" });
              if (r.status === 429) throw new Error("429 user_actions");
              return r;
            },
            {
              minInterval: 1500,
              retries: 1,
              backoffBase: 1200,
              cooldownKey: `userActions429Until_${CURRENT_DOMAIN}_${username}`,
              cooldownMs: 20 * 60 * 1e3
            }
          );
          if (!response || accountKey !== this.accountKey || accountGeneration !== this.accountGeneration)
            break;
          const res = await response.json();
          if (accountKey !== this.accountKey || accountGeneration !== this.accountGeneration) break;
          const items = res.user_actions || [];
          if (!items.length) {
            console.log(`[LikeCounter] 没有更多数据，结束获取`);
            break;
          }
          let hasOld = false;
          for (const item of items) {
            const t = new Date(item.created_at).getTime();
            if (t > cutoff) {
              allItems.push({ post_id: item.post_id, timestamp: t });
            } else {
              hasOld = true;
            }
          }
          if (hasOld || items.length < 50) {
            console.log(`[LikeCounter] ${hasOld ? "遇到窗口外的旧数据" : "数据不足50条"}，结束获取`);
            break;
          }
          offset += 50;
          pages++;
          await Utils.sleep(Utils.random(350, 900));
        } catch (e) {
          console.error(`[LikeCounter] 获取点赞历史出错:`, e);
          break;
        }
      }
      console.log(`[LikeCounter] 点赞历史获取完成，共 ${allItems.length} 条`);
      return allItems;
    }
    startPeriodicSync() {
      this.scope.setTimeout(() => this.syncRemote(), 3e3);
      this.syncTimer = this.scope.setInterval(() => {
        this.syncRemote();
      }, this.CONFIG.SYNC_INTERVAL);
    }
    setCurrentUser(user) {
      const accountKey = this.getAccountKey(user);
      this.currentUser = accountKey ? {
        ...user,
        username: String(user?.username || "").trim().replace(/^@/, "").trim()
      } : null;
      if (accountKey !== this.accountKey) {
        this.accountKey = accountKey;
        this.accountGeneration++;
        this.loadState();
      }
      this.notifyUIUpdate();
    }
    onUIUpdate(callback) {
      this.uiUpdateCallbacks.push(callback);
      return () => {
        this.uiUpdateCallbacks = this.uiUpdateCallbacks.filter((item) => item !== callback);
      };
    }
    notifyUIUpdate() {
      for (const callback of this.uiUpdateCallbacks) {
        try {
          callback(this.getStatus());
        } catch (e) {
          console.error("[LikeCounter] UI更新回调错误:", e);
        }
      }
    }
    getStatus() {
      this.cleanOldEntries();
      return {
        remaining: this.getRemainingLikes(),
        used: this.getUsedLikes(),
        limit: this.getDailyLimit(),
        isInCooldown: this.isInCooldown(),
        cooldownRemaining: this.getCooldownRemaining(),
        cooldownFormatted: this.formatCooldown(),
        cooldownUntil: this.state.cooldownUntil,
        matched: this.state.matched,
        lastSync: this.state.lastSync
      };
    }
    manualSync() {
      return this.syncRemote(true);
    }
  };

  var UserInfoHelper = class {
    constructor() {
      this.userInfoCache = /* @__PURE__ */ new Map();
      this.pendingRequests = /* @__PURE__ */ new Map();
      this.DAY_IN_MS = 24 * 60 * 60 * 1e3;
      this.isEnabled = true;
      this.observer = null;
      this.init();
    }
    init() {
      if (!this.isEnabled) return;
      if (this.observer) {
        this.observer.disconnect();
      }
      const debouncedEnhance = this.debounce(() => {
        if (!this.isEnabled || document.hidden) return;
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(() => this.isEnabled && this.enhanceUserInfo(), { timeout: 1200 });
        } else {
          setTimeout(() => this.isEnabled && this.enhanceUserInfo(), 120);
        }
      }, 600);
      this.observer = new MutationObserver((mutations) => {
        if (!this.isEnabled || document.hidden) return;
        const hasRelevantMutation = mutations.some(
          (mutation) => Array.from(mutation.addedNodes || []).some((node) => {
            if (node.nodeType !== 1) return false;
            if (node.closest && node.closest("#my-gift-panel")) return false;
            return node.matches?.(".topic-post, article, .post-stream") || node.querySelector?.(".topic-post article, .names a[data-user-card]");
          })
        );
        if (hasRelevantMutation) {
          debouncedEnhance();
        }
      });
      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      this.enhanceUserInfo();
    }
    destroy() {
      this.isEnabled = false;
      this.observer?.disconnect();
    }
    debounce(func, wait) {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }
    isTopicPage() {
      return window.location.pathname.includes("/t/topic/");
    }
    async enhanceUserInfo() {
      if (!this.isTopicPage()) return;
      const articles = document.querySelectorAll(".topic-post article");
      for (const article of articles) {
        const anchor = article.querySelector(".names a[data-user-card]");
        if (!anchor) continue;
        const slug = anchor.getAttribute("data-user-card");
        if (!slug) continue;
        const normalizedSlug = slug.trim().toLowerCase();
        if (article.querySelector(`.user-reg-info[data-user="${normalizedSlug}"]`)) {
          continue;
        }
        const postWrapper = article.closest(".topic-post");
        const postNumber = postWrapper?.getAttribute("data-post-number");
        const isFirstPost = postNumber === "1";
        if (isFirstPost) {
          await this.loadAndDisplayUserInfo(anchor, slug, normalizedSlug);
        } else {
          this.addInfoButton(anchor, slug, normalizedSlug);
        }
      }
    }
    addInfoButton(anchor, rawSlug, normalizedSlug) {
      const namesContainer = anchor.closest(".names");
      if (!namesContainer) return;
      if (namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`)) {
        return;
      }
      if (namesContainer.querySelector(`.user-reg-info[data-user="${normalizedSlug}"]`)) {
        return;
      }
      const button = document.createElement("button");
      button.className = "user-info-btn";
      button.setAttribute("data-user", normalizedSlug);
      button.setAttribute("data-raw-slug", rawSlug);
      button.textContent = "📊";
      button.title = "点击查看用户注册信息";
      button.style.cssText = `
margin-left: 6px;
font-size: 14px;
cursor: pointer;
background: none;
border: none;
padding: 2px 4px;
opacity: 0.6;
transition: opacity 0.2s;
vertical-align: middle;
      `;
      button.addEventListener("mouseenter", () => {
        button.style.opacity = "1";
      });
      button.addEventListener("mouseleave", () => {
        button.style.opacity = "0.6";
      });
      button.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = "⏳";
        try {
          await this.loadAndDisplayUserInfo(anchor, rawSlug, normalizedSlug);
        } catch (error) {
          console.error("加载用户信息失败:", error);
          button.textContent = "📊";
          button.disabled = false;
        }
      });
      anchor.insertAdjacentElement("afterend", button);
      this.addTopicsButton(anchor, rawSlug, normalizedSlug);
    }
    addTopicsButton(anchor, rawSlug, normalizedSlug) {
      const namesContainer = anchor.closest(".names");
      if (!namesContainer) return;
      if (namesContainer.querySelector(`.user-topics-btn[data-user="${normalizedSlug}"]`)) {
        return;
      }
      const topicsBtn = document.createElement("a");
      topicsBtn.className = "user-topics-btn";
      topicsBtn.setAttribute("data-user", normalizedSlug);
      topicsBtn.href = `${BASE_URL}/u/${rawSlug}/activity/topics`;
      topicsBtn.target = "_blank";
      topicsBtn.textContent = "查看话题";
      topicsBtn.title = "查看该用户的话题";
      topicsBtn.style.cssText = `
margin-left: 6px;
font-size: 12px;
cursor: pointer;
text-decoration: none;
padding: 2px 6px;
opacity: 0.7;
transition: all 0.2s;
vertical-align: middle;
display: inline-block;
color: #667eea;
background: rgba(102, 126, 234, 0.1);
border-radius: 4px;
      `;
      topicsBtn.addEventListener("mouseenter", () => {
        topicsBtn.style.opacity = "1";
        topicsBtn.style.background = "rgba(102, 126, 234, 0.2)";
      });
      topicsBtn.addEventListener("mouseleave", () => {
        topicsBtn.style.opacity = "0.7";
        topicsBtn.style.background = "rgba(102, 126, 234, 0.1)";
      });
      const infoBtn = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
      if (infoBtn) {
        infoBtn.insertAdjacentElement("afterend", topicsBtn);
      } else {
        anchor.insertAdjacentElement("afterend", topicsBtn);
      }
    }
    async loadAndDisplayUserInfo(anchor, slug, normalizedSlug) {
      const namesContainer = anchor.closest(".names");
      if (!namesContainer) return;
      const existingInfo = namesContainer.querySelector(`.user-reg-info[data-user="${normalizedSlug}"]`);
      if (existingInfo) {
        console.log(`用户 ${normalizedSlug} 信息已存在，跳过`);
        const button2 = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
        if (button2) button2.remove();
        return;
      }
      const info = await this.fetchUserInfo(slug, normalizedSlug);
      if (!info) {
        const button2 = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
        if (button2) {
          button2.textContent = "📊";
          button2.disabled = false;
        }
        return;
      }
      const infoNode = this.buildInfoNode(info, normalizedSlug);
      if (!infoNode) {
        const button2 = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
        if (button2) {
          button2.textContent = "📊";
          button2.disabled = false;
        }
        return;
      }
      const finalCheck = namesContainer.querySelector(`.user-reg-info[data-user="${normalizedSlug}"]`);
      if (finalCheck) {
        console.log(`用户 ${normalizedSlug} 信息在等待期间已被添加，跳过`);
        const button2 = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
        if (button2) button2.remove();
        return;
      }
      const button = namesContainer.querySelector(`.user-info-btn[data-user="${normalizedSlug}"]`);
      if (button) button.remove();
      anchor.insertAdjacentElement("afterend", infoNode);
      if (!namesContainer.querySelector(`.user-topics-btn[data-user="${normalizedSlug}"]`)) {
        this.addTopicsButton(anchor, slug, normalizedSlug);
      }
    }
    async fetchUserInfo(slug, normalizedSlug) {
      if (this.userInfoCache.has(normalizedSlug)) {
        return this.userInfoCache.get(normalizedSlug);
      }
      if (this.pendingRequests.has(normalizedSlug)) {
        return this.pendingRequests.get(normalizedSlug);
      }
      const requestPromise = this.doFetchUserInfo(slug, normalizedSlug);
      this.pendingRequests.set(normalizedSlug, requestPromise);
      try {
        const info = await requestPromise;
        if (info) {
          this.userInfoCache.set(normalizedSlug, info);
        }
        return info;
      } finally {
        this.pendingRequests.delete(normalizedSlug);
      }
    }
    async doFetchUserInfo(slug, normalizedSlug) {
      try {
        const PROFILE_API_BUILDERS = [
          (s) => `${BASE_URL}/u/${encodeURIComponent(s)}.json`,
          (s) => `${BASE_URL}/users/${encodeURIComponent(s)}.json`
        ];
        const SUMMARY_API_BUILDERS = [
          (s) => `${BASE_URL}/u/${encodeURIComponent(s)}/summary.json`,
          (s) => `${BASE_URL}/users/${encodeURIComponent(s)}/summary.json`
        ];
        const [profileData, summaryData] = await Promise.all([
          this.fetchFirstAvailable(PROFILE_API_BUILDERS, slug),
          this.fetchFirstAvailable(SUMMARY_API_BUILDERS, slug)
        ]);
        if (!profileData && !summaryData) {
          return null;
        }
        const user = profileData && (profileData.user || profileData);
        const summary = summaryData && (summaryData.user_summary || summaryData.summary || summaryData);
        const createdAt = this.pickCreatedAt(user) || summary && this.pickCreatedAt(summary);
        if (!createdAt) {
          return null;
        }
        const topicCount = this.pickFirstNumber(
          user && (user.topic_count ?? user.topicCount),
          summary && (summary.topic_count ?? summary.topics_count)
        );
        const totalPostCount = this.pickFirstNumber(
          user && (user.post_count ?? user.postCount),
          summary && (summary.post_count ?? summary.posts_count)
        );
        let repliesCount = this.pickFirstNumber(summary && (summary.replies_count ?? summary.reply_count));
        if (repliesCount === null && totalPostCount !== null && topicCount !== null) {
          repliesCount = Math.max(0, totalPostCount - topicCount);
        }
        const trustLevelRaw = this.pickFirstValue(
          user && (user.trust_level ?? user.trustLevel),
          summary && (summary.trust_level ?? summary.trustLevel)
        );
        const trustLevel = this.normalizeTrustLevel(trustLevelRaw);
        const days = this.calcDays(createdAt);
        return {
          slug: normalizedSlug,
          createdAt,
          days,
          topicCount: typeof topicCount === "number" && Number.isFinite(topicCount) ? topicCount : void 0,
          repliesCount: typeof repliesCount === "number" && Number.isFinite(repliesCount) ? repliesCount : void 0,
          trustLevel
        };
      } catch (error) {
        console.error("获取用户信息失败:", slug, error);
        return null;
      }
    }
    async fetchFirstAvailable(builders, slug) {
      for (const builder of builders) {
        const url = builder(slug);
        const data = await this.safeFetchJson(url);
        if (data) {
          return data;
        }
      }
      return null;
    }
    async safeFetchJson(url) {
      try {
        const response = await RequestManager.run(
          `safe-fetch-${CURRENT_DOMAIN}-${url}`,
          async () => {
            const r = await fetch(url, { credentials: "include" });
            if (r.status === 429) throw new Error(`429 ${url}`);
            return r;
          },
          {
            minInterval: 1200,
            retries: 1,
            backoffBase: 1e3,
            cooldownKey: `safeFetch429Until_${CURRENT_DOMAIN}`,
            cooldownMs: 20 * 60 * 1e3
          }
        );
        if (!response || !response.ok) {
          return null;
        }
        return await response.json();
      } catch (error) {
        return null;
      }
    }
    pickFirstNumber(...values) {
      for (const value of values) {
        const numberValue = Number(value);
        if (!Number.isNaN(numberValue)) {
          return numberValue;
        }
      }
      return null;
    }
    pickFirstValue(...values) {
      for (const value of values) {
        if (value !== void 0 && value !== null) {
          return value;
        }
      }
      return null;
    }
    normalizeTrustLevel(raw) {
      if (raw === void 0 || raw === null) {
        return void 0;
      }
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
      }
      if (typeof raw === "string") {
        const TRUST_LEVEL_ALIAS = {
          newuser: 0,
          basic: 1,
          member: 2,
          regular: 3,
          leader: 4
        };
        const alias = TRUST_LEVEL_ALIAS[raw.toLowerCase()];
        if (alias !== void 0) {
          return alias;
        }
        const numeric = Number(raw);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
      }
      return void 0;
    }
    pickCreatedAt(source) {
      if (!source) {
        return null;
      }
      return source.created_at || source.createdAt || source.registration_date || source.registrationDate || source.joined || source.joinedAt || null;
    }
    calcDays(createdAt) {
      const createdTime = new Date(createdAt).getTime();
      if (Number.isNaN(createdTime)) {
        return 0;
      }
      const diff = Date.now() - createdTime;
      return Math.max(0, Math.floor(diff / this.DAY_IN_MS));
    }
    buildInfoNode(info, normalizedSlug) {
      const segments = [`注册 ${this.formatNumber(info.days)} 天`];
      if (typeof info.topicCount === "number" && Number.isFinite(info.topicCount)) {
        segments.push(`发帖 ${this.formatNumber(info.topicCount)}`);
      }
      if (typeof info.repliesCount === "number" && Number.isFinite(info.repliesCount)) {
        segments.push(`回帖 ${this.formatNumber(info.repliesCount)}`);
      }
      if (typeof info.trustLevel === "number" && Number.isFinite(info.trustLevel)) {
        const FULL_TRUST_LEVEL_LABELS = {
          0: "Lv0 新手",
          1: "Lv1 入门",
          2: "Lv2 成员",
          3: "Lv3 常驻",
          4: "Lv4 领袖"
        };
        const label = FULL_TRUST_LEVEL_LABELS[info.trustLevel] || `信任级别 Lv${info.trustLevel}`;
        segments.push(label);
      }
      if (!segments.length) {
        return null;
      }
      const span = document.createElement("span");
      span.className = "user-reg-info";
      span.setAttribute("data-user", normalizedSlug);
      span.textContent = ` · ${segments.join(" · ")}`;
      span.style.cssText = `
margin-left: 6px;
font-size: 12px;
color: #1a4c7c;
      `;
      return span;
    }
    formatNumber(value) {
      return Number(value).toLocaleString("zh-CN");
    }
  };

  var AutomationCoordinator = class {
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
        counterUsername: this.counter?.currentUser?.username
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
  };

  var lifecycleMethods = {
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
        30 * 60 * 1e3
      );
      console.log("等级监控已启动（30分钟刷新一次，仅在可见时）");
    },
    shouldRefreshAccountInfo() {
      return Boolean(
        this.panel.accountSection && this.panel.accountSectionContent && this.panel.accountSection.getAttribute("aria-expanded") === "true"
      );
    },
    shouldRefreshCreditInfo() {
      return Boolean(
        this.panel.creditSection && this.panel.creditSection.getAttribute("aria-expanded") === "true"
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
    }
  };

  var topicMethods = {
    formatTopicCreatedTime(dateInput) {
      if (!dateInput) return "";
      const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
      if (Number.isNaN(date.getTime())) return "";
      const pad = (num) => String(num).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },
    getTopicAgeLevel(dateInput) {
      if (!dateInput) return "fresh";
      const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
      if (Number.isNaN(date.getTime())) return "fresh";
      const ageDays = (Date.now() - date.getTime()) / (1e3 * 60 * 60 * 24);
      if (ageDays > 90) return "ancient";
      if (ageDays > 30) return "old";
      return "fresh";
    },
    extractTopicCreatedAtFromRow(row) {
      if (!row) return "";
      const parsePossibleDate = (value) => {
        if (!value) return "";
        const normalized = String(value).trim();
        if (!normalized) return "";
        if (/^\d{13}$/.test(normalized)) {
          const date2 = new Date(Number(normalized));
          return Number.isNaN(date2.getTime()) ? "" : date2.toISOString();
        }
        if (/^\d{10}$/.test(normalized)) {
          const date2 = new Date(Number(normalized) * 1e3);
          return Number.isNaN(date2.getTime()) ? "" : date2.toISOString();
        }
        const date = new Date(normalized);
        return Number.isNaN(date.getTime()) ? "" : normalized;
      };
      const parseChineseDateText = (value) => {
        if (!value) return "";
        const text = String(value).replace(/\s+/g, " ").trim();
        const match = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/);
        if (!match) return "";
        const [, year, month, day, hour, minute] = match;
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:00`;
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? "" : iso;
      };
      const candidates = [
        row.dataset.createdAt,
        row.getAttribute("data-created-at"),
        row.dataset.topicCreatedAt,
        row.getAttribute("data-topic-created-at"),
        row.dataset.bumpedAt,
        row.getAttribute("data-bumped-at")
      ].filter(Boolean);
      for (const value of candidates) {
        const parsed = parsePossibleDate(value);
        if (parsed) return parsed;
      }
      const topicLink = row.querySelector("a.title, .main-link a, a.raw-topic-link");
      if (topicLink) {
        const activityCell2 = topicLink.closest("tr")?.querySelector("td.activity[title], td.age[title], td.topic-list-data.age[title]");
        if (activityCell2) {
          const activityTitle = activityCell2.getAttribute("title") || "";
          const createdFromTitle = activityTitle.match(/创建日期[:：]\s*([^\n]+)/);
          if (createdFromTitle?.[1]) {
            const parsedChinese = parseChineseDateText(createdFromTitle[1]);
            if (parsedChinese) return parsedChinese;
            const parsedDirect = parsePossibleDate(createdFromTitle[1]);
            if (parsedDirect) return parsedDirect;
          }
        }
        const linkCandidates = [
          topicLink.dataset.createdAt,
          topicLink.getAttribute("data-created-at"),
          topicLink.getAttribute("title"),
          topicLink.getAttribute("aria-label")
        ].filter(Boolean);
        for (const value of linkCandidates) {
          const parsed = parsePossibleDate(value);
          if (parsed) return parsed;
          const datetimeMatch = String(value).match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/);
          if (datetimeMatch) {
            return datetimeMatch[0].replace(" ", "T");
          }
        }
      }
      const timeEls = row.querySelectorAll("time[datetime]");
      for (const timeEl of timeEls) {
        const dt = parsePossibleDate(timeEl.getAttribute("datetime"));
        if (dt) return dt;
      }
      const activityCell = row.querySelector(
        "td.activity[title], td.age[title], td.topic-list-data.age[title]"
      );
      if (activityCell) {
        const activityTitle = activityCell.getAttribute("title") || "";
        const createdFromTitle = activityTitle.match(/创建日期[:：]\s*([^\n]+)/);
        if (createdFromTitle?.[1]) {
          const parsedChinese = parseChineseDateText(createdFromTitle[1]);
          if (parsedChinese) return parsedChinese;
          const parsedDirect = parsePossibleDate(createdFromTitle[1]);
          if (parsedDirect) return parsedDirect;
        }
      }
      return "";
    },
    renderTopicCreatedTimeInList() {
      const rows = document.querySelectorAll("tr.topic-list-item, tr.latest-topic-list-item");
      rows.forEach((row) => {
        const activityLink = row.querySelector(
          "td.activity a.post-activity, td.age a.post-activity, td.topic-list-data.age a.post-activity"
        );
        const activityCell = activityLink?.closest("td.activity, td.age, td.topic-list-data.age") || row.querySelector("td.activity, td.age, td.topic-list-data.age");
        if (!activityCell) return;
        let meta = activityCell.querySelector(".lda-topic-created-time");
        if (!this.settings.topicCreatedTimeVisible) {
          if (meta) meta.remove();
          return;
        }
        const createdAt = this.extractTopicCreatedAtFromRow(row);
        if (!createdAt) {
          if (meta) meta.remove();
          return;
        }
        const formatted = this.formatTopicCreatedTime(createdAt);
        if (!formatted) {
          if (meta) meta.remove();
          return;
        }
        if (!meta) {
          meta = document.createElement("span");
          meta.className = "lda-topic-created-time";
          const anchor = activityLink || activityCell.querySelector("a");
          if (anchor) {
            meta.style.display = "inline-flex";
            meta.style.alignItems = "center";
            meta.style.marginLeft = "8px";
            anchor.appendChild(meta);
          } else {
            meta.style.display = "inline-flex";
            meta.style.alignItems = "center";
            meta.style.marginLeft = "8px";
            activityCell.appendChild(meta);
          }
        }
        meta.dataset.createdAt = createdAt;
        meta.dataset.ageLevel = this.settings.topicAgeColorEnabled ? this.getTopicAgeLevel(createdAt) : "neutral";
        meta.innerHTML = `<span class="lda-topic-created-separator">｜</span><span class="lda-topic-created-label">创建: ${formatted}</span>`;
        meta.title = `帖子创建时间：${formatted}`;
      });
    },
    initTopicCreatedTimeEnhancer() {
      this.renderTopicCreatedTimeInList();
      if (this._topicCreatedTimeObserver) {
        try {
          this._topicCreatedTimeObserver.disconnect();
        } catch (_) {
        }
      }
      let timer = null;
      const scheduleRender = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => this.renderTopicCreatedTimeInList(), 200);
      };
      this._topicCreatedTimeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== "childList") continue;
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches?.("tr.topic-list-item, tr.latest-topic-list-item, .topic-list") || node.querySelector?.("tr.topic-list-item, tr.latest-topic-list-item")) {
              scheduleRender();
              return;
            }
          }
        }
      });
      if (document.body) {
        this._topicCreatedTimeObserver.observe(document.body, { childList: true, subtree: true });
      }
    },
    initFloorNumberDisplay() {
      this.addFloorNumbers();
      this.initMutationObserver();
    },
    addFloorNumbers() {
      const posts = Array.from(document.querySelectorAll(".boxed.onscreen-post"));
      if (!posts.length) {
        return;
      }
      const topicIdMatch = window.location.pathname.match(/\/t\/topic\/(\d+)/);
      const topicId = topicIdMatch ? topicIdMatch[1] : null;
      if (topicId && this._floorTopicId !== topicId) {
        this._floorTopicId = topicId;
        this._floorSmallActionNumbers = null;
        this._floorSmallActionPromise = null;
      }
      const ensureSmallActionNumbers = () => {
        if (!topicId) return;
        if (Array.isArray(this._floorSmallActionNumbers)) return;
        if (this._floorSmallActionPromise) return;
        const url = new URL(window.location.href);
        url.hash = "";
        const jsonUrl = url.toString().replace(/\/$/, "") + ".json";
        this._floorSmallActionPromise = fetch(jsonUrl, { credentials: "include" }).then((r) => r && r.ok ? r.json() : null).then((data) => {
          const arr = data?.post_stream?.posts;
          if (!Array.isArray(arr)) return null;
          const smallNums = [];
          for (const p of arr) {
            const n = p?.post_number;
            if (!Number.isFinite(n)) continue;
            const hasActionCode = typeof p?.action_code === "string" && p.action_code.length > 0;
            const postType = p?.post_type;
            const isNonRegularType = Number.isFinite(postType) && postType !== 1;
            let looksLikeSystemText = false;
            if (!hasActionCode && !isNonRegularType) {
              const cooked = typeof p?.cooked === "string" ? p.cooked : "";
              if (cooked) {
                const plain = cooked.replace(/<[^>]*>/g, "").trim();
                if (plain.length > 0 && plain.length <= 80) {
                  const hasCatTag = /类别|标签|category|tag/i.test(plain);
                  const hasUpdate = /更新|移除|removed|updated|change/i.test(plain);
                  if (hasCatTag && hasUpdate) looksLikeSystemText = true;
                }
              }
            }
            if (hasActionCode || isNonRegularType || looksLikeSystemText) {
              smallNums.push(n);
            }
          }
          smallNums.sort((a, b) => a - b);
          return smallNums;
        }).then((smallNums) => {
          if (Array.isArray(smallNums)) {
            const prev = this._floorSmallActionNumbers;
            this._floorSmallActionNumbers = smallNums;
            if (!Array.isArray(prev) || prev.length !== smallNums.length) {
              setTimeout(() => {
                if (this._floorTopicId === topicId) {
                  try {
                    this.addFloorNumbers();
                  } catch (_) {
                  }
                }
              }, 0);
            }
          }
        }).catch(() => {
        }).finally(() => {
          this._floorSmallActionPromise = null;
        });
      };
      ensureSmallActionNumbers();
      let smallActionPostNumbers = Array.isArray(this._floorSmallActionNumbers) ? this._floorSmallActionNumbers : null;
      if (!smallActionPostNumbers) {
        const topicPosts = Array.from(document.querySelectorAll(".topic-post[data-post-number]"));
        const nums = [];
        for (const tp of topicPosts) {
          const isSmallAction = tp.classList.contains("small-action") || !!tp.querySelector(".small-action");
          if (!isSmallAction) continue;
          const postNumberStr = tp.getAttribute("data-post-number");
          const n = postNumberStr ? parseInt(postNumberStr, 10) : NaN;
          if (Number.isFinite(n)) nums.push(n);
        }
        nums.sort((a, b) => a - b);
        smallActionPostNumbers = nums;
      }
      const countSmallActionsBefore = (postNumber) => {
        let count = 0;
        for (const n of smallActionPostNumbers) {
          if (n < postNumber) count++;
          else break;
        }
        return count;
      };
      for (const post of posts) {
        const postWrapper = post.closest(".topic-post");
        const isSmallActionWrapper = !!(postWrapper && (postWrapper.classList.contains("small-action") || !!postWrapper.querySelector(".small-action")));
        if (isSmallActionWrapper) {
          const existing = post.querySelector(".floor-number");
          if (existing) existing.remove();
          continue;
        }
        const postNumberStr = postWrapper?.getAttribute("data-post-number");
        let postNumber = postNumberStr ? parseInt(postNumberStr, 10) : NaN;
        if (!Number.isFinite(postNumber)) {
          const idPart = (post.id || "").split("_")[1];
          postNumber = idPart ? parseInt(idPart, 10) : NaN;
        }
        if (!Number.isFinite(postNumber)) continue;
        const adjustedFloor = postNumber - countSmallActionsBefore(postNumber);
        const meta = post.querySelector(".topic-meta-data");
        if (!meta) continue;
        let floorNumber = post.querySelector(".floor-number");
        if (!floorNumber) {
          floorNumber = document.createElement("div");
          floorNumber.className = "floor-number";
          floorNumber.style.cssText = "color: grey; margin-left: 10px;";
          meta.appendChild(floorNumber);
        }
        floorNumber.textContent = "楼层: " + adjustedFloor;
        floorNumber.title = "原始楼层: " + postNumber;
      }
    },
    initMutationObserver() {
      if (this._floorMutationObserver) {
        try {
          this._floorMutationObserver.disconnect();
        } catch (_) {
        }
      }
      this._floorObserverRunning = false;
      this._floorObserverScheduled = false;
      const scheduleUpdate = () => {
        if (this._floorObserverRunning || this._floorObserverScheduled) return;
        this._floorObserverScheduled = true;
        setTimeout(() => {
          this._floorObserverScheduled = false;
          this._floorObserverRunning = true;
          try {
            this.addFloorNumbers();
            this.toggleCleanMode();
          } catch (e) {
            console.error("[楼层号] 更新失败:", e);
          } finally {
            this._floorObserverRunning = false;
          }
        }, 80);
      };
      this._floorMutationObserver = new MutationObserver(() => {
        scheduleUpdate();
      });
      this._floorMutationObserver.observe(document.body, { childList: true, subtree: true });
      scheduleUpdate();
    }
  };

  var modeMethods = {
    toggleCleanMode() {
      const sidebarToggle = document.querySelector("button.btn-sidebar-toggle");
      if (sidebarToggle && this.settings.cleanModeEnabled) {
        if (sidebarToggle.getAttribute("aria-expanded") === "true") {
          console.log("清爽模式启用，收起边栏");
          sidebarToggle.click();
        }
      }
      this.applyCleanModeStyles();
    },
    applyCleanModeStyles() {
      let styleElement = document.getElementById("clean-mode-styles");
      if (styleElement) {
        styleElement.remove();
      }
      if (this.settings.cleanModeEnabled) {
        styleElement = document.createElement("style");
        styleElement.id = "clean-mode-styles";
        styleElement.textContent = `
p:contains("希望你喜欢这里。有问题，请提问，或搜索现有帖子。") { display: none !important; }
div#global-notice-alert-global-notice.alert.alert-info.alert-global-notice { display: none !important; }
a[href="https://linux.do/t/topic/482293"] { display: none !important; }
div.link-bottom-line a.badge-category__wrapper { display: none !important; }
td.posters.topic-list-data { display: none !important; }
a.discourse-tag.box[href^="/tag/"] { display: none !important; }
      `;
        document.head.appendChild(styleElement);
      }
    },
    toggleGrayscaleMode() {
      this.applyGrayscaleModeStyles();
    },
    applyGrayscaleModeStyles() {
      let styleElement = document.getElementById("grayscale-mode-styles");
      if (styleElement) {
        styleElement.remove();
      }
      if (this.settings.grayscaleModeEnabled) {
        const isAndroid = /Android/i.test(navigator.userAgent);
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        const isMobile = isAndroid || isIOS;
        const isLowEnd = navigator.hardwareConcurrency <= 4 || navigator.deviceMemory <= 4;
        styleElement = document.createElement("style");
        styleElement.id = "grayscale-mode-styles";
        styleElement.textContent = `
              @media (prefers-color-scheme: light) {
                  #main-outlet, .d-header, .menu-panel, main {
                      filter: grayscale(100%) contrast(108%) brightness(97%) !important;
                      -webkit-filter: grayscale(100%) contrast(108%) brightness(97%) !important;
                  }
                  #main-outlet *, .d-header *, .menu-panel *, main * {
                      text-shadow: 0 0 0.3px rgba(0, 0, 0, 0.4) !important;
                  }
              }
              @media (prefers-color-scheme: dark) {
                  #main-outlet, .d-header, .menu-panel, main {
                      filter: grayscale(100%) contrast(110%) brightness(103%) !important;
                      -webkit-filter: grayscale(100%) contrast(110%) brightness(103%) !important;
                  }
                  #main-outlet *, .d-header *, .menu-panel *, main * {
                      text-shadow: 0 0 0.3px rgba(255, 255, 255, 0.5) !important;
                  }
              }
              @media (prefers-color-scheme: no-preference) {
                  #main-outlet, .d-header, .menu-panel, main {
                      filter: grayscale(100%) contrast(109%) brightness(99%) !important;
                      -webkit-filter: grayscale(100%) contrast(109%) brightness(99%) !important;
                  }
              }
              img, svg, canvas, video {
                  filter: grayscale(100%) contrast(110%) !important;
                  -webkit-filter: grayscale(100%) contrast(110%) !important;
              }
              ${isMobile ? `
              html {
                  -webkit-font-smoothing: antialiased !important;
                  -moz-osx-font-smoothing: grayscale !important;
                  text-rendering: optimizeLegibility !important;
              }
              * {
                  -webkit-overflow-scrolling: touch !important;
              }
              ` : ""}
              ${isIOS ? `
              body {
                  -webkit-transform: translateZ(0) !important;
              }
              ` : ""}
              ${isLowEnd ? `
              *, *::before, *::after {
                  animation-duration: 0.01ms !important;
                  animation-iteration-count: 1 !important;
                  transition-duration: 0.01ms !important;
              }
              ` : ""}
          `;
        document.head.appendChild(styleElement);
        setTimeout(() => {
          if (document.documentElement) {
            const currentWillChange = document.documentElement.style.willChange;
            if (currentWillChange === "filter") {
              document.documentElement.style.willChange = "auto";
            }
          }
        }, 1e3);
        const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        const isLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
        const theme = isDark ? "深色" : isLight ? "浅色" : "未知";
        console.log("🎨 黑白灰模式已启用");
        console.log(`📱 设备类型: ${isMobile ? isIOS ? "iOS" : "Android" : "桌面"}`);
        console.log(`🔧 优化模式: ${isLowEnd ? "低端设备" : "标准"}`);
        console.log(`🌓 检测主题: ${theme}模式`);
        console.log(`✨ 浅色背景: 对比108% + 亮度97%`);
        console.log(`✨ 深色背景: 对比110% + 亮度103%`);
        console.log(`🖼️  图片对比度: 110%`);
      } else {
        console.log("🎨 黑白灰模式已关闭");
      }
    }
  };

  var rankingMethods = {
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
          { key: "all", name: this.t("allTimeRank"), icon: "🏅" }
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
            Accept: "application/json"
          }
        }).then((response) => {
          if (response.ok) {
            return response.json();
          }
          throw new Error("请求失败");
        }).then((data) => {
          if (data && data.personal && data.personal.user) {
            resolve({
              score: data.personal.user.total_score || 0,
              position: data.personal.position || data.personal.user.position || 0
            });
          } else {
            resolve({ score: 0, position: "-" });
          }
        }).catch((error) => {
          console.error(`获取${period}排名失败:`, error);
          resolve({ score: 0, position: "-" });
        });
      });
    },
    renderRankingData(periods, results) {
      const updateTime = /* @__PURE__ */ (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
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
    }
  };

  var cloudflareMethods = {
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
      } catch (_) {
      }
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
        characterData: true
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
    }
  };

  var accountMethods = {
    simplifyTrustLevelName(name) {
      return name.replace("已读帖子（所有时间）", "已读帖子").replace("浏览的话题（所有时间）", "浏览话题").replace("访问次数（过去", "访问次数(").replace("个月）", "月)").replace("回复次数（最近", "回复(近").replace("天内）", "天)");
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
          const currentUser = window.Discourse?.User?.current?.() || window.Discourse?.currentUser || window.User?.current?.();
          if (currentUser?.username) {
            this.currentUsername = currentUser.username;
            return this.currentUsername;
          }
        } catch (e) {
        }
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
        } catch (e) {
        }
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
          "a.current-user, .header-dropdown-toggle.current-user a"
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
        } catch (e) {
        }
        try {
          const stored = localStorage.getItem("discourse_current_user");
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed?.username) {
              this.currentUsername = parsed.username;
              return this.currentUsername;
            }
          }
        } catch (e) {
        }
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
        } catch (e) {
        }
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
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
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
            isMet: item.isMet
          };
        })
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
        allMet
      } = cachedData;
      const cacheAge = Date.now() - lastFetch;
      const cacheMinutes = Math.floor(cacheAge / 1e3 / 60);
      const cacheTimeText = cacheMinutes < 1 ? "刚刚" : `${cacheMinutes}分钟前`;
      const levelNames = {
        0: "Lv0 → Lv1",
        1: "Lv1 → Lv2",
        2: "Lv1 → Lv2",
        3: "Lv2 → Lv3",
        4: "Lv3 → Lv4"
      };
      const yesterdaySnapshot = this.getYesterdaySnapshot(username);
      const isAllMetForHeader = type === "low_level" ? allMet : achievedCount === totalCount;
      const headerTitle = isAllMetForHeader ? `Lv${targetLevel} ✓` : levelNames[type === "low_level" ? currentLevel : targetLevel] || `Lv${currentLevel} → Lv${targetLevel}`;
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
        const progress = Math.min(currentNum / requiredNum * 100, 100);
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
          changeIndicator
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
              this.fetchSummaryTrustLevelFallback(username).then(resolve).catch((fallbackErr) => {
                reject(new Error(`请求失败，状态码: ${response.status}；降级也失败: ${fallbackErr.message}`));
              });
            }
          },
          onerror: (error) => {
            console.error("GM_xmlhttpRequest 错误:", error);
            this.fetchSummaryTrustLevelFallback(username).then(resolve).catch((fallbackErr) => {
              reject(new Error(`网络请求错误；降级也失败: ${fallbackErr.message}`));
            });
          },
          ontimeout: () => {
            console.error("GM_xmlhttpRequest 超时");
            this.fetchSummaryTrustLevelFallback(username).then(resolve).catch((fallbackErr) => {
              reject(new Error(`请求超时；降级也失败: ${fallbackErr.message}`));
            });
          }
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
        credentials: "include"
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
            const isMet = cells[2].classList.contains("status-met") || cells[2].classList.contains("text-green-500");
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
        totalCount: 0
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
            isMet
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
        1: "Lv1 → Lv2"
      };
      const yesterdaySnapshot = this.getYesterdaySnapshot(username);
      const headerTitle = allMet ? `Lv${targetLevel} ✓` : levelNames[currentLevel] || `Lv${currentLevel} → Lv${targetLevel}`;
      let html = `
          <div class="trust-level-header">
              <span>📊 ${headerTitle} (${username})</span>
              <button class="trust-level-refresh" data-action="refresh">🔄 刷新</button>
          </div>
      `;
      trustLevelDetails.items.forEach((req) => {
        const progress = Math.min(req.current / req.required * 100, 100);
        const isCompleted = req.isMet;
        const fillClass = isCompleted ? "completed" : "";
        const diff = this.calculateDataChange(req.current, yesterdaySnapshot, req.name);
        const changeIndicator = this.generateChangeIndicator(diff);
        const isNegativeIndicator = req.name.includes("被禁言") || req.name.includes("被封禁") || req.name.includes("被举报的帖子") || req.name.includes("发起举报的用户");
        const currentValueHtml = isNegativeIndicator ? `<span style="color: #ff6b6b;">${req.current}</span>` : req.current;
        html += this.renderTrustLevelItem(
          req.name,
          fillClass,
          progress,
          currentValueHtml,
          req.required,
          changeIndicator
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
        allMet
      });
      this.bindTrustLevelRefresh();
    },
    renderTrustLevel(data, username) {
      const summary = data.user_summary;
      if (!summary) {
        this.panel.trustLevelContainer.innerHTML = '<div class="trust-level-loading">无数据</div>';
        return;
      }
      const currentLevel = summary.trust_level !== void 0 ? summary.trust_level : data.user && data.user.trust_level !== void 0 ? data.user.trust_level : 1;
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
            required: requiredValue
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
        3: "Lv3 → Lv4"
      };
      const yesterdaySnapshot = this.getYesterdaySnapshot(username);
      let html = `
          <div class="trust-level-header">
              <span>📊 ${levelNames[currentLevel] || `Lv${currentLevel} → Lv${targetLevel}`} (${username})</span>
              <button class="trust-level-refresh" data-action="refresh">🔄 刷新</button>
          </div>
      `;
      requirements.forEach((req) => {
        const progress = Math.min(req.current / req.required * 100, 100);
        const isCompleted = req.current >= req.required;
        const fillClass = isCompleted ? "completed" : "";
        const diff = this.calculateDataChange(req.current, yesterdaySnapshot, req.name);
        const changeIndicator = this.generateChangeIndicator(diff);
        const isNegativeIndicator = req.name.includes("被禁言") || req.name.includes("被封禁") || req.name.includes("被举报的帖子") || req.name.includes("发起举报的用户");
        const currentValueHtml = isNegativeIndicator ? `<span style="color: #ff6b6b;">${req.current}</span>` : req.current;
        html += this.renderTrustLevelItem(
          req.name,
          fillClass,
          progress,
          currentValueHtml,
          req.required,
          changeIndicator
        );
      });
      html += this.renderTrustLevelResult(allMet, targetLevel, achievedCount, totalCount);
      this.panel.trustLevelContainer.innerHTML = html;
      const cacheItems = requirements.map((req) => ({
        name: req.name,
        current: req.current,
        required: req.required,
        isMet: req.current >= req.required
      }));
      this.saveTrustLevelCache(username, {
        type: "low_level",
        username,
        currentLevel,
        targetLevel,
        items: cacheItems,
        achievedCount,
        totalCount,
        allMet
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
        { name: "阅读时长(分)", current: Math.floor(summary.time_read / 60), required: 60 }
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
        const progress = Math.min(req.current / req.required * 100, 100);
        const isCompleted = req.current >= req.required;
        const fillClass = isCompleted ? "completed" : "";
        const isNegativeIndicator = req.name.includes("被禁言") || req.name.includes("被封禁") || req.name.includes("被举报的帖子") || req.name.includes("发起举报的用户");
        const currentValueHtml = isNegativeIndicator ? `<span style="color: #ff6b6b;">${req.current}</span>` : req.current;
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
        4: "Lv3 → Lv4"
      };
      const yesterdaySnapshot = this.getYesterdaySnapshot(username);
      const allRequirementsMet = achievedCount === totalCount;
      const headerTitle = allRequirementsMet ? `Lv${targetLevel} ✓` : levelNames[targetLevel] || `Lv${currentLevel} → Lv${targetLevel}`;
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
        const progress = Math.min(currentNum / requiredNum * 100, 100);
        const isCompleted = req.isMet;
        const fillClass = isCompleted ? "completed" : "";
        let simpleName = this.simplifyTrustLevelName(req.name);
        const diff = this.calculateDataChange(currentNum, yesterdaySnapshot, simpleName);
        const changeIndicator = this.generateChangeIndicator(diff);
        const isNegativeIndicator = req.name.includes("被禁言") || req.name.includes("被封禁") || req.name.includes("被举报的帖子") || req.name.includes("发起举报的用户");
        const currentValueHtml = isNegativeIndicator ? `<span style="color: #ff6b6b;">${req.current}</span>` : req.current;
        html += this.renderTrustLevelItem(
          simpleName,
          fillClass,
          progress,
          currentValueHtml,
          req.required,
          changeIndicator
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
        totalCount
      });
      this.bindTrustLevelRefresh();
    }
  };

  var creditMethods = {
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
          refreshBtn.textContent = refreshBtn.classList.contains("credit-auth-refresh") ? "…" : this.t("refreshing");
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
            Origin: "https://credit.linux.do"
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
          }
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
            Origin: "https://credit.linux.do"
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
          ontimeout: () => resolve([])
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
            headers: { Accept: "application/json" }
          }).then((r) => {
            if (r.status === 429) {
              got429 = true;
              return null;
            }
            return r.ok ? r.json() : null;
          }).catch(() => null),
          fetch("https://linux.do/leaderboard/1?period=all", {
            credentials: "include",
            headers: { Accept: "application/json" }
          }).then((r) => {
            if (r.status === 429) {
              got429 = true;
              return null;
            }
            return r.ok ? r.json() : null;
          }).catch(() => null)
        ]).then(([dailyData, allTimeData]) => {
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
              dailyScore
            };
            Storage.set("cachedLeaderboardData", result);
            resolve(result);
          } else {
            const cachedLeaderboard = Storage.get("cachedLeaderboardData", null);
            resolve(cachedLeaderboard);
          }
        }).catch((error) => {
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
              isNegative: income < 0
            });
          }
          if (expense > 0) expenseList.push({ date, amount: "-" + expense.toFixed(2) });
        });
        incomeList.reverse();
        expenseList.reverse();
      }
      const updateTime = /* @__PURE__ */ (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
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
    }
  };

  var cdkMethods = {
    async loadCdkInfo(isManualRefresh = false) {
      if (!this.panel.cdkContainer) return;
      if (!isManualRefresh && !this.shouldRefreshCdkInfo()) return;
      if (isManualRefresh) {
        const refreshBtn = this.panel.cdkContainer.querySelector(".cdk-refresh-btn");
        if (refreshBtn) {
          refreshBtn.textContent = refreshBtn.classList.contains("cdk-panel-refresh") ? "…" : this.t("refreshing");
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
        } catch (_) {
        }
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
            "Cache-Control": "no-cache"
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
          }
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
            Referer: "https://cdk.linux.do/received"
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
                    results: json.data.results || []
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
          }
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
      const updateTime = /* @__PURE__ */ (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
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
        const receivedAt = item.received_at ? new Date(item.received_at).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }) : "-";
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
    }
  };

  var BrowseController = class {
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
          "You are not allowed to react"
        ],
        DIALOG_SELECTOR: ".dialog-body",
        CHALLENGE_PATH: "/challenge",
        NOT_FOUND_REDIRECT_GUARD_KEY: "linux_do_auto_challenge_nf_guard",
        NOT_FOUND_REDIRECT_GUARD_MS: 5e3,
        REDIRECT_DELAY_MS: 120
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
          manualTriggerCF: () => this.manualTriggerCF()
        }
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
        t: this.t
      });
      this.reader = new Reader({
        settings: this.settings,
        session: this.session,
        view: this.panel,
        getCurrentUsername: () => this.getCurrentUsername(),
        hooks: {
          canRead: () => this.automation.canRead(),
          onActive: () => this.automation.onReadingActive(),
          onPause: (reason) => this.automation.onReadingPaused(reason)
        }
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
        t: this.t
      });
      this.automation.connect({
        reader: this.reader,
        likes: this.likes,
        limits: this.limits,
        counter: this.likeCounter
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
  };
  Object.assign(
    BrowseController.prototype,
    lifecycleMethods,
    topicMethods,
    modeMethods,
    rankingMethods,
    cloudflareMethods,
    accountMethods,
    creditMethods,
    cdkMethods
  );

  var APP_KEY = /* @__PURE__ */ Symbol.for("linux-do-assistant.app");
  if (isCDKPage) {
    initCDKBridgePage();
  } else {
    if (window[APP_KEY]?.controller && !window[APP_KEY].controller.scope?.disposed) {
      window.browseController = window[APP_KEY].controller;
    } else {
      networkInterceptor.install();
      const controller = new BrowseController();
      window.browseController = controller;
      window[APP_KEY] = { controller, version: "1.0.2" };
      console.log(`[Linux.do 助手] 模块化启动完成 (${CURRENT_DOMAIN})`);
    }
  }
})();
