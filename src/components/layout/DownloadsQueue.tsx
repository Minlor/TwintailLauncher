import ProgressBar from "../common/ProgressBar";
import { formatBytes, toPercent } from "../../utils/progress";
import type { DownloadJobProgress, DownloadQueueStatePayload, QueueJobView } from "../../types/downloadQueue";

type DownloadsQueueProps = {
  queue: DownloadQueueStatePayload | null;
  progressByJobId: Record<string, DownloadJobProgress>;
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

export default function DownloadsQueue(props: DownloadsQueueProps) {
  const { queue, progressByJobId } = props;
  const running = queue?.running ?? [];
  const queued = queue?.queued ?? [];

  const items = [...running, ...queued];
  if (items.length === 0) return null;

  return (
    <div className="absolute bottom-6 left-16 right-96 p-6 z-20 pointer-events-none" id="downloads_queue">
      <div className="flex flex-row items-baseline justify-between px-2">
        <h4 className="text-white text-stroke">Downloads</h4>
        <div className="text-white/90 text-stroke text-sm">
          {running.length} active / {queued.length} queued (max {queue?.maxConcurrent ?? 1})
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {items.map((item) => {
          const p = progressByJobId[item.id];
          const name = (p?.name && p.name.trim().length > 0 ? p.name : item.name) || item.installId;

          const progress = typeof p?.progress === "number" ? p.progress : undefined;
          const total = typeof p?.total === "number" ? p.total : undefined;
          const percent = progress !== undefined && total !== undefined && total > 0 ? toPercent(progress, total) : 0;
          const percentText = progress !== undefined && total !== undefined && total > 0 ? `${percent.toFixed(2)}%` : item.status === "queued" ? "0%" : "…";

          const speed = typeof p?.speed === "number" ? p.speed : undefined;
          const disk = typeof p?.disk === "number" ? p.disk : undefined;

          return (
            <div key={item.id} className="bg-black/30 rounded-xl px-4 py-3">
              <div className="flex flex-row justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-white text-stroke truncate">{name}</div>
                  <div className="text-white/90 text-stroke text-sm">
                    {formatKind(item.kind)} • {formatStatus(item.status)} • {percentText}
                  </div>
                </div>
                <div className="text-right text-white/90 text-stroke text-sm whitespace-nowrap">
                  {progress !== undefined && total !== undefined && total > 0 ? (
                    <>
                      {formatBytes(progress)} / {formatBytes(total)}
                    </>
                  ) : (
                    <>&nbsp;</>
                  )}
                  {(speed !== undefined || disk !== undefined) && (
                    <div className="text-white/80 text-stroke text-xs">
                      {speed !== undefined ? `Net ${formatBytes(speed)}/s` : ""}
                      {speed !== undefined && disk !== undefined ? " • " : ""}
                      {disk !== undefined ? `Disk ${formatBytes(disk)}/s` : ""}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2">
                <ProgressBar id={`download_${item.id}`} progress={Math.max(0, Math.min(100, percent))} className="" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
