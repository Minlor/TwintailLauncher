import React, { useEffect, useRef, useCallback } from "react";
import { isImagePreloaded, isVideoUrl, preloadImage, getPreloadedImage, isLinux } from "../../utils/imagePreloader";

interface BackgroundLayerProps {
  currentSrc: string;
  previousSrc?: string;
  transitioning: boolean;
  bgVersion: number;
  popupOpen: boolean;
  pageOpen?: boolean;
  bgLoading?: boolean;
  onMainLoad?: () => void;
}

const isVideo = (src?: string) => !!src && isVideoUrl(src) && !isLinux;

// helper to detect MP4 specifically (for treating MP4 looping differently)
const isMp4 = (src?: string) => !!src && src.endsWith(".mp4");

const BackgroundLayer: React.FC<BackgroundLayerProps> = ({
  currentSrc,
  previousSrc,
  transitioning,
  bgVersion,
  popupOpen,
  pageOpen,
  bgLoading,
  onMainLoad,
}) => {
  const currentContainerRef = useRef<HTMLDivElement | null>(null);
  const previousContainerRef = useRef<HTMLDivElement | null>(null);
  const currentElementRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const currentSrcRef = useRef<string>("");
  // Track pending preload to prevent race condition on Linux where effect re-runs
  // before preload completes, causing duplicate image appends
  const pendingPreloadRef = useRef<string | null>(null);

  // MP4 loop restart handler
  const restartMp4 = useCallback(() => {
    const el = currentElementRef.current;
    if (el && el instanceof HTMLVideoElement) {
      try {
        el.currentTime = 0;
        el.play().catch(() => { });
      } catch {
        // ignore
      }
    }
  }, []);

  // Create and configure video element from preloaded or new
  const createVideoElement = useCallback((src: string, className: string, onLoad?: () => void): HTMLVideoElement => {
    const preloaded = getPreloadedImage(src);
    let video: HTMLVideoElement;

    if (preloaded && preloaded instanceof HTMLVideoElement) {
      // Clone the preloaded video to reuse buffered data
      video = preloaded.cloneNode(true) as HTMLVideoElement;
    } else {
      video = document.createElement("video");
      video.src = src;
    }

    video.className = className;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.autoplay = false;

    if (isMp4(src)) {
      video.loop = false;
      video.onended = restartMp4;
    } else {
      video.loop = true;
    }

    if (onLoad) {
      video.onloadeddata = onLoad;
    }

    return video;
  }, [restartMp4]);

  // Create and configure image element from preloaded or new
  const createImageElement = useCallback((src: string, className: string, onLoad?: () => void): HTMLImageElement => {
    const preloaded = getPreloadedImage(src);
    let img: HTMLImageElement;

    if (preloaded && preloaded instanceof HTMLImageElement) {
      // Clone the preloaded image to reuse cached data
      img = preloaded.cloneNode(true) as HTMLImageElement;
    } else {
      img = document.createElement("img");
      img.src = src;
    }

    img.className = className;
    img.alt = "background";
    img.loading = "eager";
    img.decoding = "async";

    if (onLoad) {
      // If already loaded (from preload), call immediately
      if (img.complete && img.naturalHeight !== 0) {
        setTimeout(onLoad, 0);
      } else {
        img.onload = onLoad;
      }
    }

    return img;
  }, []);

  // Effect to handle current background
  useEffect(() => {
    const container = currentContainerRef.current;
    if (!container) return;

    // Skip if same source and element already exists
    if (currentSrcRef.current === currentSrc && currentElementRef.current) {
      // Just update classes for popup state changes - handled by separate useEffect below
      return;
    }

    // Skip if preload is already pending for this source (prevents race condition on Linux
    // where effect re-runs due to transitioning/popup changes before preload completes)
    if (pendingPreloadRef.current === currentSrc) {
      return;
    }

    currentSrcRef.current = currentSrc;
    pendingPreloadRef.current = null; // Clear any stale pending state

    // DON'T clear the container here - keep old element visible until new one is ready
    // This prevents black flash on WebKitGTK when switching backgrounds

    if (!currentSrc) {
      // Only clear if source becomes empty
      container.innerHTML = "";
      currentElementRef.current = null;
      return;
    }

    const baseClass = `w-full h-screen object-cover object-center transition-all duration-300 ease-out`;

    // Ensure preloaded before creating element
    const createAndAppend = (srcAtCallTime: string) => {
      // Guard: only append if source hasn't changed since preload started
      if (currentSrcRef.current !== srcAtCallTime) {
        return;
      }

      pendingPreloadRef.current = null;

      let element: HTMLImageElement | HTMLVideoElement;

      if (isVideo(srcAtCallTime)) {
        element = createVideoElement(srcAtCallTime, baseClass, () => {
          onMainLoad?.();
        });

        // Clear old element AFTER new one is created, right before appending
        container.innerHTML = "";
        container.appendChild(element);
        currentElementRef.current = element;
        element.id = "app-bg";

        // Reset and play
        try {
          element.pause();
          try { element.currentTime = 0; } catch { /* ignore */ }
          element.load();
          element.play().catch(() => { });
        } catch { /* ignore */ }
      } else {
        element = createImageElement(srcAtCallTime, baseClass, () => {
          onMainLoad?.();
        });

        // Clear old element AFTER new one is created, right before appending
        container.innerHTML = "";
        container.appendChild(element);
        currentElementRef.current = element;
        element.id = "app-bg";
      }
    };

    // If already preloaded, create immediately; otherwise wait for preload
    if (isImagePreloaded(currentSrc)) {
      createAndAppend(currentSrc);
    } else {
      // Track that we're preloading this source
      pendingPreloadRef.current = currentSrc;
      const srcToPreload = currentSrc;
      preloadImage(srcToPreload).then(() => createAndAppend(srcToPreload));
    }
  }, [currentSrc, bgVersion, createVideoElement, createImageElement, onMainLoad]);

  // Effect to handle previous background (for transitions)
  useEffect(() => {
    const container = previousContainerRef.current;
    if (!container) return;

    // Clear previous content
    container.innerHTML = "";

    if (!transitioning || !previousSrc) return;

    const baseClass = `w-full h-screen object-cover object-center absolute inset-0 transition-none animate-bg-fade-out ${(popupOpen || pageOpen) ? "scale-[1.03]" : ""}`;

    if (isVideo(previousSrc)) {
      const preloaded = getPreloadedImage(previousSrc);
      let video: HTMLVideoElement;

      if (preloaded && preloaded instanceof HTMLVideoElement) {
        video = preloaded.cloneNode(true) as HTMLVideoElement;
      } else {
        video = document.createElement("video");
        video.src = previousSrc;
      }

      video.className = baseClass;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.autoplay = false;
      video.preload = "auto";

      container.appendChild(video);
    } else {
      const preloaded = getPreloadedImage(previousSrc);
      let img: HTMLImageElement;

      if (preloaded && preloaded instanceof HTMLImageElement) {
        img = preloaded.cloneNode(true) as HTMLImageElement;
      } else {
        img = document.createElement("img");
        img.src = previousSrc;
      }

      img.className = baseClass;
      img.alt = "previous background";
      img.loading = "eager";
      img.decoding = "async";

      container.appendChild(img);
    }
  }, [transitioning, previousSrc, bgVersion, popupOpen, pageOpen]);

  // Effect to update popup styling without re-creating elements
  useEffect(() => {
    const el = currentElementRef.current;
    if (!el || !currentSrc) return;

    const baseClass = `w-full h-screen object-cover object-center transition-all duration-300 ease-out ${transitioning ? "animate-bg-fade-in" : ""} ${(popupOpen || pageOpen) ? "scale-[1.03]" : ""}`;

    // Use requestAnimationFrame to prevent layout thrashing
    requestAnimationFrame(() => {
      if (el) {
        el.className = baseClass;
      }
    });
  }, [popupOpen, pageOpen, transitioning, currentSrc]);

  return (
    <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden bg-zinc-950">
      {/* Previous background container (for fade-out transition) */}
      <div ref={previousContainerRef} className="contents" />

      {/* Current background container */}
      <div
        ref={currentContainerRef}
        className="contents"
        style={bgLoading ? {
          backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(90,70,140,0.35), rgba(20,15,30,0.9) 60%), radial-gradient(circle at 80% 80%, rgba(60,100,160,0.25), rgba(10,10,20,0.95) 55%)',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        } : undefined}
      />

      {/* Dimming overlay - replaces expensive brightness/saturate filters with cheap alpha blending */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ease-out pointer-events-none ${(popupOpen || pageOpen) ? "opacity-100" : "opacity-0"}`}
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0.6))',
          willChange: 'opacity',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          transform: 'translateZ(0)',
        }}
      />

      {/* Loading gradient overlay */}
      {(bgLoading || !currentSrc) ? (
        <div className="absolute inset-0">
          <div className={`w-full h-full ${(popupOpen || pageOpen) ? "scale-[1.03]" : ""}`} style={{
            backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(90,70,140,0.35), rgba(20,15,30,0.9) 60%), radial-gradient(circle at 80% 80%, rgba(60,100,160,0.25), rgba(10,10,20,0.95) 55%)'
          }} />
        </div>
      ) : null}

      {/* Loading spinner */}
      {bgLoading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 rounded-full border-4 border-purple-500/20 border-t-purple-400/80 animate-spin" />
        </div>
      ) : null}
    </div>
  );
};

export default BackgroundLayer;
