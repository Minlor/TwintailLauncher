import { useEffect, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type {
    DownloadJobProgress,
    DownloadQueueStatePayload,
    QueueJobView,
} from '../../types/downloadQueue';
import { formatBytes, toPercent } from '../../utils/progress';
import { ArrowLeft, DownloadCloud } from "lucide-react";
import { PAGES } from './PAGES';

/* Telemetry sample for graph */
interface TelemetrySample {
    net: number;
    disk: number;
}

/* Install view for banner display */
interface InstallView {
    id: string;
    name?: string;
    game_icon?: string;
    game_background?: string;
}

/* Props for DownloadsPage */
interface DownloadsPageProps {
    setCurrentPage: (page: PAGES) => void;
    queue: DownloadQueueStatePayload | null;
    progressByJobId: Record<string, DownloadJobProgress>;
    installs: InstallView[];
    speedHistory: TelemetrySample[];
    onSpeedSample: (sample: TelemetrySample) => void;
    onClearHistory: () => void;
    downloadSpeedLimitKiB: number;
}

/* Format speed in bytes per second */
const formatSpeed = (bytesPerSecond: number): string => {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/s';
    return `${formatBytes(bytesPerSecond)}/s`;
};

/* Format time duration */
const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
};

/* Calculate ETA using average of recent speeds */
const calculateETA = (totalBytes: number, progressBytes: number, speedHistory: TelemetrySample[]): string => {
    const remaining = Math.max(totalBytes - progressBytes, 0);
    if (remaining === 0 || speedHistory.length === 0) return '—';

    // Use last 10 samples (or all if less than 10) for average
    const recentSamples = speedHistory.slice(-10);
    const avgSpeed = recentSamples.reduce((sum, sample) => sum + sample.net, 0) / recentSamples.length;

    if (!avgSpeed || avgSpeed <= 0) return '—';
    const seconds = Math.ceil(remaining / avgSpeed);
    return formatTime(seconds);
};

/* Format kind label */
function formatKind(kind: QueueJobView['kind']): string {
    switch (kind) {
        case 'game_download': return 'Download';
        case 'game_update': return 'Update';
        case 'game_preload': return 'Preload';
        case 'game_repair': return 'Repair';
    }
}

/* Format status label */
function formatStatus(status: QueueJobView['status'], isPaused: boolean): string {
    if (isPaused && status === 'running') return 'Paused';
    switch (status) {
        case 'queued': return 'Queued';
        case 'running': return 'Downloading';
        case 'completed': return 'Completed';
        case 'failed': return 'Failed';
        case 'cancelled': return 'Paused';
    }
}

/**
 * Downloads Page - Full-page view for download progress, graph, and queue
 */
