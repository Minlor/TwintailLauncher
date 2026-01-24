import { PAGES } from "./PAGES";
import SettingsPage from "./SettingsPage";
import DownloadsPage from "./DownloadsPage";
import RunnersPage from "./RunnersPage";
import type { DownloadJobProgress, DownloadQueueStatePayload } from "../../types/downloadQueue";

interface TelemetrySample {
    net: number;
    disk: number;
}

interface InstallView {
    id: string;
    name?: string;
    game_icon?: string;
    game_background?: string;
}

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

interface PageViewContainerProps {
    currentPage: PAGES;
    setCurrentPage: (page: PAGES) => void;

    // Settings props
    globalSettings: any;
    fetchSettings: () => void;

    // Downloads props
    downloadQueueState: DownloadQueueStatePayload | null;
    downloadProgressByJobId: Record<string, DownloadJobProgress>;
    installs: InstallView[];
    speedHistory: TelemetrySample[];
    onSpeedSample: (sample: TelemetrySample) => void;
    onClearHistory: () => void;
    downloadSpeedLimitKiB: number;

    // Runners props
    runners: RunnerManifest[];
    installedRunners: InstalledRunner[];
    fetchInstalledRunners: () => void;

    // Network recovery
    imageVersion?: number;
}

export default function PageViewContainer({
    currentPage,
    setCurrentPage,
    globalSettings,
    fetchSettings,
    downloadQueueState,
    downloadProgressByJobId,
    installs,
    speedHistory,
    onSpeedSample,
    onClearHistory,
    downloadSpeedLimitKiB,
    runners,
    installedRunners,
    fetchInstalledRunners,
    imageVersion = 0,
}: PageViewContainerProps) {
    return (
        <div className="absolute inset-0 left-16 z-30 bg-black/50 flex flex-col overflow-hidden border-l border-white/10">
            {currentPage === PAGES.SETTINGS && (
                <SettingsPage
                    settings={globalSettings}
                    fetchSettings={fetchSettings}
                    setCurrentPage={setCurrentPage}
                />
            )}
            {currentPage === PAGES.DOWNLOADS && (
                <DownloadsPage
                    setCurrentPage={setCurrentPage}
                    queue={downloadQueueState}
                    progressByJobId={downloadProgressByJobId}
                    installs={installs}
                    speedHistory={speedHistory}
                    onSpeedSample={onSpeedSample}
                    onClearHistory={onClearHistory}
                    downloadSpeedLimitKiB={downloadSpeedLimitKiB}
                    imageVersion={imageVersion}
                />
            )}
            {currentPage === PAGES.RUNNERS && (
                <RunnersPage
                    setCurrentPage={setCurrentPage}
                    runners={runners}
                    installedRunners={installedRunners}
                    fetchInstalledRunners={fetchInstalledRunners}
                />
            )}
        </div>
    );
}
