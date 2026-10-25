const topicMethods = {
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
      row.getAttribute("data-bumped-at"),
    ].filter(Boolean);
    for (const value of candidates) {
      const parsed = parsePossibleDate(value);
      if (parsed) return parsed;
    }
    const topicLink = row.querySelector("a.title, .main-link a, a.raw-topic-link");
    if (topicLink) {
      const activityCell2 = topicLink
        .closest("tr")
        ?.querySelector("td.activity[title], td.age[title], td.topic-list-data.age[title]");
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
        topicLink.getAttribute("aria-label"),
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
      "td.activity[title], td.age[title], td.topic-list-data.age[title]",
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
        "td.activity a.post-activity, td.age a.post-activity, td.topic-list-data.age a.post-activity",
      );
      const activityCell =
        activityLink?.closest("td.activity, td.age, td.topic-list-data.age") ||
        row.querySelector("td.activity, td.age, td.topic-list-data.age");
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
      meta.dataset.ageLevel = this.settings.topicAgeColorEnabled
        ? this.getTopicAgeLevel(createdAt)
        : "neutral";
      meta.innerHTML = `<span class="lda-topic-created-separator">｜</span><span class="lda-topic-created-label">创建: ${formatted}</span>`;
      meta.title = `帖子创建时间：${formatted}`;
    });
  },
  initTopicCreatedTimeEnhancer() {
    this.renderTopicCreatedTimeInList();
    if (this._topicCreatedTimeObserver) {
      try {
        this._topicCreatedTimeObserver.disconnect();
      } catch (_) {}
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
          if (
            node.matches?.("tr.topic-list-item, tr.latest-topic-list-item, .topic-list") ||
            node.querySelector?.("tr.topic-list-item, tr.latest-topic-list-item")
          ) {
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
      this._floorSmallActionPromise = fetch(jsonUrl, { credentials: "include" })
        .then((r) => (r && r.ok ? r.json() : null))
        .then((data) => {
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
        })
        .then((smallNums) => {
          if (Array.isArray(smallNums)) {
            const prev = this._floorSmallActionNumbers;
            this._floorSmallActionNumbers = smallNums;
            if (!Array.isArray(prev) || prev.length !== smallNums.length) {
              setTimeout(() => {
                if (this._floorTopicId === topicId) {
                  try {
                    this.addFloorNumbers();
                  } catch (_) {}
                }
              }, 0);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          this._floorSmallActionPromise = null;
        });
    };
    ensureSmallActionNumbers();
    let smallActionPostNumbers = Array.isArray(this._floorSmallActionNumbers)
      ? this._floorSmallActionNumbers
      : null;
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
      const isSmallActionWrapper = !!(
        postWrapper &&
        (postWrapper.classList.contains("small-action") || !!postWrapper.querySelector(".small-action"))
      );
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
      } catch (_) {}
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
  },
};

export { topicMethods };
