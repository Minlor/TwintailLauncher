use crate::runtime::LauncherContext;
use crate::utils::db_manager::{delete_repository_by_id, get_repositories, get_repository_info_by_id};
use crate::utils::repo_manager::clone_new_repository;
use crate::utils::resolve_app_data_dir;

pub fn list_repositories(app: LauncherContext) -> Option<String> {
    let repos = get_repositories(&app);

    if repos.is_some() {
        let repository = repos.unwrap();
        let stringified = serde_json::to_string(&repository).unwrap();
        Some(stringified)
    } else {
        None
    }
}

pub fn get_repository(app: LauncherContext, repository_id: String) -> Option<String> {
    let repo = get_repository_info_by_id(&app, repository_id);

    if repo.is_some() {
        let repository = repo.unwrap();
        let stringified = serde_json::to_string(&repository).unwrap();
        Some(stringified)
    } else {
        None
    }
}

pub fn add_repository(app: LauncherContext, url: String) -> Option<bool> {
    if url.is_empty() {
        None
    } else {
        let path = resolve_app_data_dir(&app).join("manifests");
        let rtn = clone_new_repository(&app, &path, url);

        if rtn.is_ok() {
            Some(rtn.unwrap())
        } else {
            None
        }
    }
}

pub fn remove_repository(app: LauncherContext, id: String) -> Option<bool> {
    if id.is_empty() {
        None
    } else {
        // TODO: Properly delete repository bullshit and disallow if installation with ANY manifest of a repo exists
        let rtn = delete_repository_by_id(&app, id);
        if rtn.is_ok() {
            Some(rtn.unwrap())
        } else {
            None
        }
    }
}


