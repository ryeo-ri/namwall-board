import { initializeAppPage } from "./app.js";
import { getPublicRoute, toSpaUrl } from "./spa-navigation.js";

const ROUTES = {
  home: {
    load: () => import("../pages/home-page.js?v=20260717-1"),
    initialize: "initializeHomePage"
  },
  board: {
    template: "board.html",
    load: () => import("../pages/board-page.js?v=20260717-1"),
    initialize: "initializeBoardPage",
    cleanup: "cleanupBoardPage"
  },
  page: {
    template: "page.html",
    load: () => import("../pages/page-page.js"),
    initialize: "initializePagePage",
    cleanup: "cleanupPagePage"
  },
  view: {
    template: "view.html",
    load: () => import("../pages/view-page.js"),
    initialize: "initializeViewPage",
    cleanup: "cleanupViewPage"
  },
  write: {
    template: "write.html",
    load: () => import("../pages/write-page.js?v=20260717-1"),
    initialize: "initializeWritePage",
    cleanup: "cleanupWritePage"
  },
  search: {
    template: "search.html",
    load: () => import("../pages/search.js"),
    initialize: "initializeSearchPage",
    cleanup: "cleanupSearchPage"
  },
  "skin-editor": {
    template: "skin-editor.html",
    load: () => import("../pages/skin-editor-page.js"),
    initialize: "initializeSkinEditorPage",
    canLeave: "canLeaveSkinEditorPage",
    cleanup: "cleanupSkinEditorPage"
  }
};

const anchor = document.getElementById("spaRouteAnchor");
const homeTemplate = captureCurrentPage();
const templateCache = new Map();
let activeLifecycle = null;
let navigationSequence = 0;
let renderQueue = Promise.resolve();
let suppressNextPop = false;
let historyPosition = readHistoryPosition();

history.replaceState(
  { ...(history.state || {}), namwallSpa: true, namwallPosition: historyPosition },
  "",
  window.location.href
);

window.NamwallSpa = {
  navigate(urlLike, options = {}) {
    const url = urlLike instanceof URL ? urlLike : toSpaUrl(urlLike);
    if (!url) {
      window.location.href = String(urlLike);
      return true;
    }
    if (!canLeaveActiveRoute()) return false;

    const method = options.replace ? "replaceState" : "pushState";
    const nextPosition = options.replace ? historyPosition : historyPosition + 1;
    history[method](
      { namwallSpa: true, namwallPosition: nextPosition },
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
    historyPosition = nextPosition;
    if (options.render !== false) scheduleRender({ scroll: options.scroll !== false });
    return true;
  },
  isActive(token) {
    return isLifecycleActive(activeLifecycle, token);
  }
};

document.addEventListener("click", handleDocumentClick);
window.addEventListener("popstate", handlePopState);

const publicLinkObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === "attributes") normalizePublicLinks(mutation.target);
    mutation.addedNodes.forEach((node) => normalizePublicLinks(node));
  });
});
publicLinkObserver.observe(document.body, { attributes: true, attributeFilter: ["href"], childList: true, subtree: true });
normalizePublicLinks(document);
scheduleRender({ scroll: false });

function readHistoryPosition() {
  const value = Number(history.state?.namwallPosition);
  return Number.isFinite(value) ? value : 0;
}

function handlePopState(event) {
  if (suppressNextPop) {
    suppressNextPop = false;
    return;
  }

  const targetPosition = Number(event.state?.namwallPosition);
  const nextPosition = Number.isFinite(targetPosition) ? targetPosition : historyPosition - 1;
  if (!canLeaveActiveRoute()) {
    const restoreDelta = historyPosition - nextPosition;
    if (restoreDelta) {
      suppressNextPop = true;
      history.go(restoreDelta);
    }
    return;
  }

  historyPosition = nextPosition;
  scheduleRender({ scroll: false });
}

function scheduleRender(options = {}) {
  const sequence = ++navigationSequence;
  activeLifecycle?.controller.abort();
  renderQueue = renderQueue
    .catch((error) => console.error("Previous SPA route failed:", error))
    .then(() => {
      if (sequence !== navigationSequence) return;
      return renderCurrentRoute(sequence, options);
    });
  return renderQueue;
}

function captureCurrentPage() {
  return {
    bodyClass: document.body.className,
    title: document.title,
    html: Array.from(document.body.querySelectorAll(":scope > [data-spa-page]"))
      .map((element) => element.outerHTML)
      .join("")
  };
}

async function loadTemplate(route, signal) {
  if (route === "home") return homeTemplate;
  if (templateCache.has(route)) return templateCache.get(route);

  const definition = ROUTES[route];
  const response = await fetch(definition.template, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`${definition.template} (${response.status})`);

  const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
  const template = {
    bodyClass: parsed.body.className,
    title: parsed.title,
    html: Array.from(parsed.body.children).map((element) => element.outerHTML).join("")
  };
  templateCache.set(route, template);
  return template;
}