export default function DownloadsPage({
    setCurrentPage,
    queue,
    progressByJobId,
    installs,
    speedHistory,
    onSpeedSample,
    onClearHistory,
    downloadSpeedLimitKiB,
}: DownloadsPageProps) {
    // Canvas ref for graph
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    // Ref to track last sampled speed to avoid duplicate samples
    const lastSampleRef = useRef<{ net: number; disk: number; time: number } | null>(null);

    // Hover state for graph tooltip
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

    // Track completed items locally (items that disappeared from queue)
    const [completedItems, setCompletedItems] = useState<QueueJobView[]>([]);
    const prevJobIdsRef = useRef<Set<string>>(new Set());

    // Track paused jobs (jobs that were paused and removed from queue)
    const [pausedJob, setPausedJob] = useState<{ job: QueueJobView; progress: DownloadJobProgress | null } | null>(null);
    const pauseRequestedRef = useRef<string | null>(null);

    // Peak speed tracking
    const [peakSpeed, setPeakSpeed] = useState<number>(0);

    // Pausing state - true when pause requested but not yet complete
    const [isPausing, setIsPausing] = useState<boolean>(false);

    // Track previous job ID to detect job changes and reset history
    const previousJobIdRef = useRef<string | null>(null);

    // Drag and drop state
    const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
    const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

    // Get running and queued jobs
    const runningJobs = queue?.running ?? [];
    const queuedJobs = queue?.queued ?? [];
    const isQueuePaused = queue?.paused ?? false;
    const allJobs = [...runningJobs, ...queuedJobs];

    // Current download - either from running queue or paused state
    const currentJob = runningJobs[0] ?? pausedJob?.job ?? null;
    const currentProgress = currentJob
        ? (progressByJobId[currentJob.id] ?? pausedJob?.progress ?? null)
        : null;

    // Derive paused state
    const isPaused = isQueuePaused || currentJob?.status === 'cancelled' || (pausedJob !== null && runningJobs.length === 0);

    // Calculate progress values
    const progressBytes = currentProgress?.progress ?? 0;
    const totalBytes = currentProgress?.total ?? 0;
    const downloadProgress = totalBytes > 0 ? toPercent(progressBytes, totalBytes) : 0;
    const currentSpeed = currentProgress?.speed ?? 0;
    const currentDisk = currentProgress?.disk ?? 0;

    // Track completed items when jobs disappear from queue
    useEffect(() => {
        const currentIds = new Set(allJobs.map(j => j.id));
        const prevJobIds = prevJobIdsRef.current;

        if (prevJobIds.size > 0) {
            const removed: QueueJobView[] = [];
            prevJobIds.forEach(id => {
                if (!currentIds.has(id)) {
                    if (pauseRequestedRef.current === id) {
                        pauseRequestedRef.current = null;
                        return;
                    }
                    const progress = progressByJobId[id];
                    removed.push({
                        id,
                        kind: 'game_download',
                        installId: '',
                        name: progress?.name ?? id,
                        status: 'completed',
                    });
                }
            });

            if (removed.length > 0) {
                setCompletedItems(prev => [...removed, ...prev].slice(0, 20));
            }
        }

        if (runningJobs.length > 0 && pausedJob !== null && runningJobs[0].id !== pausedJob.job.id) {
            setPausedJob(null);
        }

        prevJobIdsRef.current = currentIds;
    }, [allJobs, progressByJobId, runningJobs.length, pausedJob]);

    // Reset graph history and peak speed when active job changes
    useEffect(() => {
        const currentJobId = currentJob?.id ?? null;
        if (previousJobIdRef.current !== null && currentJobId !== previousJobIdRef.current) {
            onClearHistory();
            setPeakSpeed(0);
            lastSampleRef.current = null;
            onSpeedSample({ net: 0, disk: 0 });
            setIsPausing(false);
        }
        previousJobIdRef.current = currentJobId;
    }, [currentJob?.id, onClearHistory, onSpeedSample]);

    // Sample speed/disk for graph when we have a running job
    useEffect(() => {
        if (!currentJob || isPaused) return;
        if (currentSpeed <= 0 && currentDisk <= 0) return;

        const now = Date.now();
        const last = lastSampleRef.current;

        if (last && now - last.time < 900) return;

        lastSampleRef.current = { net: currentSpeed, disk: currentDisk, time: now };
        onSpeedSample({ net: currentSpeed, disk: currentDisk });
        setPeakSpeed(prev => Math.max(prev, currentSpeed));
        if (currentSpeed > peakSpeed) setPeakSpeed(currentSpeed);
    }, [currentSpeed, currentDisk, currentJob, isPaused, onSpeedSample, peakSpeed]);

    // Draw canvas graph
    const GRAPH_SLOTS = 60;

    // Handle Resize
    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                // Use contentBoxSize if available for better precision, fallback to contentRect
                const width = entry.contentRect.width;
                const height = entry.contentRect.height;
                setCanvasSize({ width, height });
            }
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!canvasRef.current || canvasSize.width === 0 || canvasSize.height === 0) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Handle high-DPI displays
        const dpr = window.devicePixelRatio || 1;

        // Set actual canvas size (resolution)
        canvas.width = canvasSize.width * dpr;
        canvas.height = canvasSize.height * dpr;

        // Scale context to match
        ctx.resetTransform();
        ctx.scale(dpr, dpr);

        // Logical dimensions for drawing
        const width = canvasSize.width;
        const height = canvasSize.height;

        const paddedHistory: { net: number; disk: number }[] = [];
        const emptySlots = GRAPH_SLOTS - speedHistory.length;
        for (let i = 0; i < emptySlots; i++) {
            paddedHistory.push({ net: 0, disk: 0 });
        }
        paddedHistory.push(...speedHistory);

        const maxNet = Math.max(...paddedHistory.map(s => s.net), 1024 * 1024);
        const maxDisk = Math.max(...paddedHistory.map(s => s.disk), 1024 * 1024);
        const maxValue = Math.max(maxNet, maxDisk);

        ctx.clearRect(0, 0, width, height);

        const barWidth = width / GRAPH_SLOTS;
        const fadeLeftAlpha = 0.05;
        const fadeRightAlpha = 1.0;
        const fadeExponent = 1.6;

        // Draw network bars
        paddedHistory.forEach((sample, index) => {
            const x = barWidth * index;
            const barHeight = (sample.net / maxValue) * height;
            const y = height - barHeight;

            const actualIndex = index - emptySlots;
            const isHighlighted = hoveredIndex !== null && actualIndex === hoveredIndex;
            const t = index / (GRAPH_SLOTS - 1);
            const tAdjusted = Math.pow(t, fadeExponent);
            const alpha = isHighlighted ? 0.98 : (fadeLeftAlpha + tAdjusted * (fadeRightAlpha - fadeLeftAlpha));

            ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
            // Used Math.floor/ceil to avoid subpixel gaps
            ctx.fillRect(x, y, barWidth - 1, barHeight);
        });

        // Draw disk line with gradient
        const diskGradient = ctx.createLinearGradient(0, 0, width, 0);
        diskGradient.addColorStop(0, 'rgba(16,185,129,0.12)');
        diskGradient.addColorStop(0.5, 'rgba(16,185,129,0.65)');
        diskGradient.addColorStop(1, 'rgba(16,185,129,1.0)');

        ctx.strokeStyle = diskGradient;
        ctx.lineWidth = 2;
        ctx.beginPath();
        paddedHistory.forEach((sample, index) => {
            const x = barWidth * index + barWidth / 2;
            const y = height - (sample.disk / maxValue) * height;
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Draw hover indicator
        if (hoveredIndex !== null && hoveredIndex < speedHistory.length) {
            const paddedIndex = emptySlots + hoveredIndex;
            const x = barWidth * paddedIndex + barWidth / 2;
            const sample = speedHistory[hoveredIndex];
            const y = height - (sample.disk / maxValue) * height;

            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#10b981';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }, [speedHistory, hoveredIndex, canvasSize]);

    // Mouse handlers for canvas
    const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;

        const rect = canvasRef.current.getBoundingClientRect();
        // Mouse X relative to the canvas
        const x = e.clientX - rect.left;

        // Canvas is now responsive, so logical width matches layout width.
        // We just need to map x to the correct slot.
        const logicalWidth = rect.width;

        const barWidth = logicalWidth / GRAPH_SLOTS;
        const paddedIndex = Math.floor(x / barWidth);

        const emptySlots = GRAPH_SLOTS - speedHistory.length;
        const actualIndex = paddedIndex - emptySlots;

        if (actualIndex >= 0 && actualIndex < speedHistory.length) {
            setHoveredIndex(actualIndex);
            setMousePos({ x: e.clientX, y: e.clientY });
        } else {
            setHoveredIndex(null);
            setMousePos(null);
        }
    }, [speedHistory.length]);

    const handleCanvasMouseLeave = useCallback(() => {
        setHoveredIndex(null);
        setMousePos(null);
    }, []);

    // Pause/Resume handlers
    const handlePause = async () => {
        if (!currentJob) return;
        try {
            setIsPausing(true);
            pauseRequestedRef.current = currentJob.id;
            setPausedJob({
                job: { ...currentJob, status: 'cancelled' },
                progress: currentProgress,
            });
            await invoke('pause_game_download', { installId: currentJob.installId });
        } catch (error) {
            console.error('Failed to pause download:', error);
            pauseRequestedRef.current = null;
            setPausedJob(null);
            setIsPausing(false);
        }
    };

    const handleResume = async () => {
        if (!pausedJob) return;

        const { job } = pausedJob;
        const installId = job.installId;

        try {
            setPausedJob(null);
            setIsPausing(false);

            await invoke('queue_set_paused', { paused: false });

            const payload = {
                install: installId,
                biz: '',
                lang: '',
                region: ''
            };

            switch (job.kind) {
                case 'game_download':
                    await emit('start_game_download', payload);
                    break;
                case 'game_update':
                    await emit('start_game_update', payload);
                    break;
                case 'game_preload':
                    await emit('start_game_preload', payload);
                    break;
                case 'game_repair':
                    await emit('start_game_repair', payload);
                    break;
            }
        } catch (error) {
            console.error('Failed to resume download:', error);
            setPausedJob(pausedJob);
        }
    };

    // Queue reordering handlers
    const handleMoveUp = async (jobId: string) => {
        try {
            await invoke('queue_move_up', { jobId });
        } catch (error) {
            console.error('Failed to move job up:', error);
        }
    };

    const handleMoveDown = async (jobId: string) => {
        try {
            await invoke('queue_move_down', { jobId });
        } catch (error) {
            console.error('Failed to move job down:', error);
        }
    };

    const handleRemove = async (jobId: string) => {
        try {
            await invoke('queue_remove', { jobId });
        } catch (error) {
            console.error('Failed to remove job from queue:', error);
        }
    };

    const handleActivateJob = async (jobId: string) => {
        try {
            await invoke('queue_activate_job', { jobId });
        } catch (error) {
            console.error('Failed to activate job:', error);
        }
    };

    const handleReorder = async (jobId: string, newPosition: number) => {
        try {
            await invoke('queue_reorder', { jobId, newPosition });
        } catch (error) {
            console.error('Failed to reorder job:', error);
        }
    };

    // Drag and drop handlers
    const handleDragStart = (e: React.DragEvent, jobId: string) => {
        setDraggedJobId(jobId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', jobId);
    };

    const handleDragEnd = () => {
        setDraggedJobId(null);
        setDragOverTarget(null);
    };

    const handleDragOver = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverTarget(targetId);
    };

    const handleDragLeave = () => {
        setDragOverTarget(null);
    };

    const handleDropOnQueue = async (e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        const jobId = e.dataTransfer.getData('text/plain');
        if (jobId && draggedJobId) {
            await handleReorder(jobId, targetIndex);
        }
        setDraggedJobId(null);
        setDragOverTarget(null);
    };

    const handleDropOnActive = async (e: React.DragEvent) => {
        e.preventDefault();
        const jobId = e.dataTransfer.getData('text/plain');
        if (jobId && draggedJobId) {
            await handleActivateJob(jobId);
        }
        setDraggedJobId(null);
        setDragOverTarget(null);
    };

    // Get install info for banner
    const currentInstall = currentJob ? installs.find(i => i.id === currentJob.installId) : null;
    const bannerImage = currentInstall?.game_background;

    // Speed limit display
    const limitText = downloadSpeedLimitKiB > 0
        ? (downloadSpeedLimitKiB >= 1024
            ? `${(downloadSpeedLimitKiB / 1024).toFixed(1)} MiB/s`
            : `${Math.round(downloadSpeedLimitKiB)} KiB/s`)
        : '';

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden animate-fadeIn">
            {/* Hover Tooltip */}
            {hoveredIndex !== null && mousePos && speedHistory[hoveredIndex] && (
                (() => {
                    const tooltipWidth = 220;
                    const tooltipHeight = 90;
                    const padding = 12;
                    let left = mousePos.x + 15;
                    let top = mousePos.y - 80;

                    if (left + tooltipWidth + padding > window.innerWidth) {
                        left = Math.max(padding, mousePos.x - tooltipWidth - 15);
                    }
                    if (top < padding) top = padding;
                    if (top + tooltipHeight + padding > window.innerHeight) {
                        top = Math.max(padding, window.innerHeight - tooltipHeight - padding);
                    }

                    const sample = speedHistory[hoveredIndex];
                    return (
                        <div
                            className="fixed z-50 bg-gray-900/95 border border-gray-700 rounded-lg px-3 py-2 shadow-2xl pointer-events-none backdrop-blur-sm"
                            style={{ left: `${left}px`, top: `${top}px`, minWidth: tooltipWidth }}
                        >
                            <div className="text-xs space-y-1.5 min-w-[180px]">
                                <div className="border-b border-gray-700 pb-1.5 mb-1.5">
                                    <div className="flex items-center gap-1.5 text-orange-400 font-medium">
                                        <DownloadCloud className="w-3 h-3" />
                                        <span className="truncate">{currentJob?.name ?? 'Download'}</span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-blue-400 font-semibold">Network</span>
                                    <span className="text-blue-400 font-semibold">{formatSpeed(sample.net)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-green-400 font-semibold">Disk</span>
                                    <span className="text-green-400 font-semibold">{formatSpeed(sample.disk)}</span>
                                </div>
                            </div>
                        </div>
                    );
                })()
            )}

            {/* Page Header */}
            <div className="flex items-center gap-4 px-8 py-6 border-b border-white/5 bg-black/30 backdrop-blur-sm">
                <button
                    onClick={() => setCurrentPage(PAGES.NONE)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-all duration-200 hover:scale-105"
                >
                    <ArrowLeft className="w-5 h-5 text-white/70" />
                </button>
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-600/20 rounded-xl border border-blue-500/30">
                        <DownloadCloud className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Download Manager</h1>
                        {currentJob && (
                            <p className="text-sm text-white/50">
                                {formatSpeed(currentSpeed)} • {allJobs.length} item{allJobs.length !== 1 ? 's' : ''} in queue
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {/* Current Download Section */}
                {currentJob ? (
                    <div
                        className={`flex flex-col transition-all ${draggedJobId && dragOverTarget === 'active'
                            ? 'ring-2 ring-blue-500 ring-inset bg-blue-900/10'
                            : ''
                            }`}
                        onDragOver={(e) => { e.preventDefault(); setDragOverTarget('active'); }}
                        onDragLeave={() => setDragOverTarget(null)}
                        onDrop={handleDropOnActive}
                    >
                        {/* Graph and Progress Area */}
                        <div className="border-b border-white/5">
                            <div className="flex gap-0 relative items-end pl-72">
                                {/* Banner Background - Extended */}
                                <div className="absolute left-0 top-0 bottom-0 w-[65%] overflow-hidden pointer-events-none z-0">
                                    {bannerImage ? (
                                        <img
                                            src={bannerImage}
                                            alt=""
                                            className="w-full h-full object-cover opacity-30"
                                            style={{
                                                maskImage: 'linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 40%, rgba(0,0,0,0.5) 70%, rgba(0,0,0,0) 100%)',
                                                WebkitMaskImage: 'linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 40%, rgba(0,0,0,0.5) 70%, rgba(0,0,0,0) 100%)'
                                            }}
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-gray-800/50" />
                                    )}

                                    {/* Title overlay */}
                                    <div className="absolute left-6 top-6 z-10 text-left pointer-events-none">
                                        <h3 className="text-2xl font-semibold text-white mb-1 truncate max-w-xs">
                                            {currentProgress?.name ?? currentJob.name}
                                        </h3>
                                        <p className="text-sm text-gray-300">{formatKind(currentJob.kind)}</p>
                                    </div>
                                </div>

                                {/* Graph - Wrapper to keep full width layout but constrain graph */}
                                <div className="flex-1 relative z-10 min-w-0 flex items-end justify-end">
                                    <div className="w-full max-w-[800px]">
                                        <div ref={containerRef} className="w-full h-[140px] overflow-hidden">
                                            <canvas
                                                ref={canvasRef}
                                                className="w-full h-full cursor-pointer touch-none block"
                                                style={{ width: '100%', height: '100%' }}
                                                onMouseMove={handleCanvasMouseMove}
                                                onMouseLeave={handleCanvasMouseLeave}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Stats Panel - Wider with background */}
                                <div className="w-[420px] flex flex-col justify-between z-10 px-6 py-4 bg-black/40 backdrop-blur-sm border-l border-white/5">
                                    <div className="space-y-6">
                                        {/* Stats Row */}
                                        <div className="mt-3">
                                            <div className="flex items-start gap-8 justify-between">
                                                <div className="flex flex-col text-xs">
                                                    <div className="flex items-center gap-2 text-gray-400 uppercase tracking-wider">
                                                        <div className="flex items-end gap-0.5 h-3">
                                                            <div className="w-0.5 h-1.5 bg-blue-400 rounded-sm"></div>
                                                            <div className="w-0.5 h-2.5 bg-blue-400 rounded-sm"></div>
                                                            <div className="w-0.5 h-2 bg-blue-400 rounded-sm"></div>
                                                        </div>
                                                        <span>Network</span>
                                                    </div>
                                                    <div className="text-sm font-medium text-blue-400 mt-1">{formatSpeed(currentSpeed)}</div>
                                                </div>

                                                <div className="flex flex-col text-xs">
                                                    <div className="flex items-center gap-2 text-gray-400 uppercase tracking-wider">
                                                        <div className="flex items-end gap-0.5 h-3">
                                                            <div className="w-0.5 h-1.5 bg-blue-400 rounded-sm"></div>
                                                            <div className="w-0.5 h-2.5 bg-blue-400 rounded-sm"></div>
                                                            <div className="w-0.5 h-2 bg-blue-400 rounded-sm"></div>
                                                        </div>
                                                        <span>Peak</span>
                                                    </div>
                                                    <div className="text-sm font-medium text-blue-400 mt-1">{formatSpeed(peakSpeed)}</div>
                                                </div>

                                                <div className="flex flex-col text-xs">
                                                    <div className="flex items-center gap-2 text-gray-400 uppercase tracking-wider">
                                                        <div className="flex items-center h-3">
                                                            <div className="w-3 h-0.5 bg-green-400 rounded-full"></div>
                                                        </div>
                                                        <span>Disk</span>
                                                    </div>
                                                    <div className="text-sm font-medium text-green-400 mt-1">{formatSpeed(currentDisk)}</div>
                                                </div>
                                            </div>

                                            {/* Speed limit */}
                                            {limitText && (
                                                <div className="text-xs text-gray-400 uppercase tracking-wider mt-2">
                                                    Downloads limited to: <span className="text-gray-300">{limitText}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Progress Bar */}
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="text-xs">
                                                    {isPaused ? (
                                                        <span className="text-yellow-400 font-medium">Paused</span>
                                                    ) : (
                                                        <div className="text-gray-400">
                                                            <span className="uppercase tracking-wider">Downloaded:</span>
                                                            <span className="ml-2 text-white font-medium">
                                                                {formatBytes(progressBytes)}
                                                                <span className="mx-1 text-gray-400">/</span>
                                                                {formatBytes(totalBytes)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-sm text-gray-300 font-medium">
                                                    {downloadProgress.toFixed(1)}%
                                                </div>
                                            </div>

                                            <div className="w-full bg-white/10 rounded-full h-2 mb-2 overflow-hidden">
                                                <div
                                                    className={`h-2 rounded-full transition-all duration-500 ${isPaused ? 'bg-gray-500' : 'bg-blue-500'
                                                        }`}
                                                    style={{
                                                        width: `${downloadProgress}%`,
                                                        boxShadow: isPaused ? 'none' : '0 0 10px rgba(59, 130, 246, 0.5)'
                                                    }}
                                                />
                                            </div>

                                            {/* ETA and Pause Button */}
                                            <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
                                                <div className="flex-1">
                                                    {isPausing && !isPaused ? (
                                                        <div className="flex items-center">
                                                            <svg className="animate-spin w-3 h-3 mr-2 text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                                                                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                                                            </svg>
                                                            <span className="text-yellow-400 font-medium">Pausing...</span>
                                                        </div>
                                                    ) : !isPaused ? (
                                                        <div>
                                                            <span className="uppercase tracking-wider">Estimate:</span>
                                                            <span className="ml-2 text-white font-medium">
                                                                {calculateETA(totalBytes, progressBytes, speedHistory)}
                                                            </span>
                                                        </div>
                                                    ) : null}
                                                </div>
                                                <button
                                                    onClick={isPaused ? handleResume : handlePause}
                                                    disabled={isPausing && !isPaused}
                                                    className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors shadow-sm ${isPausing && !isPaused
                                                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                                                        }`}
                                                >
                                                    {isPaused ? (
                                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                                            <path d="M5 3v18l15-9L5 3z" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                                            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="h-2" />
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-12 text-center text-gray-500">
                        <DownloadCloud className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p className="text-lg">No active downloads</p>
                        <p className="text-sm mt-2 text-gray-600">Downloads will appear here when you start them</p>
                    </div>
                )}

                {/* Queue Section */}
                <div className="bg-black/20">
                    <div className="p-6 border-b border-white/5">
                        <h3 className="text-lg font-semibold text-white">Queue ({queuedJobs.length})</h3>
                    </div>
                    <div className="p-4">
                        {queuedJobs.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                <p className="text-sm">No items in queue</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {queuedJobs.map((job, index) => {
                                    const jobProgress = progressByJobId[job.id];
                                    const install = installs.find(i => i.id === job.installId);
                                    const name = jobProgress?.name ?? job.name ?? install?.name ?? job.installId;
                                    const isDragging = draggedJobId === job.id;
                                    const isDragOver = dragOverTarget === job.id;

                                    return (
                                        <div
                                            key={job.id}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, job.id)}
                                            onDragEnd={handleDragEnd}
                                            onDragOver={(e) => handleDragOver(e, job.id)}
                                            onDragLeave={handleDragLeave}
                                            onDrop={(e) => handleDropOnQueue(e, index)}
                                            className={`
                        flex items-center gap-4 p-3 rounded-lg border transition-all cursor-grab active:cursor-grabbing
                        ${isDragging ? 'opacity-50 scale-95' : 'opacity-100'}
                        ${isDragOver ? 'border-blue-500 bg-blue-900/20' : 'border-white/5 bg-white/5'}
                        hover:bg-white/10
                      `}
                                        >
                                            {/* Drag Handle */}
                                            <div className="flex-shrink-0 text-gray-500 hover:text-gray-300">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                                                </svg>
                                            </div>

                                            {/* Game Icon */}
                                            <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/10">
                                                {install?.game_icon ? (
                                                    <img src={install.game_icon} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-sm font-medium text-white truncate" title={name}>
                                                    {name}
                                                </h4>
                                                <p className="text-xs text-gray-400 mt-0.5">{formatKind(job.kind)} • {formatStatus(job.status, false)}</p>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex gap-1 flex-shrink-0">
                                                <button
                                                    onClick={() => handleActivateJob(job.id)}
                                                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                                                    title="Start downloading this now"
                                                >
                                                    Start Now
                                                </button>
                                                {index > 0 && (
                                                    <button
                                                        onClick={() => handleMoveUp(job.id)}
                                                        className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                                                        title="Move up"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                                        </svg>
                                                    </button>
                                                )}
                                                {index < queuedJobs.length - 1 && (
                                                    <button
                                                        onClick={() => handleMoveDown(job.id)}
                                                        className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                                                        title="Move down"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleRemove(job.id)}
                                                    className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                                                    title="Remove from queue"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Completed Section */}
                    {completedItems.length > 0 && (
                        <div className="p-6 border-t border-white/5">
                            <h3 className="text-lg font-semibold text-white mb-4">
                                Completed <span className="text-gray-400 font-normal ml-2">({completedItems.length})</span>
                            </h3>
                            <div className="flex flex-col gap-2">
                                {completedItems.map((job) => {
                                    const install = installs.find(i => i.id === job.installId);
                                    return (
                                        <div key={job.id} className="flex items-center gap-4 p-3 rounded-lg border border-white/5 bg-white/5">
                                            {/* Game Icon */}
                                            <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-white/10">
                                                {install?.game_icon ? (
                                                    <img src={install.game_icon} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-sm font-medium text-white truncate" title={job.name}>
                                                    {job.name}
                                                </h4>
                                            </div>
                                            <div className="text-xs text-green-400 font-medium flex items-center gap-1">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                                Completed
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
