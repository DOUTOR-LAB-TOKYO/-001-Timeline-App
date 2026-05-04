/// ENTTEC USB DMX Pro protocol
///
/// Packet format: 0x7E [label] [len_lo] [len_hi] [data...] 0xE7
/// Label 6 = Send DMX Packet Request
/// Data  = [start_code=0x00] + [512 channel values]
///
/// Baud rate is always 57600 for ENTTEC DMX Pro.

use serialport::SerialPort;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const ENTTEC_BAUD: u32 = 57600;

const START_VAL: u8 = 0x7E;
const END_VAL:   u8 = 0xE7;
const LABEL_DMX: u8 = 6;
const DMX_CHANNELS: usize = 512;

pub struct DmxState {
    pub port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
}

impl DmxState {
    pub fn new() -> Self {
        Self { port: Arc::new(Mutex::new(None)) }
    }
}

#[tauri::command]
pub fn open_dmx_port(
    state: tauri::State<'_, DmxState>,
    port_name: String,
) -> Result<(), String> {
    let mut guard = state.port.lock().unwrap();
    *guard = None;
    let port = serialport::new(&port_name, ENTTEC_BAUD)
        .timeout(Duration::from_millis(10))
        .open()
        .map_err(|e| e.to_string())?;
    *guard = Some(port);
    Ok(())
}

#[tauri::command]
pub fn close_dmx_port(state: tauri::State<'_, DmxState>) {
    let mut guard = state.port.lock().unwrap();
    *guard = None;
}

/// Build an ENTTEC DMX Pro packet for a 512-channel universe.
fn build_packet(universe: &[u8; DMX_CHANNELS]) -> Vec<u8> {
    let data_len = DMX_CHANNELS + 1; // +1 for start code
    let mut pkt = Vec::with_capacity(6 + data_len);
    pkt.push(START_VAL);
    pkt.push(LABEL_DMX);
    pkt.push((data_len & 0xFF) as u8);
    pkt.push(((data_len >> 8) & 0xFF) as u8);
    pkt.push(0x00); // DMX start code
    pkt.extend_from_slice(universe);
    pkt.push(END_VAL);
    pkt
}

/// Send a full 512-channel universe. Called from the engine thread via Arc clone.
pub fn send_dmx(
    port_arc: &Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    universe: &[u8; DMX_CHANNELS],
) {
    if let Ok(mut guard) = port_arc.try_lock() {
        if let Some(port) = guard.as_mut() {
            let pkt = build_packet(universe);
            let _ = port.write_all(&pkt);
        }
    }
}
