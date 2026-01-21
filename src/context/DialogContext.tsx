import React, { createContext, useContext, useState, useCallback } from "react";

export type DialogType = "error" | "warning" | "info" | "confirm";

export interface DialogButton {
    label: string;
    variant?: "primary" | "secondary" | "danger";
    onClick?: () => void;
    preventClose?: boolean;
}

export interface DialogOptions {
    type: DialogType;
    title: string;
    message: string;
    buttons?: DialogButton[];
    onClose?: (buttonIndex: number) => void;
}

interface DialogState extends DialogOptions {
    isOpen: boolean;
}

interface DialogContextType {
    dialog: DialogState | null;
    showDialog: (options: DialogOptions) => void;
    closeDialog: (buttonIndex?: number) => void;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export function DialogProvider({ children }: { children: React.ReactNode }) {
    const [dialog, setDialog] = useState<DialogState | null>(null);

    const showDialog = useCallback((options: DialogOptions) => {
        // Default buttons based on type if not provided
        const defaultButtons: DialogButton[] =
            options.type === "confirm"
                ? [
                    { label: "Cancel", variant: "secondary" },
                    { label: "OK", variant: "primary" },
                ]
                : [{ label: "OK", variant: "primary" }];

        setDialog({
            ...options,
            buttons: options.buttons || defaultButtons,
            isOpen: true,
        });
    }, []);

    const closeDialog = useCallback((buttonIndex: number = 0) => {
        setDialog((prev) => {
            if (prev?.onClose) {
                prev.onClose(buttonIndex);
            }
            return null;
        });
    }, []);

    return (
        <DialogContext.Provider value={{ dialog, showDialog, closeDialog }}>
            {children}
        </DialogContext.Provider>
    );
}

export function useDialog() {
    const context = useContext(DialogContext);
    if (context === undefined) {
        throw new Error("useDialog must be used within a DialogProvider");
    }
    return context;
}
