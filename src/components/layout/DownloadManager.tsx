import { useEffect, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type {
  DownloadJobProgress,
  DownloadQueueStatePayload,
  QueueJobView,
} from '../../types/downloadQueue';
import { formatBytes, toPercent } from '../../utils/progress';

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

/* Props for DownloadManager */
interface DownloadManagerProps {
  isOpen: boolean;
  onClose: () => void;
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

/* Calculate ETA */
const calculateETA = (totalBytes: number, progressBytes: number, currentSpeed: number): string => {
  const remaining = Math.max(totalBytes - progressBytes, 0);
  if (!currentSpeed || remaining === 0) return '—';
  const seconds = Math.ceil(remaining / currentSpeed);
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
 * Download Manager - Steam-like modal displaying download progress, graph, and queue
 * Props-based version that receives state from App.tsx instead of polling
 */
export default function DownloadManager({
  isOpen,
  onClose,
  queue,
  progressByJobId,
  installs,
  speedHistory,
  onSpeedSample,
  onClearHistory,
  downloadSpeedLimitKiB,
}: DownloadManagerProps) {
  // Canvas ref for graph
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
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
  
  // Derive paused state - either queue is paused, job status is cancelled, OR we have a pausedJob
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
          // Check if this job was paused (we requested pause for it)
          if (pauseRequestedRef.current === id) {
            // This is a paused job, not completed
            // pausedJob should already be set by handlePause, just clear the ref
            pauseRequestedRef.current = null;
            return;
          }
          
          // Find the job info - it might still be in progressByJobId
          const progress = progressByJobId[id];
          removed.push({
            id,
            kind: 'game_download', // Default, we don't have this info after removal
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
    
    // If a new job started running (different from our paused job), clear the paused state
    // This handles the case where resume worked and a new/resumed job is now active
    if (runningJobs.length > 0 && pausedJob !== null && runningJobs[0].id !== pausedJob.job.id) {
      setPausedJob(null);
    }
    
    prevJobIdsRef.current = currentIds;
  }, [allJobs, progressByJobId, runningJobs.length, pausedJob]);

  // Reset graph history and peak speed when active job changes
  useEffect(() => {
    const currentJobId = currentJob?.id ?? null;
    if (previousJobIdRef.current !== null && currentJobId !== previousJobIdRef.current) {
      // Job changed - reset history and peak speed
      onClearHistory();
      setPeakSpeed(0);
      lastSampleRef.current = null;
      // Immediately push a zero sample so graph and peak are not broken
      onSpeedSample({ net: 0, disk: 0 });
      // Clear pausing state when job actually changes
      setIsPausing(false);
    }
    previousJobIdRef.current = currentJobId;
  }, [currentJob?.id, onClearHistory, onSpeedSample]);

  // Sample speed/disk for graph when we have a running job - throttled to once per second
  useEffect(() => {
    if (!currentJob || isPaused) return;
    if (currentSpeed <= 0 && currentDisk <= 0) return;
    
    const now = Date.now();
    const last = lastSampleRef.current;
    
    // Only sample if at least 900ms have passed since last sample
    if (last && now - last.time < 900) return;
    
    lastSampleRef.current = { net: currentSpeed, disk: currentDisk, time: now };
    onSpeedSample({ net: currentSpeed, disk: currentDisk });
    setPeakSpeed(prev => Math.max(prev, currentSpeed));
    // Always show at least the current sample as peak, even if 0
    if (currentSpeed > peakSpeed) setPeakSpeed(currentSpeed);
  }, [currentSpeed, currentDisk, currentJob, isPaused, onSpeedSample]);

  // Draw canvas graph - always uses 60 fixed slots for consistent appearance
  const GRAPH_SLOTS = 60;
  
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Pad history to 60 slots, right-aligned (new data on right)
    const paddedHistory: { net: number; disk: number }[] = [];
    const emptySlots = GRAPH_SLOTS - speedHistory.length;
    for (let i = 0; i < emptySlots; i++) {
      paddedHistory.push({ net: 0, disk: 0 });
    }
    paddedHistory.push(...speedHistory);
    
    // Find max values for normalization (use at least 1MB to avoid tiny fluctuations looking huge)
    const maxNet = Math.max(...paddedHistory.map(s => s.net), 1024 * 1024);
    const maxDisk = Math.max(...paddedHistory.map(s => s.disk), 1024 * 1024);
    const maxValue = Math.max(maxNet, maxDisk);
    
    ctx.clearRect(0, 0, width, height);
    
    // Fixed bar width based on 60 slots
    const barWidth = width / GRAPH_SLOTS;
    
    // Fade parameters
    const fadeLeftAlpha = 0.05;
    const fadeRightAlpha = 1.0;
    const fadeExponent = 1.6;

    // Draw network bars
    paddedHistory.forEach((sample, index) => {
      const x = barWidth * index;
      const barHeight = (sample.net / maxValue) * height;
      const y = height - barHeight;
      
      // Map hovered index from speedHistory to paddedHistory
      const actualIndex = index - emptySlots;
      const isHighlighted = hoveredIndex !== null && actualIndex === hoveredIndex;
      const t = index / (GRAPH_SLOTS - 1);
      const tAdjusted = Math.pow(t, fadeExponent);
      const alpha = isHighlighted ? 0.98 : (fadeLeftAlpha + tAdjusted * (fadeRightAlpha - fadeLeftAlpha));
      
      ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
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

    // Draw hover indicator on disk line
    if (hoveredIndex !== null && hoveredIndex < speedHistory.length) {
      // Convert speedHistory index to paddedHistory index
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
  }, [speedHistory, hoveredIndex]);

  // Mouse handlers for canvas - use fixed 60 slots
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    const scaleX = canvas.width / rect.width;
    const x = mouseX * scaleX;
    
    // Fixed bar width based on 60 slots
    const barWidth = canvas.width / GRAPH_SLOTS;
    const paddedIndex = Math.floor(x / barWidth);
    
    // Convert padded index to actual speedHistory index
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
      // Mark that we're pausing this job so we don't treat it as completed
      pauseRequestedRef.current = currentJob.id;
      // Save current job state before it disappears from queue
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
      // Clear paused and pausing state before emitting resume event
      setPausedJob(null);
      setIsPausing(false);
      
      // Emit the appropriate resume event based on job kind
      switch (job.kind) {
        case 'game_download':
          await emit('start_game_download', { install: installId, biz: '', lang: '', region: '' });
          break;
        case 'game_update':
          await emit('start_game_update', { install: installId, biz: '', lang: '', region: '' });
          break;
        case 'game_preload':
          await emit('start_game_preload', { install: installId, biz: '', lang: '', region: '' });
          break;
        case 'game_repair':
          await emit('start_game_repair', { install: installId, biz: '', lang: '', region: '' });
          break;
      }
    } catch (error) {
      console.error('Failed to resume download:', error);
      // Restore paused state on error
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

  // Activate a queued job (move to front and start downloading)
  const handleActivateJob = async (jobId: string) => {
    try {
      await invoke('queue_activate_job', { jobId });
    } catch (error) {
      console.error('Failed to activate job:', error);
    }
  };

  // Reorder a job to a specific position
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
      // Activate this job - move to front and start downloading
      await handleActivateJob(jobId);
    }
    setDraggedJobId(null);
    setDragOverTarget(null);
  };

  if (!isOpen) return null;

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
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
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
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
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

      <div 
        className="relative w-[95vw] h-[90vh] max-w-7xl bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 rounded-2xl shadow-2xl border border-gray-700/50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700/50 bg-gradient-to-r from-gray-800/50 to-gray-900/50">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600/20 rounded-xl border border-blue-500/30">
              <svg className="w-7 h-7 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Download Manager</h2>
              {currentJob && (
                <p className="text-gray-400 text-sm mt-1">
                  {formatSpeed(currentSpeed)} • {allJobs.length} item{allJobs.length !== 1 ? 's' : ''} in queue
                </p>
              )}
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700/50 rounded-lg transition-colors group"
          >
            <svg className="w-6 h-6 text-gray-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="h-[calc(100%-5rem)] overflow-y-auto">
          {/* Current Download Section */}
          {currentJob ? (
            <div 
              className={`flex flex-col transition-all ${
                draggedJobId && dragOverTarget === 'active' 
                  ? 'ring-2 ring-blue-500 ring-inset bg-blue-900/10' 
                  : ''
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOverTarget('active'); }}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={handleDropOnActive}
            >
              {/* Graph and Progress Area */}
              <div className="border-b border-gray-700/50">
                <div className="flex gap-6 relative items-end pl-72">
                  {/* Banner Background */}
                  <div className="absolute left-0 top-0 bottom-0 w-1/2 overflow-hidden pointer-events-none z-0">
                    {bannerImage ? (
                      <img
                        src={bannerImage}
                        alt=""
                        className="w-full h-full object-cover opacity-30"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-800/50" />
                    )}
                    <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-l from-gray-900/90 to-transparent pointer-events-none" />
                    
                    {/* Title overlay */}
                    <div className="absolute left-6 top-6 z-10 text-left pointer-events-none">
                      <h3 className="text-2xl font-semibold text-white mb-1 truncate max-w-xs">
                        {currentProgress?.name ?? currentJob.name}
                      </h3>
                      <p className="text-sm text-gray-300">{formatKind(currentJob.kind)}</p>
                    </div>
                  </div>

                  {/* Graph */}
                  <div className="flex-1 relative z-10">
                    <div className="overflow-hidden">
                      <canvas 
                        ref={canvasRef}
                        width={600}
                        height={120}
                        className="w-full cursor-pointer"
                        onMouseMove={handleCanvasMouseMove}
                        onMouseLeave={handleCanvasMouseLeave}
                      />
                    </div>
                  </div>

                  {/* Stats Panel */}
                  <div className="w-80 flex flex-col justify-between z-10 px-2">
                    <div className="space-y-6">
                      {/* Stats Row */}
                      <div className="mt-3">
                        <div className="flex items-start gap-6">
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

                        {/* Speed limit - styled like stats labels, tight spacing */}
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

                        <div className="w-full bg-gray-700/50 rounded-full h-2 mb-2 overflow-hidden">
                          <div 
                            className={`h-2 rounded-full transition-all duration-500 ${
                              isPaused ? 'bg-gray-500' : 'bg-blue-500'
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
                                  {calculateETA(totalBytes, progressBytes, currentSpeed)}
                                </span>
                              </div>
                            ) : null}
                          </div>
                          <button
                            onClick={isPaused ? handleResume : handlePause}
                            disabled={isPausing && !isPaused}
                            className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors shadow-sm ${
                              isPausing && !isPaused
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
            <div className="p-6 text-center text-gray-500">
              <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
              <p className="text-lg">No active downloads</p>
            </div>
          )}

          {/* Queue Section */}
          <div className="bg-gray-900/30">
            <div className="p-6 border-b border-gray-700/50">
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
                          ${isDragOver ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700/50 bg-gray-800/70'}
                          hover:bg-gray-800/90
                        `}
                      >
                        {/* Drag Handle */}
                        <div className="flex-shrink-0 text-gray-500 hover:text-gray-300">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                          </svg>
                        </div>

                        {/* Game Icon */}
                        <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-700">
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
                          {/* Start Now button */}
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
                              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
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
                              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
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
              <div className="p-6 border-t border-gray-700/50">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Completed <span className="text-gray-400 font-normal ml-2">({completedItems.length})</span>
                </h3>
                <div className="flex flex-col gap-2">
                  {completedItems.map((job) => {
                    const install = installs.find(i => i.id === job.installId);
                    return (
                      <div key={job.id} className="flex items-center gap-4 p-3 rounded-lg border border-gray-700/40 bg-gray-800/60">
                        {/* Game Icon */}
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-gray-700">
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
    </div>
  );
}
