import { useState, useEffect } from 'react';
import { invoke } from "@tauri-apps/api/core";
import HelpTooltip from "./HelpTooltip.tsx";

interface NumberInputProps {
    id: string;
    name: string;
    value: number;
    placeholder?: string;
    min?: number;
    max?: number;
    suffix?: string;
    helpText: string;
    fetchSettings?: () => void;
}

export default function NumberInput({ id, name, value, placeholder, min, max, suffix, helpText, fetchSettings }: NumberInputProps) {
    const [localValue, setLocalValue] = useState(value.toString());

    useEffect(() => {
        setLocalValue(value.toString());
    }, [value]);

    const handleSave = () => {
        const numValue = parseInt(localValue) || 0;
        const clampedValue = Math.max(min ?? 0, Math.min(max ?? Infinity, numValue));

        switch (id) {
            case "download_speed_limit":
                invoke("update_settings_download_speed_limit_cmd", { speedLimit: clampedValue }).then(() => {
                    fetchSettings?.();
                });
                break;
        }
    };

    return (
        <div className="flex w-full items-center gap-4 max-sm:flex-col max-sm:items-stretch">
            <span className="text-white text-sm flex items-center gap-1 w-56 shrink-0 max-sm:w-full">
                {name}
                <HelpTooltip text={helpText}/>
            </span>
            <div className="inline-flex flex-row items-center justify-end ml-auto w-[320px]">
                <div className="relative w-full">
                    <input
                        type="number"
                        min={min}
                        max={max}
                        className="text-ellipsis w-full focus:outline-none h-10 rounded-xl bg-zinc-800/60 border border-white/30 text-white px-3 placeholder-white/50 focus:border-white/40 transition-colors pr-16"
                        value={localValue}
                        placeholder={placeholder}
                        onChange={(e) => setLocalValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    />
                    {suffix && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">
                            {suffix}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
