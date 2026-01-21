import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface DialogPayload {
    dialog_type: "error" | "warning" | "info" | "confirm";
    title: string;
    message: string;
    buttons?: string[];
}

export type ShowDialogFn = (payload: DialogPayload) => void;

/**
 * Registers a listener for the 'show_dialog' event emitted from Rust.
 * Returns an unlisten function to clean up the listener.
 */
export async function registerDialogListener(
    showDialog: ShowDialogFn
): Promise<UnlistenFn> {
    return await listen<DialogPayload>("show_dialog", (event) => {
        showDialog(event.payload);
    });
}
