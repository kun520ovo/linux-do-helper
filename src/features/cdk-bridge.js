import { isCDKPage } from "../core/runtime-context.js";

function initCDKBridgePage() {
  if (!isCDKPage || typeof window === "undefined") return;
  const bridgeKey = Symbol.for("linux-do-assistant.cdk-bridge");
  if (window[bridgeKey]) return window[bridgeKey];
  const cacheAndNotify = async () => {
    try {
      const [userRes, receivedRes] = await Promise.all([
        fetch("https://cdk.linux.do/api/v1/oauth/user-info", {
          credentials: "include",
        }),
        fetch("https://cdk.linux.do/api/v1/projects/received?current=1&size=20&search=", {
          credentials: "include",
        }),
      ]);
      const userData = userRes.ok ? await userRes.json() : null;
      const receivedData = receivedRes.ok ? await receivedRes.json() : null;
      if (!userData?.data) return;
      const cacheData = {
        user: userData.data,
        received: receivedData?.data || null,
      };
      if (typeof GM_setValue === "function") {
        GM_setValue("lda_cdk_cache", { data: cacheData, ts: Date.now() });
      }
      try {
        window.parent?.postMessage(
          {
            type: "lda-cdk-data",
            payload: { data: cacheData },
          },
          "*",
        );
      } catch (_) {}
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

export { initCDKBridgePage };
