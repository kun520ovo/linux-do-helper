import { Storage } from "./storage.js";
import { Utils } from "./utils.js";

class RequestManagerClass {
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
      cooldownMs = 30 * 60 * 1e3,
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
}

const RequestManager = new RequestManagerClass();

export { RequestManagerClass, RequestManager };
