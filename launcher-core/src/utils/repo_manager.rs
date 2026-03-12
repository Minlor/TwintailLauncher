use std::fs;
use std::io::BufReader;
use std::path::{PathBuf};
use std::sync::{RwLock};
use std::collections::{HashMap,HashSet};
use linked_hash_map::LinkedHashMap;
use serde::{Deserialize, Serialize};
use crate::runtime::{LauncherContext, Manager};
use crate::utils::db_manager::{create_manifest,create_repository,delete_manifest_by_id,get_manifest_info_by_filename,get_manifests_by_repository_id,get_repositories,get_repository_info_by_github_id,update_manifest_enabled_by_id};
use crate::utils::{generate_cuid, models::{RepositoryManifest, RunnerManifest, GameManifest}, resolve_app_data_dir, show_dialog};
use crate::utils::git_helpers::{do_fetch, do_merge};

#[cfg(target_os = "linux")]
use crate::utils::{run_async_command, runner_from_runner_version};
#[cfg(target_os = "linux")]
use std::path::Path;
#[cfg(target_os = "linux")]
use crate::utils::db_manager::{create_installed_runner, update_install_runner_location_by_id, update_install_runner_version_by_id, get_installs, get_installed_runner_info_by_version, update_installed_runner_is_installed_by_version};

fn manifest_branch() -> &'static str { if cfg!(debug_assertions) || std::env::var("TTL_DEV").is_ok() { "next" } else { "main" } }

fn clone_repo(url: &str, path: &PathBuf) -> Result<git2::Repository, git2::Error> {
    if cfg!(debug_assertions) || std::env::var("TTL_DEV").is_ok() { git2::build::RepoBuilder::new().branch("next").clone(url, path) } else { git2::Repository::clone(url, path) }
}

fn read_manifest_data(path: &PathBuf) -> Option<ManifestData> {
    let file = match fs::File::open(path) { Ok(file) => file, Err(err) => { log::error!("Failed to open manifest {}: {}", path.display(), err); return None; } };
    let reader = BufReader::new(file);
    match serde_json::from_reader(reader) {
        Ok(data) => Some(data),
        Err(err) => {
            let raw = match fs::read_to_string(path) { Ok(raw) => raw, Err(read_err) => { log::error!("Failed to parse manifest {}: {} (also failed to read raw contents: {})", path.display(), err, read_err); return None; } };
            if raw.contains("<<<<<<<") && raw.contains("=======") && raw.contains(">>>>>>>") {
                if let Some(resolved) = resolve_merge_conflict_preferring_theirs(&raw) {
                    match serde_json::from_str::<ManifestData>(&resolved) {
                        Ok(data) => {
                            let _ = fs::write(path, resolved.as_bytes());
                            log::warn!("Resolved Git merge markers in manifest {}", path.display());
                            Some(data)
                        }
                        Err(resolve_err) => { log::error!("Failed to parse conflict-resolved manifest {}: {}", path.display(), resolve_err); None }
                    }
                } else {
                    log::error!("Failed to resolve merge markers in manifest {}", path.display());
                    None
                }
            } else {
                log::error!("Failed to parse manifest {}: {}", path.display(), err);
                None
            }
        }
    }
}

fn resolve_merge_conflict_preferring_theirs(raw: &str) -> Option<String> {
    enum State { Normal, Ours, Theirs }
    let mut state = State::Normal;
    let mut resolved = String::new();
    for line in raw.lines() {
        if line.starts_with("<<<<<<<") { state = State::Ours; continue; }
        if line.starts_with("=======") { if matches!(state, State::Ours) { state = State::Theirs; continue; } }
        if line.starts_with(">>>>>>>") { if matches!(state, State::Theirs) { state = State::Normal; continue; } }
        match state {
            State::Normal | State::Theirs => {
                resolved.push_str(line);
                resolved.push('\n');
            }
            State::Ours => {}
        }
    }
    if !matches!(state, State::Normal) { return None; }
    Some(resolved)
}

fn ensure_repository_id(app: &LauncherContext, github_id: &str) -> Option<String> {
    if let Some(repo) = get_repository_info_by_github_id(app, github_id.to_string()) { return Some(repo.id); }
    let id = generate_cuid();
    let _ = create_repository(app, id.clone(), github_id);
    get_repository_info_by_github_id(app, github_id.to_string()).map(|repo| repo.id).or(Some(id))
}

