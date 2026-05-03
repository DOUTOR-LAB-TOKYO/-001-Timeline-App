mod engine;
mod interpolation;
mod osc;
mod types;

use engine::EngineState;
use tauri::State;
use types::Project;

// ─── Tauri Commands ──────────────────────────────────────────────────

#[tauri::command]
fn start_playback(
    state: State<'_, EngineState>,
    app: tauri::AppHandle,
    project_json: String,
    start_frame: i64,
) -> Result<(), String> {
    let project: Project =
        serde_json::from_str(&project_json).map_err(|e| e.to_string())?;
    engine::start(&state, app, project, start_frame);
    Ok(())
}

#[tauri::command]
fn stop_playback(state: State<'_, EngineState>) -> Result<(), String> {
    engine::stop(&state);
    Ok(())
}

#[tauri::command]
fn get_current_frame(state: State<'_, EngineState>) -> i64 {
    engine::get_current_frame(&state)
}

#[tauri::command]
fn load_project(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_csv(path: String, project_json: String) -> Result<(), String> {
    let project: Project =
        serde_json::from_str(&project_json).map_err(|e| e.to_string())?;

    let mut out = String::new();

    // Header
    out.push_str("frame");
    for seq in &project.sequences {
        out.push(',');
        out.push_str(&seq.name.replace(',', "_"));
    }
    out.push('\n');

    // Rows
    for frame in 0..=project.duration_frames {
        out.push_str(&frame.to_string());
        for seq in &project.sequences {
            out.push(',');
            if seq.enabled && !seq.muted && !seq.keyframes.is_empty() {
                let val = interpolation::interpolate(&seq.keyframes, frame);
                out.push_str(&format!("{:.6}", val));
            } else {
                out.push_str(&format!("{:.6}", seq.default_value));
            }
        }
        out.push('\n');
    }

    std::fs::write(&path, out).map_err(|e| e.to_string())
}

// ─── Entry point ─────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EngineState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            start_playback,
            stop_playback,
            get_current_frame,
            load_project,
            save_project,
            export_csv,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
