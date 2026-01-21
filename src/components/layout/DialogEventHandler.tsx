import { useEffect, useState } from "react";
import { useDialog, DialogType } from "../../context/DialogContext";
import {
    registerDialogListener,
    DialogPayload,
} from "../../services/dialogEvents";

const DIALOG_TYPES: DialogType[] = ["info", "warning", "error", "confirm"];

/**
 * Component that registers the Tauri event listener for dialogs from Rust.
 * Must be mounted inside DialogProvider.
 */
export default function DialogEventHandler() {
    const { showDialog } = useDialog();
    const [testTypeIndex, setTestTypeIndex] = useState(0);

    useEffect(() => {
        let unlisten: (() => void) | undefined;

        const register = async () => {
            unlisten = await registerDialogListener((payload: DialogPayload) => {
                // Map Rust payload to React dialog options
                const buttons = payload.buttons?.map((label: string, index: number) => ({
                    label,
                    variant:
                        index === (payload.buttons?.length || 1) - 1
                            ? ("primary" as const)
                            : ("secondary" as const),
                })) || [{ label: "OK", variant: "primary" as const }];

                showDialog({
                    type: payload.dialog_type,
                    title: payload.title,
                    message: payload.message,
                    buttons,
                });
            });
        };

        register();

        return () => {
            if (unlisten) {
                unlisten();
            }
        };
    }, [showDialog]);

    // DEV: Ctrl+Shift+D to trigger test dialog
    useEffect(() => {
        const showTestDialog = (typeIndex: number) => {
            const type = DIALOG_TYPES[typeIndex];
            showDialog({
                type,
                title: `Test Dialog (${type})`,
                message: `This is a ${type.toUpperCase()} dialog.\n\nPress "Next Type" to see the next style, or Ctrl+Shift+D again.`,
                buttons: [
                    { label: "Close", variant: "secondary" },
                    {
                        label: "Next Type →",
                        variant: "primary",
                        preventClose: true,
                        onClick: () => {
                            const nextIndex = (typeIndex + 1) % DIALOG_TYPES.length;
                            setTestTypeIndex(nextIndex);
                            setTimeout(() => showTestDialog(nextIndex), 100);
                        }
                    }
                ],
            });
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === "D") {
                e.preventDefault();
                showTestDialog(testTypeIndex);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [showDialog, testTypeIndex]);

    return null;
}