fn sync_repo_manifest_rows(app: &LauncherContext, github_id: &str, loaded: &[(String,String)]) {
    let Some(repository_id) = ensure_repository_id(app, github_id) else { return; };
    let existing = get_manifests_by_repository_id(app, repository_id.clone()).unwrap_or_default();
    let desired = loaded.iter().map(|(filename, _)| filename.clone()).collect::<HashSet<_>>();
    let mut grouped = HashMap::<String, Vec<crate::utils::models::LauncherManifest>>::new();
    for manifest in existing { grouped.entry(manifest.filename.clone()).or_default().push(manifest); }

    for (filename, manifests) in grouped {
        if !desired.contains(&filename) {
            for manifest in manifests { let _ = delete_manifest_by_id(app, manifest.id); }
            continue;
        }
        let mut iter = manifests.into_iter();
        if let Some(primary) = iter.next() { if !primary.enabled { update_manifest_enabled_by_id(app, primary.id, true); } }
        for duplicate in iter { let _ = delete_manifest_by_id(app, duplicate.id); }
    }

    for (filename, display_name) in loaded {
        if get_manifest_info_by_filename(app, filename.clone()).is_none() {
            let _ = create_manifest(app, generate_cuid(), repository_id.clone(), display_name.as_str(), filename.as_str(), true);
        }
    }
}

pub fn setup_official_repository(app: &LauncherContext, path: &PathBuf) {
    let url = "https://github.com/TwintailTeam/game-manifests.git";

    let tmp = url.split("/").collect::<Vec<&str>>()[4];
    let user = url.split("/").collect::<Vec<&str>>()[3];
    let repo_name = tmp.split(".").collect::<Vec<&str>>()[0];

    let repo_path = path.join(format!("{}/{}", user, repo_name).as_str());
    let repo_manifest = repo_path.join("repository.json");

    if !path.exists() {
        return;
    } else if !repo_path.exists() {
        clone_repo(url, &repo_path).unwrap();

        if repo_manifest.exists() {
            let rm = fs::File::open(&repo_manifest).unwrap();
            let reader = BufReader::new(rm);
            let rma: RepositoryManifest = serde_json::from_reader(reader).unwrap();

            let repo_id = generate_cuid();
            create_repository(app, repo_id.clone(), format!("{user}/{repo_name}").as_str()).unwrap();

            for m in rma.manifests {
                match read_manifest_data(&repo_path.join(&m.as_str())) {
                    Some(ManifestData::Game(mi)) => {
                        let cuid = generate_cuid();
                        create_manifest(app, cuid.clone(), repo_id.clone(), mi.display_name.as_str(), m.as_str(), true).unwrap();
                    }
                    #[cfg(target_os = "linux")]
                    Some(ManifestData::Runner(_)) => {}
                    #[cfg(target_os = "windows")]
                    Some(ManifestData::Runner(_)) => {}
                    None => {}
                }
            }
            ()
        }
    } else {
        log::debug!("Official game repository is already cloned!");
        #[cfg(debug_assertions)]
        { println!("Official game repository is already cloned!"); }
        let r = update_repositories(&repo_path);
        match r {
            Ok(_) => {}
            Err(e) => { show_dialog(app, "warning", "TwintailLauncher", format!("Failed to fetch update(s) for game manifest repository! {}", e.to_string()).as_str(), None); }
        }
    }
}

