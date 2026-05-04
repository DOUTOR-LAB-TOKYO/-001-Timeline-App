use crate::dmx::send_dmx;
use crate::interpolation::interpolate;
use crate::osc::send_osc_f32;
use crate::serial::send_serial;
use crate::types::{FrameUpdatePayload, Project};
use serialport::SerialPort;
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

pub fn start(
    state: &EngineState,
    app: AppHandle,
    project: Project,
    start_frame: i64,
    loop_enabled: bool,
    loop_in: i64,
    loop_out: i64,
    serial_port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    dmx_port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
) {
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

        let mut start_instant_ref = Instant::now();
        let mut start_frame_ref = start_frame;
        let mut frame_offset: i64 = 0;

        loop {
            if rx.try_recv().is_ok() {
                break;
            }

            frame_offset += 1;
            let current_frame = start_frame_ref + frame_offset;

            // Loop or end-of-timeline
            let end = if loop_enabled { loop_out.min(duration_frames) } else { duration_frames };
            if current_frame > end {
                if loop_enabled {
                    // Restart from loop_in
                    frame_offset = 0;
                    start_frame_ref = loop_in;
                    start_instant_ref = Instant::now();
                    continue;
                } else {
                    let mut inner = inner_arc.lock().unwrap();
                    inner.is_playing = false;
                    inner.current_frame = duration_frames;
                    let _ = app.emit("playback_stopped", ());
                    break;
                }
            }

            let mut values: HashMap<String, f64> = HashMap::new();
            for seq in &project.sequences {
                if !seq.enabled || seq.muted || seq.keyframes.is_empty() {
                    continue;
                }
                let raw = interpolate(&seq.keyframes, current_frame);
                let val = if seq.value_type == "int" { raw.round() } else { raw };
                values.insert(seq.id.clone(), val);
            }

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

            // Send DMX (ENTTEC Pro): build 512-ch universe from dmxChannel assignments
            if project.dmx_config.enabled {
                let mut universe = [0u8; 512];
                for seq in &project.sequences {
                    if !seq.enabled || seq.muted || seq.dmx_channel == 0 {
                        continue;
                    }
                    let ch = (seq.dmx_channel as usize).saturating_sub(1); // 1-based → 0-based
                    if ch < 512 {
                        if let Some(&val) = values.get(&seq.id) {
                            let range = seq.max - seq.min;
                            let norm = if range.abs() > f64::EPSILON {
                                (val - seq.min) / range
                            } else { 0.0 };
                            universe[ch] = (norm.clamp(0.0, 1.0) * 255.0).round() as u8;
                        }
                    }
                }
                send_dmx(&dmx_port, &universe);
            }

            // Send Serial: "<address>:<value>\n" per sequence
            if project.serial_config.enabled {
                for seq in &project.sequences {
                    if !seq.enabled || seq.muted {
                        continue;
                    }
                    if let Some(&val) = values.get(&seq.id) {
                        let msg = if seq.value_type == "int" {
                            format!("{}:{}\n", seq.osc_address, val as i64)
                        } else {
                            format!("{}:{:.4}\n", seq.osc_address, val)
                        };
                        send_serial(&serial_port, &msg);
                    }
                }
            }

            {
                let mut inner = inner_arc.lock().unwrap();
                inner.current_frame = current_frame;
            }

            let target = start_instant_ref + frame_duration.mul_f64(frame_offset as f64);
            let now = Instant::now();
            if target > now {
                let remaining = target - now;
                if remaining > Duration::from_micros(200) {
                    spin_sleep::sleep(remaining - Duration::from_micros(100));
                }
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
