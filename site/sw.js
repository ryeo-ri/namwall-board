// NARU BOARD Copyright (c) 2026 NAMWALL — MPL-2.0 (https://mozilla.org/MPL/2.0/)
// 서비스 워커 — assets/*, SDK, 최상위 게시판 페이지를 캐시 우선 + 백그라운드 갱신으로 제공한다.
// 새 배포는 다음 로드부터 반영된다. API 호출과 하위 폴더 페이지는 건드리지 않는다.
const CACHE_NAME = "board-static-1.0.0";
const SCOPE = self.registration.scope;
const ASSET_BASE = new URL("assets/", SCOPE).href;

const isAssetRequest = (url) =>
  url.href.startsWith(ASSET_BASE)
  || (url.origin === "https://sdk.naru.pub" && url.pathname.startsWith("/sdk/"));

const isBoardPage = (url) => url.href.startsWith(SCOPE) && !url.href.slice(SCOPE.length).split(/[?#]/)[0].includes("/");

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch (_error) { return; }

  if (isAssetRequest(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.mode === "navigate" && isBoardPage(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  // 갱신은 HTTP 캐시를 건너뛴다 — r2.naru.pub 리다이렉트 응답엔 캐시 지시가 없어 옛 파일이 남는다.
  // (내비게이션 요청은 옵션을 바꿔 다시 만들 수 없지만 HTML은 max-age=0)
  const fresh = request.mode === "navigate" ? request : new Request(request, { cache: "no-cache" });
  const refresh = fetch(fresh).then((response) => {
    if (response && (response.ok || response.type === "opaque")) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);
  if (cached) return cached;
  return (await refresh) || Response.error();
}
