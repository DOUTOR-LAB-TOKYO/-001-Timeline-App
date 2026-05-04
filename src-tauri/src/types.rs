use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    pub frame: i64,
    pub value: f64,
    pub interpolation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cp1x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cp1y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cp2x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cp2y: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sequence {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub muted: bool,
    pub solo: bool,
    pub locked: bool,
    pub color: String,
    #[serde(rename = "oscAddress")]
    pub osc_address: String,
    #[serde(rename = "dmxChannel", default)]
    pub dmx_channel: u16, // 0 = disabled, 1-512 = DMX channel
    #[serde(rename = "valueType", default = "default_value_type")]
    pub value_type: String,
    pub min: f64,
    pub max: f64,
    #[serde(rename = "defaultValue")]
    pub default_value: f64,
    pub keyframes: Vec<Keyframe>,
}

fn default_value_type() -> String {
    "float".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OscConfig {
    pub ip: String,
    pub port: u16,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub port: String,
    #[serde(rename = "baudRate")]
    pub baud_rate: u32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmxConfig {
    pub port: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    #[serde(rename = "projectName")]
    pub project_name: String,
    pub fps: f64,
    #[serde(rename = "durationFrames")]
    pub duration_frames: i64,
    #[serde(rename = "audioFile")]
    pub audio_file: Option<String>,
    #[serde(rename = "videoFile")]
    pub video_file: Option<String>,
    pub sequences: Vec<Sequence>,
    #[serde(rename = "oscConfig")]
    pub osc_config: OscConfig,
    #[serde(rename = "serialConfig")]
    pub serial_config: SerialConfig,
    #[serde(rename = "dmxConfig")]
    pub dmx_config: DmxConfig,
}

#[derive(Debug, Clone, Serialize)]
pub struct FrameUpdatePayload {
    pub frame: i64,
    pub values: std::collections::HashMap<String, f64>,
}
