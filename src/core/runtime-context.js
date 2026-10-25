const resolveWindow = (candidate) => {
  if (candidate) return candidate;
  if (typeof window !== "undefined") return window;
  return typeof globalThis !== "undefined" ? globalThis : void 0;
};

const resolveLocation = (windowRef, candidate) => {
  if (candidate) return candidate;
  return windowRef?.location || (typeof location !== "undefined" ? location : void 0);
};

const resolveFetch = (windowRef, candidate) => {
  if (typeof candidate === "function") return candidate;
  if (typeof windowRef?.fetch === "function") return windowRef.fetch.bind(windowRef);
  if (typeof globalThis?.fetch === "function") return globalThis.fetch.bind(globalThis);
  return void 0;
};

const resolveTimer = (windowRef, name) => {
  if (typeof windowRef?.[name] === "function") return windowRef[name].bind(windowRef);
  if (typeof globalThis?.[name] === "function") return globalThis[name].bind(globalThis);
  return void 0;
};

const resolveStorage = (windowRef, name) => {
  try {
    return windowRef?.[name] || (typeof globalThis !== "undefined" ? globalThis[name] : void 0);
  } catch (_) {
    return void 0;
  }
};

const resolveGlobal = (windowRef) => {
  try {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow;
  } catch (_) {}
  return windowRef;
};

const createRuntimeContext = (options = {}) => {
  const windowRef = resolveWindow(options.windowRef || options.window);
  const documentRef = options.documentRef || options.document || windowRef?.document;
  const locationRef = resolveLocation(windowRef, options.locationRef || options.location);
  const currentDomain = String(options.currentDomain ?? locationRef?.hostname ?? "");
  const baseUrl = String(
    options.baseUrl ?? (currentDomain ? `https://${currentDomain}` : locationRef?.origin || ""),
  );
  const fetchFn = resolveFetch(windowRef, options.fetchFn || options.fetch);
  const setTimeoutFn = options.setTimeoutFn || options.setTimeout || resolveTimer(windowRef, "setTimeout");
  const clearTimeoutFn =
    options.clearTimeoutFn || options.clearTimeout || resolveTimer(windowRef, "clearTimeout");
  const setIntervalFn =
    options.setIntervalFn || options.setInterval || resolveTimer(windowRef, "setInterval");
  const clearIntervalFn =
    options.clearIntervalFn || options.clearInterval || resolveTimer(windowRef, "clearInterval");
  const isHeartToggleUrl2 = (url, method = "PUT") => {
    try {
      const parsed = new URL(url, baseUrl);
      return (
        String(method || "GET").toUpperCase() === "PUT" &&
        parsed.origin === baseUrl &&
        /^\/discourse-reactions\/posts\/\d+\/custom-reactions\/heart\/toggle\.json$/.test(parsed.pathname)
      );
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
      saveTab: typeof GM_saveTab === "function" ? GM_saveTab : void 0,
    },
    CURRENT_DOMAIN: currentDomain,
    BASE_URL: baseUrl,
    isCDKPage: currentDomain === "cdk.linux.do",
    isHeartToggleUrl: isHeartToggleUrl2,
  };
};

const defaultRuntime = createRuntimeContext();

const CURRENT_DOMAIN = defaultRuntime.CURRENT_DOMAIN;

const BASE_URL = defaultRuntime.BASE_URL;

const isCDKPage = defaultRuntime.isCDKPage;

const isHeartToggleUrl = defaultRuntime.isHeartToggleUrl;

export {
  resolveWindow,
  resolveLocation,
  resolveFetch,
  resolveTimer,
  resolveStorage,
  resolveGlobal,
  createRuntimeContext,
  defaultRuntime,
  CURRENT_DOMAIN,
  BASE_URL,
  isCDKPage,
  isHeartToggleUrl,
};
