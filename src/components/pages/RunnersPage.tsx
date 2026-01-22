import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, AtomIcon, ChevronDown, DownloadCloud, FolderOpen, Trash2, Check } from "lucide-react";
import { PAGES } from "./PAGES";

interface RunnerVersion {
    version: string;
    url: string;
}

interface RunnerManifest {
    display_name: string;
    versions: RunnerVersion[];
}

interface InstalledRunner {
    version: string;
    is_installed: boolean;
}

interface RunnersPageProps {
    setCurrentPage: (page: PAGES) => void;
    runners: RunnerManifest[];
    installedRunners: InstalledRunner[];
    fetchInstalledRunners: () => void;
}

function RunnerItem({
    version,
    isInstalled,
    onInstall,
    onRemove,
    onOpenFolder,
}: {
    version: string;
    isInstalled: boolean;
    onInstall: () => void;
    onRemove: () => void;
    onOpenFolder: () => void;
}) {
    const [isLoading, setIsLoading] = useState(false);

    const handleInstall = async () => {
        setIsLoading(true);
        try {
            await onInstall();
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemove = async () => {
        setIsLoading(true);
        try {
            await onRemove();
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all duration-200 group">
            <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${isInstalled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-zinc-600'}`} />
                <span className="text-white/90 text-sm font-medium">{version}</span>
            </div>
            <div className="flex items-center gap-2">
                {isInstalled ? (
                    <>
                        <button
                            onClick={onOpenFolder}
                            className="p-2 rounded-lg text-white/50 hover:text-purple-400 hover:bg-purple-500/10 transition-all duration-200"
                            title="Open folder"
                        >
                            <FolderOpen className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleRemove}
                            disabled={isLoading}
                            className="p-2 rounded-lg text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 disabled:opacity-50"
                            title="Remove"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-xs text-emerald-400 font-medium">Installed</span>
                        </div>
                    </>
                ) : (
                    <button
                        onClick={handleInstall}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-300 hover:text-purple-200 transition-all duration-200 disabled:opacity-50"
                    >
                        {isLoading ? (
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                            </svg>
                        ) : (
                            <DownloadCloud className="w-4 h-4" />
                        )}
                        <span className="text-xs font-medium">Install</span>
                    </button>
                )}
            </div>
        </div>
    );
}

function RunnerCategory({
    name,
    versions,
    installedRunners,
    fetchInstalledRunners,
}: {
    name: string;
    versions: RunnerVersion[];
    installedRunners: InstalledRunner[];
    fetchInstalledRunners: () => void;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const installedCount = versions.filter(v =>
        installedRunners.some(r => r.version === v.version && r.is_installed)
    ).length;

    return (
        <div className="rounded-xl overflow-hidden border border-white/5 bg-black/20">
            {/* Category Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-all duration-200"
            >
                <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                        <AtomIcon className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="text-left">
                        <h3 className="text-white font-semibold">{name}</h3>
                        <p className="text-xs text-white/50 mt-0.5">
                            {installedCount} of {versions.length} installed
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {installedCount > 0 && (
                        <div className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                            <span className="text-xs text-emerald-400 font-medium">{installedCount} active</span>
                        </div>
                    )}
                    <ChevronDown
                        className={`w-5 h-5 text-white/40 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                </div>
            </button>

            {/* Expanded Content */}
            <div
                className={`overflow-hidden transition-all duration-300 ease-out ${isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
            >
                <div className="px-4 pb-4 pt-1 flex flex-col gap-2">
                    {versions.map((v) => {
                        const isInstalled = installedRunners.some(
                            r => r.version === v.version && r.is_installed
                        );
                        return (
                            <RunnerItem
                                key={v.version}
                                version={v.version}
                                isInstalled={isInstalled}
                                onInstall={async () => {
                                    await invoke("add_installed_runner", {
                                        runnerUrl: v.url,
                                        runnerVersion: v.version
                                    });
                                    fetchInstalledRunners();
                                }}
                                onRemove={async () => {
                                    await invoke("remove_installed_runner", {
                                        runnerVersion: v.version
                                    });
                                    fetchInstalledRunners();
                                }}
                                onOpenFolder={() => {
                                    invoke("open_folder", {
                                        runnerVersion: v.version,
                                        manifestId: "",
                                        installId: "",
                                        pathType: "runner_global"
                                    });
                                }}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default function RunnersPage({
    setCurrentPage,
    runners,
    installedRunners,
    fetchInstalledRunners,
}: RunnersPageProps) {
    // Calculate totals
    const totalVersions = runners.reduce((sum, r) => sum + r.versions.length, 0);
    const totalInstalled = installedRunners.filter(r => r.is_installed).length;

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden animate-fadeIn">
            {/* Page Header */}
            <div className="flex items-center gap-4 px-8 py-6 border-b border-white/5">
                <button
                    onClick={() => setCurrentPage(PAGES.NONE)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-all duration-200 hover:scale-105"
                >
                    <ArrowLeft className="w-5 h-5 text-white/70" />
                </button>
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-purple-600/20 rounded-xl border border-purple-500/30">
                        <AtomIcon className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Runner Manager</h1>
                        <p className="text-sm text-white/50">
                            {totalInstalled} installed of {totalVersions} available Wine/Proton versions
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                {runners.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                        <AtomIcon className="w-16 h-16 text-white/20 mb-4" />
                        <h3 className="text-lg font-medium text-white/70">No runners available</h3>
                        <p className="text-sm text-white/40 mt-2">
                            Runner versions will appear here when available
                        </p>
                    </div>
                ) : (
                    <div className="max-w-4xl mx-auto space-y-4">
                        {runners.map((runner) => (
                            <RunnerCategory
                                key={runner.display_name}
                                name={runner.display_name}
                                versions={runner.versions}
                                installedRunners={installedRunners}
                                fetchInstalledRunners={fetchInstalledRunners}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
