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
 * - Uses deferred swap to prevent black flash when changing sources
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

    // Helper to clear old content and finalize new element
    const finalizeElement = useCallback((container: HTMLDivElement, newElement: HTMLImageElement | HTMLVideoElement, srcAtCreation: string) => {
        // Only finalize if this is still the current src (prevents race conditions)
        if (currentSrcRef.current !== srcAtCreation) return;

        // Remove all previous children (old content)
        while (container.firstChild && container.firstChild !== newElement) {
            container.removeChild(container.firstChild);
        }
        elementRef.current = newElement;
        cacheImage(srcAtCreation, newElement, false);
        setIsReady(true);
    }, []);

    // Helper for error handling
    const handleError = useCallback((container: HTMLDivElement, newElement: HTMLImageElement | HTMLVideoElement, srcAtCreation: string) => {
        if (currentSrcRef.current !== srcAtCreation) return;

        while (container.firstChild && container.firstChild !== newElement) {
            container.removeChild(container.firstChild);
        }
        elementRef.current = newElement;
        cacheImage(srcAtCreation, newElement, true);
        setIsReady(true);
    }, []);

    // Main effect for src changes - only runs when src changes
    useEffect(() => {
        if (!containerRef.current || !src) return;

        const container = containerRef.current;
        currentSrcRef.current = src;

        const cachedElement = getPreloadedImage(src);
        const isVideo = isVideoUrl(src);

        if (cachedElement) {
            // Use the cached/preloaded element by cloning - immediate swap is safe
            container.innerHTML = '';
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
            // Not cached - create new element but don't remove old content yet
            // Old content stays visible as a placeholder until new content loads
            setIsReady(false);

            if (isVideo) {
                const video = document.createElement('video');
                video.src = src;
                video.className = className;
                video.muted = true;
                video.playsInline = true;
                video.autoplay = true;
                video.loop = true;
                video.preload = 'auto';
                // Append new element (old content still visible behind/before it)
                container.appendChild(video);

                video.onloadeddata = () => finalizeElement(container, video, src);
                video.onerror = () => handleError(container, video, src);

                video.play().catch(() => { });
            } else {
                const img = document.createElement('img');
                img.src = src;
                img.alt = alt;
                img.className = className;
                img.loading = 'eager';
                img.decoding = 'async';
                // Append new element (old content still visible behind/before it)
                container.appendChild(img);

                img.onload = () => finalizeElement(container, img, src);
                img.onerror = () => handleError(container, img, src);
            }
        }
    }, [src, alt, className, finalizeElement, handleError]);

    return (
        <div
            ref={containerRef}
            className="contents"
            data-ready={isReady}
        />
    );
}

export default CachedImage;
