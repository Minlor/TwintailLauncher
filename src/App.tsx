import "./App.css";
import React from "react";
import { POPUPS } from "./components/popups/POPUPS.ts";
import { PAGES } from "./components/pages/PAGES.ts";
import { invoke } from "@tauri-apps/api/core";
import SidebarSettings from "./components/sidebar/SidebarSettings.tsx";
import SidebarIconInstall from "./components/sidebar/SidebarIconInstall.tsx";
import SidebarLink from "./components/sidebar/SidebarLink.tsx";
import { preloadImages } from "./utils/imagePreloader";
import AppLoadingScreen from "./components/AppLoadingScreen";
import SidebarManifests from "./components/sidebar/SidebarManifests.tsx";
import { determineButtonType } from "./utils/determineButtonType";
import BackgroundLayer from "./components/layout/BackgroundLayer";
import ManifestsPanel from "./components/layout/ManifestsPanel";
import ActionBar from "./components/layout/ActionBar";
import PopupOverlay from "./components/layout/PopupOverlay";
import PageViewContainer from "./components/pages/PageViewContainer";
import GameInfoOverlay from "./components/layout/GameInfoOverlay";
import { startInitialLoad } from "./services/loader";
import SidebarRunners from "./components/sidebar/SidebarRunners.tsx";
import SidebarDownloads from "./components/sidebar/SidebarDownloads";
import { toPercent } from "./utils/progress";
import BackgroundControls from "./components/common/BackgroundControls";


export default class App extends React.Component<any, any> {
    loaderController?: { cancel: () => void };
    preloadedBackgrounds: Set<string>;
    // Ref to measure floating manifests panel width to prevent snap during close
    manifestsPanelRef: React.RefObject<HTMLDivElement>;
    constructor(props: any) {
        super(props);

        this.setCurrentGame = this.setCurrentGame.bind(this);
        this.setDisplayName = this.setDisplayName.bind(this);
        this.setBackground = this.setBackground.bind(this);
        this.setGameIcon = this.setGameIcon.bind(this);
        this.setReposList = this.setReposList.bind(this);
        this.setOpenPopup = this.setOpenPopup.bind(this);
        this.setCurrentInstall = this.setCurrentInstall.bind(this);

        this.pushGames = this.pushGames.bind(this);
        this.pushGamesInfo = this.pushGamesInfo.bind(this);
        this.pushInstalls = this.pushInstalls.bind(this);
        this.fetchSettings = this.fetchSettings.bind(this);
        this.fetchRepositories = this.fetchRepositories.bind(this);
        this.fetchInstallSettings = this.fetchInstallSettings.bind(this);
        this.fetchInstallResumeStates = this.fetchInstallResumeStates.bind(this);
        this.fetchDownloadSizes = this.fetchDownloadSizes.bind(this);
        this.fetchGameVersions = this.fetchGameVersions.bind(this);
        this.fetchCompatibilityVersions = this.fetchCompatibilityVersions.bind(this);
        this.refreshDownloadButtonInfo = this.refreshDownloadButtonInfo.bind(this);
        this.fetchInstalledRunners = this.fetchInstalledRunners.bind(this);
        this.handleSpeedSample = this.handleSpeedSample.bind(this);
        this.handleClearSpeedHistory = this.handleClearSpeedHistory.bind(this);
        this.setCurrentPage = this.setCurrentPage.bind(this);
        this.updateAvailableBackgrounds = this.updateAvailableBackgrounds.bind(this);

        // @ts-ignore
        this.preloadedBackgrounds = new Set();
        this.manifestsPanelRef = React.createRef<HTMLDivElement>();

        this.state = {
            isInitialLoading: true,
            isContentLoaded: false,
            loadingProgress: 0,
            loadingMessage: "Initializing...",
            showLoadingOverlay: true,
            overlayFadingOut: false,
            openPopup: POPUPS.NONE,
            currentGame: "",
            currentInstall: "",
            displayName: "",
            gameBackground: "",
            previousBackground: "",
            transitioningBackground: false,
            bgLoading: false,
            bgVersion: 0,
            gameIcon: "",
            gamesinfo: [],
            reposList: [],
            installs: [],
            globalSettings: {},
            preloadAvailable: false,
            gameVersions: [],
            installSettings: {},
            installGameSwitches: {},
            installGameFps: [],
            manifestsInitialLoading: true,
            manifestsOpenVisual: false,
            manifestsPanelWidth: null,
            runnerVersions: [],
            dxvkVersions: [],
            runners: [],
            installedRunners: [],
            downloadSizes: {},
            downloadDir: "",
            downloadVersion: "",
            gameManifest: {},
            disableRun: false,
            disableUpdate: false,
            disableDownload: false,
            disableInstallEdit: false,
            disablePreload: false,
            disableResume: false,
            hideProgressBar: true,
            progressName: "?",
            progressVal: 0,
            progressPercent: "0%",
            progressSpeed: "",
            progressPretty: 0,
            progressPrettyTotal: 0,
            downloadQueueState: null,
            downloadProgressByJobId: {},
            resumeStates: {},
            openDownloadAsExisting: false,
            downloadManagerOpen: false,
            speedHistory: [] as { net: number; disk: number }[],
            downloadsPageOpen: false,
            currentPage: PAGES.NONE,
            availableBackgrounds: [] as { src: string; label: string; isDynamic: boolean }[]
        }
    }