async function renderCurrentRoute(sequence, options = {}) {
  if (sequence !== navigationSequence) return;
  cleanupActiveRoute();

  const requestedRoute = getPublicRoute();
  const route = ROUTES[requestedRoute] ? requestedRoute : "home";
  const definition = ROUTES[route];
  const controller = new AbortController();
  const lifecycle = {
    token: sequence,
    controller,
    cleanup: null,
    canLeave: null,
    leaveApproved: false
  };
  activeLifecycle = lifecycle;

  try {
    const [template, pageModule] = await Promise.all([
      loadTemplate(route, controller.signal),
      definition.load()
    ]);
    if (!isLifecycleActive(lifecycle, sequence)) return;

    window.closeLightbox?.();
    mountTemplate(template);
    if (options.scroll) window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    if (definition.cleanup && typeof pageModule[definition.cleanup] === "function") {
      lifecycle.cleanup = pageModule[definition.cleanup];
    }
    if (definition.canLeave && typeof pageModule[definition.canLeave] === "function") {
      lifecycle.canLeave = pageModule[definition.canLeave];
    }

    const context = {
      token: sequence,
      signal: controller.signal,
      isActive: () => isLifecycleActive(lifecycle, sequence)
    };
    const initializer = pageModule[definition.initialize];
    await Promise.all([
      initializeAppPage(context),
      typeof initializer === "function" ? initializer(context) : Promise.resolve()
    ]);
    if (!isLifecycleActive(lifecycle, sequence)) return;

    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) return;
    console.error("SPA route failed:", error);
    cleanupLifecycle(lifecycle);
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    mountError(route);
    document.body.classList.remove("spa-booting");
  } finally {
    if (isLifecycleActive(lifecycle, sequence)) {
      document.body.classList.remove("spa-booting");
    }
  }
}

function isLifecycleActive(lifecycle, token = lifecycle?.token) {
  return Boolean(
    lifecycle
    && activeLifecycle === lifecycle
    && lifecycle.token === token
    && token === navigationSequence
    && !lifecycle.controller.signal.aborted
  );
}

function canLeaveActiveRoute() {
  try {
    if (!activeLifecycle?.canLeave || activeLifecycle.leaveApproved) return true;
    const canLeave = activeLifecycle.canLeave() !== false;
    if (canLeave) activeLifecycle.leaveApproved = true;
    return canLeave;
  } catch (error) {
    console.warn("SPA leave guard failed:", error);
    return false;
  }
}

function cleanupActiveRoute() {
  if (!activeLifecycle) return;
  cleanupLifecycle(activeLifecycle);
  activeLifecycle = null;
}

function cleanupLifecycle(lifecycle) {
  if (!lifecycle) return;
  lifecycle?.controller.abort();
  try {
    lifecycle?.cleanup?.();
  } catch (error) {
    console.warn("SPA cleanup failed:", error);
  }
  lifecycle.cleanup = null;
  lifecycle.canLeave = null;
  lifecycle.leaveApproved = false;
}

function mountTemplate(template) {
  document.body.querySelectorAll(":scope > [data-spa-page]").forEach((element) => element.remove());
  document.body.className = template.bodyClass;
  document.title = template.title;

  const holder = document.createElement("template");
  holder.innerHTML = template.html;
  Array.from(holder.content.children).forEach((element) => {
    element.setAttribute("data-spa-page", "");
    anchor.before(element);
  });
}

function mountError(route) {
  document.body.querySelectorAll(":scope > [data-spa-page]").forEach((element) => element.remove());
  document.body.className = "site-page";
  document.title = "화면 불러오기 오류";
  const main = document.createElement("main");
  main.className = "container";
  main.setAttribute("data-spa-page", "");
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = `${route} 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.`;
  main.appendChild(notice);
  anchor.before(main);
}

function handleDocumentClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a[href]");
  if (!link || link.target && link.target !== "_self" || link.hasAttribute("download")) return;
  const url = toSpaUrl(link.href);
  if (!url) return;

  event.preventDefault();
  window.NamwallSpa.navigate(url);
}

function normalizePublicLinks(root) {
  const links = [];
  if (root?.nodeType === Node.ELEMENT_NODE && root.matches?.("a[href]")) links.push(root);
  root?.querySelectorAll?.("a[href]").forEach((link) => links.push(link));

  links.forEach((link) => {
    const url = toSpaUrl(link.getAttribute("href"));
    if (!url) return;
    const href = `index.html${url.search}${url.hash}`;
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  });
}
