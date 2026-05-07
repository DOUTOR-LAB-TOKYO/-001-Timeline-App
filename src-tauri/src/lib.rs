mod dmx;
mod engine;
mod interpolation;
mod osc;
mod serial;
mod types;

use dmx::DmxState;
use engine::EngineState;
use serial::SerialState;
use tauri::State;
use types::Project;

// ─── Tauri Commands ──────────────────────────────────────────────────

#[tauri::command]
fn start_playback(
    state: State<'_, EngineState>,
    serial_state: State<'_, SerialState>,
    dmx_state: State<'_, DmxState>,
    app: tauri::AppHandle,
    project_json: String,
    start_frame: i64,
    loop_enabled: bool,
    loop_in: i64,
    loop_out: i64,
) -> Result<(), String> {
    let project: Project =
        serde_json::from_str(&project_json).map_err(|e| e.to_string())?;
    let serial_port = std::sync::Arc::clone(&serial_state.port);
    let dmx_port = std::sync::Arc::clone(&dmx_state.port);
    engine::start(&state, app, project, start_frame, loop_enabled, loop_in, loop_out, serial_port, dmx_port);
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
    let csv_cell = |s: &str| -> String {
        let formula_like = matches!(
            s.trim_start_matches(|c| c == ' ' || c == '\t').chars().next(),
            Some('=' | '+' | '-' | '@')
        );
        let mut value = String::new();
        if formula_like {
            value.push('\'');
        }
        value.push_str(s);
        let needs_quotes = formula_like
            || value.contains(',')
            || value.contains('"')
            || value.contains('\n')
            || value.contains('\r');
        if needs_quotes {
            format!("\"{}\"", value.replace('"', "\"\""))
        } else {
            value
        }
    };

    // Header
    out.push_str("frame");
    for seq in &project.sequences {
        match seq.kind.as_str() {
            "color" => {
                for suffix in ["_r", "_g", "_b", "_a"] {
                    out.push(',');
                    out.push_str(&csv_cell(&format!("{}{}", seq.name, suffix)));
                }
            }
            "flag" => {
                for suffix in ["_state", "_text"] {
                    out.push(',');
                    out.push_str(&csv_cell(&format!("{}{}", seq.name, suffix)));
                }
            }
            _ => {
                out.push(',');
                out.push_str(&csv_cell(&seq.name));
            }
        }
    }
    out.push('\n');

    for frame in 0..=project.duration_frames {
        out.push_str(&frame.to_string());
        for seq in &project.sequences {
            match seq.kind.as_str() {
                "color" => {
                    let (r, g, b, a) = if seq.enabled && !seq.muted && !seq.color_keyframes.is_empty() {
                        interpolation::interpolate_color(&seq.color_keyframes, frame)
                    } else {
                        (0.0, 0.0, 0.0, 0.0)
                    };
                    if seq.color_format == "int" {
                        let cv = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as i32;
                        out.push_str(&format!(",{},{},{},{}", cv(r), cv(g), cv(b), cv(a)));
                    } else {
                        out.push_str(&format!(",{:.6},{:.6},{:.6},{:.6}", r, g, b, a));
                    }
                }
                "flag" => {
                    // Find the flag whose [frame, frame+duration] (or exact frame for point) contains current frame.
                    let mut state = "";
                    let mut text = String::new();
                    if seq.enabled && !seq.muted {
                        for f in &seq.flags {
                            if f.duration <= 0 {
                                if f.frame == frame {
                                    state = "trigger";
                                    text = f.text.clone();
                                    break;
                                }
                            } else if frame >= f.frame && frame < f.frame + f.duration {
                                state = "active";
                                text = f.text.clone();
                                break;
                            }
                        }
                    }
                    out.push(',');
                    out.push_str(&csv_cell(state));
                    out.push(',');
                    out.push_str(&csv_cell(&text));
                }
                _ => {
                    out.push(',');
                    if seq.enabled && !seq.muted && !seq.keyframes.is_empty() {
                        let val = interpolation::interpolate(&seq.keyframes, frame);
                        if seq.value_type == "int" {
                            out.push_str(&(val.round() as i64).to_string());
                        } else {
                            out.push_str(&format!("{:.6}", val));
                        }
                    } else if seq.value_type == "int" {
                        out.push_str(&(seq.default_value.round() as i64).to_string());
                    } else {
                        out.push_str(&format!("{:.6}", seq.default_value));
                    }
                }
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
        .manage(SerialState::new())
        .manage(DmxState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            start_playback,
            stop_playback,
            get_current_frame,
            load_project,
            save_project,
            export_csv,
            serial::list_serial_ports,
            serial::open_serial_port,
            serial::close_serial_port,
            dmx::open_dmx_port,
            dmx::close_dmx_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
