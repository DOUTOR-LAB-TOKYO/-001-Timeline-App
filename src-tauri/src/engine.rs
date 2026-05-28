use crate::dmx::send_dmx;
use crate::interpolation::{interpolate, interpolate_color};
use crate::osc::{send_osc_f32, send_osc_flag, send_osc_i32};
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
    pub worker: Option<std::thread::JoinHandle<()>>,
    pub loop_enabled: bool,
    pub loop_in: i64,
    pub loop_out: i64,
}

impl EngineState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(EngineInner {
                is_playing: false,
                current_frame: 0,
                stop_tx: None,
                worker: None,
                loop_enabled: false,
                loop_in: 0,
                loop_out: 0,
            })),
        }
    }
}

pub fn update_loop(state: &EngineState, loop_enabled: bool, loop_in: i64, loop_out: i64) {
    let mut inner = state.inner.lock().unwrap();
    inner.loop_enabled = loop_enabled;
    inner.loop_in = loop_in;
    inner.loop_out = loop_out;
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
        inner.loop_enabled = loop_enabled;
        inner.loop_in = loop_in;
        inner.loop_out = loop_out;
    }

    let inner_arc = Arc::clone(&state.inner);

    let worker = std::thread::spawn(move || {
        let fps = project.fps;
        let duration_frames = project.duration_frames;
        let frame_duration = Duration::from_secs_f64(1.0 / fps);

        // DEBUG: dump received flag sequences once
        for seq in &project.sequences {
            if seq.kind == "flag" {
                eprintln!(
                    "[eevee] flag seq id={} name={} addr={} enabled={} muted={} flags={}",
                    seq.id, seq.name, seq.osc_address, seq.enabled, seq.muted, seq.flags.len()
                );
                for f in &seq.flags {
                    eprintln!("  flag id={} frame={} dur={} text=\"{}\"", f.id, f.frame, f.duration, f.text);
                }
            }
        }
        eprintln!(
            "[eevee] osc enabled={} ip={} port={}",
            project.osc_config.enabled, project.osc_config.ip, project.osc_config.port
        );

        let mut start_instant_ref = Instant::now();
        let mut start_frame_ref = start_frame;
        let mut frame_offset: i64 = 0;
        let mut prev_frame: i64 = start_frame - 1;

        loop {
            if rx.try_recv().is_ok() {
                break;
            }

            let current_frame = start_frame_ref + frame_offset;

            // Loop or end-of-timeline — read live loop config so UI changes apply mid-playback
            let (cur_loop_enabled, cur_loop_in, cur_loop_out) = {
                let inner = inner_arc.lock().unwrap();
                (inner.loop_enabled, inner.loop_in, inner.loop_out)
            };
            let end = if cur_loop_enabled { cur_loop_out.min(duration_frames) } else { duration_frames };
            if current_frame > end {
                if cur_loop_enabled {
                    // Restart from loop_in
                    frame_offset = 0;
                    start_frame_ref = cur_loop_in;
                    start_instant_ref = Instant::now();
                    prev_frame = cur_loop_in - 1;
                    let _ = app.emit("loop_restart", cur_loop_in);
                    continue;
                } else {
                    let mut inner = inner_arc.lock().unwrap();
                    inner.is_playing = false;
                    inner.current_frame = duration_frames;
                    inner.stop_tx = None;
                    let _ = app.emit("playback_stopped", ());
                    break;
                }
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

            let mut values: HashMap<String, f64> = HashMap::new();
            for seq in &project.sequences {
                if seq.kind == "flag" || seq.kind == "color" || !seq.enabled || seq.muted || seq.keyframes.is_empty() {
                    continue;
                }
                let raw = interpolate(&seq.keyframes, current_frame);
                let val = if seq.value_type == "int" { raw.round() } else { raw };
                values.insert(seq.id.clone(), val);
            }

            // ── Color sequences: interpolate RGBA, send via OSC sub-addrs / DMX 4 channels / Serial ──
            let mut color_values: HashMap<String, (f64, f64, f64, f64)> = HashMap::new();
            for seq in &project.sequences {
                if seq.kind != "color" || !seq.enabled || seq.muted || seq.color_keyframes.is_empty() {
                    continue;
                }
                let c = interpolate_color(&seq.color_keyframes, current_frame);
                color_values.insert(seq.id.clone(), c);
                let as_int = seq.color_format == "int";
                if project.osc_config.enabled {
                    let suffixes = ["/r", "/g", "/b", "/a"];
                    let chans = [c.0, c.1, c.2, c.3];
                    for (suf, v) in suffixes.iter().zip(chans.iter()) {
                        let addr = format!("{}{}", seq.osc_address, suf);
                        if as_int {
                            let iv = (v.clamp(0.0, 1.0) * 255.0).round() as i32;
                            send_osc_i32(&project.osc_config.ip, project.osc_config.port, &addr, iv);
                        } else {
                            send_osc_f32(&project.osc_config.ip, project.osc_config.port, &addr, *v as f32);
                        }
                    }
                }
                if project.serial_config.enabled {
                    if as_int {
                        send_serial(&serial_port, &format!(
                            "{}:{},{},{},{}\n",
                            seq.osc_address,
                            (c.0.clamp(0.0, 1.0) * 255.0).round() as i32,
                            (c.1.clamp(0.0, 1.0) * 255.0).round() as i32,
                            (c.2.clamp(0.0, 1.0) * 255.0).round() as i32,
                            (c.3.clamp(0.0, 1.0) * 255.0).round() as i32,
                        ));
                    } else {
                        send_serial(&serial_port, &format!(
                            "{}:{:.4},{:.4},{:.4},{:.4}\n",
                            seq.osc_address, c.0, c.1, c.2, c.3
                        ));
                    }
                }
            }

            // ── Flag transitions: detect crossings between prev_frame and current_frame ──
            for seq in &project.sequences {
                if seq.kind != "flag" || !seq.enabled || seq.muted {
                    continue;
                }
                for f in &seq.flags {
                    let enter = f.frame;
                    let exit = f.frame + f.duration;
                    let crossed_enter = prev_frame < enter && enter <= current_frame;
                    let crossed_exit = f.duration > 0 && prev_frame < exit && exit <= current_frame;
                    if !crossed_enter && !crossed_exit {
                        continue;
                    }
                    eprintln!(
                        "[eevee] flag fired: addr={} text=\"{}\" enter={} exit={} prev={} cur={}",
                        seq.osc_address, f.text, crossed_enter, crossed_exit, prev_frame, current_frame
                    );
                    if project.osc_config.enabled {
                        if f.duration > 0 {
                            if crossed_enter {
                                send_osc_flag(
                                    &project.osc_config.ip,
                                    project.osc_config.port,
                                    &seq.osc_address,
                                    1.0,
                                    &f.text,
                                );
                            }
                            if crossed_exit {
                                send_osc_flag(
                                    &project.osc_config.ip,
                                    project.osc_config.port,
                                    &seq.osc_address,
                                    0.0,
                                    &f.text,
                                );
                            }
                        } else if crossed_enter {
                            // Point flag: emit a 1.0 pulse, then immediately a 0.0 to allow re-trigger
                            send_osc_flag(
                                &project.osc_config.ip,
                                project.osc_config.port,
                                &seq.osc_address,
                                1.0,
                                &f.text,
                            );
                            send_osc_flag(
                                &project.osc_config.ip,
                                project.osc_config.port,
                                &seq.osc_address,
                                0.0,
                                &f.text,
                            );
                        }
                    }
                    if project.serial_config.enabled {
                        if f.duration > 0 {
                            if crossed_enter {
                                send_serial(&serial_port, &format!("{}:enter,{}\n", seq.osc_address, f.text));
                            }
                            if crossed_exit {
                                send_serial(&serial_port, &format!("{}:exit,{}\n", seq.osc_address, f.text));
                            }
                        } else if crossed_enter {
                            send_serial(&serial_port, &format!("{}:trigger,{}\n", seq.osc_address, f.text));
                        }
                    }
                }
            }
            prev_frame = current_frame;

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
                    if seq.kind == "color" {
                        if let Some(&(r, g, b, a)) = color_values.get(&seq.id) {
                            let bytes = [r, g, b, a];
                            for (i, v) in bytes.iter().enumerate() {
                                let c = ch + i;
                                if c < 512 {
                                    universe[c] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                                }
                            }
                        }
                    } else if ch < 512 {
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

            frame_offset += 1;
        }
    });

    let mut inner = state.inner.lock().unwrap();
    inner.worker = Some(worker);
}

pub fn stop(state: &EngineState) {
    let worker = {
        let mut inner = state.inner.lock().unwrap();
        if let Some(tx) = inner.stop_tx.take() {
            let _ = tx.try_send(());
        }
        inner.is_playing = false;
        inner.worker.take()
    };
    if let Some(worker) = worker {
        let _ = worker.join();
    }
}

pub fn get_current_frame(state: &EngineState) -> i64 {
    state.inner.lock().unwrap().current_frame
}
