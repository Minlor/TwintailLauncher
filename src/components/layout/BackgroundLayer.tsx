import React, { useEffect, useRef } from "react";

interface BackgroundLayerProps {
  currentSrc: string;
  previousSrc?: string;
  transitioning: boolean;
  bgVersion: number;
  popupOpen: boolean;
  bgLoading?: boolean;
  onMainLoad?: () => void;
}

const isVideo = (src?: string) =>
  !!src && (src.endsWith(".mp4") || src.endsWith(".webm"));

const BackgroundLayer: React.FC<BackgroundLayerProps> = ({
  currentSrc,
  previousSrc,
  transitioning,
  bgVersion,
  popupOpen,
  bgLoading,
  onMainLoad,
}) => {
  const currentVideoRef = useRef<HTMLVideoElement | null>(null);

  // Reset the current video feed whenever the source changes
  useEffect(() => {
    if (!isVideo(currentSrc)) return;

    const v = currentVideoRef.current;
    if (!v) return;

    try {
      v.pause();
      // Some WebKit builds throw if currentTime is set too early; wrap it.
      try { v.currentTime = 0; } catch {}
      v.load(); // force reload of the media pipeline
      v.play().catch(() => {
        // autoplay can reject; ignore here since you already show a loader
      });
    } catch {
      // ignore
    }

    // Cleanup ONLY this element (captured), so we don't nuke the next one
    return () => {
      try {
        v.pause();
        // full reset
        v.removeAttribute("src");
        v.load();
      } catch {
        // ignore
      }
    };
  }, [currentSrc, bgVersion]);

  return (
    <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
      {transitioning && previousSrc && (
          (previousSrc.endsWith('.mp4') || previousSrc.endsWith('.webm')) ? (
              <video
                  key={`prev-${bgVersion}-${previousSrc}`}  // <- include src to force remount
                  className={`w-full h-screen object-cover object-center absolute inset-0 transition-none animate-bg-fade-out ${popupOpen ? "scale-[1.03] brightness-[0.45] saturate-75" : ""}`}
                  autoPlay={true}
                  muted={true}
                  loop={true}
                  playsInline={true}
                  preload={"auto"}
                  src={previousSrc}
              />
              ) : (
              <img
                  key={`prev-${bgVersion}-${previousSrc}`}  // <- include src to force remount
                  className={`w-full h-screen object-cover object-center absolute inset-0 transition-none animate-bg-fade-out ${popupOpen ? "scale-[1.03] brightness-[0.45] saturate-75" : ""}`}
                  alt={"previous background"}
                  src={previousSrc}
                  loading="lazy"
                  decoding="async"
              />
      )
      )}
      {currentSrc ? (
              (currentSrc.endsWith(".mp4") || currentSrc.endsWith(".webm")) ? (
                  <video
                      id="app-bg"
                      ref={currentVideoRef}                   // <- NEW
                      key={`curr-${bgVersion}`}
                      className={`w-full h-screen object-cover object-center transition-all duration-300 ease-out ${transitioning ? "animate-bg-fade-in" : ""} ${popupOpen ? "scale-[1.03] brightness-[0.45] saturate-75" : ""}`}
                      autoPlay={true}
                      muted={true}
                      loop={true}
                      playsInline={true}
                      preload={"auto"}
                      src={currentSrc}
                      onLoadedData={() => onMainLoad && onMainLoad()}
                      style={bgLoading ? {
                        backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(90,70,140,0.35), rgba(20,15,30,0.9) 60%), radial-gradient(circle at 80% 80%, rgba(60,100,160,0.25), rgba(10,10,20,0.95) 55%)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      } : undefined}
                  />
                  ) : (
                  <img
                      id="app-bg"
                      key={`curr-${bgVersion}-${currentSrc}`} // <- include src to force remount
                      className={`w-full h-screen object-cover object-center transition-all duration-300 ease-out ${transitioning ? "animate-bg-fade-in" : ""} ${popupOpen ? "scale-[1.03] brightness-[0.45] saturate-75" : ""}`}
                      alt={"?"}
                      src={currentSrc}
                      loading="eager"
                      decoding="async"
                      style={bgLoading ? {
                        backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(90,70,140,0.35), rgba(20,15,30,0.9) 60%), radial-gradient(circle at 80% 80%, rgba(60,100,160,0.25), rgba(10,10,20,0.95) 55%)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      } : undefined}
                      onLoad={() => onMainLoad && onMainLoad()}
                  />
              )
      ) : null}
      {(bgLoading || !currentSrc) ? (
        <div className="absolute inset-0">
          <div className={`w-full h-full ${popupOpen ? "scale-[1.03]" : ""}`} style={{
            backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(90,70,140,0.35), rgba(20,15,30,0.9) 60%), radial-gradient(circle at 80% 80%, rgba(60,100,160,0.25), rgba(10,10,20,0.95) 55%)'
          }} />
        </div>
      ) : null}
      {bgLoading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 rounded-full border-4 border-white/20 border-t-white/80 animate-spin" />
        </div>
      ) : null}
    </div>
  );
};

export default BackgroundLayer;
