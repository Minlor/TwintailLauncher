import React from "react";
import { Check, ChevronDown, FolderOpen } from "lucide-react";
import { open } from '@tauri-apps/plugin-dialog';

// --- Card Components ---

export const SettingsSection = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div className="mb-10 animate-fadeIn">
        <h2 className="text-lg font-semibold text-white/90 mb-4 px-1">{title}</h2>
        <div className="flex flex-col gap-4">
            {children}
        </div>
    </div>
);

export const SettingsCard = ({ children, className = "", onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
    <div className={`bg-zinc-900/50 backdrop-blur-sm border border-white/5 rounded-xl p-5 hover:border-white/10 transition-colors ${className}`} onClick={onClick}>
        {children}
    </div>
);

// --- Form Components ---

interface SettingsControlProps {
    label: string;
    description?: string;
}

export const ModernToggle = ({ label, description, checked, onChange }: SettingsControlProps & { checked: boolean, onChange: (val: boolean) => void }) => {
    return (
        <SettingsCard className="flex flex-row items-center justify-between group cursor-pointer" onClick={() => onChange(!checked)}>
            <div className="flex flex-col gap-1 pr-4">
                <label className="text-base font-medium text-white group-hover:text-orange-100 transition-colors pointer-events-none">{label}</label>
                {description && <span className="text-sm text-zinc-400 pointer-events-none">{description}</span>}
            </div>

            <div
                onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
                className={`
                    w-12 h-7 rounded-full transition-all duration-300 relative flex items-center shadow-inner cursor-pointer
                    ${checked ? "bg-orange-600 shadow-[0_0_15px_rgba(234,88,12,0.4)]" : "bg-zinc-800"}
                `}
            >
                <div className={`
                    w-5 h-5 rounded-full bg-white shadow-md transform transition-all duration-300 absolute
                    ${checked ? "translate-x-6" : "translate-x-1"}
                `} />
            </div>
        </SettingsCard>
    );
};

export const ModernInput = ({ label, description, value, onChange, onBlur, ...props }: SettingsControlProps & React.InputHTMLAttributes<HTMLInputElement>) => {
    // Use local state to allow typing without immediate save
    const [localValue, setLocalValue] = React.useState(value?.toString() ?? "");

    // Sync local value when prop changes (e.g., after fetchSettings)
    React.useEffect(() => {
        setLocalValue(value?.toString() ?? "");
    }, [value]);

    const handleSave = () => {
        // Only trigger onChange (save) when user is done editing
        if (onChange && localValue !== value?.toString()) {
            // Create a synthetic event for compatibility
            const syntheticEvent = {
                target: { value: localValue }
            } as React.ChangeEvent<HTMLInputElement>;
            onChange(syntheticEvent);
        }
        onBlur?.(undefined as unknown as React.FocusEvent<HTMLInputElement>);
    };

    return (
        <SettingsCard>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-base font-medium text-white">{label}</label>
                    {description && <span className="text-sm text-zinc-400">{description}</span>}
                </div>
                <input
                    {...props}
                    value={localValue}
                    onChange={(e) => setLocalValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleSave();
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 transition-all font-mono text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
            </div>
        </SettingsCard>
    );
};

export const ModernPathInput = ({ label, description, value, onChange, folder = true, extensions }: SettingsControlProps & { value: string, onChange: (val: string) => void, folder?: boolean, extensions?: string[] }) => {
    // Use local state to allow typing without immediate save
    const [localValue, setLocalValue] = React.useState(value ?? "");

    // Sync local value when prop changes (e.g., after fetchSettings or folder picker)
    React.useEffect(() => {
        setLocalValue(value ?? "");
    }, [value]);

    const handleSave = () => {
        // Only trigger onChange (save) when user is done editing and value changed
        if (localValue !== value) {
            onChange(localValue);
        }
    };

    const handleBrowse = async () => {
        try {
            const selected = await open({
                directory: folder,
                multiple: false,
                filters: extensions ? [{ name: 'Allowed files', extensions }] : undefined
            });

            if (selected) {
                const newPath = Array.isArray(selected) ? selected[0] : selected;
                setLocalValue(newPath);
                onChange(newPath); // Folder picker saves immediately
            }
        } catch (e) {
            console.error("Failed to open dialog", e);
        }
    };

    return (
        <SettingsCard>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-base font-medium text-white">{label}</label>
                    {description && <span className="text-sm text-zinc-400">{description}</span>}
                </div>
                <div className="flex gap-2">
                    <input
                        value={localValue}
                        onChange={(e) => setLocalValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleSave();
                                (e.target as HTMLInputElement).blur();
                            }
                        }}
                        className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 transition-all font-mono text-sm truncate"
                    />
                    <button
                        onClick={handleBrowse}
                        className="bg-zinc-800 hover:bg-zinc-700 text-white p-2.5 rounded-lg border border-white/5 transition-colors"
                    >
                        <FolderOpen className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </SettingsCard>
    );
};

export const ModernSelect = ({ label, description, options, value, onChange }: SettingsControlProps & {
    value: string,
    onChange: (val: string) => void,
    options: { value: string, label: string }[]
}) => {
    return (
        <SettingsCard>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-base font-medium text-white">{label}</label>
                    {description && <span className="text-sm text-zinc-400">{description}</span>}
                </div>
                <div className="relative">
                    <select
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full appearance-none bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 transition-all cursor-pointer"
                    >
                        {options.map(opt => (
                            <option key={opt.value} value={opt.value} className="bg-zinc-900 text-white">
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                </div>
            </div>
        </SettingsCard>
    );
};
