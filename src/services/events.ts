import { toPercent, formatBytes } from '../utils/progress.ts';

export type EventStateUpdate = Record<string, any> | ((prev: any) => Record<string, any>);

export function registerEvents(
  eventType: string,
  event: any,
  pushInstalls: () => void,
  getCurrentInstall: () => string,
  fetchInstallResumeStates: (install: string) => void,
  fetchInstalledRunners?: () => void,
  fetchSteamRTStatus?: () => void
): EventStateUpdate | undefined {
  switch (eventType) {
    case 'download_queue_state': {
      // Note: disableRun and disableInstallEdit are now calculated per-install in the UI
      return {
        downloadQueueState: event.payload,
        // keep legacy fields hidden (UI is replaced)
        hideProgressBar: true,
        // disableInstallEdit is now calculated per-install in the UI (allows editing settings for non-downloading games)
        // disableRun is now calculated per-install in the UI (allows playing installed games while others download)
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

      // Refresh runner status after downloads complete (runner/steamrt downloads)
      // This ensures the Play button becomes enabled when dependencies are ready
      if (fetchInstalledRunners) fetchInstalledRunners();
      if (fetchSteamRTStatus) fetchSteamRTStatus();

      // Misc downloads (proton, steamrt, etc.) use name as job ID
      // Remove from progress tracking when complete
      const completedName = typeof event.payload === 'string' ? event.payload : event.payload?.name;
      if (completedName) {
        return (prev) => {
          const next = { ...(prev?.downloadProgressByJobId || {}) };
          delete next[completedName];
          return { downloadProgressByJobId: next };
        };
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
      // Use job_id if present, otherwise use name as fallback for misc downloads (proton, steamrt, etc.)
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId ?? event?.payload?.name;
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
      // Use job_id if present, otherwise use name as fallback for misc updates (steamrt, etc.)
      const jobId = event?.payload?.job_id ?? event?.payload?.jobId ?? event?.payload?.name;
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