pub fn clone_new_repository(app: &LauncherContext, path: &PathBuf, url: String) -> Result<bool, git2::Error> {
    let tmp = url.split("/").collect::<Vec<&str>>()[4];
    let user = url.split("/").collect::<Vec<&str>>()[3];
    let repo_name = tmp.split(".").collect::<Vec<&str>>()[0];

    let repo_path = path.join(format!("{}/{}", user, repo_name).as_str());
    let repo_manifest = repo_path.join("repository.json");

    if !path.exists() {
        Ok(false)
    } else if !repo_path.exists() {
       let repo = clone_repo(url.as_str(), &repo_path);

        if repo_manifest.exists() && repo.is_ok() {
            let rm = fs::File::open(&repo_manifest).unwrap();
            let reader = BufReader::new(rm);
            let rma: RepositoryManifest = serde_json::from_reader(reader).unwrap();

            let repo_id = generate_cuid();
            create_repository(app, repo_id.clone(), format!("{user}/{repo_name}").as_str()).unwrap();

            for m in rma.manifests {
                match read_manifest_data(&repo_path.join(&m.as_str())) {
                    Some(ManifestData::Game(mi)) => {
                        let cuid = generate_cuid();
                        create_manifest(app, cuid.clone(), repo_id.clone(), mi.clone().display_name.as_str(), m.clone().as_str(), true).unwrap();
                    }
                    #[cfg(target_os = "linux")]
                    Some(ManifestData::Runner(_)) => {}
                    #[cfg(target_os = "windows")]
                    Some(ManifestData::Runner(_)) => {}
                    None => {}
                }
            }
            Ok(true)
        } else {
            #[cfg(debug_assertions)]
            { println!("Cannot clone repository! Not a valid repository?"); }
            Ok(false)
        }
    } else {
        #[cfg(debug_assertions)]
        { println!("Target repository already exists!"); }
        let r = update_repositories(&repo_path);
        match r {
            Ok(_) => {}
            Err(e) => { show_dialog(app, "warning", "TwintailLauncher", format!("Failed to fetch update(s) for one or multiple 3rd party repositories! {}", e.to_string()).as_str(), None); }
        }
        Ok(false)
    }
}

pub fn update_repositories(path: &PathBuf) -> Result<bool, git2::Error> {
    let repo = git2::Repository::open(&path);

    if repo.is_ok() && path.exists() {
        let r = repo?;
        let mut remote = r.find_remote("origin")?;
        let branch = manifest_branch();
        let fetch_commit = do_fetch(&r, &[branch], &mut remote)?;
        do_merge(&r, branch, fetch_commit)?;
        log::debug!("Successfully updated repositories!");
        #[cfg(debug_assertions)]
        { println!("Successfully updated repositories!"); }
        Ok(true)
    } else {
        log::debug!("Failed to fetch repository updates!");
        #[cfg(debug_assertions)]
        { println!("Failed to fetch repository updates!"); }
        Ok(false)
    }
}

