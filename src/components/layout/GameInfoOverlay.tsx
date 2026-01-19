import { CachedImage } from "../common/CachedImage";

interface GameInfoOverlayProps {
    displayName: string;
    gameIcon: string;
    version?: string;
    hasUpdate?: boolean;
    isVisible: boolean;
}

export default function GameInfoOverlay({
    displayName,
    gameIcon,
    version,
    hasUpdate,
    isVisible
}: GameInfoOverlayProps) {
    if (!isVisible || !displayName) return null;

    return (
        <div className="absolute bottom-8 left-24 max-w-md animate-slideUp z-10" style={{ animationDelay: '200ms' }}>
            <div className="bg-black/50 backdrop-blur-md rounded-2xl border border-white/10 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <div className="flex items-center gap-4">
                    {gameIcon && (
                        <div className="w-14 h-14 rounded-xl overflow-hidden border border-white/10 shadow-lg flex-shrink-0">
                            <CachedImage src={gameIcon} className="w-full h-full object-cover" alt="Game Icon" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <h1 className="text-xl font-bold text-white truncate">{displayName}</h1>
                        <div className="flex items-center gap-2 mt-1">
                            {version && (
                                <span className="text-sm text-white/50">v{version}</span>
                            )}
                            {hasUpdate && (
                                <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-medium border border-purple-500/30">
                                    Update Available
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
