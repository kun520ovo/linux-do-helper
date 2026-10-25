import panelCss from "./styles/panel.css";
import controlsCss from "./styles/controls.css";

const styledDocuments = new WeakSet();

export function installPanelStyles(documentRef = document) {
  if (styledDocuments.has(documentRef) || documentRef.getElementById("linux-do-assistant-panel-style"))
    return;
  const css = panelCss + "\n" + controlsCss;
  if (typeof GM_addStyle === "function") {
    const style = GM_addStyle(css);
    if (style?.nodeType === 1) style.id = "linux-do-assistant-panel-style";
    styledDocuments.add(documentRef);
    return;
  }
  const style = documentRef.createElement("style");
  style.id = "linux-do-assistant-panel-style";
  style.textContent = css;
  (documentRef.head || documentRef.documentElement).appendChild(style);
  styledDocuments.add(documentRef);
}
