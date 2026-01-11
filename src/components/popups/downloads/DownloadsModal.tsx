import { useEffect, useMemo, useState } from "react";
import type {
  DownloadJobProgress,
  DownloadQueueStatePayload,
  QueueJobView,
} from "../../../types/downloadQueue";
import ProgressBar from "../../common/ProgressBar";
import { formatBytes, toPercent } from "../../../utils/progress";
import { POPUPS } from "../POPUPS";

type TelemetrySample = {
  t: number; // epoch ms
  net?: number; // bytes/s
  disk?: number; // bytes/s
};

type InstallView = {
  id: string;
  name?: string;
  game_icon?: string;
  game_background?: string;
};

type DownloadsModalProps = {
  setOpenPopup: (p: POPUPS) => void;
  queue: DownloadQueueStatePayload | null;
  progressByJobId: Record<string, DownloadJobProgress>;
  installs: InstallView[];
  downloadSpeedLimitKiB: number;
};

type CompletedJobSnapshot = {
  id: string;
  kind: QueueJobView["kind"];
  installId: string;
  name: string;
  completedAt: number;
  // Best-effort fields
  progress?: number;
  total?: number;
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

function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 B/s";
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatSpeedLimitKiB(limitKiB: number): string {
  if (!Number.isFinite(limitKiB) || limitKiB <= 0) return "";
  const MiB = 1024;
  if (limitKiB >= MiB) return `${(limitKiB / MiB).toFixed(1)} MiB/s`;
  return `${Math.round(limitKiB)} KiB/s`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export default function DownloadsModal(props: DownloadsModalProps) {
  const { setOpenPopup, queue, progressByJobId, installs, downloadSpeedLimitKiB } = props;

  const runningJobs = queue?.running ?? [];
  const queuedJobs = queue?.queued ?? [];
  const allQueuedOrRunning = useMemo(() => [...runningJobs, ...queuedJobs], [runningJobs, queuedJobs]);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedJobSnapshot[]>([]);
  const [prevIds, setPrevIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ids = new Set(allQueuedOrRunning.map((i) => i.id));

    // Detect jobs that disappeared from queue and treat them as completed (best-effort).
    if (prevIds.size > 0) {
      const removed: string[] = [];
      prevIds.forEach((id) => {
        if (!ids.has(id)) removed.push(id);
      });

      if (removed.length > 0) {
        setCompleted((prev) => {
          const next = [...prev];
          for (const id of removed) {
            // Avoid duplicates
            if (next.some((j) => j.id === id)) continue;
            const p = progressByJobId[id];
            const fallbackName = p?.name?.trim?.() ? p.name : id;
            // We don't have the job kind/installId anymore once removed; try to infer from last known queues.
            const lastKnown = allQueuedOrRunning.find((j) => j.id === id);
            next.unshift({
              id,
              kind: lastKnown?.kind ?? "game_download",
              installId: lastKnown?.installId ?? "",
              name: fallbackName,
              completedAt: Date.now(),
              progress: typeof p?.progress === "number" ? p.progress : undefined,
              total: typeof p?.total === "number" ? p.total : undefined,
            });
          }

          // Keep the list bounded.
          return next.slice(0, 50);
        });
      }
    }

    setPrevIds(ids);

    // Select a job by priority: running → queued → keep previous if still present.
    if (allQueuedOrRunning.length === 0) {
      setSelectedJobId(null);
      return;
    }
    setSelectedJobId((prev) => {
      if (prev && ids.has(prev)) return prev;
      return (runningJobs[0] ?? queuedJobs[0]).id;
    });
  }, [allQueuedOrRunning, runningJobs, queuedJobs, progressByJobId, prevIds]);

  const selected = selectedJobId ? allQueuedOrRunning.find((i) => i.id === selectedJobId) : undefined;
  const selectedProgress = selected ? progressByJobId[selected.id] : undefined;

  const [telemetryByJobId, setTelemetryByJobId] = useState<Record<string, TelemetrySample[]>>({});
  const [netHover, setNetHover] = useState<{ jobId: string; index: number; x: number; y: number } | null>(null);

  // Accumulate a small time-series window per job for graphs/ETA.
  useEffect(() => {
    if (!selected) return;
    const p = selectedProgress;
    if (!p) return;

    const net = typeof p.speed === "number" ? p.speed : undefined;
    const disk = typeof p.disk === "number" ? p.disk : undefined;
    if (net === undefined && disk === undefined) return;

    setTelemetryByJobId((prev) => {
      const next = { ...prev };
      const existing = next[selected.id] ? [...next[selected.id]] : [];
      const now = Date.now();
      existing.push({ t: now, net, disk });

      // Keep ~60s of samples.
      const cutoff = now - 60_000;
      const trimmed = existing.filter((s) => s.t >= cutoff);
      next[selected.id] = trimmed.length > 0 ? trimmed : existing.slice(-1);
      return next;
    });
  }, [selected?.id, selectedProgress?.speed, selectedProgress?.disk]);

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

        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {!selected ? (
              <div className="text-white/70 text-stroke">No active downloads.</div>
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

                // Installation progress (for extraction phase)
                const installProgress = typeof p?.installProgress === "number" ? p.installProgress : undefined;
                const installTotal = typeof p?.installTotal === "number" ? p.installTotal : undefined;
                const installPercent = installProgress !== undefined && installTotal !== undefined && installTotal > 0 ? toPercent(installProgress, installTotal) : 0;
                const hasInstallProgress = installProgress !== undefined && installTotal !== undefined && installTotal > 0;

                const install = installs.find((i) => i.id === selected.installId);

                const samples = telemetryByJobId[selected.id] || [];
                const peakNet = samples.reduce<number | undefined>((acc, s) => {
                  if (typeof s.net !== "number") return acc;
                  if (acc === undefined) return s.net;
                  return Math.max(acc, s.net);
                }, undefined);

                const limitText = formatSpeedLimitKiB(downloadSpeedLimitKiB);

                // Basic graph normalization (0..1) using max across window.
                const netMax = samples.reduce((m, s) => (typeof s.net === "number" ? Math.max(m, s.net) : m), 0);
                const diskMax = samples.reduce((m, s) => (typeof s.disk === "number" ? Math.max(m, s.disk) : m), 0);
                const netValues = samples.map((s) => (typeof s.net === "number" && netMax > 0 ? clamp01(s.net / netMax) : 0));
                const diskValues = samples.map((s) => (typeof s.disk === "number" && diskMax > 0 ? clamp01(s.disk / diskMax) : 0));

                const netPath = (() => {
                  if (netValues.length < 2) return "";
                  const w = 520;
                  const h = 110;
                  return netValues
                    .map((v, idx) => {
                      const x = (idx / (netValues.length - 1)) * w;
                      const y = (1 - v) * h;
                      return `${idx === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
                    })
                    .join(" ");
                })();

                const downloadBarPercent = Math.max(0, Math.min(100, percent));
                const installBarPercent = Math.max(0, Math.min(100, installPercent));

                const hoverIndex =
                  netHover && netHover.jobId === selected.id && samples.length > 0
                    ? Math.max(0, Math.min(samples.length - 1, netHover.index))
                    : undefined;
                const hoverSample = hoverIndex !== undefined ? samples[hoverIndex] : undefined;

                return (
                  <>
                    {/* Steam-like header area - unified banner with blended graph */}
                    <div className="bg-black/25 rounded-xl overflow-hidden">
                      {/* Combined banner + graph area */}
                      <div className="relative h-[200px]">
                        {/* Background image (left side, fades to right) */}
                        <div className="absolute inset-0 pointer-events-none">
                          {install?.game_background ? (
                            <img
                              src={install.game_background}
                              alt={""}
                              className="absolute inset-0 w-full h-full object-cover object-left"
                              style={{
                                maskImage: 'linear-gradient(to right, black 0%, black 25%, transparent 55%)',
                                WebkitMaskImage: 'linear-gradient(to right, black 0%, black 25%, transparent 55%)',
                              }}
                              draggable={false}
                            />
                          ) : (
                            <div
                              className="absolute inset-0 bg-white/5"
                              style={{
                                maskImage: 'linear-gradient(to right, black 0%, black 25%, transparent 55%)',
                                WebkitMaskImage: 'linear-gradient(to right, black 0%, black 25%, transparent 55%)',
                              }}
                            />
                          )}
                          {/* Darkening overlay on image side */}
                          <div
                            className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-transparent"
                            style={{
                              maskImage: 'linear-gradient(to right, black 0%, black 30%, transparent 55%)',
                              WebkitMaskImage: 'linear-gradient(to right, black 0%, black 30%, transparent 55%)',
                            }}
                          />
                        </div>

                        {/* Graph area (right side, fades to left) */}
                        <div
                          className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/15 to-black/30"
                          style={{
                            maskImage: 'linear-gradient(to left, black 0%, black 40%, transparent 65%)',
                            WebkitMaskImage: 'linear-gradient(to left, black 0%, black 40%, transparent 65%)',
                          }}
                        />

                        {/* Content layer */}
                        <div className="relative z-10 h-full flex flex-row">
                          {/* Left: Empty space for image to show through */}
                          <div className="w-72 flex-shrink-0 h-full" />

                          {/* Right: Graph + metrics */}
                          <div className="flex-1 flex flex-row overflow-hidden">
                            {/* Graph section */}
                            <div className="flex-1 p-3 overflow-hidden pointer-events-auto">
                              <div className="w-full h-full relative flex flex-col">
                                <svg
                                  viewBox="0 0 520 150"
                                  className="w-full flex-1"
                                  preserveAspectRatio="none"
                                  aria-hidden="true"
                                  onMouseMove={(e) => {
                                    if (samples.length === 0) return;
                                    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                                    const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                                    const ratio = rect.width > 0 ? px / rect.width : 0;
                                    const idx = Math.round(ratio * (samples.length - 1));
                                    setNetHover({ jobId: selected.id, index: idx, x: e.clientX, y: e.clientY });
                                  }}
                                  onMouseLeave={() => setNetHover(null)}
                                >
                                  <defs>
                                    <linearGradient id="netFillGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity="0.35" />
                                      <stop offset="100%" stopColor="rgb(59 130 246)" stopOpacity="0.05" />
                                    </linearGradient>
                                    <linearGradient id="diskBarGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
                                      <stop offset="100%" stopColor="rgba(255,255,255,0.08)" />
                                    </linearGradient>
                                    {/* Horizontal fade mask for graph elements */}
                                    <linearGradient id="graphFadeMask" x1="0" y1="0" x2="1" y2="0">
                                      <stop offset="0%" stopColor="white" stopOpacity="0" />
                                      <stop offset="25%" stopColor="white" stopOpacity="0.5" />
                                      <stop offset="45%" stopColor="white" stopOpacity="1" />
                                      <stop offset="100%" stopColor="white" stopOpacity="1" />
                                    </linearGradient>
                                    <mask id="graphMask">
                                      <rect x="0" y="0" width="520" height="150" fill="url(#graphFadeMask)" />
                                    </mask>
                                  </defs>

                                  {/* Graph content with fade mask */}
                                  <g mask="url(#graphMask)">
                                    {/* Horizontal grid lines */}
                                    <path d="M0 37.5 H520" stroke="rgba(255,255,255,0.06)" strokeWidth={1} fill="none" />
                                    <path d="M0 75 H520" stroke="rgba(255,255,255,0.08)" strokeWidth={1} fill="none" />
                                    <path d="M0 112.5 H520" stroke="rgba(255,255,255,0.06)" strokeWidth={1} fill="none" />
                                    <path d="M0 150 H520" stroke="rgba(255,255,255,0.10)" strokeWidth={1} fill="none" />

                                    {/* Disk bars (behind) */}
                                    {(() => {
                                      const bars = diskValues.length > 0 ? diskValues.slice(-60) : [];
                                      const barCount = bars.length > 0 ? bars.length : 60;
                                      const w = 520;
                                      const h = 150;
                                      const bw = w / barCount;
                                      return Array.from({ length: barCount }).map((_, idx) => {
                                        const v = bars.length > 0 ? bars[idx] ?? 0 : 0;
                                        const bh = Math.max(2, v * (h - 2));
                                        const x = idx * bw;
                                        const y = h - bh;
                                        return (
                                          <rect
                                            key={idx}
                                            x={x}
                                            y={y}
                                            width={Math.max(1, bw - 1)}
                                            height={bh}
                                            fill={v > 0 ? "url(#diskBarGradient)" : "rgba(255,255,255,0.05)"}
                                          />
                                        );
                                      });
                                    })()}

                                    {/* Filled area under network line */}
                                    {netPath && (
                                      <path
                                        d={`${netPath} L520 150 L0 150 Z`}
                                        fill="url(#netFillGradient)"
                                      />
                                    )}

                                    {/* Network line (front) */}
                                    {netPath ? (
                                      <path d={netPath} stroke="rgb(96 165 250)" strokeWidth={2} fill="none" strokeLinejoin="round" />
                                    ) : (
                                      <path d="" />
                                    )}

                                    {hoverIndex !== undefined && netValues.length > 1 && (
                                      (() => {
                                        const w = 520;
                                        const x = (hoverIndex / (netValues.length - 1)) * w;
                                        return (
                                          <path
                                            d={`M${x.toFixed(1)} 0 V150`}
                                            stroke="rgba(255,255,255,0.30)"
                                            strokeWidth={1}
                                            fill="none"
                                          />
                                        );
                                      })()
                                    )}
                                  </g>
                                </svg>

                                {hoverSample && (
                                  <div
                                    className="absolute z-10 px-3 py-2 rounded-md bg-black/90 border border-white/20 text-white text-stroke text-xs pointer-events-none shadow-lg backdrop-blur-sm"
                                    style={{ top: 10, right: 10 }}
                                  >
                                    <div className="flex gap-3">
                                      <span className="text-blue-400">Net:</span>
                                      <span>{typeof hoverSample.net === "number" ? formatRate(hoverSample.net) : "—"}</span>
                                    </div>
                                    <div className="flex gap-3 mt-1">
                                      <span className="text-white/60">Disk:</span>
                                      <span>{typeof hoverSample.disk === "number" ? formatRate(hoverSample.disk) : "—"}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Metrics (right side) */}
                            <div className="w-56 flex-shrink-0 flex flex-col justify-between p-3">
                              {/* Top: Metrics in horizontal row */}
                              <div className="flex gap-4 justify-end">
                                <div className="text-right">
                                  <div className="text-white/60 text-stroke text-xs">NETWORK</div>
                                  <div className="text-white text-stroke text-base">{speed !== undefined ? formatRate(speed) : "—"}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-white/60 text-stroke text-xs">PEAK</div>
                                  <div className="text-white text-stroke text-base">{peakNet !== undefined ? formatRate(peakNet) : "—"}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-white/60 text-stroke text-xs">DISK</div>
                                  <div className="text-white text-stroke text-base">{disk !== undefined ? formatRate(disk) : "—"}</div>
                                </div>
                              </div>

                              {/* Middle: Speed limit */}
                              {limitText && (
                                <div className="text-right text-white/70 text-stroke text-xs">
                                  Download limited to: <span className="text-white">{limitText}</span>
                                </div>
                              )}

                              {/* Bottom: Progress bars - Download and Installation side by side */}
                              <div className="space-y-2">
                                {/* Download progress bar */}
                                <div className="flex items-center gap-3">
                                  <div className="text-white/60 text-stroke text-xs w-20">Download</div>
                                  <div className="flex-1 bg-white/10 rounded h-1.5 overflow-hidden">
                                    <div
                                      className="h-full rounded transition-all duration-500 ease-out"
                                      style={{
                                        width: `${downloadBarPercent}%`,
                                        background: 'linear-gradient(90deg, rgb(37 99 235) 0%, rgb(96 165 250) 100%)'
                                      }}
                                    />
                                  </div>
                                  <div className="text-white text-stroke text-xs whitespace-nowrap w-16 text-right">
                                    {percentText}
                                  </div>
                                </div>
                                {/* Installation progress bar (visible during extraction) */}
                                {hasInstallProgress && (
                                  <div className="flex items-center gap-3">
                                    <div className="text-white/60 text-stroke text-xs w-20">Installing</div>
                                    <div className="flex-1 bg-white/10 rounded h-1.5 overflow-hidden">
                                      <div
                                        className="h-full rounded transition-all duration-500 ease-out"
                                        style={{
                                          width: `${installBarPercent}%`,
                                          background: 'linear-gradient(90deg, rgb(34 197 94) 0%, rgb(134 239 172) 100%)'
                                        }}
                                      />
                                    </div>
                                    <div className="text-white text-stroke text-xs whitespace-nowrap w-16 text-right">
                                      {installPercent.toFixed(0)}%
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="px-4 pb-2 text-white/50 text-stroke text-xs">Job ID: {selected.id}</div>

                    {/* Queue sections below */}
                    <div className="mt-6 space-y-6">
                      {/* Now downloading */}
                      <div>
                        <div className="text-white/80 text-stroke text-sm mb-2">Now downloading</div>
                        <div className="space-y-3">
                          {runningJobs.length === 0 ? (
                            <div className="text-white/50 text-stroke text-sm">Nothing is downloading right now.</div>
                          ) : (
                            runningJobs.map((job) => {
                              const jp = progressByJobId[job.id];
                              const installJ = installs.find((i) => i.id === job.installId);
                              const name = (jp?.name && jp.name.trim().length > 0 ? jp.name : job.name) || installJ?.name || job.installId;
                              const pr = typeof jp?.progress === "number" ? jp.progress : undefined;
                              const tt = typeof jp?.total === "number" ? jp.total : undefined;
                              const pct = pr !== undefined && tt !== undefined && tt > 0 ? toPercent(pr, tt) : 0;
                              const selectedRow = job.id === selectedJobId;
                              return (
                                <button
                                  key={job.id}
                                  className={`w-full text-left rounded-lg px-4 py-3 border transition-colors ${selectedRow
                                      ? "bg-black/50 border-white/25"
                                      : "bg-black/25 hover:bg-black/35 border-white/10"
                                    }`}
                                  onClick={() => setSelectedJobId(job.id)}
                                >
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                      <div className="text-white text-stroke truncate">{name}</div>
                                      <div className="text-white/60 text-stroke text-xs">
                                        {formatKind(job.kind)} • {formatStatus(job.status)}
                                      </div>
                                    </div>

                                    <div className="text-right text-white/70 text-stroke text-xs whitespace-nowrap">
                                      {pr !== undefined && tt !== undefined && tt > 0 ? (
                                        <>
                                          {formatBytes(pr)} / {formatBytes(tt)}
                                        </>
                                      ) : (
                                        <>&nbsp;</>
                                      )}
                                    </div>
                                  </div>

                                  <div className="mt-2">
                                    <ProgressBar id={`dl_modal_now_${job.id}`} progress={Math.max(0, Math.min(100, pct))} className="" />
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Up next */}
                      <div>
                        <div className="text-white/80 text-stroke text-sm mb-2">Up next</div>
                        <div className="space-y-3">
                          {queuedJobs.length === 0 ? (
                            <div className="text-white/50 text-stroke text-sm">No queued downloads.</div>
                          ) : (
                            queuedJobs.map((job) => {
                              const jp = progressByJobId[job.id];
                              const installJ = installs.find((i) => i.id === job.installId);
                              const name = (jp?.name && jp.name.trim().length > 0 ? jp.name : job.name) || installJ?.name || job.installId;
                              const selectedRow = job.id === selectedJobId;
                              return (
                                <button
                                  key={job.id}
                                  className={`w-full text-left rounded-lg px-4 py-3 border transition-colors ${selectedRow
                                      ? "bg-black/50 border-white/25"
                                      : "bg-black/25 hover:bg-black/35 border-white/10"
                                    }`}
                                  onClick={() => setSelectedJobId(job.id)}
                                >
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                      <div className="text-white text-stroke truncate">{name}</div>
                                      <div className="text-white/60 text-stroke text-xs">
                                        {formatKind(job.kind)} • {formatStatus(job.status)}
                                      </div>
                                    </div>
                                    <div className="text-white/50 text-stroke text-xs whitespace-nowrap">Queued</div>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Completed */}
                      <div>
                        <div className="text-white/80 text-stroke text-sm mb-2">Completed</div>
                        <div className="space-y-3">
                          {completed.length === 0 ? (
                            <div className="text-white/50 text-stroke text-sm">No completed items yet.</div>
                          ) : (
                            completed.map((job) => {
                              const installJ = installs.find((i) => i.id === job.installId);
                              const name = job.name || installJ?.name || job.id;
                              const pr = typeof job.progress === "number" ? job.progress : undefined;
                              const tt = typeof job.total === "number" ? job.total : undefined;
                              const pct = pr !== undefined && tt !== undefined && tt > 0 ? toPercent(pr, tt) : 100;
                              return (
                                <div
                                  key={job.id}
                                  className="w-full rounded-lg px-4 py-3 border bg-black/20 border-white/10"
                                >
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                      <div className="text-white/80 text-stroke truncate">{name}</div>
                                      <div className="text-white/50 text-stroke text-xs">Completed</div>
                                    </div>
                                    <div className="text-white/50 text-stroke text-xs whitespace-nowrap">
                                      {pr !== undefined && tt !== undefined && tt > 0 ? (
                                        <>
                                          {formatBytes(pr)} / {formatBytes(tt)}
                                        </>
                                      ) : (
                                        <span>—</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-2">
                                    <ProgressBar id={`dl_modal_done_${job.id}`} progress={Math.max(0, Math.min(100, pct))} className="opacity-60" />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
