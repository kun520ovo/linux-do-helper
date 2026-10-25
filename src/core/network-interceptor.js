import { defaultRuntime } from "./runtime-context.js";

const STATE_KEY = Symbol.for("linux-do-assistant.network-interceptor");

const requestInfo = (args, transport) => {
  const request = args?.[0];
  return {
    transport,
    url: typeof request === "string" ? request : request?.url || request?.href || "",
    method: String(args?.[1]?.method || request?.method || "GET").toUpperCase(),
    args,
  };
};

const callSafely = (callback, payload) => {
  if (typeof callback !== "function") return void 0;
  try {
    return callback(payload);
  } catch (error) {
    console.error("[NetworkInterceptor] subscriber error:", error);
    return void 0;
  }
};

class NetworkInterceptor {
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
      win.fetch = async function (...args) {
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
      XHR.prototype.open = function (method, url, ...rest) {
        this.__ldaNetworkRequest = {
          transport: "xhr",
          url,
          method: String(method || "GET").toUpperCase(),
        };
        return service.originalXhrOpen.apply(this, [method, url, ...rest]);
      };
      XHR.prototype.send = function (body) {
        const request = {
          ...(this.__ldaNetworkRequest || {}),
          transport: "xhr",
          url: this.__ldaNetworkRequest?.url || "",
          method: this.__ldaNetworkRequest?.method || "GET",
          xhr: this,
          body,
        };
        const contexts = service.collectContexts(request);
        const hasMatchingSubscriber = contexts.some(({ value }) => value !== null && value !== void 0);
        if (hasMatchingSubscriber) {
          this.addEventListener(
            "load",
            () => {
              service.dispatchResponse({ request, contexts, response: this });
            },
            { once: true },
          );
          this.addEventListener(
            "error",
            (event) => {
              service.dispatchError({ request, contexts, error: event });
            },
            { once: true },
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
      value: callSafely(subscriber.beforeRequest, request),
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
}

const getNetworkInterceptor = (runtime = defaultRuntime) => {
  const win = runtime.window || (typeof window !== "undefined" ? window : null);
  if (win) {
    if (!win[STATE_KEY]) win[STATE_KEY] = new NetworkInterceptor(runtime);
    return win[STATE_KEY];
  }
  return new NetworkInterceptor(runtime);
};

const networkInterceptor = getNetworkInterceptor();

export { STATE_KEY, requestInfo, callSafely, NetworkInterceptor, getNetworkInterceptor, networkInterceptor };
