import React, { useRef, useState } from "react";
import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  offset,
  shift,
  useFloating,
  useHover,
  useInteractions,
} from "@floating-ui/react";
import { POPUPS } from "../popups/POPUPS";
import { DownloadIcon } from "lucide-react";

export default function SidebarDownloads({
  setOpenPopup,
  popup,
  hasDownloads,
  progressPercent,
  onOpenDownloadManager,
}: {
  setOpenPopup: (a: POPUPS) => void;
  popup: POPUPS;
  hasDownloads: boolean;
  progressPercent?: number;
  onOpenDownloadManager?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const arrowRef = useRef(null);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(25), flip(), shift(), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
    placement: "right",
  });

  const hover = useHover(context, { move: false });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);

  const ringPercent = typeof progressPercent === "number" ? Math.max(0, Math.min(100, progressPercent)) : undefined;
  const cx = 16;
  const cy = 20;
  const r = 14;
  const c = 2 * Math.PI * r;
  const dashOffset = ringPercent !== undefined ? c * (1 - ringPercent / 100) : c;

  const showActivityDot = hasDownloads && ringPercent === undefined;
  const iconClass =
    ringPercent !== undefined
      ? "w-4 h-5"
      : "w-8 h-10";

  return (
    <React.Fragment>
      <div
        ref={refs.setReference}
        {...getReferenceProps()}
        className="relative flex items-center justify-center w-8 h-10 text-white hover:text-white/55 cursor-pointer"
        onClick={() => {
          if (onOpenDownloadManager) {
            onOpenDownloadManager();
          } else {
            setOpenPopup(popup === POPUPS.DOWNLOADS ? POPUPS.NONE : POPUPS.DOWNLOADS);
          }
        }}
      >
        {ringPercent !== undefined && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 32 40"
            aria-hidden="true"
          >
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              className="text-white/25"
            />
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              className="text-purple-400"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          </svg>
        )}

        <DownloadIcon
          className={`relative z-10 flex-initial transition-all duration-200 ease-out ${iconClass}`}
        />

        {showActivityDot && (
          <span className="absolute top-1 right-0.5 z-20 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.9)]"></span>
          </span>
        )}
      </div>

      {isOpen && popup === POPUPS.NONE && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          className="bg-black/75 rounded-md p-2 min-w-max z-50"
        >
          <FloatingArrow ref={arrowRef} context={context} className="fill-black/75" />
          <span className="text-white z-50">Downloads</span>
        </div>
      )}
    </React.Fragment>
  );
}
