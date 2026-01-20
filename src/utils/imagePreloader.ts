/**
 * Preloads a list of image/video URLs and tracks progress.
 * Works with Tauri WebViews (WebView2 on Windows, WebKitGTK on Linux).
 *
 * Uses element-based preloading which works without CORS restrictions.
 * Preloaded elements are cached and cloned when displayed to avoid re-downloads.
 *
 * @param urls Array of image URLs to preload
 * @param onProgress Optional callback for progress updates (loaded, total)
 * @param cache Optional Set to track already loaded images
 * @returns Promise that resolves when all images are loaded
 */

// Keep strong references to preloaded elements to prevent GC
const imageElementCache: Map<string, HTMLImageElement | HTMLVideoElement> = new Map();

// Track URLs that are currently being preloaded to prevent duplicate requests
const pendingPreloads: Map<string, Promise<void>> = new Map();

// Track successfully loaded URLs (separate from element cache for quick lookup)
const loadedUrls: Set<string> = new Set();

export function isImagePreloaded(url: string): boolean {
  return loadedUrls.has(url);
}

/**
 * Check if a URL is currently being preloaded
 */
export function isPreloading(url: string): boolean {
  return pendingPreloads.has(url);
}

/**
 * Get the preloaded image/video element from cache.
 * Returns the cached element if available, otherwise undefined.
 * Clone the returned element before using to preserve the cached copy.
 */
export function getPreloadedImage(url: string): HTMLImageElement | HTMLVideoElement | undefined {
  return imageElementCache.get(url);
}

/**
 * Check if content is a video based on file extension
 */
export function isVideoUrl(url: string): boolean {
  if (navigator.userAgent.includes('Linux')) return false; // TODO: Re-enable when Linux video backgrounds are fixed
  return url.endsWith('.webm') || url.endsWith('.mp4');
}

/**
 * Preload a single URL using element-based loading.
 * Handles deduplication - if URL is already being preloaded, returns existing promise.
 *
 * Note: We use element-based preloading instead of fetch+blob because external CDNs
 * (hoyoverse, steamgriddb, etc.) don't provide CORS headers for fetch requests.
 * Element-based loading works without CORS restrictions.
 */
export function preloadImage(src: string): Promise<void> {
  // Already loaded - resolve immediately
  if (loadedUrls.has(src)) {
    return Promise.resolve();
  }

  // Already being preloaded - return existing promise
  const pending = pendingPreloads.get(src);
  if (pending) {
    return pending;
  }

  // Create new preload promise using element-based loading
  const promise = new Promise<void>((resolve) => {
    if (isVideoUrl(src)) {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.autoplay = false;
      video.loop = true;

      const handleReady = () => {
        if (!loadedUrls.has(src)) {
          loadedUrls.add(src);
          imageElementCache.set(src, video);
          pendingPreloads.delete(src);
          resolve();
        }
      };

      video.oncanplaythrough = handleReady;
      video.onloadeddata = handleReady;

      video.onerror = () => {
        // Mark as loaded to prevent retries, but it failed
        loadedUrls.add(src);
        imageElementCache.set(src, video);
        pendingPreloads.delete(src);
        resolve();
      };

      video.src = src;
      video.load();
    } else {
      const img = new window.Image();

      try {
        // @ts-ignore fetchPriority isn't typed on HTMLImageElement in all TS versions
        img.fetchPriority = "high";
      } catch { /* ignore */ }
      img.decoding = "async";
      img.loading = "eager";

      img.onload = () => {
        loadedUrls.add(src);
        imageElementCache.set(src, img);
        pendingPreloads.delete(src);
        resolve();
      };

      img.onerror = () => {
        // Mark as loaded to prevent retries
        loadedUrls.add(src);
        imageElementCache.set(src, img);
        pendingPreloads.delete(src);
        resolve();
      };

      img.src = src;
    }
  });

  pendingPreloads.set(src, promise);
  return promise;
}

export function preloadImages(
  urls: string[],
  onProgress?: (loaded: number, total: number) => void,
  cache?: Set<string>
): Promise<void> {
  return new Promise((resolve) => {
    const loadedCache = cache || new Set<string>();

    // Filter out empty URLs, already loaded, and URLs in the provided cache
    const toLoad = urls.filter((src) =>
      src && !loadedUrls.has(src) && !loadedCache.has(src)
    );

    const total = toLoad.length;
    if (total === 0) return resolve();

    let completed = 0;

    toLoad.forEach((src) => {
      preloadImage(src).then(() => {
        loadedCache.add(src);
        completed++;
        if (onProgress) onProgress(completed, total);
        if (completed === total) resolve();
      });
    });
  });
}
