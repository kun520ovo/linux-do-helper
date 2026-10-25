import { defaultRuntime } from "./runtime-context.js";

const createUtils = (runtime = defaultRuntime) => {
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
    },
  };
};

const Utils = createUtils();

export { createUtils, Utils };
