const modeMethods = {
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
              ${
                isMobile
                  ? `
              html {
                  -webkit-font-smoothing: antialiased !important;
                  -moz-osx-font-smoothing: grayscale !important;
                  text-rendering: optimizeLegibility !important;
              }
              * {
                  -webkit-overflow-scrolling: touch !important;
              }
              `
                  : ""
              }
              ${
                isIOS
                  ? `
              body {
                  -webkit-transform: translateZ(0) !important;
              }
              `
                  : ""
              }
              ${
                isLowEnd
                  ? `
              *, *::before, *::after {
                  animation-duration: 0.01ms !important;
                  animation-iteration-count: 1 !important;
                  transition-duration: 0.01ms !important;
              }
              `
                  : ""
              }
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
      console.log(`📱 设备类型: ${isMobile ? (isIOS ? "iOS" : "Android") : "桌面"}`);
      console.log(`🔧 优化模式: ${isLowEnd ? "低端设备" : "标准"}`);
      console.log(`🌓 检测主题: ${theme}模式`);
      console.log(`✨ 浅色背景: 对比108% + 亮度97%`);
      console.log(`✨ 深色背景: 对比110% + 亮度103%`);
      console.log(`🖼️  图片对比度: 110%`);
    } else {
      console.log("🎨 黑白灰模式已关闭");
    }
  },
};

export { modeMethods };