#[cfg(target_os = "linux")]
pub fn setup_compatibility_repository(app: &LauncherContext, path: &PathBuf) {
    let url = "https://github.com/TwintailTeam/runner-manifests.git";

    let tmp = url.split("/").collect::<Vec<&str>>()[4];
    let user = url.split("/").collect::<Vec<&str>>()[3];
    let repo_name = tmp.split(".").collect::<Vec<&str>>()[0];

    let repo_path = path.join(format!("{}/{}", user, repo_name).as_str());
    let repo_manifest = repo_path.join("repository.json");

    if !path.exists() {
        return;
    } else if !repo_path.exists() {
        clone_repo(url, &repo_path).unwrap();

        if repo_manifest.exists() {
            let rm = fs::File::open(&repo_manifest).unwrap();
            let reader = BufReader::new(rm);
            let rma: RepositoryManifest = serde_json::from_reader(reader).unwrap();

            let repo_id = generate_cuid();
            create_repository(app, repo_id.clone(), format!("{user}/{repo_name}").as_str()).unwrap();

            for m in rma.manifests {
                match read_manifest_data(&repo_path.join(&m.as_str())) {
                    Some(ManifestData::Runner(mi)) => {
                        let cuid = generate_cuid();
                        create_manifest(app, cuid.clone(), repo_id.clone(), mi.display_name.as_str(), m.as_str(), true).unwrap();
                    }
                    Some(ManifestData::Game(_)) => {}
                    None => {}
                }
            }
            ()
        }
    } else {
        log::debug!("Official compatibility repository is already cloned!");
        #[cfg(debug_assertions)]
        { println!("Official compatibility repository is already cloned!"); }
        let r = update_repositories(&repo_path);
        match r {
            Ok(_) => {}
            Err(e) => { show_dialog(app, "warning", "TwintailLauncher", format!("Failed to fetch update(s) for compatibility repository! {}", e.to_string()).as_str(), None); }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn setup_compatibility_repository(_app: &LauncherContext, _path: &PathBuf) {}

// === MANIFESTS ===

pub fn load_manifests(app: &LauncherContext) {
        let data_path = resolve_app_data_dir(app);
        let manifets_path = data_path.join("manifests");

        if !manifets_path.exists() {
            fs::create_dir_all(&manifets_path).unwrap();
        } else {
            for d in fs::read_dir(&manifets_path).unwrap() {
                let p = d.unwrap().path();

                if p.is_dir() {
                    for pp in fs::read_dir(p).unwrap() {
                        let p = pp.unwrap().path();
                        log::debug!("Loading manifests from: {}", p.display());
                        #[cfg(debug_assertions)]
                        { println!("Loading manifests from: {}", p.display()); }
                        let repo_manifest = p.join("repository.json");

                        if repo_manifest.exists() {
                            let rm = fs::File::open(&repo_manifest).unwrap();
                            let reader = BufReader::new(rm);
                            let rma: RepositoryManifest = serde_json::from_reader(reader).unwrap();
                            let user = p.parent().and_then(|parent| parent.components().last()).and_then(|component| component.as_os_str().to_str()).unwrap_or_default().to_string();
                            let repo_name = p.components().last().and_then(|component| component.as_os_str().to_str()).unwrap_or_default().to_string();
                            let github_id = format!("{user}/{repo_name}");
                            let mut loaded_for_repo = Vec::<(String,String)>::new();

                            let ml = app.state::<ManifestLoaders>().clone();

                            let mut tmp = ml.game.0.write().unwrap();
                            #[cfg(target_os = "linux")]
                            let mut tmp1 = ml.runner.0.write().unwrap();

                            for m in rma.manifests {
                                let mp = p.join(&m.as_str());
                                if mp.exists() {
                                    let manifest_data = match read_manifest_data(&mp) { Some(data) => data, None => { continue; } };

                                    match manifest_data {
                                        ManifestData::Game(mi) => {
                                            tmp.insert(m.clone(), mi.clone());
                                            loaded_for_repo.push((m.clone(), mi.display_name.clone()));
                                            log::debug!("Loaded game manifest {}", m.as_str());
                                            #[cfg(debug_assertions)]
                                            { println!("Loaded game manifest {}", m.as_str()); }
                                        }
                                        #[cfg(target_os = "linux")]
                                        ManifestData::Runner(ri) => {
                                            tmp1.insert(m.clone(), ri.clone());
                                            loaded_for_repo.push((m.clone(), ri.display_name.clone()));
                                            log::debug!("Loaded compatibility manifest {}", m.as_str());
                                            #[cfg(debug_assertions)]
                                            { println!("Loaded compatibility manifest {}", m.as_str()); }
                                        }
                                        #[cfg(target_os = "windows")]
                                        ManifestData::Runner(_) => {}
                                    }
                                } else {
                                    // Delete manifests that no longer exist
                                    let dbm = get_manifest_info_by_filename(&app, m.clone());
                                    if dbm.is_some() {
                                        let ml = dbm.unwrap();
                                        #[cfg(target_os = "linux")]
                                        {
                                            let dbr = crate::utils::db_manager::get_repository_info_by_id(&app, ml.repository_id.clone());
                                            if dbr.is_some() {
                                                let dbrr = dbr.unwrap();
                                                if dbrr.github_id.contains("runner-manifests") {
                                                    let installs = get_installs(&app);
                                                    if installs.is_some() {
                                                        let install = installs.unwrap();
                                                        // Fallback installs that use deprecated runner
                                                        for i in install {
                                                            let ir = runner_from_runner_version(i.runner_version.clone()).unwrap();
                                                            if ir == m {
                                                                let file = fs::File::open(p.join("proton_cachyos.json")).unwrap();
                                                                let reader = BufReader::new(file);
                                                                let manifest_data = serde_json::from_reader(reader).unwrap();
                                                                match manifest_data {
                                                                    ManifestData::Game(_mi) => {}
                                                                    #[cfg(target_os = "linux")]
                                                                    ManifestData::Runner(ri) => {
                                                                        let first = ri.versions.first().unwrap();
                                                                        let np = i.runner_path.replace(i.runner_version.as_str(), first.version.as_str());
                                                                        let pp = Path::new(&np).to_path_buf();
                                                                        let installedr = get_installed_runner_info_by_version(&app, first.version.clone());
                                                                        if installedr.is_none() { create_installed_runner(&app, first.version.clone(), true, np.clone()).unwrap(); } else { update_installed_runner_is_installed_by_version(&app, first.version.clone(), true); }
                                                                        let mut dl_url = first.url.clone();
                                                                        if let Some(ref urls) = first.urls { #[cfg(target_arch = "x86_64")] { dl_url = urls.x86_64.clone(); } #[cfg(target_arch = "aarch64")] { dl_url = if urls.aarch64.is_empty() { first.url.clone() } else { urls.aarch64.clone() }; } }
                                                                        if !pp.exists() {
                                                                            fs::create_dir_all(&pp).unwrap();
                                                                            run_async_command(async { fischl::compat::download_runner(dl_url.clone(), pp.to_str().unwrap().to_string(),true, move |_current, _total, _net, _disk| {}, move |_current, _total| {}).await });
                                                                        } else {
                                                                            run_async_command(async { fischl::compat::download_runner(dl_url, pp.to_str().unwrap().to_string(),true, move |_current, _total, _net, _disk| {}, move |_current, _total| {}).await });
                                                                        }
                                                                        update_install_runner_location_by_id(&app, i.id.clone(), np.clone());
                                                                        update_install_runner_version_by_id(&app, i.id, first.version.clone());
                                                                    }
                                                                    #[cfg(target_os = "windows")]
                                                                    ManifestData::Runner(_) => {}
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        delete_manifest_by_id(app, ml.id).unwrap();
                                    } // cleanup end
                                }
                            }
                            sync_repo_manifest_rows(app, github_id.as_str(), &loaded_for_repo);
                            drop(tmp);
                            #[cfg(target_os = "linux")]
                            drop(tmp1);
                        } else {
                            log::debug!("Failed to load manifests from {}! Not a valid KeqingLauncher repository?", p.display());
                            #[cfg(debug_assertions)]
                            { println!("Failed to load manifests from {}! Not a valid KeqingLauncher repository?", p.display()); }
                        }
                    }
                }
            }
        }
        cleanup_unloaded_manifests(app);
    }

fn cleanup_unloaded_manifests(app: &LauncherContext) {
    let game_loader = app.state::<ManifestLoaders>().game.0.read().unwrap().clone();
    #[cfg(target_os = "linux")]
    let runner_loader = app.state::<ManifestLoaders>().runner.0.read().unwrap().clone();

    if let Some(repos) = get_repositories(app) {
        for repo in repos {
            if let Some(manifests) = get_manifests_by_repository_id(app, repo.id) {
                for m in manifests {
                    let loaded = game_loader.contains_key(&m.filename);
                    #[cfg(target_os = "linux")]
                    let loaded = loaded || runner_loader.contains_key(&m.filename);
                    if !loaded && m.enabled { update_manifest_enabled_by_id(app, m.id, false); }
                }
            }
        }
    }
}

pub fn get_manifests(app: &LauncherContext) -> LinkedHashMap<String, GameManifest> {
    app.state::<ManifestLoaders>().game.0.read().unwrap().clone()
}

pub fn get_manifest(app: &LauncherContext, filename: String) -> Option<GameManifest> {
    let loader = app.state::<ManifestLoaders>().game.0.read().unwrap().clone();

    if loader.contains_key(&filename) {
        let content = loader.get(&filename).unwrap();
        Some(content.clone())
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
pub fn get_compatibilities(app: &LauncherContext) -> LinkedHashMap<String, RunnerManifest> {
    app.state::<ManifestLoaders>().runner.0.read().unwrap().clone()
}

#[cfg(target_os = "linux")]
pub fn get_compatibility(app: &LauncherContext, filename: &String) -> Option<RunnerManifest> {
    let loader = app.state::<ManifestLoaders>().runner.0.read().unwrap().clone();

    if loader.contains_key(filename) {
        let content = loader.get(filename).unwrap();
        Some(content.clone())
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
#[derive(Default)]
pub struct RunnerLoader(pub RwLock<LinkedHashMap<String, RunnerManifest>>);

#[derive(Default)]
pub struct ManifestLoader(pub RwLock<LinkedHashMap<String, GameManifest>>);

pub struct ManifestLoaders {
    pub game: ManifestLoader,
    #[cfg(target_os = "linux")]
    pub runner: RunnerLoader,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(untagged)]
enum ManifestData {
    Game(GameManifest),
    Runner(RunnerManifest)
}


