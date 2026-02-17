import { useState, useMemo } from "react";
import { POPUPS } from "../POPUPS.ts";
import { PAGES } from "../../pages/PAGES.ts";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {Folder, Play, Wrench, Trash2, Sliders, Box, Monitor, Copy, FileCode2, LayoutDashboard} from "lucide-react";
import { SettingsLayout } from "../../layout/SettingsLayout.tsx";
import { SettingsSidebar, SettingsTab } from "../../sidebar/SettingsSidebar.tsx";
import { SettingsSection, ModernToggle, ModernInput, ModernPathInput, ModernSelect, SettingsCard } from "../../common/SettingsComponents.tsx";


// Helper for Steam Icon
const SteamIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M18.102 12.129c0-0 0-0 0-0.001 0-1.564 1.268-2.831 2.831-2.831s2.831 1.268 2.831 2.831c0 1.564-1.267 2.831-2.831 2.831-0 0-0 0-0.001 0h0c-0 0-0 0-0.001 0-1.563 0-2.83-1.267-2.83-2.83 0-0 0-0 0-0.001v0zM24.691 12.135c0-2.081-1.687-3.768-3.768-3.768s-3.768 1.687-3.768 3.768c0 2.081 1.687 3.768 3.768 3.768v0c2.080-0.003 3.765-1.688 3.768-3.767v-0zM10.427 23.76l-1.841-0.762c0.524 1.078 1.611 1.808 2.868 1.808 1.317 0 2.448-0.801 2.93-1.943l0.008-0.021c0.155-0.362 0.246-0.784 0.246-1.226 0-1.757-1.424-3.181-3.181-3.181-0.405 0-0.792 0.076-1.148 0.213l0.022-0.007 1.903 0.787c0.852 0.364 1.439 1.196 1.439 2.164 0 1.296-1.051 2.347-2.347 2.347-0.324 0-0.632-0.066-0.913-0.184l0.015 0.006zM15.974 1.004c-7.857 0.001-14.301 6.046-14.938 13.738l-0.004 0.054 8.038 3.322c0.668-0.462 1.495-0.737 2.387-0.737 0.001 0 0.002 0 0.002 0h-0c0.079 0 0.156 0.005 0.235 0.008l3.575-5.176v-0.074c0.003-3.12 2.533-5.648 5.653-5.648 3.122 0 5.653 2.531 5.653 5.653s-2.531 5.653-5.653 5.653h-0.131l-5.094 3.638c0 0.065 0.005 0.131 0.005 0.199 0 0.001 0 0.002 0 0.003 0 2.342-1.899 4.241-4.241 4.241-2.047 0-3.756-1.451-4.153-3.38l-0.005-0.027-5.755-2.383c1.841 6.345 7.601 10.905 14.425 10.905 8.281 0 14.994-6.713 14.994-14.994s-6.713-14.994-14.994-14.994c-0 0-0.001 0-0.001 0h0z" />
    </svg>
);

interface GameSettingsProps {
    setOpenPopup: (popup: POPUPS) => void;
    setCurrentPage: (page: PAGES) => void;
    installSettings: any;
    gameManifest: any;
    fetchInstallSettings: (id: string) => void;
    prefetchedSwitches: any;
    prefetchedFps: any;
    installedRunners: any[];
    installs?: any[];
    gamesinfo?: any[]; // Game manifests to look up static backgrounds
    imageVersion?: number; // Used to force image re-load after network recovery
}

