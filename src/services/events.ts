import { toPercent, formatBytes } from '../utils/progress.ts';

export type EventStateUpdate = Record<string, any> | ((prev: any) => Record<string, any>);

export function registerEvents(
  eventType: string,
  event: any,
  pushInstalls: () => void,
  getCurrentInstall: () => string,
  fetchInstallResumeStates: (install: string) => void
): EventStateUpdate | undefined {
  switch (eventType) {
    case 'download_queue_state': {
      const running = (event?.payload?.running || []) as any[];
      const queued = (event?.payload?.queued || []) as any[];
      const hasWork = running.length > 0 || queued.length > 0;
      return {
        downloadQueueState: event.payload,
        // keep legacy fields hidden (UI is replaced)
        hideProgressBar: true,
        disableInstallEdit: hasWork,
        disableRun: hasWork,
        // Allow queueing new downloads/updates even while work is in progress
        // The queue system handles multiple jobs
        disableUpdate: false,
        disableDownload: false,
        disablePreload: false,
        disableResume: false,
      };
    }
    case 'move_complete':
    case 'download_complete':
    case 'update_complete':
    case 'repair_complete':
    case 'preload_complete': {
      pushInstalls();

      // Refresh resume states for the current install after completion
      const currentInstall = getCurrentInstall();
      if (currentInstall) {
        fetchInstallResumeStates(currentInstall);
      }
      return undefined;
    }
    case 'move_progress': {
      return {
        hideProgressBar: false,
        disableInstallEdit: true,
        disableRun: true,
        disableUpdate: true,
        disableDownload: true,
        disablePreload: true,
        disableResume: true,
        progressName: `Moving "${event.payload.file}"`,
        progressVal: Math.round(toPercent(event.payload.progress, event.payload.total)),
        progressPercent: `${toPercent(event.payload.progress, event.payload.total).toFixed(2)}%`,
        progressSpeed: "",
        progressPretty: `${formatBytes(event.payload.progress)}`,
        progressPrettyTotal: `${formatBytes(event.payload.total)}`,
      };
    }
    case 'download_progress': {
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId;
      if (!jobId) return undefined;
      return (prev) => {
        const next = { ...(prev?.downloadProgressByJobId || {}) };
        next[jobId] = {
          jobId,
          name: event.payload.name,
          progress: parseInt(event.payload.progress),
          total: parseInt(event.payload.total),
          speed: event.payload.speed ? parseInt(event.payload.speed) : undefined,
          disk: event.payload.disk ? parseInt(event.payload.disk) : undefined,
          eventType,
        };
        return { downloadProgressByJobId: next };
      };
    }
    case 'download_installing': {
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId;
      if (!jobId) return undefined;
      return (prev) => {
        const next = { ...(prev?.downloadProgressByJobId || {}) };
        const existing = next[jobId] || {};
        next[jobId] = {
          ...existing,
          jobId,
          name: event.payload.name || existing.name,
          // Keep existing download progress, add installation progress
          installProgress: event.payload.progress !== undefined ? parseInt(event.payload.progress) : existing.installProgress,
          installTotal: event.payload.total !== undefined ? parseInt(event.payload.total) : existing.installTotal,
          eventType,
        };
        return { downloadProgressByJobId: next };
      };
    }
    case 'download_paused': {
      const currentInstall = getCurrentInstall();
      if (currentInstall) {
        fetchInstallResumeStates(currentInstall);
      }
      return undefined;
    }
    case 'update_progress': {
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId;
      if (!jobId) return undefined;
      return (prev) => {
        const next = { ...(prev?.downloadProgressByJobId || {}) };
        next[jobId] = {
          jobId,
          name: event.payload.name,
          progress: parseInt(event.payload.progress),
          total: parseInt(event.payload.total),
          speed: event.payload.speed ? parseInt(event.payload.speed) : undefined,
          disk: event.payload.disk ? parseInt(event.payload.disk) : undefined,
          eventType,
        };
        return { downloadProgressByJobId: next };
      };
    }
    case 'update_installing': {
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId;
      if (!jobId) return undefined;
      return (prev) => {
        const next = { ...(prev?.downloadProgressByJobId || {}) };
        const existing = next[jobId] || {};
        next[jobId] = {
          ...existing,
          jobId,
          name: event.payload.name || existing.name,
          // Keep existing download progress, add installation progress
          installProgress: event.payload.progress !== undefined ? parseInt(event.payload.progress) : existing.installProgress,
          installTotal: event.payload.total !== undefined ? parseInt(event.payload.total) : existing.installTotal,
          eventType,
        };
        return { downloadProgressByJobId: next };
      };
    }
    case 'repair_progress': {
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId;
      if (!jobId) return undefined;
      return (prev) => {
        const next = { ...(prev?.downloadProgressByJobId || {}) };
        next[jobId] = {
          jobId,
          name: event.payload.name,
          progress: parseInt(event.payload.progress),
          total: parseInt(event.payload.total),
          speed: event.payload.speed ? parseInt(event.payload.speed) : undefined,
          disk: event.payload.disk ? parseInt(event.payload.disk) : undefined,
          eventType,
        };
        return { downloadProgressByJobId: next };
      };
    }
    case 'repair_installing': {
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId;
      if (!jobId) return undefined;
      return (prev) => {
        const next = { ...(prev?.downloadProgressByJobId || {}) };
        const existing = next[jobId] || {};
        next[jobId] = {
          ...existing,
          jobId,
          name: event.payload.name || existing.name,
          // Keep existing download progress, add installation progress
          installProgress: event.payload.progress !== undefined ? parseInt(event.payload.progress) : existing.installProgress,
          installTotal: event.payload.total !== undefined ? parseInt(event.payload.total) : existing.installTotal,
          eventType,
        };
        return { downloadProgressByJobId: next };
      };
    }
    case 'preload_progress': {
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId;
      if (!jobId) return undefined;
      return (prev) => {
        const next = { ...(prev?.downloadProgressByJobId || {}) };
        next[jobId] = {
          jobId,
          name: event.payload.name,
          progress: parseInt(event.payload.progress),
          total: parseInt(event.payload.total),
          speed: event.payload.speed ? parseInt(event.payload.speed) : undefined,
          disk: event.payload.disk ? parseInt(event.payload.disk) : undefined,
          eventType,
        };
        return { downloadProgressByJobId: next };
      };
    }
    case 'preload_installing': {
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId;
      if (!jobId) return undefined;
      return (prev) => {
        const next = { ...(prev?.downloadProgressByJobId || {}) };
        next[jobId] = {
          jobId,
          name: event.payload.name,
          progress: event.payload.progress !== undefined ? parseInt(event.payload.progress) : undefined,
          total: event.payload.total !== undefined ? parseInt(event.payload.total) : undefined,
          speed: event.payload.speed ? parseInt(event.payload.speed) : undefined,
          disk: event.payload.disk ? parseInt(event.payload.disk) : undefined,
          eventType,
        };
        return { downloadProgressByJobId: next };
      };
    }
  }
}
