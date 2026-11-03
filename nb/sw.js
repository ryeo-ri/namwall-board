// NB 서비스 워커 — 정적 파일 캐시로 페이지 이동 시 재다운로드 제거
// 나루가 정적 파일을 max-age=0으로 내려줘서, 매 페이지마다 JS·CSS 20여 개를
// 다시 받는 것이 가장 큰 병목이었다. 전략:
// - /nb/assets/*, SDK 모듈, HTML(내비게이션): 캐시 우선 + 백그라운드 갱신(stale-while-revalidate)
//   → 새 배포는 "다음" 로드부터 반영된다 (한 번 새로고침하면 받아두고, 그 다음에 적용)
//   HTML은 빈 틀이고 내용은 JS가 쿼리로 그리므로, 캐시 우선이어도 내용은 항상 최신이다.
// - API 호출(_query 등)은 절대 캐시하지 않는다

const CACHE_NAME = "nb-static-v1";

const isAssetRequest = (url) =>
  (url.origin === self.location.origin && url.pathname.includes("/nb/assets/"))
  || (url.origin === "https://sdk.naru.pub" && url.pathname.startsWith("/sdk/"));

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

  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response && (response.ok || response.type === "opaque")) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);
  if (cached) return cached;
  return (await refresh) || Response.error();
}
