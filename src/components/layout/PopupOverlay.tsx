import { POPUPS } from "../popups/POPUPS";
import { PAGES } from "../pages/PAGES";
import { useEffect } from "react";
import RepoManager from "../popups/repomanager/RepoManager";
import AddRepo from "../popups/repomanager/AddRepo";
import LauncherSettings from "../settings/LauncherSettings";
import DownloadGame from "../popups/DownloadGame";
import GameSettings from "../settings/GameSettings";
import InstallDeleteConfirm from "../popups/settings/InstallDeleteConfirm";
import FpsUnlockSettings from "../popups/settings/FpsUnlockSettings.tsx";
import MangoHudSettings from "../popups/settings/MangoHudSettings.tsx";
import XXMISettings from "../popups/settings/XXMISettings.tsx";

export type PopupOverlayProps = {
  openPopup: POPUPS;
  setOpenPopup: (p: POPUPS) => void;

  // Repo manager
  reposList: any[];
  fetchRepositories: () => any;

  // Global settings
  fetchSettings: () => any;
  globalSettings: any;

  // Download game
  downloadSizes: any;
  runnerVersions: any[];
  dxvkVersions: any[];
  gameVersions: any[];
  runners: any[];
  installedRunners: any[];
  fetchInstalledRunners: () => any;
  gameIcon: string;
  gameBackground: string;
  currentGame: string;
  displayName: string;
  openDownloadAsExisting: boolean;
  fetchDownloadSizes: (
    biz: any,
    version: any,
    lang: any,
    path: any,
    region_filter: any,
    callback: (data: any) => void
  ) => void;
  pushInstalls: (...args: any[]) => any;
  setBackground: (f: string) => void;
  setCurrentInstall: (id: string) => void;

  // Install settings
  gamesinfo: any[];
  installSettings: any;
  setCurrentGame: (biz: string) => void;
  fetchInstallSettings: (installId: string) => Promise<any> | any;
  installGameSwitches: any;
  installGameFps: any[];

  // Delete confirmation
  installs: any[];

  // Page navigation
  setCurrentPage: (page: PAGES) => void;

  // Network recovery
  imageVersion?: number;
};

export default function PopupOverlay(props: PopupOverlayProps) {
  const {
    openPopup,
    setOpenPopup,
    reposList,
    fetchRepositories,
    fetchSettings,
    globalSettings,
    downloadSizes,
    runnerVersions,
    dxvkVersions,
    gameVersions,
    installedRunners,
    gameIcon,
    gameBackground,
    currentGame,
    displayName,
    openDownloadAsExisting,
    fetchDownloadSizes,
    pushInstalls,
    setBackground,
    setCurrentInstall,
    gamesinfo,
    installSettings,
    setCurrentGame,
    fetchInstallSettings,
    installGameSwitches,
    installGameFps,
    installs,
    setCurrentPage,
    imageVersion = 0,
  } = props;

  // ESC to close and scroll lock while a popup is open
  useEffect(() => {
    if (openPopup !== POPUPS.NONE) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpenPopup(POPUPS.NONE);
      };
      document.addEventListener("keydown", onKey);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [openPopup, setOpenPopup]);

  return (
    <div
      role="dialog"
      aria-modal={openPopup !== POPUPS.NONE}
      className={`absolute items-center justify-center top-0 bottom-0 left-16 right-0 p-8 z-50 transition-opacity duration-200 flex ${openPopup == POPUPS.NONE ? "opacity-0 pointer-events-none invisible" : "opacity-100 visible"}`}
      style={{
        willChange: 'opacity',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
        contain: 'content' // Isolate layout/paint
      }}
      onClick={(e) => { if (e.target === e.currentTarget) { setOpenPopup(POPUPS.NONE); } }}
    >
      {/* Backdrop overlay - prevents WebKitGTK flash during popup animation */}
      {openPopup !== POPUPS.NONE && (
        <div className="absolute inset-0 bg-black/60 animate-backdrop-in pointer-events-none" style={{ willChange: 'opacity', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }} />
      )}
      {openPopup == POPUPS.REPOMANAGER && (
        <RepoManager
          repos={reposList}
          setOpenPopup={setOpenPopup}
          fetchRepositories={fetchRepositories}
        />
      )}
      {openPopup == POPUPS.ADDREPO && <AddRepo setOpenPopup={setOpenPopup} />}
      {openPopup == POPUPS.SETTINGS && (
        <LauncherSettings
          fetchSettings={fetchSettings}
          settings={globalSettings}
          setOpenPopup={setOpenPopup}
        />
      )}
      {openPopup == POPUPS.DOWNLOADGAME && (
        <DownloadGame
          fetchDownloadSizes={fetchDownloadSizes}
          disk={downloadSizes}
          runnerVersions={runnerVersions}
          dxvkVersions={dxvkVersions}
          versions={gameVersions}
          icon={gameIcon}
          background={gameBackground}
          biz={currentGame}
          displayName={displayName}
          settings={globalSettings}
          setOpenPopup={setOpenPopup}
          pushInstalls={pushInstalls}
          setBackground={setBackground}
          setCurrentInstall={setCurrentInstall}
          openAsExisting={openDownloadAsExisting}
          setCurrentPage={setCurrentPage}
          imageVersion={imageVersion}
        />
      )}

      {openPopup == POPUPS.INSTALLSETTINGS && (
        <GameSettings
          installedRunners={installedRunners}
          installSettings={installSettings}
          setOpenPopup={setOpenPopup}
          fetchInstallSettings={fetchInstallSettings}
          prefetchedSwitches={installGameSwitches}
          prefetchedFps={installGameFps}
          installs={installs}
          setCurrentPage={setCurrentPage}
          gamesinfo={gamesinfo}
          imageVersion={imageVersion}
        />
      )}
      {openPopup == POPUPS.INSTALLDELETECONFIRMATION && (
        <InstallDeleteConfirm
          installs={installs}
          games={gamesinfo}
          install={installSettings}
          setOpenPopup={setOpenPopup}
          pushInstalls={pushInstalls}
          setCurrentInstall={setCurrentInstall}
          setCurrentGame={setCurrentGame}
          setBackground={setBackground}
        />
      )}
      {openPopup == POPUPS.FPSUNLOCKERSETTINGS && (
        <FpsUnlockSettings install={installSettings} setOpenPopup={setOpenPopup} gameSwitches={installGameSwitches} gameFps={installGameFps} fetchInstallSettings={fetchInstallSettings} />
      )}
      {openPopup == POPUPS.XXMISETTINGS && (
        <XXMISettings install={installSettings} setOpenPopup={setOpenPopup} gameSwitches={installGameSwitches} fetchInstallSettings={fetchInstallSettings} />
      )}
      {openPopup == POPUPS.MANGOHUDSETTINGS && (
        <MangoHudSettings install={installSettings} setOpenPopup={setOpenPopup} fetchInstallSettings={fetchInstallSettings} gameSwitches={installGameSwitches} />
      )}
    </div>
  );
}
