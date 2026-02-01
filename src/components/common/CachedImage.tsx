import { useEffect, useRef, useState, useCallback } from 'react';
import { getPreloadedImage, isImagePreloaded, isVideoUrl, cacheImage } from '../../utils/imagePreloader';

interface CachedImageProps {
    src: string;
    alt?: string;
    className?: string;
}

/** TODO: Okay since we're having issues on webkit can we just make the dynamic backgrounds load and work only on windows for now but make it very simple for us to re-enable them when we can properly add support for them on linux  */

/**
 * An image/video component that uses preloaded/cached elements when available.
 * Supports both images and videos (.webm, .mp4).
 * Falls back to creating new elements if not preloaded.
 *
 * For Tauri WebViews (WebView2/WebKitGTK), this component:
 * - Uses crossOrigin="anonymous" for images to share browser cache with preloader
 * - Uses preload="auto" for videos to ensure full buffering
 * - Triggers on-demand preloading if content isn't already cached
 */
export function CachedImage({ src, alt = '', className = '' }: CachedImageProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const elementRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
    const [isReady, setIsReady] = useState(() => isImagePreloaded(src));
    const currentSrcRef = useRef<string>(src);

    // Update className on existing element without re-creating
    const updateClassName = useCallback((element: HTMLElement | null, newClassName: string) => {
        if (element) {
            element.className = newClassName;
        }
    }, []);

    // Effect to update className without re-mounting
    useEffect(() => {
        updateClassName(elementRef.current, className);
    }, [className, updateClassName]);

    // Main effect for src changes - only runs when src changes
    useEffect(() => {
        if (!containerRef.current || !src) return;

        const container = containerRef.current;
        currentSrcRef.current = src;

        // Reset ready state when src changes
        const preloaded = isImagePreloaded(src);
        if (!preloaded) {
            setIsReady(false);
            // Don't call preloadImage here - we create our own element below
            // and register it via cacheImage to avoid double-loading
        }

        // Clear previous content
        container.innerHTML = '';
        elementRef.current = null;

        const cachedElement = getPreloadedImage(src);
        const isVideo = isVideoUrl(src);

        if (cachedElement) {
            // Use the cached/preloaded element by cloning
            if (cachedElement instanceof HTMLVideoElement) {
                const clone = cachedElement.cloneNode(true) as HTMLVideoElement;
                clone.className = className;
                clone.muted = true;
                clone.playsInline = true;
                clone.autoplay = true;
                clone.loop = true;
                clone.preload = 'auto';
                elementRef.current = clone;
                container.appendChild(clone);
                // Ensure video plays after cloning
                clone.play().catch(() => { });
                setIsReady(true);
            } else {
                const clone = cachedElement.cloneNode(true) as HTMLImageElement;
                clone.className = className;
                clone.alt = alt;
                elementRef.current = clone;
                container.appendChild(clone);
                setIsReady(true);
            }
        } else {
            // Create new element - will use browser cache if preloaded
            if (isVideo) {
                const video = document.createElement('video');
                video.src = src;
                video.className = className;
                video.muted = true;
                video.playsInline = true;
                video.autoplay = true;
                video.loop = true;
                video.preload = 'auto';
                video.onloadeddata = () => {
                    if (currentSrcRef.current === src) {
                        cacheImage(src, video, false);
                        setIsReady(true);
                    }
                };
                video.onerror = () => {
                    if (currentSrcRef.current === src) {
                        cacheImage(src, video, true);
                        setIsReady(true);
                    }
                };
                elementRef.current = video;
                container.appendChild(video);
                video.play().catch(() => { });
            } else {
                const img = document.createElement('img');
                img.src = src;
                img.alt = alt;
                img.className = className;
                img.loading = 'eager';
                img.decoding = 'async';
                img.onload = () => {
                    if (currentSrcRef.current === src) {
                        cacheImage(src, img, false);
                        setIsReady(true);
                    }
                };
                img.onerror = () => {
                    if (currentSrcRef.current === src) {
                        cacheImage(src, img, true);
                        setIsReady(true);
                    }
                };
                elementRef.current = img;
                container.appendChild(img);
            }
        }
    }, [src, alt]); // Note: className removed from deps to prevent re-mounting

    return (
        <div
            ref={containerRef}
            className="contents"
            data-ready={isReady}
        />
    );
}

export default CachedImage;
