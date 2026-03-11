export interface RuntimeEvent<T> {
  payload: T;
}

export type RuntimeUnlistenFn = () => void;

export interface RuntimeDialogFilter {
  name: string;
  extensions: string[];
}

export interface RuntimeDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  defaultPath?: string;
  filters?: RuntimeDialogFilter[];
}

export interface RendererRuntime {
  invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
  listen<T>(eventName: string, handler: (event: RuntimeEvent<T>) => void): Promise<RuntimeUnlistenFn>;
  emit(eventName: string, payload?: unknown): Promise<void>;
  openDialog(options: RuntimeDialogOptions): Promise<string | string[] | null>;
  getVersion(): Promise<string>;
}

declare global {
  interface Window {
    __TTL_RUNTIME__?: RendererRuntime;
  }
}

function getRuntime(): RendererRuntime {
  if (!window.__TTL_RUNTIME__) {
    throw new Error("TwintailLauncher Electron runtime bridge is not available.");
  }
  return window.__TTL_RUNTIME__;
}

export async function invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  return getRuntime().invoke<T>(command, payload);
}

export async function listen<T>(eventName: string, handler: (event: RuntimeEvent<T>) => void): Promise<RuntimeUnlistenFn> {
  return getRuntime().listen<T>(eventName, handler);
}

export async function emit(eventName: string, payload?: unknown): Promise<void> {
  return getRuntime().emit(eventName, payload);
}

export async function openDialog(options: RuntimeDialogOptions): Promise<string | string[] | null> {
  return getRuntime().openDialog(options);
}

export async function getVersion(): Promise<string> {
  return getRuntime().getVersion();
}
