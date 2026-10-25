import { CURRENT_DOMAIN, isCDKPage } from "./core/runtime-context.js";
import { networkInterceptor } from "./core/network-interceptor.js";
import { initCDKBridgePage } from "./features/cdk-bridge.js";
import { BrowseController } from "./app/controller.js";

const APP_KEY = Symbol.for("linux-do-assistant.app");
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
