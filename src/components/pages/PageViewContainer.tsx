import { PAGES } from "./PAGES";
import SettingsPage from "./SettingsPage";
import DownloadsPage from "./DownloadsPage";
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
}: PageViewContainerProps) {
    return (
        <div className="absolute inset-0 left-16 z-30 bg-[#09090b]/95 backdrop-blur-sm flex flex-col overflow-hidden">
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
                />
            )}
        </div>
    );
}
