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

#[allow(dead_code)]
pub fn send_osc_string(ip: &str, port: u16, address: &str, value: &str) {
    let msg = OscPacket::Message(OscMessage {
        addr: address.to_string(),
        args: vec![OscType::String(value.to_string())],
    });
    let bytes = match encoder::encode(&msg) {
        Ok(b) => b,
        Err(_) => return,
    };
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.send_to(&bytes, format!("{ip}:{port}"));
    }
}

#[allow(dead_code)]
pub fn send_osc_no_args(ip: &str, port: u16, address: &str) {
    let msg = OscPacket::Message(OscMessage {
        addr: address.to_string(),
        args: vec![],
    });
    let bytes = match encoder::encode(&msg) {
        Ok(b) => b,
        Err(_) => return,
    };
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.send_to(&bytes, format!("{ip}:{port}"));
    }
}

#[allow(dead_code)]
pub fn send_osc_two_strings(ip: &str, port: u16, address: &str, a: &str, b: &str) {
    let msg = OscPacket::Message(OscMessage {
        addr: address.to_string(),
        args: vec![OscType::String(a.to_string()), OscType::String(b.to_string())],
    });
    let bytes = match encoder::encode(&msg) {
        Ok(b) => b,
        Err(_) => return,
    };
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.send_to(&bytes, format!("{ip}:{port}"));
    }
}

pub fn send_osc_i32(ip: &str, port: u16, address: &str, value: i32) {
    let msg = OscPacket::Message(OscMessage {
        addr: address.to_string(),
        args: vec![OscType::Int(value)],
    });
    let bytes = match encoder::encode(&msg) {
        Ok(b) => b,
        Err(_) => return,
    };
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.send_to(&bytes, format!("{ip}:{port}"));
    }
}

pub fn send_osc_flag(ip: &str, port: u16, address: &str, value: f32, text: &str) {
    let msg = OscPacket::Message(OscMessage {
        addr: address.to_string(),
        args: vec![OscType::Float(value), OscType::String(text.to_string())],
    });
    let bytes = match encoder::encode(&msg) {
        Ok(b) => b,
        Err(_) => return,
    };
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.send_to(&bytes, format!("{ip}:{port}"));
    }
}
