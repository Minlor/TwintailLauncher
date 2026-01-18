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
            className={`fixed inset-0 z-50 w-full h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 scrollbar-none transition-opacity duration-500 ${fadingOut ? 'opacity-0' : 'opacity-100'}`}
        >
            <div className="flex flex-col items-center space-y-6 animate-fadeIn">
                {/* App Logo/Icon */}
                <div className="w-20 h-20 animate-pulse">
                    <img src="/launcher-icon.png" srcSet="/launcher-icon.png 1x, /launcher-icon-128.png 2x" alt="TwintailLauncher" className="w-full h-full object-contain"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                </div>

                {/* App Name */}
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-white mb-2 animate-slideUp">TwintailLauncher</h1>
                    <p className="text-slate-400 text-sm animate-slideUp delay-100">{message}</p>
                </div>

                {/* Loading Bar */}
                <div className="w-64 h-1 bg-slate-700 rounded-full overflow-hidden animate-slideUp delay-200">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full transition-all duration-500 ease-out animate-shimmer" style={{ width: `${progress}%` }}></div>
                </div>

                {/* Loading Dots */}
                <div className="flex space-x-1 animate-slideUp delay-300">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-100"></div>
                    <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce delay-200"></div>
                </div>
            </div>
        </main>
    );
};

export default AppLoadingScreen;