export default function GameSettings({
    setOpenPopup,
    setCurrentPage,
    installSettings,
    gameManifest,
    fetchInstallSettings,
    prefetchedSwitches,
    prefetchedFps: _prefetchedFps,
    installedRunners,
    installs,
    gamesinfo,
    imageVersion = 0
}: GameSettingsProps) {
    const [activeTab, setActiveTab] = useState("general");
    const [authkeyCopied, setAuthkeyCopied] = useState(false);

    const tabs: SettingsTab[] = [
        { id: "general", label: "General", icon: Sliders, color: "blue" },
        { id: "launch", label: "Launch Options", icon: Play, color: "emerald" },
        ...(window.navigator.platform.includes("Linux") ? [{ id: "linux", label: "Linux Options", icon: Monitor, color: "orange" }] : []),
        { id: "manage", label: "Manage", icon: Box, color: "red" },
    ];

    // Generic update wrapper that matches backend command conventions
    // Backend commands use: update_install_{key}(app, id: String, {param}: {type})
    // Parameter names vary by command type - see install.rs for exact signatures
    const handleUpdate = async (key: string, value: any) => {
        try {
            const installId = installSettings.id;
            const command = `update_install_${key}`;

            // Build payload based on command type - backend uses 'id' not 'installId'
            let payload: Record<string, any> = { id: installId };

            if (typeof value === "boolean") {
                // Boolean commands use { id, enabled }
                payload.enabled = value;
            } else if (key.includes("path")) {
                // Path commands use { id, path }
                payload.path = value;
            } else if (key === "launch_args") {
                // update_install_launch_args uses { id, args }
                payload.args = value;
            } else if (key === "env_vars") {
                // update_install_env_vars uses { id, env_vars }
                payload.envVars = value;
            } else if (key === "pre_launch_cmd" || key === "launch_cmd") {
                // update_install_pre_launch_cmd and update_install_launch_cmd use { id, cmd }
                payload.cmd = value;
            } else if (key === "runner_version" || key === "dxvk_version") {
                // update_install_runner_version and update_install_dxvk_version use { id, version }
                payload.version = value;
            } else if (key === "fps_value") {
                // update_install_fps_value uses { id, fps }
                payload.fps = value;
            }

            await invoke(command, payload);

            // Use requestAnimationFrame to prevent flickering on Linux
            requestAnimationFrame(() => {
                fetchInstallSettings(installId);
            });
        } catch (e) {
            console.error(`Failed to update game setting ${key}:`, e);
        }
    }

    // Find images - always use static backgrounds for settings popup
    // Memoize to prevent unnecessary re-renders on Linux
    const banner = useMemo(() => {
        const installInfo = (installs || []).find((i: any) => i.id === installSettings.id);
        const gameInfo = (gamesinfo || []).find((g: any) => g.biz === installSettings.manifest_id);
        return gameInfo?.background || installInfo?.game_background || installSettings.game_background;
    }, [installs, gamesinfo, installSettings.id, installSettings.manifest_id, installSettings.game_background]);

    const icon = useMemo(() => {
        const installInfo = (installs || []).find((i: any) => i.id === installSettings.id);
        return installInfo?.game_icon || installSettings.game_icon;
    }, [installs, installSettings.id, installSettings.game_icon]);

    const gameBiz = gameManifest?.biz || "";

    return (
        <SettingsLayout
            title={installSettings.name || "Game Settings"}
            onClose={() => setOpenPopup(POPUPS.NONE)}
            banner={banner}
            icon={icon}
            imageVersion={imageVersion}
        >
            <div className="flex h-full">
                <SettingsSidebar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

                <div className="flex-1 overflow-y-auto p-8 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                    {activeTab === "general" && (
                        <SettingsSection title="General Configuration">
                            <ModernPathInput
                                label="Install Location"
                                description="Directory where the game is installed."
                                value={`${installSettings.directory}`}
                                onChange={(val) => handleUpdate("game_path", val)}
                            />
                            <div className="grid grid-cols-1 gap-4 mt-4">
                                <ModernToggle
                                    label="Skip Version Checks"
                                    description="Don't check for game updates."
                                    checked={installSettings.ignore_updates}
                                    onChange={(val) => handleUpdate("skip_version_updates", val)}
                                />
                                <ModernToggle
                                    label="Skip Hash Validation"
                                    description="Skip file verification during repairs (faster but less safe)."
                                    checked={installSettings.skip_hash_check}
                                    onChange={(val) => handleUpdate("skip_hash_valid", val)}
                                />
                                <ModernToggle
                                    label="Enable DiscordRPC"
                                    description="Show Discord rich presence activity while you are playing the game."
                                    checked={installSettings.show_discord_rpc}
                                    onChange={(val) => handleUpdate("show_drpc", val)}
                                />
                                {prefetchedSwitches.xxmi && (
                                    <SettingsCard className="flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-white">XXMI Settings</span>
                                            <span className="text-sm text-zinc-400">Configure mods and plugins.</span>
                                        </div>
                                        <button
                                            onClick={() => setOpenPopup(POPUPS.XXMISETTINGS)}
                                            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors border border-white/5">
                                            Configure
                                        </button>
                                    </SettingsCard>
                                )}
                                {prefetchedSwitches.fps_unlocker && (
                                    <SettingsCard className="flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-white">FPS Unlocker</span>
                                            <span className="text-sm text-zinc-400">Unlock frame rate limits.</span>
                                        </div>
                                        <button
                                            onClick={() => setOpenPopup(POPUPS.FPSUNLOCKERSETTINGS)}
                                            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors border border-white/5">
                                            Configure
                                        </button>
                                    </SettingsCard>
                                )}
                            </div>
                        </SettingsSection>
                    )}

                    {activeTab === "launch" && (
                        <SettingsSection title="Launch Configuration">
                            <div className="flex flex-col gap-4">
                                <ModernToggle
                                    label="Prevent idle"
                                    description="Prevents system from going to idle/screenlock state while playing the game."
                                    checked={installSettings.disable_system_idle}
                                    onChange={(val) => handleUpdate("disable_system_idle", val)}
                                />
                                <ModernInput
                                    label="Launch Arguments"
                                    description="Additional arguments passed to the game executable."
                                    value={installSettings.launch_args || ""}
                                    onChange={(e) => handleUpdate("launch_args", e.target.value)}
                                    placeholder="-dx11 -console"
                                />
                                <ModernInput
                                    label="Environment Variables"
                                    description="Environment variables set for the game process."
                                    value={installSettings.env_vars || ""}
                                    onChange={(e) => handleUpdate("env_vars", e.target.value)}
                                    placeholder='DXVK_HUD=fps,devinfo;PROTON_LOG=1;SOMETHING="/path/to/thing";'
                                />
                                <ModernInput
                                    label="Pre-Launch Command"
                                    description="Command executed before the game starts."
                                    value={installSettings.pre_launch_command || ""}
                                    onChange={(e) => handleUpdate("pre_launch_cmd", e.target.value)}
                                    helpText={`Command that will be ran before game launches. You can use quotes around paths if needed.\nAvailable variables:\n- %steamrt% = SteamLinuxRuntime binary (Usage: %steamrt% --verb=waitforexitandrun -- %reaper%)\n- %reaper% = Process reaper binary (Usage: %reaper% SteamLaunch AppId=0 -- %runner%)\n- %runner% = Call proton binary\n- %game_exe% = Points to game executable\n- %runner_dir% = Path of current runner (not a binary you can append any binary from this folder)\n- %prefix% = Path to root of runner prefix location field\n- %install_dir% = Path to game install location field\n- %steamrt_path% = Path to SteamLinuxRuntime folder (you can append other binaries from the folder)`}
                                />
                                <ModernInput
                                    label="Custom Launch Command"
                                    description="Override the default launch command."
                                    value={installSettings.launch_command || ""}
                                    onChange={(e) => handleUpdate("launch_cmd", e.target.value)}
                                    helpText={`Custom command to launch the game. You can use quotes around paths if needed.\nAvailable variables:\n- %steamrt% = SteamLinuxRuntime binary (Usage: %steamrt% --verb=waitforexitandrun -- %reaper%)\n- %reaper% = Process reaper binary (Usage: %reaper% SteamLaunch AppId=0 -- %runner%)\n- %runner% = Call proton binary\n- %game_exe% = Points to game executable\n- %runner_dir% = Path of current runner (not a binary you can append any binary from this folder)\n- %prefix% = Path to root of runner prefix location field\n- %install_dir% = Path to game install location field\n- %steamrt_path% = Path to SteamLinuxRuntime folder (you can append other binaries from the folder)`}
                                />
                            </div>
                        </SettingsSection>
                    )}

                    {activeTab === "linux" && (
                        <SettingsSection title="Linux Configuration">
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-2">
                                    <ModernSelect
                                        label="Runner Version"
                                        description="Select the Wine/Proton version to use."
                                        value={installSettings.runner_version || ""}
                                        options={installedRunners}
                                        onChange={(val) => handleUpdate("runner_version", val)}
                                    />
                                    <button
                                        onClick={() => {
                                            setOpenPopup(POPUPS.NONE);
                                            setCurrentPage(PAGES.RUNNERS);
                                        }}
                                        className="text-purple-400 hover:text-purple-300 text-sm font-medium transition-colors text-left px-1 underline-offset-2 hover:underline">
                                        → Manage Runners
                                    </button>
                                </div>
                                <ModernPathInput
                                    label="Runner Location"
                                    description="Path to Wine/Proton folder."
                                    value={`${installSettings.runner_path}`}
                                    onChange={(val) => handleUpdate("runner_path", val)}
                                />
                                <ModernPathInput
                                    label="Prefix Location"
                                    description="Path to the Wine/Proton prefix."
                                    value={`${installSettings.runner_prefix}`}
                                    onChange={(val) => handleUpdate("prefix_path", val)}
                                />
                                {prefetchedSwitches.jadeite && (
                                    <ModernToggle
                                        label="Use Jadeite"
                                        description="Enable Jadeite patch."
                                        checked={installSettings.use_jadeite}
                                        onChange={(val) => handleUpdate("use_jadeite", val)}
                                    />
                                )}
                                <ModernToggle
                                    label="Feral Gamemode"
                                    description="Enable Feral Interactive's GameMode."
                                    checked={installSettings.use_gamemode}
                                    onChange={(val) => handleUpdate("use_gamemode", val)}
                                />
                                <SettingsCard className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <span className="font-medium text-white">MangoHUD</span>
                                        <span className="text-sm text-zinc-400">Configure HUD overlay settings.</span>
                                    </div>
                                    <button
                                        onClick={() => setOpenPopup(POPUPS.MANGOHUDSETTINGS)}
                                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors border border-white/5">
                                        Configure
                                    </button>
                                </SettingsCard>
                            </div>
                        </SettingsSection>
                    )}

                    {activeTab === "manage" && (
                        <>
                            <SettingsSection title="Manage Installation">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <button
                                        onClick={() => {
                                            setOpenPopup(POPUPS.NONE);
                                            invoke("open_folder", {
                                                runnerVersion: "",
                                                manifestId: installSettings.manifest_id,
                                                installId: installSettings.id,
                                                pathType: "install"
                                            });
                                        }}
                                        className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                        <Folder className="w-6 h-6 text-purple-400" />
                                        <div className="flex flex-col">
                                            <span className="font-bold">Open Game Folder</span>
                                            <span className="text-xs text-zinc-400">View game files</span>
                                        </div>
                                    </button>

                                    {installSettings.use_xxmi && (
                                        <button
                                            onClick={() => {
                                                setOpenPopup(POPUPS.NONE);
                                                invoke("open_folder", {
                                                    runnerVersion: "",
                                                    manifestId: installSettings.manifest_id,
                                                    installId: installSettings.id,
                                                    pathType: "mods"
                                                });
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <Folder className="w-6 h-6 text-pink-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Open Mods Folder</span>
                                                <span className="text-xs text-zinc-400">View XXMI mods</span>
                                            </div>
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            setOpenPopup(POPUPS.NONE);
                                            emit("start_game_repair", {
                                                install: installSettings.id,
                                                biz: installSettings.manifest_id,
                                                lang: "en-us",
                                                region: installSettings.region_code
                                            });
                                        }}
                                        className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                        <Wrench className="w-6 h-6 text-orange-400" />
                                        <div className="flex flex-col">
                                            <span className="font-bold">Repair Game</span>
                                            <span className="text-xs text-zinc-400">Verify and fix game</span>
                                        </div>
                                    </button>

                                    {installSettings.shortcut_is_steam ? (
                                        <button
                                            onClick={() => {
                                                invoke("remove_shortcut", { installId: installSettings.id, shortcutType: "steam" }).then(() => fetchInstallSettings(installSettings.id));
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <Trash2 className="w-6 h-6 text-blue-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Remove from Steam</span>
                                                <span className="text-xs text-zinc-400">Delete shortcut</span>
                                            </div>
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => {
                                                invoke("add_shortcut", { installId: installSettings.id, shortcutType: "steam" }).then(() => fetchInstallSettings(installSettings.id));
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <SteamIcon className="w-6 h-6 text-blue-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Add to Steam</span>
                                                <span className="text-xs text-zinc-400">Create shortcut</span>
                                            </div>
                                        </button>
                                    )}

                                    {installSettings.shortcut_path !== "" ? (
                                        <button
                                            onClick={() => {
                                                invoke("remove_shortcut", { installId: installSettings.id, shortcutType: "desktop" }).then(() => fetchInstallSettings(installSettings.id));
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <Trash2 className="w-6 h-6 text-blue-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Remove from Desktop</span>
                                                <span className="text-xs text-zinc-400">Delete shortcut</span>
                                            </div>
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => {
                                                invoke("add_shortcut", { installId: installSettings.id, shortcutType: "desktop" }).then(() => fetchInstallSettings(installSettings.id));
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <Monitor className="w-6 h-6 text-blue-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Add to Desktop</span>
                                                <span className="text-xs text-zinc-400">Create shortcut</span>
                                            </div>
                                        </button>
                                    )}

                                    {gameBiz && !gameBiz.startsWith("wuwa") && !gameBiz.startsWith("pgr") && (
                                        <button
                                            onClick={() => {
                                                invoke("copy_authkey", { id: installSettings.id }).then(() => {
                                                    setAuthkeyCopied(true);
                                                    setTimeout(() => setAuthkeyCopied(false), 2000);
                                                }).catch((e) => console.error("Failed to copy authkey:", e));
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <Copy className="w-6 h-6 text-purple-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">{authkeyCopied ? "Copied!" : "Copy Authkey"}</span>
                                                <span className="text-xs text-zinc-400">Sync and view your pull history at <span className="text-purple-400">aivo.minlor.net/hoyo</span></span>
                                            </div>
                                        </button>
                                    )}

                                    <button
                                        onClick={() => setOpenPopup(POPUPS.INSTALLDELETECONFIRMATION)}
                                        className="flex items-center gap-3 p-4 bg-red-900/20 hover:bg-red-900/40 rounded-xl border border-red-500/20 transition-all hover:border-red-500/40 text-red-100 text-left">
                                        <Trash2 className="w-6 h-6 text-red-500" />
                                        <div className="flex flex-col">
                                            <span className="font-bold text-red-400">Uninstall</span>
                                            <span className="text-xs text-red-500/60">Remove game files</span>
                                        </div>
                                    </button>
                                </div>
                            </SettingsSection>
                            {window.navigator.platform.includes("Linux") && (
                                <SettingsSection title="Manage Runner">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <button
                                            onClick={() => {
                                                setOpenPopup(POPUPS.NONE);
                                                invoke("open_folder", {
                                                    runnerVersion: "",
                                                    manifestId: installSettings.manifest_id,
                                                    installId: installSettings.id,
                                                    pathType: "runner"
                                                });
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <Folder className="w-6 h-6 text-orange-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Open Runner Folder</span>
                                                <span className="text-xs text-zinc-400">Wine/Proton location</span>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setOpenPopup(POPUPS.NONE);
                                                invoke("open_folder", {
                                                    runnerVersion: "",
                                                    manifestId: installSettings.manifest_id,
                                                    installId: installSettings.id,
                                                    pathType: "runner_prefix"
                                                });
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <Folder className="w-6 h-6 text-yellow-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Open Prefix Folder</span>
                                                <span className="text-xs text-zinc-400">Wine/Proton prefix location</span>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setOpenPopup(POPUPS.NONE);
                                                invoke("empty_folder", {
                                                    installId: installSettings.id,
                                                    pathType: "runner_prefix"
                                                });
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <Wrench className="w-6 h-6 text-orange-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Repair Prefix</span>
                                                <span className="text-xs text-zinc-400">Verify and fix Wine/Proton prefix</span>
                                            </div>
                                        </button>
                                            <button
                                                onClick={() => {
                                                    setOpenPopup(POPUPS.NONE);
                                                    invoke("open_in_prefix", {
                                                        installId: installSettings.id,
                                                        pathType: "regedit.exe"
                                                    });
                                                }}
                                                className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                                <FileCode2 className="w-6 h-6 text-purple-400" />
                                                <div className="flex flex-col">
                                                    <span className="font-bold">Open Registry Editor</span>
                                                    <span className="text-xs text-zinc-400">Open regedit.exe for Wine/Proton prefix</span>
                                                </div>
                                            </button>
                                        <button
                                            onClick={() => {
                                                setOpenPopup(POPUPS.NONE);
                                                invoke("open_in_prefix", {
                                                    installId: installSettings.id,
                                                    pathType: "control.exe"
                                                });
                                            }}
                                            className="flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl border border-white/5 transition-all hover:border-white/20 text-white text-left">
                                            <LayoutDashboard className="w-6 h-6 text-purple-400" />
                                            <div className="flex flex-col">
                                                <span className="font-bold">Open Control Panel</span>
                                                <span className="text-xs text-zinc-400">Open control.exe for Wine/Proton prefix</span>
                                            </div>
                                        </button>
                                    </div>
                                </SettingsSection>
                            )}
                        </>
                        )}
                </div>
            </div>
        </SettingsLayout>
    );
}
