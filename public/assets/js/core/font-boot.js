// 첫 페인트 전에 localStorage에 캐시된 글꼴 설정을 적용해
// 기본 폰트 → 지정 폰트로 바뀌는 깜박임(FOUT)을 줄인다.
// head에서 동기 실행되어야 하므로 모듈이 아닌 일반 스크립트로 유지.
// (링크 id와 URL 형식은 design.js / app.js 와 동일해야 중복 로드가 없다)
(function () {
  try {
    var design = {};
    try { design = JSON.parse(localStorage.getItem("archive_design_cache_v1") || "{}") || {}; } catch (e) { /* ignore */ }
    var headerFont = "";
    try { headerFont = localStorage.getItem("archive_header_font_v1") || ""; } catch (e) { /* ignore */ }

    function clean(value) {
      return String(value || "")
        .replace(/^["']+|["']+$/g, "")
        .replace(/[<>{};]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    }
    function cssName(value) {
      return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    function addFontLink(id, family) {
      if (!family || document.getElementById(id)) return;
      var link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?" + new URLSearchParams({ family: family, display: "swap" }).toString();
      document.head.appendChild(link);
    }

    var heading = clean(design.headingFontFamily);
    var body = clean(design.bodyFontFamily);
    var header = clean(headerFont);
    var root = document.documentElement.style;

    if (heading) {
      addFontLink("archiveHeadingFontLink", heading);
      root.setProperty("--font-heading", cssName(heading) + ', "Pixelify Sans", "Noto Sans KR", sans-serif');
    }
    if (body) {
      addFontLink("archiveBodyFontLink", body);
      root.setProperty("--font-kr", cssName(body) + ', "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif');
    }
    if (header) {
      addFontLink("archiveHeaderFontLink", header);
      root.setProperty("--header-font", cssName(header) + ", var(--font-kr), sans-serif");
    }
  } catch (e) { /* ignore */ }
})();
