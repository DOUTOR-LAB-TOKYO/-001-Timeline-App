use serialport::SerialPort;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct SerialState {
    pub port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
}

impl SerialState {
    pub fn new() -> Self {
        Self {
            port: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
pub fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.port_name)
        .collect()
}

#[tauri::command]
pub fn open_serial_port(
    state: tauri::State<'_, SerialState>,
    port_name: String,
    baud_rate: u32,
) -> Result<(), String> {
    let mut guard = state.port.lock().unwrap();
    // Close existing connection first
    *guard = None;

    let port = serialport::new(&port_name, baud_rate)
        .timeout(Duration::from_millis(10))
        .open()
        .map_err(|e| e.to_string())?;

    *guard = Some(port);
    Ok(())
}

#[tauri::command]
pub fn close_serial_port(state: tauri::State<'_, SerialState>) {
    let mut guard = state.port.lock().unwrap();
    *guard = None;
}

/// Send a formatted message. Called from the engine thread via Arc clone.
pub fn send_serial(port_arc: &Arc<Mutex<Option<Box<dyn SerialPort>>>>, msg: &str) {
    if let Ok(mut guard) = port_arc.try_lock() {
        if let Some(port) = guard.as_mut() {
            let _ = port.write_all(msg.as_bytes());
        }
    }
}
