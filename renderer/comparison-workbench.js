(() => {
  const model = window.comparisonModel;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn, id) => {
    const n = el("button", text);
    n.type = "button";
    n.title = text;
    n.setAttribute("aria-label", text);
    if (id) n.id = id;
    n.onclick = () =>
      Promise.resolve()
        .then(fn)
        .catch((error) => message(error.message, true));
    return n;
  };
  const entry = button("对比", open, "comparison-workspace-button");
  entry.innerHTML =
    '<svg class="sf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5h18m-4-4 4 4-4 4M21 16.5H3m4-4-4 4 4 4"/></svg><span class="sf-label">对比</span>';
  document.querySelector(".sidebar-footer").prepend(entry);
  const panel = el("section", undefined, "comparison-workbench");
  panel.id = "comparison-workbench";
  panel.hidden = true;
  panel.setAttribute("aria-label", "跨 AI 对比");
  document.body.append(panel);
  /* 奥卡姆减法：顶部只保留标题、状态、选择 AI 与关闭，其余交给分屏对比本身。 */
  panel.innerHTML = `<header class="cmp-row"><strong id="cmp-title">跨 AI 对比</strong><span id="cmp-feedback" role="status" aria-live="polite">正在读取…</span><button id="cmp-select-sites" type="button">选择 AI</button><span id="cmp-recovery" hidden><button id="cmp-reload" type="button">重新载入</button><button id="cmp-recover" type="button">恢复备份</button></span><button id="cmp-close" type="button">关闭</button></header><div id="cmp-browsers"></div>`;
  const $ = (s) => panel.querySelector(s);
  const wire = (selector, fn) => {
    $(selector).onclick = () =>
      Promise.resolve()
        .then(fn)
        .catch((error) => message(error.message, true));
  };
  let data = null,
    c = null,
    opened = false,
    dirty = false,
    serial = Promise.resolve(),
    timer,
    journalTimer,
    version = 0,
    blocked = false;
  let originalPage = null,
    originalLoaded = new Set(),
    owned = new Set(),
    zoom = false;
  const journalKey = "aihub-comparison-pending-v1";
  function message(text, error = false) {
    const node = $("#cmp-feedback");
    node.textContent = text;
    node.title = text;
    node.classList.toggle("cmp-error", error);
  }
  function recovery(show) {
    $("#cmp-recovery").hidden = !show;
  }
  function journal() {
    if (!c) return;
    try {
      localStorage.setItem(
        journalKey,
        JSON.stringify({ revision: data.revision, comparison: c }),
      );
    } catch (_) {
      message("临时草稿空间不足，请点击保存；当前编辑仍保留。", true);
    }
  }
  function changed() {
    if (!c) return;
    dirty = true;
    version++;
    clearTimeout(journalTimer);
    journalTimer = setTimeout(journal, 150);
    message("有修改 · 正在等待保存");
    clearTimeout(timer);
    timer = setTimeout(() => save().catch(() => {}), 600);
  }
  function unwrap(r) {
    if (!r?.ok)
      throw Object.assign(new Error(r?.error || "操作失败"), { code: r?.code });
    return r.value;
  }
  function save() {
    clearTimeout(timer);
    const pending = serial.then(async () => {
      if (!c || !dirty) return true;
      if (blocked) throw new Error("保存发生冲突，请先复制内容，再重新载入。");
      clearTimeout(journalTimer);
      journal();
      const snapshot = structuredClone(c),
        v = version;
      message("正在保存到本机…");
      try {
        data = unwrap(
          await window.comparison.save({
            revision: data.revision,
            comparison: snapshot,
          }),
        );
        if (version === v) {
          dirty = false;
          clearTimeout(journalTimer);
          localStorage.removeItem(journalKey);
        } else journal();
        message(dirty ? "新修改等待保存" : "已保存到本机");
        return true;
      } catch (e) {
        if (e.code === "CONFLICT") blocked = true;
        recovery(true);
        message(e.message + " 编辑内容仍保留。", true);
        throw e;
      }
    });
    serial = pending.catch(() => {});
    return pending;
  }
  function available() {
    return SITE_ORDER.filter((id) => SITES[id]).map((id) => ({
      id,
      name: SITES[id].name,
      url: SITES[id].url,
    }));
  }
  function fresh() {
    const sites = available();
    if (sites.length < 2) throw new Error("请先在设置中启用至少两个 AI 站点");
    const value = model.create(sites);
    value.id = crypto.randomUUID();
    return value;
  }
  async function load() {
    data = unwrap(await window.comparison.read());
    c = structuredClone(
      data.comparisons.find((x) => x.id === data.currentId && !x.deleted) ||
        data.comparisons.find((x) => !x.deleted) ||
        fresh(),
    );
    blocked = false;
    let recovered = false;
    try {
      const j = JSON.parse(localStorage.getItem(journalKey) || "null");
      if (j?.comparison?.id) {
        c = j.comparison;
        recovered = true;
        blocked = j.revision !== data.revision;
      }
    } catch (_) {}
    dirty = recovered || !data.comparisons.some((x) => x.id === c.id);
    version++;
    render();
    recovery(blocked);
    message(
      blocked
        ? "草稿与文件版本不一致，请先复制内容再重新载入"
        : recovered
          ? "已恢复异常退出前的草稿"
          : "已载入",
      blocked,
    );
    if (dirty && !blocked) await save();
  }
  async function open() {
    if (opened) return;
    await registryReady;
    opened = true;
    await window.comparison.setActive(true);
    originalPage = activePage;
    originalLoaded = new Set(loadedWebviews);
    panel.hidden = false;
    document.body.classList.add("comparison-open");
    positionPanel();
    try {
      if (!data) await load();
      else render();
    } catch (e) {
      recovery(true);
      message(e.message + " 原文件未修改，可重新载入或恢复备份", true);
    }
    entry.setAttribute("aria-pressed", "true");
  }
  async function close() {
    if (!opened) return true;
    try {
      await save();
    } catch (_) {
      if (
        !confirm(
          "当前修改尚未写入文件。确定返回浏览？编辑内容会继续保留在当前窗口。",
        )
      )
        return false;
    }
    opened = false;
    await window.comparison.setActive(false);
    panel.hidden = true;
    document.body.classList.remove("comparison-open");
    releaseViews(true);
    entry.setAttribute("aria-pressed", "false");
    if (originalPage && getPageInfo(originalPage)) switchPage(originalPage);
    entry.focus();
    return true;
  }
  function releaseViews(all = false) {
    for (const id of [...owned]) {
      if (!all && c.sites.some((s) => s.id === id)) continue;
      const w = document.getElementById("wv-" + id);
      w?.classList.remove("cmp-webview");
      w?.removeAttribute("style");
      if (!originalLoaded.has(id)) {
        w?.remove();
        loadedWebviews.delete(id);
        delete lastUsed[id];
      }
      owned.delete(id);
    }
    updateIndicators();
  }
  function positionPanel() {
    if (!opened) return;
    const r = document.querySelector("#sidebar").getBoundingClientRect();
    panel.style.left =
      (window.innerWidth < 700 ? 0 : Math.max(0, r.right)) + "px";
    layout();
  }
  function layout() {
    if (!opened || !c) return;
    /* 栏宽不足时降级为单栏；其余栏折叠成可点击的标题条，取代原来的站点标签行。 */
    const narrow = panel.clientWidth < (c.sites.length === 3 ? 1050 : 740);
    const single = narrow || zoom;
    panel.classList.toggle("cmp-narrow", narrow);
    panel.classList.toggle("cmp-zoom", zoom);
    for (const s of c.sites) {
      const slot = $(`[data-slot="${s.id}"]`),
        wv = document.getElementById("wv-" + s.id);
      if (!slot || !wv) continue;
      const focused = s.id === c.active,
        visible = !single || focused;
      slot.parentElement.classList.toggle(
        "cmp-collapsed-col",
        single && !focused,
      );
      wv.classList.add("cmp-webview");
      wv.style.display = visible ? "flex" : "none";
      if (visible) {
        const r = slot.getBoundingClientRect();
        wv.style.position = "fixed";
        wv.style.left = r.x + "px";
        wv.style.top = r.y + "px";
        wv.style.width = r.width + "px";
        wv.style.height = r.height + "px";
        wv.style.zIndex = "151";
      }
    }
  }
  function focusSite(id) {
    if (!c || c.active === id) return;
    c.active = id;
    changed();
    layout();
    requestAnimationFrame(() => document.getElementById("wv-" + id)?.focus());
  }
  function renderBrowsers() {
    releaseViews();
    const container = $("#cmp-browsers");
    container.replaceChildren();
    for (const s of c.sites) {
      const column = el("article", undefined, "cmp-column");
      column.style.flexGrow = s.width;
      column.dataset.column = s.id;
      const head = el("div", undefined, "cmp-column-head");
      const nameButton = button(s.name, () => {
        if (panel.classList.contains("cmp-narrow") || zoom) focusSite(s.id);
      });
      nameButton.className = "cmp-col-name";
      head.append(nameButton);
      const loading = el("span", "准备加载", "cmp-loading");
      head.append(loading);
      const refresh = button("刷新", () =>
        document.getElementById("wv-" + s.id)?.reload(),
      );
      const enlarge = button("放大 / 还原", () => {
        c.active = s.id;
        zoom = !zoom;
        changed();
        layout();
      });
      head.append(
        refresh,
        enlarge,
        button("关闭此栏", () => {
          if (c.sites.length === 2) {
            chooseSites();
            return;
          }
          c.sites = c.sites.filter((x) => x.id !== s.id);
          if (c.active === s.id) c.active = c.sites[0].id;
          changed();
          renderBrowsers();
        }),
      );
      const slot = el("div", undefined, "cmp-slot");
      slot.dataset.slot = s.id;
      column.append(head, slot);
      container.append(column);
      if (!SITES[s.id]) {
        slot.textContent = "此站点已移除，请选择其他 AI。";
        continue;
      }
      const wv = getOrCreateWebview(s.id, s.url);
      owned.add(s.id);
      lastUsed[s.id] = Date.now();
      if (!wv.dataset.comparisonEvents) {
        wv.dataset.comparisonEvents = "1";
        for (const event of ["did-navigate", "did-navigate-in-page"])
          wv.addEventListener(event, () => {
            if (!opened) return;
            const site = c.sites.find((x) => x.id === s.id);
            const url = wv.getURL();
            if (site && safeNavigationURL(url) && site.url !== url) {
              site.url = url;
              changed();
            }
          });
        for (const name of [
          "did-start-loading",
          "did-stop-loading",
          "did-fail-load",
        ])
          wv.addEventListener(name, (e) => {
            const n = $(`[data-column="${s.id}"] .cmp-loading`);
            if (n)
              n.textContent =
                name === "did-start-loading"
                  ? "加载中…"
                  : name === "did-fail-load" && e.errorCode !== -3
                    ? "加载失败，可刷新"
                    : "就绪";
          });
        wv.addEventListener("focus", () => {
          if (opened && c.active !== s.id) {
            c.active = s.id;
            changed();
            layout();
          }
        });
      }
      try {
        loading.textContent = wv.isLoading() ? "加载中…" : "就绪";
      } catch (_) {}
      const grip = el("div", undefined, "cmp-grip");
      grip.tabIndex = 0;
      grip.title = "拖动调整栏宽；左右方向键调整";
      grip.setAttribute("role", "separator");
      grip.setAttribute("aria-label", s.name + " 栏宽");
      grip.setAttribute("aria-orientation", "vertical");
      column.append(grip);
      const resize = (delta) => {
        s.width = Math.min(5, Math.max(0.2, s.width + delta));
        column.style.flexGrow = s.width;
        grip.setAttribute("aria-valuenow", Math.round(s.width * 100));
        layout();
      };
      grip.onkeydown = (e) => {
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          resize(e.key === "ArrowRight" ? 0.1 : -0.1);
          changed();
        }
      };
      grip.onpointerdown = (e) => {
        grip.setPointerCapture(e.pointerId);
        let x = e.clientX;
        document.body.classList.add("cmp-resizing");
        grip.onpointermove = (e) => {
          resize((e.clientX - x) / 250);
          x = e.clientX;
        };
        grip.onpointerup = () => {
          grip.onpointermove = null;
          document.body.classList.remove("cmp-resizing");
          changed();
        };
      };
    }
    requestAnimationFrame(layout);
  }
  function select(label, items, value, fn) {
    const n = el("select");
    n.title = label;
    n.setAttribute("aria-label", label);
    for (const [id, text] of items) {
      const o = el("option", text);
      o.value = id;
      n.append(o);
    }
    n.value = value;
    n.onchange = () =>
      Promise.resolve(fn(n.value)).catch((e) => message(e.message, true));
    return n;
  }
  function render() {
    if (!c) return;
    $("#cmp-title").textContent = c.title;
    renderBrowsers();
  }
  function chooseSites() {
    if (!c) return;
    const dialog = el("dialog", undefined, "cmp-chooser");
    dialog.setAttribute("aria-label", "选择并排列 AI");
    dialog.append(el("h3", "选择 2～3 个 AI · 推荐双栏"));
    const picks = [...c.sites.map((s) => s.id)];
    while (picks.length < 3) picks.push("");
    const selectors = picks.map((value, i) => {
      const n = select(
        "第 " + (i + 1) + " 栏",
        [
          ["", i === 2 ? "不启用第三栏" : "请选择"],
          ...available().map((s) => [s.id, s.name]),
        ],
        value,
        () => {},
      );
      dialog.append(n);
      return n;
    });
    const err = el("p");
    dialog.append(
      err,
      button("应用", () => {
        const ids = selectors.map((n) => n.value).filter(Boolean);
        if (
          ids.length < 2 ||
          ids.length > 3 ||
          new Set(ids).size !== ids.length
        ) {
          err.textContent = "请选择 2～3 个不同的 AI。";
          return;
        }
        c.sites = ids.map(
          (id) =>
            c.sites.find((s) => s.id === id) || {
              id,
              name: SITES[id].name,
              url: SITES[id].url,
              status: "pending",
              width: 1,
            },
        );
        if (!ids.includes(c.active)) c.active = ids[0];
        changed();
        dialog.close();
        render();
      }),
      button("取消", () => {
        dialog.close();
      }),
    );
    // Keep the closing sheet alive until its return transition has finished.
    dialog.addEventListener("close", () => {
      dialog.inert = true;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = parseFloat(getComputedStyle(dialog).getPropertyValue("--gb-motion-normal")) || 240;
      setTimeout(() => dialog.remove(), reduced ? 0 : duration + 20);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }
  wire("#cmp-select-sites", chooseSites);
  wire("#cmp-close", close);
  wire("#cmp-reload", async () => {
    if (dirty && !confirm("先复制未保存内容。确定重新载入并放弃当前修改？"))
      return;
    clearTimeout(timer);
    await serial;
    localStorage.removeItem(journalKey);
    await load();
  });
  wire("#cmp-recover", async () => {
    if (dirty && !confirm("当前还有未保存编辑。确定继续恢复备份？")) return;
    clearTimeout(timer);
    await serial;
    const restored = unwrap(await window.comparison.recover());
    if (restored) {
      localStorage.removeItem(journalKey);
      await load();
    }
  });
  new ResizeObserver(() => layout()).observe($("#cmp-browsers"));
  new ResizeObserver(positionPanel).observe(document.querySelector("#sidebar"));
  window.addEventListener("resize", positionPanel);
  document.addEventListener(
    "keydown",
    (e) => {
      if (!opened || document.querySelector("dialog[open]")) return;
      let fn;
      if (e.ctrlKey && e.key.toLowerCase() === "s") fn = save;
      else if (e.key === "Escape") fn = close;
      if (fn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        Promise.resolve()
          .then(fn)
          .catch((err) => message(err.message, true));
      }
    },
    true,
  );
  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      journal();
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.comparison.onShortcut((value) =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { ...value, bubbles: true }),
    ),
  );
  window.comparison.onCapture((snapshot) => {
    if (!opened || !c) return;
    if (snapshot.comparisonId && snapshot.comparisonId !== c.id) {
      message("采集对应的对比已切换，请重新选择文字采集。", true);
      return;
    }
    const s = snapshot.source;
    if (!c.sites.some((x) => x.id === s.siteId)) return;
    c.answers.push({
      id: crypto.randomUUID(),
      title: snapshot.title,
      pageTitle: s.title,
      text: snapshot.text,
      siteId: s.siteId,
      siteName: s.siteName,
      url: s.url,
      capturedAt: s.capturedAt,
      prompt: snapshot.prompt ?? c.prompt,
      notes: "",
      recommended: false,
      common: false,
      conflict: false,
      deleted: false,
    });
    c.sites.find((x) => x.id === s.siteId).status = "captured";
    changed();
    message("已采集「" + s.siteName + "」的回答");
  });
  window.app.onGuestPopup(({ guestId, url }) => {
    const w = [...document.querySelectorAll("webview")].find((w) => {
      try {
        return w.getWebContentsId() === guestId;
      } catch (_) {
        return false;
      }
    });
    if (w) handlePopupUrl(url, w.id.slice(3));
  });
  window.comparisonWorkbench = Object.freeze({
    open,
    close,
    selectSite: (id) => {
      if (opened && c.sites.some((s) => s.id === id)) focusSite(id);
    },
    captureContext: () =>
      opened && c ? { comparisonId: c.id, prompt: "" } : {},
    isOpen: () => opened,
    contains: (id) => opened && !!c?.sites.some((s) => s.id === id),
    activeWebview: () =>
      opened ? document.getElementById("wv-" + c?.active) : null,
  });
})();
