import { useState, useEffect } from "react";
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
  }
}

export default function DownloadsQueue(props: DownloadsQueueProps) {
  const { queue, progressByJobId } = props;
  const running = queue?.running ?? [];
  const queued = queue?.queued ?? [];

  const [isExpanded, setIsExpanded] = useState(false);

  const items = [...running, ...queued];
  const activeCount = running.length + queued.length;
  const isPaused = queue?.paused ?? false;

  // Auto-collapse when empty
  useEffect(() => {
    if (activeCount === 0) setIsExpanded(false);
  }, [activeCount]);

  if (activeCount === 0) return null;

  const currentJob = running[0];
  const currentProgress = currentJob ? progressByJobId[currentJob.id] : null;

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
          flex flex-col bg-[#0a0a0a]/80 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-300
          ${isExpanded ? 'rounded-2xl' : 'rounded-full h-14 hover:bg-[#0a0a0a]/90'}
        `}
      >
        {/* Header / Summary (Visible when collapsed) */}
        <div
          className="flex items-center justify-between px-4 h-14 cursor-pointer group"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            {/* Pulsing Indicator */}
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center transition-colors
              ${isPaused ? 'bg-yellow-500/20 text-yellow-500' : 'bg-purple-500/20 text-purple-400'}
            `}>
              {isPaused ? <Pause size={14} fill="currentColor" /> : <Download size={14} className={activeCount > 0 ? "animate-pulse" : ""} />}
            </div>

            {/* Status Text */}
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-bold text-white truncate">
                {currentJob ? (currentProgress?.name ?? currentJob.name) : `${activeCount} Downloads`}
              </span>
              <div className="flex items-center gap-2 text-xs text-white/50">
                {currentJob && currentProgress ? (
                  <>
                    <span className="text-purple-300">{formatBytes(currentProgress.speed ?? 0)}/s</span>
                    <span>•</span>
                    <span>{toPercent(currentProgress.progress ?? 0, currentProgress.total ?? 1).toFixed(0)}%</span>
                  </>
                ) : (
                  <span>{activeCount} items in queue</span>
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
                      <h4 className="text-sm font-bold text-white truncate">{name}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] items-center px-1.5 py-0.5 rounded font-bold uppercase tracking-wide
                           ${job.status === 'running' ? 'bg-purple-500/20 text-purple-300' : 'bg-white/10 text-white/50'}
                        `}>
                          {formatStatus(job.status)}
                        </span>
                        {isActive && p?.speed ? (
                          <span className="text-xs text-white/40 flex items-center gap-1">
                            <Activity size={10} /> {formatBytes(p.speed)}/s
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-xs font-bold text-white">{percent.toFixed(1)}%</span>
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
                    <span>{formatBytes(progressVal)} / {formatBytes(totalVal)}</span>
                    {isActive && p?.disk ? (
                      <span className="flex items-center gap-1"><HardDrive size={10} /> {formatBytes(p.disk)}/s</span>
                    ) : (
                      <span>Queue #{index + 1}</span>
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
