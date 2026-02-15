import { useState, useEffect, type CSSProperties } from "react";
import { formatBytes, toPercent } from "../../utils/progress";
import type { DownloadJobProgress, DownloadQueueStatePayload, QueueJobView } from "../../types/downloadQueue";
import {
  Download,
  ChevronUp,
  ChevronDown,
  Pause,
  Activity,
  HardDrive
} from "lucide-react";

type DownloadsQueueProps = {
  queue: DownloadQueueStatePayload | null;
  progressByJobId: Record<string, DownloadJobProgress>;
};

function formatStatus(status: QueueJobView["status"]): string {
  switch (status) {
    case "queued": return "Queued";
    case "running": return "Downloading";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "cancelled": return "Paused";
    case "paused": return "Paused";
  }
}

export default function DownloadsQueue(props: DownloadsQueueProps) {
  const { queue, progressByJobId } = props;
  const running = queue?.running ?? [];
  const queued = queue?.queued ?? [];

  const [isExpanded, setIsExpanded] = useState(false);

  // Get all job IDs from the queue
  const queueJobIds = new Set([...running, ...queued].map(j => j.id));

  // Find misc downloads that exist in progressByJobId but not in the queue (proton, steamrt, etc.)
  const miscDownloads: QueueJobView[] = Object.entries(progressByJobId)
    .filter(([id]) => !queueJobIds.has(id))
    .map(([id, progress]) => ({
      id,
      kind: 'game_download' as const,
      installId: id,
      name: progress.name ?? id,
      status: 'running' as const,
    }));

  const items = [...running, ...miscDownloads, ...queued];
  const activeCount = running.length + queued.length + miscDownloads.length;
  const isPaused = queue?.paused ?? false;

  // Auto-collapse when empty
  useEffect(() => {
    if (activeCount === 0) setIsExpanded(false);
  }, [activeCount]);

  if (activeCount === 0) return null;

  // Current job from queue or first misc download
  const currentJob = running[0] ?? miscDownloads[0];
  const currentProgress = currentJob ? progressByJobId[currentJob.id] : null;
  const strongTextStyle: CSSProperties = {
    textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.75)",
    WebkitTextStroke: "0.3px rgba(0,0,0,0.7)",
  };

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 transition-all duration-300 ease-spring ${isExpanded ? 'w-[450px]' : 'w-[400px]'
        }`}
      onMouseEnter={() => { }}
      onMouseLeave={() => { }}
    >
      {/* Dock Container */}
      <div
        className={`
          flex flex-col bg-[#0a0a0a]/95 border border-white/10 shadow-2xl overflow-hidden transition-all duration-300
          ${isExpanded ? 'rounded-2xl' : 'rounded-full h-14 hover:bg-[#0a0a0a]/90'}
        `}
      >
        {/* Header / Summary (Visible when collapsed) */}
        <div
          className="flex items-center justify-between px-4 h-14 cursor-pointer group"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Pulsing Indicator */}
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center transition-colors
              ${isPaused ? 'bg-yellow-500/20 text-yellow-500' : 'bg-purple-500/20 text-purple-400'}
            `}>
              {isPaused ? <Pause size={14} fill="currentColor" /> : <Download size={14} className={activeCount > 0 ? "animate-pulse" : ""} />}
            </div>

            {/* Status Text */}
            <div className="flex flex-col flex-1 min-w-0">
              <span
                className="block text-sm font-bold text-white whitespace-nowrap overflow-x-auto overflow-y-hidden custom-scrollbar"
                style={{ ...strongTextStyle, textOverflow: "clip" }}
                title={currentJob ? (currentProgress?.name ?? currentJob.name) : `${activeCount} Downloads`}
              >
                {currentJob ? (currentProgress?.name ?? currentJob.name) : `${activeCount} Downloads`}
              </span>
              <div className="flex items-center gap-2 text-xs text-white/50">
                {currentJob && currentProgress ? (
                  <>
                    <span className="text-purple-300" style={strongTextStyle}>{formatBytes(currentProgress.speed ?? 0)}/s</span>
                    <span>•</span>
                    <span style={strongTextStyle}>{toPercent(currentProgress.progress ?? 0, currentProgress.total ?? 1).toFixed(0)}%</span>
                  </>
                ) : (
                  <span style={strongTextStyle}>{activeCount} items in queue</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mini Progress Circle (only when collapsed) */}
            {!isExpanded && currentJob && currentProgress && (
              <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full ${isPaused ? 'bg-yellow-500' : 'bg-purple-500'}`}
                  style={{ width: `${toPercent(currentProgress.progress ?? 0, currentProgress.total ?? 1)}%` }}
                />
              </div>
            )}

            <button
              className="p-1.5 rounded-full hover:bg-white/10 text-white/40 group-hover:text-white transition-colors"
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          </div>
        </div>

        {/* Expanded Content */}
        <div className={`
            overflow-y-auto custom-scrollbar transition-[max-height] duration-300 ease-in-out
            ${isExpanded ? 'max-h-96 border-t border-white/5' : 'max-h-0'}
        `}>
          <div className="p-2 space-y-1">
            {items.map((job, index) => {
              const p = progressByJobId[job.id];
              const name = p?.name ?? job.name ?? job.installId;
              const isActive = index === 0 && !isPaused && job.status === 'running';
              const progressVal = p?.progress ?? 0;
              const totalVal = p?.total ?? 1;
              const percent = toPercent(progressVal, totalVal);

              return (
                <div key={job.id} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors group/item">
                  <div className="flex justify-between items-start mb-2">
                    <div className="min-w-0 pr-4">
                      <h4 className="text-sm font-bold text-white break-all leading-snug" style={strongTextStyle}>{name}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] items-center px-1.5 py-0.5 rounded font-bold uppercase tracking-wide backdrop-blur-sm
                           ${job.status === 'running' ? 'bg-purple-500/40 text-purple-100 border border-purple-300/70' : 'bg-black/30 text-white/90 border border-white/40'}
                        `} style={strongTextStyle}>
                          {formatStatus(job.status)}
                        </span>
                        {isActive && p?.speed ? (
                          <span className="text-xs text-white/60 flex items-center gap-1" style={strongTextStyle}>
                            <Activity size={10} /> {formatBytes(p.speed)}/s
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-xs font-bold text-white" style={strongTextStyle}>{percent.toFixed(1)}%</span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="relative h-1.5 bg-black/40 rounded-full overflow-hidden">
                    <div
                      className={`absolute top-0 left-0 h-full rounded-full transition-all duration-300
                            ${job.status === 'failed' ? 'bg-red-500' :
                          isPaused ? 'bg-yellow-500' :
                            job.status === 'running' ? 'bg-gradient-to-r from-purple-500 to-blue-500' : 'bg-white/20'}
                        `}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <div className="flex justify-between mt-1.5 text-[10px] text-white/30">
                    <span style={strongTextStyle}>{formatBytes(progressVal)} / {formatBytes(totalVal)}</span>
                    {isActive && p?.disk ? (
                      <span className="flex items-center gap-1" style={strongTextStyle}><HardDrive size={10} /> {formatBytes(p.disk)}/s</span>
                    ) : (
                      <span style={strongTextStyle}>Queue #{index + 1}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-white/5 flex justify-center">
            <span className="text-xs text-white/30 font-medium">Click header to collapse</span>
          </div>
        </div>
      </div>
    </div>
  );
}
