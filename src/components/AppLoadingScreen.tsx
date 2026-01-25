import React from "react";

interface AppLoadingScreenProps {
    progress: number;
    message: string;
    // When true, the overlay will fade out (opacity 0) before unmounting
    fadingOut?: boolean;
}

const AppLoadingScreen: React.FC<AppLoadingScreenProps> = ({ progress, message, fadingOut }) => {
    return (
        <main
            className={`fixed inset-0 z-50 w-full h-screen flex flex-col items-center justify-center bg-black transition-opacity duration-500 ease-in-out ${fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
            {/* Subtle background ambient glow for depth */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/10 blur-[120px]" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[120px]" />


            </div>

            <div className="relative z-10 flex flex-col items-center max-w-md w-full px-12 animate-fadeIn">
                {/* Logo & Title Section */}
                <div className="flex flex-col items-center mb-14 space-y-6">
                    <div className="relative w-24 h-24 mb-2">
                        {/* Glow behind logo */}
                        <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full" />
                        <img
                            src="/launcher-icon.png"
                            srcSet="/launcher-icon.png 1x, /launcher-icon-128.png 2x"
                            alt="TwintailLauncher"
                            className="relative w-full h-full object-contain drop-shadow-2xl animate-[pulse_3s_ease-in-out_infinite]"
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                            }}
                        />
                    </div>

                    <div className="text-center space-y-1">
                        <h1 className="text-3xl font-bold bg-gradient-to-br from-white via-white to-white/60 bg-clip-text text-transparent tracking-tight">
                            TwintailLauncher
                        </h1>
                    </div>
                </div>

                {/* Progress Section */}
                <div className="w-full space-y-4">
                    {/* Progress Bar Container */}
                    <div className="relative h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden backdrop-blur-sm ring-1 ring-white/[0.05]">
                        {/* Actual Bar */}
                        <div
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-600 via-blue-400 to-blue-500 rounded-full transition-all duration-300 ease-out shadow-[0_0_12px_rgba(59,130,246,0.6)]"
                            style={{ width: `${Math.max(2, progress)}%` }}
                        >
                            {/* Inner highlight for gloss effect */}
                            <div className="absolute top-0 right-0 bottom-0 w-20 bg-gradient-to-l from-white/30 to-transparent" />
                        </div>
                    </div>

                    {/* Status Text & Percentage */}
                    <div className="flex justify-between items-center text-xs">
                        <span className="text-white/40 uppercase tracking-widest font-medium truncate max-w-[240px]">
                            {message}
                        </span>
                        <span className="text-blue-400 font-mono font-medium">
                            {Math.round(progress)}%
                        </span>
                    </div>
                </div>
            </div>

            {/* Footer / Copyright */}
            <div className="absolute bottom-10 text-white/[0.15] text-[10px] uppercase tracking-[0.2em] font-medium">
                Initializing Environment
            </div>
        </main>
    );
};

export default AppLoadingScreen;
