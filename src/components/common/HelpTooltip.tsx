import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { arrow, autoUpdate, flip, FloatingArrow, offset, shift, useFloating } from "@floating-ui/react";
import { CircleHelp } from "lucide-react";

export default function HelpTooltip({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    const arrowRef = useRef(null);
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        middleware: [offset(10), flip(), shift({ padding: 8 }), arrow({ element: arrowRef }),],
        placement: "top",
        whileElementsMounted: autoUpdate,
    });

    return (
        <>
            <span
                className="relative inline-flex items-center justify-center transition-all duration-200"
                ref={refs.setReference}
                tabIndex={0}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
            >
                <CircleHelp className="w-4 h-4 text-zinc-500 hover:text-purple-400 hover:scale-110 transition-all duration-200 cursor-help drop-shadow-sm hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
            </span>
            {open && createPortal(
                <div
                    ref={refs.setFloating}
                    style={{ ...floatingStyles, animation: 'fadeIn 150ms ease-out' }}
                    className="z-[9999] bg-gradient-to-br from-purple-900/85 to-zinc-900/85 text-white text-xs rounded-lg py-2.5 px-3 shadow-xl border border-purple-500/20 max-w-[280px]"
                >
                    <p className="leading-relaxed whitespace-pre-line break-words">{text}</p>
                    <FloatingArrow ref={arrowRef} context={context} className="fill-purple-900/85" />
                </div>,
                document.body
            )}
        </>
    )
}