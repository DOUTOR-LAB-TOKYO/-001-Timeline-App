use crate::interpolation::interpolate;
use crate::osc::send_osc_f32;
use crate::types::{FrameUpdatePayload, Project};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub struct EngineState {
    pub inner: Arc<Mutex<EngineInner>>,
}

pub struct EngineInner {
    pub is_playing: bool,
    pub current_frame: i64,
    pub stop_tx: Option<std::sync::mpsc::SyncSender<()>>,
}

impl EngineState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(EngineInner {
                is_playing: false,
                current_frame: 0,
                stop_tx: None,
            })),
        }
    }
}

pub fn start(state: &EngineState, app: AppHandle, project: Project, start_frame: i64) {
    // Stop any existing playback
    stop(state);

    let (tx, rx) = std::sync::mpsc::sync_channel::<()>(1);

    {
        let mut inner = state.inner.lock().unwrap();
        inner.is_playing = true;
        inner.current_frame = start_frame;
        inner.stop_tx = Some(tx);
    }

    let inner_arc = Arc::clone(&state.inner);

    std::thread::spawn(move || {
        let fps = project.fps;
        let duration_frames = project.duration_frames;
        let frame_duration = Duration::from_secs_f64(1.0 / fps);

        let start_instant = Instant::now();
        let mut frame_offset: i64 = 0;

        loop {
            // Check stop signal
            if rx.try_recv().is_ok() {
                break;
            }

            frame_offset += 1;
            let current_frame = start_frame + frame_offset;

            // End of timeline
            if current_frame > duration_frames {
                let mut inner = inner_arc.lock().unwrap();
                inner.is_playing = false;
                inner.current_frame = duration_frames;
                let _ = app.emit("playback_stopped", ());
                break;
            }

            // Compute interpolated values for all enabled, non-muted sequences
            let mut values: HashMap<String, f64> = HashMap::new();
            for seq in &project.sequences {
                if !seq.enabled || seq.muted || seq.keyframes.is_empty() {
                    continue;
                }
                let raw = interpolate(&seq.keyframes, current_frame);
                let val = if seq.value_type == "int" { raw.round() } else { raw };
                values.insert(seq.id.clone(), val);
            }

            // Emit frame update to frontend
            let _ = app.emit(
                "frame_update",
                FrameUpdatePayload {
                    frame: current_frame,
                    values: values.clone(),
                },
            );

            // Send OSC
            if project.osc_config.enabled {
                for seq in &project.sequences {
                    if !seq.enabled || seq.muted {
                        continue;
                    }
                    if let Some(&val) = values.get(&seq.id) {
                        send_osc_f32(
                            &project.osc_config.ip,
                            project.osc_config.port,
                            &seq.osc_address,
                            val as f32,
                        );
                    }
                }
            }

            // Update state
            {
                let mut inner = inner_arc.lock().unwrap();
                inner.current_frame = current_frame;
            }

            // Precise timing: sleep until the next frame's target time
            let target = start_instant + frame_duration.mul_f64(frame_offset as f64);
            let now = Instant::now();
            if target > now {
                let remaining = target - now;
                // Coarse sleep for most of the wait, spin for the last bit
                if remaining > Duration::from_micros(200) {
                    spin_sleep::sleep(remaining - Duration::from_micros(100));
                }
                // Spin the rest
                while Instant::now() < target {
                    std::hint::spin_loop();
                }
            }
        }
    });
}

pub fn stop(state: &EngineState) {
    let mut inner = state.inner.lock().unwrap();
    if let Some(tx) = inner.stop_tx.take() {
        let _ = tx.try_send(());
    }
    inner.is_playing = false;
}

pub fn get_current_frame(state: &EngineState) -> i64 {
    state.inner.lock().unwrap().current_frame
}
