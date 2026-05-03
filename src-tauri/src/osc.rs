use rosc::{OscMessage, OscPacket, OscType, encoder};
use std::net::UdpSocket;

pub fn send_osc_f32(ip: &str, port: u16, address: &str, value: f32) {
    let msg = OscPacket::Message(OscMessage {
        addr: address.to_string(),
        args: vec![OscType::Float(value)],
    });

    let bytes = match encoder::encode(&msg) {
        Ok(b) => b,
        Err(_) => return,
    };

    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.send_to(&bytes, format!("{ip}:{port}"));
    }
}