    render() {
        const runningJobs = this.state.downloadQueueState?.running || [];
        const queuedJobs = this.state.downloadQueueState?.queued || [];

        const isCurrentInstallDownloading =
            runningJobs.some((j: any) => j.installId === this.state.currentInstall);
        const isCurrentInstallQueued =
            queuedJobs.some((j: any) => j.installId === this.state.currentInstall);

        const hasDownloads = runningJobs.length + queuedJobs.length > 0;

        const primaryRunningJobId = runningJobs.length > 0 ? runningJobs[0].id : undefined;
        const primaryProgress = primaryRunningJobId ? this.state.downloadProgressByJobId?.[primaryRunningJobId] : undefined;
        const downloadsPercent =
            typeof primaryProgress?.progress === "number" && typeof primaryProgress?.total === "number" && primaryProgress.total > 0
                ? Math.max(0, Math.min(100, toPercent(primaryProgress.progress, primaryProgress.total)))
                : undefined;
        const buttonType = determineButtonType({
            currentInstall: this.state.currentInstall,
            installSettings: this.state.installSettings,
            gameManifest: this.state.gameManifest,
            preloadAvailable: this.state.preloadAvailable,
            resumeStates: this.state.resumeStates,
            isDownloading: isCurrentInstallDownloading,
            isQueued: isCurrentInstallQueued,
        });

        return (
            <>
                <main className={`w-full h-screen flex flex-row bg-transparent overflow-x-hidden transition-opacity duration-500 ${this.state.isContentLoaded ? 'opacity-100' : 'opacity-0'} ${this.state.openPopup != POPUPS.NONE ? "popup-open" : ""}`}>
                    <BackgroundLayer
                        currentSrc={this.state.gameBackground}
                        previousSrc={this.state.previousBackground}
                        transitioning={this.state.transitioningBackground}
                        bgVersion={this.state.bgVersion}
                        popupOpen={this.state.openPopup != POPUPS.NONE}
                        bgLoading={this.state.bgLoading}
                        onMainLoad={() => {
                            // Background image has rendered; stop spinner and finish initial reveal if needed
                            this.setState((prev: any) => ({ bgLoading: false, isContentLoaded: prev.isContentLoaded ? prev.isContentLoaded : prev.isContentLoaded }), () => {
                                if (!this.state.isContentLoaded) {
                                    setTimeout(() => { this.setState({ isContentLoaded: true }); }, 100);
                                }
                            });
                        }}
                    />
                    {this.state.openPopup != POPUPS.NONE && (
                        <div className="pointer-events-none absolute top-0 bottom-0 left-16 right-0 z-40 animate-fadeIn">
                            {/* Frost-like light veil */}
                            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-white/[0.06]" />
                            {/* Subtle dark vignette for depth */}
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.25)_70%,rgba(0,0,0,0.4)_100%)]" />
                            {/* Light grid texture for frost feel */}
                            <div className="absolute inset-0 backdrop-fallback-grid opacity-[0.06]" />
                        </div>
                    )}
                    {/* Top floating manifest panel (slides out from left), toggled by the sidebar chevron */}
                    <ManifestsPanel
                        openPopup={this.state.openPopup}
                        manifestsOpenVisual={this.state.manifestsOpenVisual}
                        manifestsInitialLoading={this.state.manifestsInitialLoading}
                        gamesinfo={this.state.currentGame !== "" ? this.state.gamesinfo : []}
                        manifestsPanelRef={this.manifestsPanelRef}
                        currentGame={this.state.currentGame}
                        setCurrentGame={this.setCurrentGame}
                        setOpenPopup={this.setOpenPopup}
                        setDisplayName={this.setDisplayName}
                        setBackground={this.setBackground}
                        setCurrentInstall={this.setCurrentInstall}
                        setGameIcon={this.setGameIcon}
                        onRequestClose={() => {
                            if (this.state.manifestsOpenVisual && this.state.openPopup === POPUPS.NONE) {
                                this.setState({ manifestsOpenVisual: false });
                            }
                        }}
                    />
                    <div className="h-full w-16 p-2 bg-black/50 flex flex-col items-center justify-start animate-slideInLeft" style={{ animationDelay: '100ms' }}>
                        {/* Separate, centered section for the download/manifests toggle */}
                        <div className="flex items-center justify-center h-16 animate-slideInLeft" style={{ animationDelay: '150ms' }}>
                            <SidebarManifests
                                isOpen={this.state.manifestsOpenVisual}
                                popup={this.state.openPopup}
                                hasInstalls={(this.state.installs?.length || 0) > 0}
                                currentPage={this.state.currentPage}
                                setCurrentPage={this.setCurrentPage}
                                onToggle={() => {
                                    const nextOpen = !this.state.manifestsOpenVisual;
                                    // Instant visual flip for spam-safe reversible transitions
                                    this.setState((prev: any) => ({
                                        manifestsOpenVisual: nextOpen,
                                        globalSettings: { ...prev.globalSettings, hide_manifests: !nextOpen }
                                    }));
                                    // Persist setting asynchronously, no timeouts
                                    invoke("update_settings_manifests_hide", { enabled: !nextOpen }).then(() => { });
                                }}
                            />
                        </div>
                        {/* Scrollable section for installs and separators */}
                        <div className="flex flex-col pb-2 gap-2 flex-shrink overflow-scroll scrollbar-none select-none animate-slideInLeft" style={{ animationDelay: '200ms' }}>
                            <div className={"w-full transition-all duration-500 ease-in-out overflow-visible scrollbar-none gap-3 flex flex-col flex-shrink items-center"} style={{
                                maxHeight: "0px",
                                opacity: 0,
                                transform: "translateY(-10px)"
                            }}>
                                {/* Manifests moved to the top bar */}
                            </div>
                            <div className={`w-8 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent transition-all duration-500 ${this.state.manifestsClosing ? 'animate-slideUpToPosition' : ''}`} style={{
                                animationDelay: this.state.manifestsClosing ? "100ms" : "0ms",
                                '--target-y': this.state.manifestsClosing ? `-${(this.state.gamesinfo.length * 56) + 12}px` : '0px'
                            } as React.CSSProperties} />
                            <div className={`gap-3 flex flex-col items-center scrollbar-none overflow-scroll select-none transition-all duration-500 ${this.state.manifestsClosing ? 'animate-slideUpToPosition' : (this.state.globalSettings.hide_manifests ? '' : 'animate-slideDownToPosition')}`} style={{
                                animationDelay: this.state.manifestsClosing ? "100ms" : "0ms",
                                '--target-y': this.state.manifestsClosing ? `-${(this.state.gamesinfo.length * 56) + 12}px` : '0px'
                            } as React.CSSProperties}>
                                {this.state.installs.map((install: any, index: number) => {
                                    // Find corresponding game manifest info by manifest_id
                                    const game = (this.state.gamesinfo || []).find((g: any) => g.manifest_id === install.manifest_id);
                                    const latest = game?.latest_version ?? null;
                                    const hasUpdate = !!(latest && install?.version && latest !== install.version && !install?.ignore_updates);
                                    return (
                                        <div key={install.id} className="animate-slideInLeft" style={{ animationDelay: `${index * 100 + 600}ms` }}>
                                            <SidebarIconInstall
                                                popup={this.state.openPopup}
                                                icon={install.game_icon}
                                                background={install.game_background}
                                                name={install.name}
                                                enabled={true}
                                                id={install.id}
                                                hasUpdate={hasUpdate}
                                                setCurrentInstall={this.setCurrentInstall}
                                                setOpenPopup={this.setOpenPopup}
                                                currentPage={this.state.currentPage}
                                                setCurrentPage={this.setCurrentPage}
                                                setDisplayName={this.setDisplayName}
                                                setBackground={this.setBackground}
                                                setGameIcon={this.setGameIcon}
                                                installSettings={this.state.installSettings}
                                                onOpenInstallSettings={async () => {
                                                    this.setCurrentInstall(install.id);
                                                    this.setDisplayName(install.name);
                                                    this.setBackground(install.game_background);
                                                    this.setGameIcon(install.game_icon);
                                                    // Preload images and fetch settings in parallel
                                                    await Promise.all([
                                                        preloadImages([install.game_background, install.game_icon].filter(Boolean)),
                                                        this.fetchInstallSettings(install.id)
                                                    ]);
                                                    this.setOpenPopup(POPUPS.INSTALLSETTINGS);
                                                }}
                                                onRefreshSettings={() => { this.fetchInstallSettings(install.id); }}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div className="flex flex-col gap-4 flex-shrink overflow-visible scrollbar-none animate-slideInLeft mt-auto items-center" style={{ animationDelay: '900ms' }}>
                            <div className="w-8 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent animate-slideInLeft" style={{ animationDelay: '950ms' }} />
                            <div className="animate-slideInLeft" style={{ animationDelay: '975ms' }}>
                                <SidebarDownloads
                                    popup={this.state.openPopup}
                                    setOpenPopup={this.setOpenPopup}
                                    hasDownloads={hasDownloads}
                                    progressPercent={downloadsPercent}
                                    currentPage={this.state.currentPage}
                                    setCurrentPage={this.setCurrentPage}
                                />
                            </div>
                            {(window.navigator.platform.includes("Linux")) && (
                                <div className="animate-slideInLeft" style={{ animationDelay: '1000ms' }}>
                                    <SidebarRunners popup={this.state.openPopup} setOpenPopup={this.setOpenPopup} currentPage={this.state.currentPage} setCurrentPage={this.setCurrentPage} />
                                </div>
                            )}
                            <div className="animate-slideInLeft" style={{ animationDelay: '1100ms' }}>
                                <SidebarSettings popup={this.state.openPopup} setOpenPopup={this.setOpenPopup} currentPage={this.state.currentPage} setCurrentPage={this.setCurrentPage} />
                            </div>
                            <div className="animate-slideInLeft" style={{ animationDelay: '1200ms' }}>
                                <SidebarLink popup={this.state.openPopup} title={"Discord"} iconType={"discord"} uri={"https://discord.gg/nDMJDwuj7s"} />
                            </div>
                            <div className="animate-slideInLeft" style={{ animationDelay: '1300ms' }}>
                                <SidebarLink popup={this.state.openPopup} title={"Support the project"} iconType={"donate"} uri={"https://ko-fi.com/twintailteam"} />
                            </div>
                        </div>
                    </div>
                    <GameInfoOverlay
                        displayName={this.state.displayName}
                        gameIcon={this.state.gameIcon}
                        version={(() => {
                            // For installed games, use installSettings.version
                            if (this.state.currentInstall) {
                                return this.state.installSettings?.version;
                            }
                            // For manifest games (not installed), show latest version
                            const game = this.state.gamesinfo.find((g: any) => g.biz === this.state.currentGame);
                            return game?.latest_version;
                        })()}
                        hasUpdate={(() => {
                            const install = this.state.installs.find((i: any) => i.id === this.state.currentInstall);
                            const game = this.state.gamesinfo.find((g: any) => g.manifest_id === install?.manifest_id);
                            const latest = game?.latest_version ?? null;
                            return !!(latest && install?.version && latest !== install.version && !install?.ignore_updates);
                        })()}
                        isVisible={(this.state.currentInstall !== "" || this.state.currentGame !== "") && this.state.openPopup === POPUPS.NONE && this.state.currentPage === PAGES.NONE}
                    />

                    <ActionBar
                        currentInstall={this.state.currentInstall}
                        preloadAvailable={this.state.preloadAvailable}
                        disablePreload={this.state.disablePreload}
                        disableInstallEdit={isCurrentInstallDownloading || isCurrentInstallQueued}
                        disableResume={this.state.disableResume}
                        disableDownload={this.state.disableDownload}
                        disableRun={isCurrentInstallDownloading || isCurrentInstallQueued}
                        disableUpdate={this.state.disableUpdate}
                        resumeStates={this.state.resumeStates}
                        globalSettings={this.state.globalSettings}
                        installSettings={this.state.installSettings}
                        buttonType={buttonType}
                        refreshDownloadButtonInfo={this.refreshDownloadButtonInfo}
                        isVisible={this.state.openPopup === POPUPS.NONE && this.state.currentPage === PAGES.NONE}
                        isPausing={this.state.downloadQueueState?.pausingInstalls?.includes(this.state.currentInstall) ?? false}
                        onOpenInstallSettings={() => {
                            this.setState({ disableInstallEdit: true }, async () => {
                                // Get current install for image preloading
                                const currentInstall = this.state.installs.find((i: any) => i.id === this.state.currentInstall);
                                // Preload images and fetch settings in parallel
                                await Promise.all([
                                    currentInstall ? preloadImages([currentInstall.game_background, currentInstall.game_icon].filter(Boolean)) : Promise.resolve(),
                                    this.fetchInstallSettings(this.state.currentInstall)
                                ]);
                                this.setState({ openPopup: POPUPS.INSTALLSETTINGS, disableInstallEdit: false });
                            });
                        }}
                    />
                    <PopupOverlay
                        openPopup={this.state.openPopup}
                        setOpenPopup={this.setOpenPopup}
                        reposList={this.state.reposList}
                        fetchRepositories={this.fetchRepositories}
                        fetchSettings={this.fetchSettings}
                        globalSettings={this.state.globalSettings}
                        downloadSizes={this.state.downloadSizes}
                        runnerVersions={this.state.runnerVersions}
                        dxvkVersions={this.state.dxvkVersions}
                        gameVersions={this.state.gameVersions}
                        runners={this.state.runners}
                        installedRunners={this.state.installedRunners}
                        fetchInstalledRunners={this.fetchInstalledRunners}
                        gameIcon={this.state.gameIcon}
                        gameBackground={this.state.gameBackground}
                        currentGame={this.state.currentGame}
                        displayName={this.state.displayName}
                        openDownloadAsExisting={this.state.openDownloadAsExisting}
                        fetchDownloadSizes={this.fetchDownloadSizes}
                        pushInstalls={this.pushInstalls}
                        setBackground={this.setBackground}
                        setCurrentInstall={this.setCurrentInstall}
                        gamesinfo={this.state.gamesinfo}
                        installSettings={this.state.installSettings}
                        setCurrentGame={this.setCurrentGame}
                        fetchInstallSettings={this.fetchInstallSettings}
                        installGameSwitches={this.state.installGameSwitches}
                        installGameFps={this.state.installGameFps}
                        installs={this.state.installs}
                    />
                    <BackgroundControls
                        currentBackground={this.state.gameBackground}
                        availableBackgrounds={this.state.availableBackgrounds}
                        onBackgroundChange={this.handleBackgroundChange}
                        isVisible={this.state.openPopup === POPUPS.NONE && this.state.currentPage === PAGES.NONE && (this.state.currentInstall !== "" || this.state.currentGame !== "")}
                    />
                </main>
                {/* Page View Container */}
                {this.state.currentPage !== PAGES.NONE && (
                    <PageViewContainer
                        currentPage={this.state.currentPage}
                        setCurrentPage={this.setCurrentPage}
                        globalSettings={this.state.globalSettings}
                        fetchSettings={this.fetchSettings}
                        downloadQueueState={this.state.downloadQueueState}
                        downloadProgressByJobId={this.state.downloadProgressByJobId}
                        installs={this.state.installs}
                        speedHistory={this.state.speedHistory}
                        onSpeedSample={this.handleSpeedSample}
                        onClearHistory={this.handleClearSpeedHistory}
                        downloadSpeedLimitKiB={this.state.globalSettings?.download_speed_limit ?? 0}
                        runners={this.state.runners}
                        installedRunners={this.state.installedRunners}
                        fetchInstalledRunners={this.fetchInstalledRunners}
                    />
                )}
                {this.state.showLoadingOverlay && (
                    <AppLoadingScreen
                        progress={this.state.loadingProgress}
                        message={this.state.loadingMessage}
                        fadingOut={this.state.overlayFadingOut}
                    />
                )}
            </>
        )
    }

    async componentDidMount() {
        // Kick off background-style initial loading via service
        this.loaderController = startInitialLoad({
            fetchSettings: this.fetchSettings,
            fetchRepositories: this.fetchRepositories,
            fetchCompatibilityVersions: this.fetchCompatibilityVersions,
            fetchInstalledRunners: this.fetchInstalledRunners,
            getGamesInfo: () => this.state.gamesinfo,
            getInstalls: () => this.state.installs,
            preloadImages: (images, onProgress, preloaded) => preloadImages(images, onProgress, preloaded),
            preloadedBackgrounds: this.preloadedBackgrounds,
            setProgress: (progress, message) => this.setState({ loadingProgress: progress, loadingMessage: message }),
            completeInitialLoading: () => this.completeInitialLoading(),
            pushInstalls: this.pushInstalls,
            applyEventState: (ns) => this.setState(ns as any),
            getCurrentInstall: () => this.state.currentInstall,
            fetchInstallResumeStates: this.fetchInstallResumeStates,
        });
    }

    completeInitialLoading() {
        this.setState({ loadingProgress: 100 });
        // Start cross-fade: reveal main content and fade out overlay
        setTimeout(() => {
            this.setState({ isContentLoaded: true, overlayFadingOut: true });
            // After overlay fade duration, remove it and finalize initial state
            setTimeout(() => {
                this.setState({ showLoadingOverlay: false, isInitialLoading: false });
            }, 520); // match overlay CSS duration (500ms) + small buffer
        }, 150);
    }

    componentWillUnmount() {
        if (this.loaderController) {
            this.loaderController.cancel();
        }
    }

    componentDidUpdate(_prevProps: any, prevState: any) {
        if (this.state.currentInstall && this.state.currentInstall !== prevState.currentInstall) {
            this.fetchInstallSettings(this.state.currentInstall);
            this.fetchInstallResumeStates(this.state.currentInstall);
            this.fetchCompatibilityVersions();
            this.fetchInstalledRunners();
            this.updateAvailableBackgrounds();
        }

        // Update available backgrounds when current game changes (for manifests without installs)
        if (this.state.currentGame && this.state.currentGame !== prevState.currentGame && !this.state.currentInstall) {
            this.updateAvailableBackgrounds();
        }

        // Update available backgrounds when gamesinfo updates (handles late-loading dynamic backgrounds)
        // This ensures dynamic backgrounds show up even if data wasn't ready when user first clicked a game
        if (this.state.gamesinfo !== prevState.gamesinfo && this.state.gamesinfo.length > 0 && (this.state.currentGame || this.state.currentInstall)) {
            this.updateAvailableBackgrounds();
        }

        // Update available backgrounds when installs list changes (handles async pushInstalls completion)
        // This fixes the race condition where setCurrentInstall is called before pushInstalls completes
        if (this.state.installs !== prevState.installs && this.state.currentInstall) {
            this.updateAvailableBackgrounds();
        }
    }

    fetchRepositories() {
        return invoke("list_repositories").then(r => {
            if (r === null) {
                console.error("Repository database table contains nothing, some serious fuck up happened!")
            } else {
                let rr = JSON.parse(r as string);
                this.pushGames(rr);
                this.pushInstalls();
            }
        }).catch(e => {
            console.error("Error while listing database repositories information: " + e)
        });
    }

    pushGames(repos: { id: string; github_id: any; }[]) {
        repos.forEach((r: { id: string; github_id: any; }) => {
            invoke("list_manifests_by_repository_id", { repositoryId: r.id }).then(m => {
                if (m === null) {
                    console.error("Manifest database table contains nothing, some serious fuck up happened!")
                } else {
                    let g = JSON.parse(m as string);
                    this.pushGamesInfo(g);
                    let entries: any[] = [];
                    g.forEach((e: any) => entries.push(e));
                    // @ts-ignore
                    r["manifests"] = entries;
                    this.setReposList(repos);
                }
            }).catch(e => {
                console.error("Error while listing database manifest information: " + e)
            })
        });
    }

    pushGamesInfo(games: { filename: any; display_name: string; id: string; enabled: boolean; }[]) {
        invoke("list_game_manifests").then(m => {
            if (m === null) {
                console.error("GameManifest repository fetch issue, some serious fuck up happened!")
            } else {
                let gi = JSON.parse(m as string);
                // Hacky way to pass some values from DB manifest data onto the list of games we use to render SideBarIcon components
                gi.forEach((e: any) => {
                    let g = games.find(g => g.filename.replace(".json", "") === e.biz);
                    // @ts-ignore
                    e["manifest_id"] = g.id;
                    // @ts-ignore
                    e["manifest_enabled"] = g.enabled;
                    // @ts-ignore
                    e["manifest_file"] = g.filename;
                });

                this.setState(() => ({ gamesinfo: gi }), () => {
                    // Reset initial loading state after animations complete
                    if (this.state.manifestsInitialLoading && gi.length > 0) {
                        const maxDelay = (gi.length - 1) * 100 + 400; // Last item delay
                        const animationDuration = 600; // slideInLeft duration
                        setTimeout(() => { this.setState({ manifestsInitialLoading: false }); }, maxDelay + animationDuration + 50);
                    }

                    if (this.state.installs.length === 0) {
                        if (games.length > 0 && this.state.currentGame == "") {
                            // Use dynamic background if available, otherwise fall back to static
                            let bg = gi[0].assets.game_live_background || gi[0].assets.game_background;
                            this.setCurrentGame(games[0].filename.replace(".json", ""));
                            this.setDisplayName(games[0].display_name);
                            this.setBackground(bg);
                            this.setGameIcon(gi[0].assets.game_icon);
                            setTimeout(() => {
                                // @ts-ignore
                                document.getElementById(gi[0].biz).focus();
                            }, 20);
                        }
                    } else {
                        this.setCurrentGame(games[0].filename.replace(".json", ""));
                        this.setDisplayName(this.state.installs[0].name);
                        this.setBackground(this.state.installs[0].game_background);
                        this.setGameIcon(this.state.installs[0].game_icon);
                        this.setCurrentInstall(this.state.installs[0].id);
                        this.fetchInstallResumeStates(this.state.installs[0].id);
                        setTimeout(() => {
                            // @ts-ignore
                            document.getElementById(`${this.state.installs[0].id}`).focus();
                        }, 20);
                    }
                });
            }
        }).catch(e => {
            console.error("Error while listing game manifest information: " + e)
        })
    }

    pushInstalls() {
        invoke("list_installs").then(m => {
            if (m === null) {
                // No installs left, set installs to empty array
                this.setState(() => ({ installs: [] }));
            } else {
                let gi = JSON.parse(m as string);
                this.setState(() => ({ installs: gi }), () => {
                    // Also preload installed-specific assets (older/different versions)
                    try {
                        const backgrounds: string[] = (this.state.installs || [])
                            .map((i: any) => i?.game_background)
                            .filter((s: any) => !!s);
                        const icons: string[] = (this.state.installs || [])
                            .map((i: any) => i?.game_icon)
                            .filter((s: any) => !!s);
                        const images = Array.from(new Set([...(backgrounds as string[]), ...(icons as string[])]));
                        // Only preload ones we haven't already cached
                        const notPreloaded = images.filter((u) => !this.preloadedBackgrounds.has(u));
                        if (notPreloaded.length > 0) {
                            preloadImages(notPreloaded, undefined, this.preloadedBackgrounds).then(() => { });
                        }
                    } catch (e) {
                        console.warn("Install assets preload failed:", e);
                    }
                });
            }
        }).catch(e => {
            console.error("Error while listing installs information: " + e)
        })
    }

    fetchSettings() {
        return invoke("list_settings").then(data => {
            if (data === null) {
                console.error("Settings database table contains nothing, some serious fuck up happened!")
            } else {
                const gs = JSON.parse(data as string);
                this.setState(() => ({
                    globalSettings: gs
                }));
            }
        });
    }

    fetchInstallSettings(install: any) {
        return invoke("get_install_by_id", { id: install }).then(async data => {
            if (data === null) {
                console.error("Failed to fetch install settings!");
                this.setState(() => ({ installSettings: null, gameManifest: null, preloadAvailable: false, installGameSwitches: {}, installGameFps: [] }));
            } else {
                let parsed = JSON.parse(data as string);
                let md = await this.fetchManifestById(parsed.manifest_id);
                // @ts-ignore
                let isPreload = md.extra.preload['metadata'] !== null;
                // Prepare switches and fps list for SettingsInstall (keep newer fields if present)
                const switches = md?.extra?.switches ?? {};
                const fpsList = Array.isArray(md?.extra?.fps_unlock_options) ? md.extra.fps_unlock_options.map((e: any) => ({ value: `${e}`, name: `${e}` })) : [];
                this.setState(() => ({ installSettings: parsed, gameManifest: md, preloadAvailable: isPreload, installGameSwitches: switches, installGameFps: fpsList }));
            }
        });
    }

    fetchGameVersions(biz: string): Promise<void> {
        return new Promise((resolve) => {
            let game = this.state.gamesinfo.filter((g: any) => g.biz == biz)[0];
            let tmp: { value: any; name: any; background?: string; liveBackground?: string; }[] = [];
            game.game_versions.forEach((g: any) => {
                // Only use version-specific live background if it exists for this version
                // Don't fall back to game's global live background for older versions
                const versionLiveBackground = g.assets?.game_live_background || "";
                const staticBackground = g.assets?.game_background || "";
                tmp.push({
                    value: g.metadata.version,
                    name: (game.latest_version === g.metadata.version) ? `Latest (${g.metadata.version})` : g.metadata.version,
                    background: staticBackground,
                    liveBackground: versionLiveBackground // Only use version-specific, no fallback
                });
            });
            this.setState({ gameVersions: tmp }, resolve);
        });
    }

    fetchCompatibilityVersions() {
        return invoke("list_compatibility_manifests").then(data => {
            if (data === null) {
                console.error("Failed to get compatibility versions.");
            } else {
                let r = JSON.parse(data as string);
                let dxvks: any[] = [];
                let wines: any[] = [];
                // Bad but will work for now... DO NOT EVER FILTER LIKE THIS...
                r.filter((e: any) => e.display_name.toLowerCase().includes("dxvk")).forEach((e: any) => {
                    e.versions.forEach((v: any) => dxvks.push({ value: v.version, name: v.version }));
                });
                r.filter((e: any) => !e.display_name.toLowerCase().includes("dxvk") && !e.display_name.toLowerCase().includes("wine")).forEach((e: any) => {
                    e.versions.forEach((v: any) => wines.push({ value: v.version, name: v.version }));
                });
                let d = r.filter((e: any) => !e.display_name.toLowerCase().includes("dxvk") && !e.display_name.toLowerCase().includes("wine"));
                this.setState({ runnerVersions: wines, dxvkVersions: dxvks, runners: d });
            }
        })
    }

    fetchInstalledRunners() {
        return invoke("list_installed_runners").then(data => {
            if (data === null) {
                console.error("Failed to get installed runners.");
            } else {
                let r = JSON.parse(data as string);
                let installed: any[] = [];
                r.filter((e: any) => e.is_installed).forEach((e: any) => { installed.push(e); });
                this.setState({ installedRunners: installed });
            }
        })
    }

    fetchDownloadSizes(biz: any, version: any, lang: any, path: any, callback: (data: any) => void) {
        invoke("get_download_sizes", { biz: biz, version: version, path: path, lang: lang }).then(data => {
            if (data === null) {
                console.error("Could not get download sizes!");
            } else {
                const parsed = JSON.parse(data as string);
                callback(parsed);
                this.setState({ downloadSizes: parsed });
            }
        });
    }

    async fetchManifestById(install: any) {
        // Use broad typing since manifest.extra may include optional fields like
        // switches, fps_unlock_options, preload, etc.
        let rslt: any;
        let data = await invoke("get_game_manifest_by_manifest_id", { id: install });
        if (data === null) {
            console.error("Failed to fetch game manifest info!");
            rslt = { latest_version: null, extra: { preload: { metadata: null } } };
        } else {
            rslt = JSON.parse(data as string);
        }
        return rslt;
    }

    fetchInstallResumeStates(install: any) {
        invoke("get_resume_states", { install: install }).then(async data => {
            if (data === null) {
                console.error("Failed to fetch install resume states!");
                this.setState(() => ({ resumeStates: { downloading: false, updating: false, preloading: false, repairing: false } }));
            } else {
                let parsed = JSON.parse(data as string);
                this.setState(() => ({ resumeStates: parsed }));
            }
        });
    }

    async refreshDownloadButtonInfo(existingInstall: boolean = false) {
        // Ensure versions are fetched before opening popup
        await this.fetchGameVersions(this.state.currentGame);
        await this.fetchCompatibilityVersions();

        // Fetch download sizes and open popup only after data is ready
        this.fetchDownloadSizes(
            this.state.currentGame,
            this.state.gameVersions[0]?.value,
            "en-us",
            `${this.state.globalSettings.default_game_path}/${this.state.currentGame}`,
            () => {
                // Open popup after download sizes are fetched
                this.setState({ openPopup: POPUPS.DOWNLOADGAME, openDownloadAsExisting: existingInstall });
            }
        );
    }



    setOpenPopup(state: POPUPS) { this.setState({ openPopup: state }); }
    setCurrentGame(game: string) { this.setState({ currentGame: game }); }
    setDisplayName(name: string) { this.setState({ displayName: name }); }
    setCurrentPage(page: PAGES) { this.setState({ currentPage: page }); }

    // Handle speed sample from DownloadManager for telemetry graph
    handleSpeedSample(sample: { net: number; disk: number }) {
        this.setState((prev: any) => {
            const history = [...(prev.speedHistory || []), sample];
            // Keep last 60 samples (~60 seconds of data)
            return { speedHistory: history.slice(-60) };
        });
    }

    // Clear speed history when switching to a different download job
    handleClearSpeedHistory() {
        this.setState({ speedHistory: [] });
    }

    // Update available backgrounds for the current game/install
    updateAvailableBackgrounds() {
        const backgrounds: { src: string; label: string; isDynamic: boolean }[] = [];
        const seen = new Set<string>();

        const addBg = (src: string, label: string, isDynamic: boolean) => {
            if (src && !seen.has(src)) {
                backgrounds.push({ src, label, isDynamic });
                seen.add(src);
            }
        };

        // If we have a current install, get backgrounds from the install
        if (this.state.currentInstall) {
            const install = this.state.installs.find((i: any) => i.id === this.state.currentInstall);
            if (install) {
                // Try to find the game manifest by ID first, then by title
                let game = this.state.gamesinfo.find((g: any) => g.manifest_id === install.manifest_id);
                if (!game) {
                    game = this.state.gamesinfo.find((g: any) => g.title === install.name);
                }

                if (game) {
                    // Add dynamic background if available
                    if (game.assets?.game_live_background) {
                        addBg(game.assets.game_live_background, "Dynamic", true);
                    }
                    // Add static background from game manifest
                    if (game.assets?.game_background) {
                        addBg(game.assets.game_background, "Static", false);
                    }
                }

                // Always ensure the install's own background is added if we didn't get it yet
                if (install.game_background) {
                    addBg(install.game_background, "Static", false);
                }
            }
        } else if (this.state.currentGame) {
            // If no install, get backgrounds from the current game manifest
            const game = this.state.gamesinfo.find((g: any) => g.biz === this.state.currentGame);
            if (game) {
                if (game.assets?.game_live_background) {
                    addBg(game.assets.game_live_background, "Dynamic", true);
                }
                if (game.assets?.game_background) {
                    addBg(game.assets.game_background, "Static", false);
                }
            }
        }

        // Ensure the currently displayed background is in the list (if valid)
        if (this.state.gameBackground && !seen.has(this.state.gameBackground)) {
            // Determine if it's dynamic based on URL
            const isDynamic = this.state.gameBackground.endsWith(".mp4") || this.state.gameBackground.endsWith(".webm");
            addBg(this.state.gameBackground, isDynamic ? "Dynamic" : "Static", isDynamic);
        }

        // Sort: Dynamic first
        backgrounds.sort((a, b) => (a.isDynamic === b.isDynamic ? 0 : a.isDynamic ? -1 : 1));

        this.setState({ availableBackgrounds: backgrounds }, () => {
            // Check if the user has a saved preference for this install
            const install = this.state.currentInstall
                ? this.state.installs.find((i: any) => i.id === this.state.currentInstall)
                : null;

            if (install?.preferred_background) {
                // User has a saved preference - use it if it's in the available list
                const preferredBg = backgrounds.find(b => b.src === install.preferred_background);
                if (preferredBg && this.state.gameBackground !== preferredBg.src) {
                    this.setBackground(preferredBg.src);
                }
            } else {
                // No saved preference - default to dynamic background if available
                const dynamicBg = backgrounds.find(b => b.isDynamic);
                if (dynamicBg && this.state.gameBackground !== dynamicBg.src) {
                    this.setBackground(dynamicBg.src);
                }
            }
        });
    }

    // Store the background transition timeout
    bgTransitionTimeout?: number;

    setBackground(file: string, savePreference: boolean = false) {
        if (!file || file === this.state.gameBackground) return; // nothing to do

        // Cancel any previous transition timeout
        if (this.bgTransitionTimeout) {
            clearTimeout(this.bgTransitionTimeout);
            this.bgTransitionTimeout = undefined;
        }

        // Save user preference if this is a manual change
        if (savePreference && this.state.currentInstall) {
            invoke("update_install_preferred_background", {
                id: this.state.currentInstall,
                background: file
            }).catch(console.error);

            // Also update the local state so the preference is immediately reflected
            this.setState((prev: any) => ({
                installs: prev.installs.map((i: any) =>
                    i.id === this.state.currentInstall
                        ? { ...i, preferred_background: file }
                        : i
                )
            }));
        }

        // Start loading: show gradient on the new image while it loads
        this.setState((prev: any) => ({
            bgLoading: true,
            previousBackground: prev.gameBackground || prev.previousBackground || "",
            gameBackground: file,
            transitioningBackground: prev.gameBackground !== "",
            bgVersion: prev.bgVersion + 1
        }), () => {
            if (this.state.transitioningBackground) {
                this.bgTransitionTimeout = window.setTimeout(() => {
                    // After animation remove previous; keep if multiple rapid switches occurred
                    this.setState({
                        transitioningBackground: false,
                        previousBackground: ""
                    });
                    this.bgTransitionTimeout = undefined;
                }, 480); // match CSS duration
            }
        });
    }

    // Wrapper for user-initiated background changes (saves preference)
    handleBackgroundChange = (file: string) => {
        this.setBackground(file, true);
    };
    setGameIcon(file: string) { this.setState({ gameIcon: file }); }
    setReposList(reposList: any) { this.setState({ reposList: reposList }); }
    setCurrentInstall(game: string) { this.setState({ currentInstall: game }); }
}
