(function () {
  "use strict";

  const routes = {
    "board.html": "board",
    "page.html": "page",
    "view.html": "view",
    "write.html": "write",
    "search.html": "search",
    "skin-editor.html": "skin-editor"
  };
  const fileName = location.pathname.split("/").pop();
  const route = routes[fileName];
  if (!route) return;

  const params = new URLSearchParams(location.search);
  params.delete("route");
  const next = new URL("index.html", location.href);
  const ordered = new URLSearchParams({ route });
  params.forEach((value, key) => ordered.append(key, value));
  next.search = ordered.toString();
  next.hash = location.hash;
  location.replace(next.href);
})();
