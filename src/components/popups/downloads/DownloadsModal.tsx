import { useEffect, useMemo, useState } from "react";
import type {
  DownloadJobProgress,
  DownloadQueueStatePayload,
  QueueJobView,
} from "../../../types/downloadQueue";
import ProgressBar from "../../common/ProgressBar";
import { formatBytes, toPercent } from "../../../utils/progress";
import { POPUPS } from "../POPUPS";

type InstallView = {
  id: string;
  name?: string;
  game_icon?: string;
};

type DownloadsModalProps = {
  setOpenPopup: (p: POPUPS) => void;
  queue: DownloadQueueStatePayload | null;
  progressByJobId: Record<string, DownloadJobProgress>;
  installs: InstallView[];
};

function formatKind(kind: QueueJobView["kind"]): string {
  switch (kind) {
    case "game_download":
      return "Download";
    case "game_update":
      return "Update";
    case "game_preload":
      return "Preload";
    case "game_repair":
      return "Repair";
  }
}

function formatStatus(status: QueueJobView["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Downloading";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Paused";
  }
}

export default function DownloadsModal(props: DownloadsModalProps) {
  const { setOpenPopup, queue, progressByJobId, installs } = props;

  const items = useMemo(() => {
    const running = queue?.running ?? [];
    const queued = queue?.queued ?? [];
    return [...running, ...queued];
  }, [queue]);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedJobId(null);
      return;
    }

    setSelectedJobId((prev) => {
      if (prev && items.some((i) => i.id === prev)) return prev;
      const firstRunning = items.find((i) => i.status === "running");
      return (firstRunning ?? items[0]).id;
    });
  }, [items]);

  const selected = selectedJobId ? items.find((i) => i.id === selectedJobId) : undefined;
  const selectedProgress = selected ? progressByJobId[selected.id] : undefined;

  const runningCount = queue?.running?.length ?? 0;
  const queuedCount = queue?.queued?.length ?? 0;

  return (
    <div className="w-full h-full pointer-events-auto">
      <div className="w-full h-full bg-black/40 border border-white/10 rounded-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="min-w-0">
            <div className="text-white text-stroke text-xl truncate">Downloads</div>
            <div className="text-white/80 text-stroke text-sm">
              {runningCount} active / {queuedCount} queued (max {queue?.maxConcurrent ?? 1})
            </div>
          </div>
          <button
            className="px-4 py-2 rounded-lg bg-black/30 hover:bg-black/40 border border-white/15 text-white/90 transition-colors"
            onClick={() => setOpenPopup(POPUPS.NONE)}
          >
            Close
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-[26rem] max-w-[40%] border-r border-white/10 overflow-y-auto">
            <div className="p-4 space-y-3">
              {items.length === 0 ? (
                <div className="text-white/70 text-stroke text-sm">No active downloads.</div>
              ) : (
                items.map((item) => {
                  const p = progressByJobId[item.id];
                  const install = installs.find((i) => i.id === item.installId);
                  const displayName = (p?.name && p.name.trim().length > 0 ? p.name : item.name) || install?.name || item.installId;

                  const progress = typeof p?.progress === "number" ? p.progress : undefined;
                  const total = typeof p?.total === "number" ? p.total : undefined;
                  const percent =
                    progress !== undefined && total !== undefined && total > 0
                      ? toPercent(progress, total)
                      : item.status === "queued"
                        ? 0
                        : 0;

                  const percentText =
                    progress !== undefined && total !== undefined && total > 0
                      ? `${percent.toFixed(2)}%`
                      : item.status === "queued"
                        ? "0%"
                        : "…";

                  const isSelected = item.id === selectedJobId;

                  return (
                    <button
                      key={item.id}
                      className={`w-full text-left rounded-xl px-4 py-3 border transition-colors ${
                        isSelected
                          ? "bg-black/50 border-white/25"
                          : "bg-black/25 hover:bg-black/35 border-white/10"
                      }`}
                      onClick={() => setSelectedJobId(item.id)}
                    >
                      <div className="flex gap-3 items-start">
                        {install?.game_icon ? (
                          <img
                            src={install.game_icon}
                            alt={""}
                            className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                            draggable={false}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-white/10 flex-shrink-0" />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="text-white text-stroke truncate">{displayName}</div>
                          <div className="text-white/80 text-stroke text-xs">
                            {formatKind(item.kind)} • {formatStatus(item.status)} • {percentText}
                          </div>

                          <div className="mt-2">
                            <ProgressBar id={`dl_modal_${item.id}`} progress={Math.max(0, Math.min(100, percent))} className="" />
                          </div>

                          <div className="mt-2 text-white/70 text-stroke text-xs">
                            {progress !== undefined && total !== undefined && total > 0 ? (
                              <>
                                {formatBytes(progress)} / {formatBytes(total)}
                              </>
                            ) : (
                              <>&nbsp;</>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              {!selected ? (
                <div className="text-white/70 text-stroke">Select a download to view details.</div>
              ) : (
                (() => {
                  const p = selectedProgress;
                  const progress = typeof p?.progress === "number" ? p.progress : undefined;
                  const total = typeof p?.total === "number" ? p.total : undefined;
                  const percent = progress !== undefined && total !== undefined && total > 0 ? toPercent(progress, total) : 0;
                  const percentText =
                    progress !== undefined && total !== undefined && total > 0
                      ? `${percent.toFixed(2)}%`
                      : selected.status === "queued"
                        ? "0%"
                        : "…";

                  const speed = typeof p?.speed === "number" ? p.speed : undefined;
                  const disk = typeof p?.disk === "number" ? p.disk : undefined;

                  return (
                    <>
                      <div className="text-white text-stroke text-2xl">{(p?.name && p.name.trim() ? p.name : selected.name) || selected.installId}</div>
                      <div className="mt-1 text-white/80 text-stroke">
                        {formatKind(selected.kind)} • {formatStatus(selected.status)} • {percentText}
                      </div>

                      <div className="mt-6 bg-black/25 border border-white/10 rounded-xl p-5">
                        <div className="flex items-baseline justify-between gap-4">
                          <div className="text-white/90 text-stroke">Progress</div>
                          <div className="text-white/80 text-stroke text-sm whitespace-nowrap">
                            {progress !== undefined && total !== undefined && total > 0 ? (
                              <>
                                {formatBytes(progress)} / {formatBytes(total)}
                              </>
                            ) : (
                              <>&nbsp;</>
                            )}
                          </div>
                        </div>

                        <div className="mt-3">
                          <ProgressBar id={`dl_modal_detail_${selected.id}`} progress={Math.max(0, Math.min(100, percent))} className="transition-all duration-500 ease-out" />
                        </div>

                        {(speed !== undefined || disk !== undefined) && (
                          <div className="mt-3 text-white/80 text-stroke text-sm">
                            {speed !== undefined ? `Net ${formatBytes(speed)}/s` : ""}
                            {speed !== undefined && disk !== undefined ? " • " : ""}
                            {disk !== undefined ? `Disk ${formatBytes(disk)}/s` : ""}
                          </div>
                        )}

                        <div className="mt-3 text-white/60 text-stroke text-xs">Job ID: {selected.id}</div>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
