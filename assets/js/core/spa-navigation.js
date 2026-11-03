const PUBLIC_ROUTE_FILES = new Map([
  ["index.html", "home"],
  ["board.html", "board"],
  ["page.html", "page"],
  ["view.html", "view"],
  ["write.html", "write"],
  ["search.html", "search"],
  ["skin-editor.html", "skin-editor"]
]);
const PUBLIC_ROUTES = new Set(PUBLIC_ROUTE_FILES.values());

export function getPublicRoute(urlLike = window.location.href) {
  const url = new URL(urlLike, window.location.href);
  const fileName = url.pathname.split("/").pop() || "index.html";
  if (fileName === "index.html" || !fileName) {
    return url.searchParams.get("route") || "home";
  }
  return PUBLIC_ROUTE_FILES.get(fileName) || "";
}

export function toSpaUrl(urlLike) {
  const url = new URL(urlLike, window.location.href);
  if (url.origin !== window.location.origin) return null;

  const fileName = url.pathname.split("/").pop() || "index.html";
  let route = PUBLIC_ROUTE_FILES.get(fileName);
  if (!route) return null;
  const expectedPath = new URL(fileName, document.baseURI).pathname;
  if (url.pathname !== expectedPath) return null;

  const next = new URL("index.html", url);
  const params = new URLSearchParams(url.search);
  if (fileName === "index.html" && PUBLIC_ROUTES.has(params.get("route"))) {
    route = params.get("route");
  }
  params.delete("route");
  if (route !== "home") params.set("route", route);

  const ordered = new URLSearchParams();
  if (params.has("route")) ordered.set("route", params.get("route"));
  params.forEach((value, key) => {
    if (key !== "route") ordered.append(key, value);
  });

  next.search = ordered.toString();
  next.hash = url.hash;
  return next;
}

export function navigatePublic(urlLike, options = {}) {
  const spaUrl = toSpaUrl(urlLike);
  if (spaUrl && window.NamwallSpa?.navigate) {
    window.NamwallSpa.navigate(spaUrl, options);
    return;
  }

  const fallback = spaUrl?.href || new URL(urlLike, window.location.href).href;
  if (options.replace) {
    window.location.replace(fallback);
  } else {
    window.location.href = fallback;
  }
}
