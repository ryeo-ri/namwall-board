/*
 * YouTube Diamond Playlist Player
 * HTML에는 아래 한 줄만 추가하면 됩니다.
 * <script src="assets/js/youtube-diamond-player.js"></script>
 */
(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────
  // 여기만 수정하세요.
  // playlistUrl: YouTube 재생목록 주소 또는 재생목록 ID
  // autoplay: true = 접속 시 자동 재생 / false = 클릭 후 재생
  // shuffle: true = 랜덤 재생 / false = 재생목록 순서대로 재생
  // ─────────────────────────────────────────────────────────────
  const CONFIG = {
    playlistUrl: "https://youtube.com/playlist?list=PLf4f9zLAgcgrM7XtXGbj4EbAde_CXjRQd&si=kImfcKbIMb2lkvBm",
    autoplay: true,
    shuffle: true,
    loop: true,
    volume: 70,
    position: {
      left: "28px",
      bottom: "28px"
    },
    lineColor: "#000000",
    titleColor: "#000000",
    titleBackground: "transparent"
  };

  const ROOT_ID = "youtube-diamond-player";
  const API_PROMISE_KEY = "__youtubeDiamondIframeApiPromise";
  const PLAYING_STATE = 1;
  const BUFFERING_STATE = 3;
  const CUED_STATE = 5;
  const LAST_TRACK_STORAGE_PREFIX = "youtubeDiamondPlayer:lastTrack:";
  const VISUAL_SIZE = 28;
  const VISUAL_CENTER = VISUAL_SIZE / 2;
  const PARTICLE_COUNT = 48;
  const PARTICLE_RADIUS = 0.35;

  let player = null;
  let root = null;
  let controlButton = null;
  let titleElement = null;
  let titleTrack = null;
  let titleCopy = null;
  let titleClone = null;
  let canvas = null;
  let animationFrame = 0;
  let visualSpread = 0.16;
  let currentStatus = "loading";
  let shuffleApplied = false;
  let initialTrackResolved = false;
  let autoplayPending = false;
  let autoplayMuted = false;
  let autoplayFallbackTried = false;
  let autoplayRecoveryCount = 0;
  let autoplayProbeTimer = 0;
  let autoplayUnlockBound = false;
  let errorSkipTimer = 0;
  const particles = [];

  function getPlaylistId(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) return "";

    try {
      const url = new URL(rawValue, window.location.href);
      const listId = url.searchParams.get("list");
      if (listId) return listId;
    } catch (_) {
      // URL이 아니라 재생목록 ID만 입력한 경우 아래 값을 그대로 사용합니다.
    }

    const listMatch = rawValue.match(/[?&]list=([^&#]+)/i);
    return listMatch ? decodeURIComponent(listMatch[1]) : rawValue;
  }

  function insertStyles() {
    if (document.getElementById(`${ROOT_ID}-style`)) return;

    const style = document.createElement("style");
    style.id = `${ROOT_ID}-style`;
    style.textContent = `
      #${ROOT_ID} {
        --ydp-line: #fff;
        --ydp-title: #fff;
        --ydp-title-bg: rgba(12, 12, 14, .82);
        position: fixed;
        z-index: 2147483000;
        width: 28px;
        height: 28px;
        font-family: Arial, "Noto Sans KR", sans-serif;
        isolation: isolate;
      }
      #${ROOT_ID},
      #${ROOT_ID} * {
        box-sizing: border-box;
      }
      #${ROOT_ID} .ydp-control {
        position: relative;
        z-index: 2;
        display: block;
        width: 28px;
        height: 28px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        overflow: visible;
        background: transparent;
        color: var(--ydp-line);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      #${ROOT_ID} .ydp-control:disabled {
        cursor: wait;
      }
      #${ROOT_ID} .ydp-control:focus-visible {
        outline: 1px solid var(--ydp-line);
        outline-offset: 3px;
      }
      #${ROOT_ID} .ydp-visual,
      #${ROOT_ID} .ydp-effects {
        position: absolute;
        inset: 0;
        width: 28px;
        height: 28px;
        pointer-events: none;
      }
      #${ROOT_ID} .ydp-effects {
        z-index: 1;
      }
      #${ROOT_ID} .ydp-diamond {
        position: absolute;
        z-index: 2;
        left: 5px;
        top: 5px;
        width: 18px;
        height: 18px;
        border: 1px solid var(--ydp-line);
        transform: rotate(45deg);
        opacity: 1;
        transition: transform .25s ease;
      }
      #${ROOT_ID}:hover .ydp-diamond {
        transform: rotate(90deg);
      }
      #${ROOT_ID} .ydp-title-wrap {
        position: absolute;
        z-index: 1;
        left: 24px;
        top: 50%;
        max-width: 0;
        overflow: hidden;
        opacity: 0;
        transform: translate(-8px, -50%);
        transition: max-width .35s ease, opacity .22s ease, transform .35s ease;
        pointer-events: none;
      }
      #${ROOT_ID}:hover .ydp-title-wrap {
        max-width: min(390px, calc(100vw - 54px));
        opacity: 1;
        transform: translate(0, -50%);
      }
      #${ROOT_ID} .ydp-title {
        display: block;
        max-width: min(360px, calc(100vw - 72px));
        padding: 8px 10px 8px 12px;
        overflow: hidden;
        color: var(--ydp-title);
        background: var(--ydp-title-bg);
        font-size: 12px;
        font-weight: 500;
        line-height: 1.4;
        letter-spacing: .01em;
        white-space: nowrap;
      }
      #${ROOT_ID} .ydp-title-track {
        display: flex;
        width: max-content;
        align-items: center;
        gap: 28px;
        transform: translateX(0);
        white-space: nowrap;
        will-change: transform;
      }
      #${ROOT_ID} .ydp-title-copy,
      #${ROOT_ID} .ydp-title-clone {
        display: block;
        flex: 0 0 auto;
      }
      #${ROOT_ID} .ydp-title-clone {
        display: none;
      }
      #${ROOT_ID} .ydp-title.is-marquee .ydp-title-clone {
        display: block;
      }
      #${ROOT_ID}:hover .ydp-title.is-marquee .ydp-title-track {
        animation: ydp-title-marquee var(--ydp-marquee-duration, 12s) linear infinite;
      }
      #${ROOT_ID} .ydp-youtube-host {
        position: fixed;
        left: -10000px;
        top: 0;
        width: 200px;
        height: 200px;
        overflow: hidden;
        pointer-events: none;
        opacity: .001;
      }
      #${ROOT_ID} .ydp-youtube-host iframe {
        width: 200px !important;
        height: 200px !important;
      }
      @keyframes ydp-title-marquee {
        0%, 12% { transform: translateX(0); }
        88%, 100% { transform: translateX(calc(-1 * var(--ydp-marquee-distance, 0px))); }
      }
      @media (max-width: 520px) {
        #${ROOT_ID} .ydp-title-wrap {
          left: 24px;
        }
        #${ROOT_ID} .ydp-title {
          max-width: calc(100vw - 70px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #${ROOT_ID} .ydp-diamond {
          animation: none !important;
        }
        #${ROOT_ID} .ydp-title-track {
          animation: none !important;
        }
        #${ROOT_ID} .ydp-title-wrap {
          transition-duration: .01ms;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function createWidget() {
    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot) return existingRoot;

    insertStyles();
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.dataset.status = "loading";
    root.style.left = CONFIG.position.left;
    root.style.bottom = CONFIG.position.bottom;
    root.style.setProperty("--ydp-line", CONFIG.lineColor);
    root.style.setProperty("--ydp-title", CONFIG.titleColor);
    root.style.setProperty("--ydp-title-bg", CONFIG.titleBackground);
    root.innerHTML = `
      <button class="ydp-control" type="button" aria-label="YouTube 플레이어 준비 중" aria-pressed="false" disabled>
        <span class="ydp-visual" aria-hidden="true">
          <canvas class="ydp-effects"></canvas>
          <span class="ydp-diamond"></span>
        </span>
      </button>
      <span class="ydp-title-wrap" aria-live="polite">
        <span class="ydp-title">
          <span class="ydp-title-track">
            <span class="ydp-title-copy">YouTube 플레이어 준비 중…</span>
            <span class="ydp-title-clone" aria-hidden="true">YouTube 플레이어 준비 중…</span>
          </span>
        </span>
      </span>
      <span class="ydp-youtube-host" aria-hidden="true"><span id="${ROOT_ID}-iframe"></span></span>
    `;

    document.body.appendChild(root);
    controlButton = root.querySelector(".ydp-control");
    titleElement = root.querySelector(".ydp-title");
    titleTrack = root.querySelector(".ydp-title-track");
    titleCopy = root.querySelector(".ydp-title-copy");
    titleClone = root.querySelector(".ydp-title-clone");
    canvas = root.querySelector(".ydp-effects");
    controlButton.addEventListener("click", togglePlayback);
    window.addEventListener("resize", updateTitleMarquee, { passive: true });
    setTitle("YouTube 플레이어 준비 중…");
    startVisualLoop();
    return root;
  }

  function setTitle(text) {
    if (!titleElement || !titleCopy || !titleClone) return;
    const title = String(text || "제목 없음");
    titleCopy.textContent = title;
    titleClone.textContent = title;
    window.requestAnimationFrame(updateTitleMarquee);
  }

  function updateTitleMarquee() {
    if (!titleElement || !titleTrack || !titleCopy || !titleClone) return;

    titleElement.classList.remove("is-marquee");
    titleElement.style.width = "auto";
    titleTrack.style.removeProperty("--ydp-marquee-distance");
    titleTrack.style.removeProperty("--ydp-marquee-duration");

    const horizontalPadding = 22;
    const maxWidth = Math.max(96, Math.min(360, window.innerWidth - 72));
    const textWidth = Math.ceil(titleCopy.getBoundingClientRect().width);
    const isLongTitle = textWidth + horizontalPadding > maxWidth;
    titleElement.style.width = `${isLongTitle ? maxWidth : textWidth + horizontalPadding}px`;

    if (!isLongTitle) return;

    const marqueeGap = 28;
    const distance = textWidth + marqueeGap;
    const duration = Math.max(9, distance / 28);
    titleElement.classList.add("is-marquee");
    titleTrack.style.setProperty("--ydp-marquee-distance", `${distance}px`);
    titleTrack.style.setProperty("--ydp-marquee-duration", `${duration.toFixed(2)}s`);
  }

  function setStatus(status) {
    currentStatus = status;
    if (!root || !controlButton) return;

    root.dataset.status = status;
    const isPlaying = status === "playing";
    controlButton.setAttribute("aria-pressed", String(isPlaying));
    controlButton.setAttribute("aria-label", isPlaying ? "일시정지" : "재생");
  }

  function updateCurrentTitle(fallbackText = "클릭하여 재생") {
    if (!player || typeof player.getVideoData !== "function") {
      setTitle(fallbackText);
      return;
    }

    const videoData = player.getVideoData() || {};
    setTitle(videoData.title || fallbackText);
  }

  function applyPlaylistOptions() {
    if (!player) return;
    if (typeof player.setLoop === "function") player.setLoop(Boolean(CONFIG.loop));
    if (typeof player.setShuffle === "function") {
      player.setShuffle(Boolean(CONFIG.shuffle));
      shuffleApplied = true;
    }
  }

  function cueRandomInitialTrack() {
    if (!player || !CONFIG.shuffle || initialTrackResolved) return false;
    const playlist = typeof player.getPlaylist === "function" ? player.getPlaylist() : [];
    if (!Array.isArray(playlist) || playlist.length < 2) {
      initialTrackResolved = true;
      return false;
    }

    const playlistId = getPlaylistId(CONFIG.playlistUrl);
    const storageKey = `${LAST_TRACK_STORAGE_PREFIX}${playlistId}`;
    let previousVideoId = "";
    try {
      previousVideoId = window.localStorage.getItem(storageKey) || "";
    } catch (_) {
      // 저장소 사용이 제한된 브라우저에서는 현재 진입에서만 무작위 선택합니다.
    }

    const indexedVideos = playlist.map((videoId, index) => ({ videoId, index }));
    const differentVideos = indexedVideos.filter((item) => item.videoId !== previousVideoId);
    const candidates = differentVideos.length ? differentVideos : indexedVideos;
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    initialTrackResolved = true;

    try {
      window.localStorage.setItem(storageKey, selected.videoId);
    } catch (_) {
      // 다음 방문 중복 방지는 저장소를 사용할 수 있을 때만 적용됩니다.
    }

    player.cuePlaylist({
      listType: "playlist",
      list: playlistId,
      index: selected.index,
      startSeconds: 0
    });
    return true;
  }

  function getConfiguredVolume() {
    return Math.max(0, Math.min(100, Number(CONFIG.volume) || 0));
  }

  function removeAutoplayUnlockListeners() {
    if (!autoplayUnlockBound) return;
    autoplayUnlockBound = false;
    document.removeEventListener("click", handleAutoplayUnlock);
    document.removeEventListener("keydown", handleAutoplayUnlock, true);
  }

  function restoreAutoplayAudio() {
    if (!autoplayMuted || !player) return false;
    autoplayMuted = false;
    removeAutoplayUnlockListeners();
    if (typeof player.unMute === "function") player.unMute();
    if (typeof player.setVolume === "function") player.setVolume(getConfiguredVolume());
    if (typeof player.playVideo === "function") player.playVideo();
    setStatus("playing");
    return true;
  }

  function handleAutoplayUnlock(event) {
    const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (root && (root.contains(event.target) || eventPath.includes(root))) return;
    restoreAutoplayAudio();
  }

  function bindAutoplayUnlockListeners() {
    if (autoplayUnlockBound) return;
    autoplayUnlockBound = true;
    document.addEventListener("click", handleAutoplayUnlock);
    document.addEventListener("keydown", handleAutoplayUnlock, true);
  }

  function startMutedAutoplay(force = false) {
    if (!CONFIG.autoplay || !player || (autoplayFallbackTried && !force)) return false;
    autoplayFallbackTried = true;
    autoplayPending = false;
    autoplayMuted = true;
    window.clearTimeout(autoplayProbeTimer);
    if (typeof player.mute === "function") player.mute();
    setStatus("loading");
    setTitle("자동 재생 중 · 클릭하면 소리가 켜집니다");
    player.playVideo();
    bindAutoplayUnlockListeners();
    return true;
  }

  function startAutoplay() {
    autoplayPending = false;
    autoplayFallbackTried = false;
    autoplayRecoveryCount = 0;
    autoplayMuted = false;
    if (typeof player.unMute === "function") player.unMute();
    if (typeof player.setVolume === "function") player.setVolume(getConfiguredVolume());
    setStatus("loading");
    setTitle("자동 재생 준비 중");
    player.playVideo();
    window.clearTimeout(autoplayProbeTimer);
    autoplayProbeTimer = window.setTimeout(() => {
      if (!player || typeof player.getPlayerState !== "function") return;
      const state = player.getPlayerState();
      if (state !== PLAYING_STATE && state !== BUFFERING_STATE) startMutedAutoplay();
    }, 900);
  }

  function handlePlayerReady(event) {
    player = event.target;
    shuffleApplied = false;
    initialTrackResolved = !CONFIG.shuffle;
    autoplayPending = Boolean(CONFIG.autoplay);
    autoplayMuted = false;
    autoplayFallbackTried = false;
    autoplayRecoveryCount = 0;
    window.clearTimeout(autoplayProbeTimer);
    removeAutoplayUnlockListeners();
    player.setVolume(getConfiguredVolume());
    player.cuePlaylist({
      listType: "playlist",
      list: getPlaylistId(CONFIG.playlistUrl),
      index: 0,
      startSeconds: 0
    });
    controlButton.disabled = false;
    setStatus("ready");
    setTitle("클릭하여 재생");
  }

  function handlePlayerStateChange(event) {
    window.clearTimeout(errorSkipTimer);

    if (event.data === PLAYING_STATE) {
      window.clearTimeout(autoplayProbeTimer);
      if (!shuffleApplied) applyPlaylistOptions();
      setStatus("playing");
      if (autoplayMuted) controlButton.setAttribute("aria-label", "소리 켜기");
      window.setTimeout(() => updateCurrentTitle("재생 중"), 80);
      return;
    }

    if (event.data === BUFFERING_STATE) {
      setStatus("loading");
      window.setTimeout(() => updateCurrentTitle("불러오는 중…"), 80);
      return;
    }

    if (event.data === CUED_STATE) {
      if (cueRandomInitialTrack()) return;
      applyPlaylistOptions();
      if (autoplayPending) {
        startAutoplay();
        return;
      }
      setStatus("ready");
      window.setTimeout(() => updateCurrentTitle("클릭하여 재생"), 80);
      return;
    }

    if (event.data === 2) {
      setStatus("paused");
      updateCurrentTitle("일시정지");
      return;
    }

    if (event.data === 0) {
      setStatus("loading");
      window.setTimeout(() => updateCurrentTitle("다음 곡 불러오는 중…"), 80);
    }
  }

  function handlePlayerError() {
    window.clearTimeout(autoplayProbeTimer);
    setStatus("error");
    setTitle("재생할 수 없는 곡 · 다음 곡으로 이동합니다");
    window.clearTimeout(errorSkipTimer);
    errorSkipTimer = window.setTimeout(() => {
      if (player && typeof player.nextVideo === "function") player.nextVideo();
    }, 900);
  }

  function handleAutoplayBlocked() {
    autoplayRecoveryCount += 1;
    if (autoplayRecoveryCount <= 2 && startMutedAutoplay(true)) return;
    const state = player && typeof player.getPlayerState === "function" ? player.getPlayerState() : null;
    if (state === PLAYING_STATE || state === BUFFERING_STATE) {
      autoplayMuted = true;
      if (typeof player.mute === "function") player.mute();
      bindAutoplayUnlockListeners();
      setStatus("playing");
      controlButton.setAttribute("aria-label", "소리 켜기");
      return;
    }
    autoplayMuted = false;
    removeAutoplayUnlockListeners();
    setStatus("ready");
    updateCurrentTitle("클릭하여 재생");
  }

  function togglePlayback() {
    if (!player || typeof player.getPlayerState !== "function") return;
    const state = player.getPlayerState();
    if (autoplayMuted) {
      restoreAutoplayAudio();
      return;
    }
    if (state === PLAYING_STATE || state === BUFFERING_STATE) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }

  function loadYouTubeIframeApi() {
    if (window.YT && typeof window.YT.Player === "function") return Promise.resolve(window.YT);
    if (window[API_PROMISE_KEY]) return window[API_PROMISE_KEY];

    window[API_PROMISE_KEY] = new Promise((resolve, reject) => {
      const previousReadyHandler = window.onYouTubeIframeAPIReady;
      let timeoutId = 0;

      window.onYouTubeIframeAPIReady = function () {
        if (typeof previousReadyHandler === "function") previousReadyHandler();
        window.clearTimeout(timeoutId);
        resolve(window.YT);
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const apiScript = document.createElement("script");
        apiScript.src = "https://www.youtube.com/iframe_api";
        apiScript.async = true;
        apiScript.onerror = () => reject(new Error("YouTube IFrame API를 불러오지 못했습니다."));
        document.head.appendChild(apiScript);
      }

      timeoutId = window.setTimeout(() => {
        if (!(window.YT && typeof window.YT.Player === "function")) {
          reject(new Error("YouTube IFrame API 응답 시간이 초과되었습니다."));
        }
      }, 15000);
    });

    return window[API_PROMISE_KEY];
  }

  function resizeCanvas() {
    if (!canvas) return null;
    const size = VISUAL_SIZE;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
    }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return context;
  }

  function ensureParticles() {
    while (particles.length < PARTICLE_COUNT) {
      const targetX = (Math.random() * 2 - 1) * 11;
      const targetY = (Math.random() * 2 - 1) * 11;
      if (Math.abs(targetX) + Math.abs(targetY) > 11) continue;

      particles.push({
        targetX,
        targetY,
        phase: Math.random() * Math.PI * 2,
        drift: .65 + Math.random() * 1.1
      });
    }
  }

  function getPlaybackPulse(time) {
    if (currentStatus !== "playing") return 0;
    const playbackTime = player && typeof player.getCurrentTime === "function"
      ? player.getCurrentTime()
      : time / 1000;
    const fastBeat = (Math.sin(playbackTime * Math.PI * 3.4) + 1) / 2;
    const slowBeat = (Math.sin(playbackTime * Math.PI * 1.12 + .8) + 1) / 2;
    return Math.min(1, Math.pow(fastBeat, 5) * .72 + Math.pow(slowBeat, 7) * .48);
  }

  function drawVisual(time) {
    const context = resizeCanvas();
    if (!context) return;

    context.clearRect(0, 0, VISUAL_SIZE, VISUAL_SIZE);
    const isPlaying = currentStatus === "playing";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pulse = isPlaying && !reducedMotion ? getPlaybackPulse(time) : 0;
    const targetSpread = isPlaying && !reducedMotion ? .16 + pulse * .84 : .16;
    visualSpread += (targetSpread - visualSpread) * (targetSpread > visualSpread ? .2 : .1);

    context.save();
    context.beginPath();
    context.moveTo(VISUAL_CENTER, 1.25);
    context.lineTo(26.75, VISUAL_CENTER);
    context.lineTo(VISUAL_CENTER, 26.75);
    context.lineTo(1.25, VISUAL_CENTER);
    context.closePath();
    context.clip();

    ensureParticles();
    context.globalAlpha = 1;
    context.fillStyle = CONFIG.lineColor;
    particles.forEach((particle) => {
      const driftAmount = isPlaying && !reducedMotion ? .35 * pulse : 0;
      const driftX = Math.cos(time * .001 * particle.drift + particle.phase) * driftAmount;
      const driftY = Math.sin(time * .0012 * particle.drift + particle.phase) * driftAmount;
      const x = VISUAL_CENTER + particle.targetX * visualSpread + driftX;
      const y = VISUAL_CENTER + particle.targetY * visualSpread + driftY;
      context.beginPath();
      context.arc(x, y, PARTICLE_RADIUS, 0, Math.PI * 2);
      context.fill();
    });

    context.restore();
  }

  function startVisualLoop() {
    window.cancelAnimationFrame(animationFrame);
    const tick = (time) => {
      drawVisual(time);
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
  }

  async function initialize() {
    const playlistId = getPlaylistId(CONFIG.playlistUrl);
    createWidget();

    if (!playlistId) {
      setStatus("error");
      setTitle("CONFIG.playlistUrl에 재생목록 주소를 입력하세요");
      return;
    }

    try {
      const YT = await loadYouTubeIframeApi();
      player = new YT.Player(`${ROOT_ID}-iframe`, {
        width: 200,
        height: 200,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          rel: 0,
          origin: /^https?:$/.test(window.location.protocol) ? window.location.origin : undefined
        },
        events: {
          onReady: handlePlayerReady,
          onStateChange: handlePlayerStateChange,
          onError: handlePlayerError,
          onAutoplayBlocked: handleAutoplayBlocked
        }
      });
    } catch (error) {
      console.error("[YouTubeDiamondPlayer]", error);
      setStatus("error");
      setTitle(error.message || "YouTube 플레이어를 불러오지 못했습니다");
    }
  }

  window.YouTubeDiamondPlayer = {
    config: CONFIG,
    getPlayer: () => player,
    play: () => player && player.playVideo(),
    pause: () => player && player.pauseVideo(),
    toggle: togglePlayback,
    next: () => player && player.nextVideo(),
    previous: () => player && player.previousVideo(),
    setShuffle(value) {
      CONFIG.shuffle = Boolean(value);
      shuffleApplied = false;
      if (player && typeof player.setShuffle === "function") applyPlaylistOptions();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
}());
