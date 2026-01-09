export type QueueJobKind = 'game_download' | 'game_update' | 'game_preload' | 'game_repair';

export type QueueJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface QueueJobView {
  id: string;
  kind: QueueJobKind;
  installId: string;
  name: string;
  status: QueueJobStatus;
}

export interface DownloadQueueStatePayload {
  maxConcurrent: number;
  running: QueueJobView[];
  queued: QueueJobView[];
}

export interface DownloadJobProgress {
  jobId: string;
  name?: string;
  progress?: number;
  total?: number;
  speed?: number;
  disk?: number;
  eventType: string;
}
