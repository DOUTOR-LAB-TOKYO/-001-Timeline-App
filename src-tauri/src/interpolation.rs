use crate::types::{ColorKeyframe, Keyframe};

fn smoothstep(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn bezier_x(t: f64, p1x: f64, p2x: f64) -> f64 {
    let mt = 1.0 - t;
    3.0 * mt * mt * t * p1x + 3.0 * mt * t * t * p2x + t * t * t
}

fn bezier_y(t: f64, p1y: f64, p2y: f64) -> f64 {
    let mt = 1.0 - t;
    3.0 * mt * mt * t * p1y + 3.0 * mt * t * t * p2y + t * t * t
}

fn solve_bezier_t(x: f64, p1x: f64, p2x: f64) -> f64 {
    let (mut lo, mut hi) = (0.0_f64, 1.0_f64);
    for _ in 0..24 {
        let mid = (lo + hi) / 2.0;
        if bezier_x(mid, p1x, p2x) < x { lo = mid; } else { hi = mid; }
    }
    (lo + hi) / 2.0
}

pub fn interpolate(keyframes: &[Keyframe], frame: i64) -> f64 {
    if keyframes.is_empty() {
        return 0.0;
    }

    let mut sorted = keyframes.to_vec();
    sorted.sort_by_key(|k| k.frame);

    if frame <= sorted[0].frame {
        return sorted[0].value;
    }
    if frame >= sorted[sorted.len() - 1].frame {
        return sorted[sorted.len() - 1].value;
    }

    let mut prev = &sorted[0];
    let mut next = &sorted[1];
    for i in 0..sorted.len() - 1 {
        if frame >= sorted[i].frame && frame < sorted[i + 1].frame {
            prev = &sorted[i];
            next = &sorted[i + 1];
            break;
        }
    }

    let span = (next.frame - prev.frame) as f64;
    if span == 0.0 {
        return next.value;
    }
    let t = (frame - prev.frame) as f64 / span;

    match prev.interpolation.as_str() {
        "step" => prev.value,
        "linear" => prev.value + (next.value - prev.value) * t,
        "smooth" => prev.value + (next.value - prev.value) * smoothstep(t),
        "bezier" => {
            let p1x = prev.cp1x.unwrap_or(0.25);
            let p1y = prev.cp1y.unwrap_or(0.25);
            let p2x = prev.cp2x.unwrap_or(0.75);
            let p2y = prev.cp2y.unwrap_or(0.75);
            let bt = solve_bezier_t(t, p1x, p2x);
            let progress = bezier_y(bt, p1y, p2y);
            prev.value + (next.value - prev.value) * progress
        }
        _ => prev.value + (next.value - prev.value) * t,
    }
}

pub fn interpolate_color(kfs: &[ColorKeyframe], frame: i64) -> (f64, f64, f64, f64) {
    if kfs.is_empty() {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let mut sorted = kfs.to_vec();
    sorted.sort_by_key(|k| k.frame);
    if frame <= sorted[0].frame {
        let k = &sorted[0];
        return (k.r, k.g, k.b, k.a);
    }
    let last = &sorted[sorted.len() - 1];
    if frame >= last.frame {
        return (last.r, last.g, last.b, last.a);
    }
    let mut prev = &sorted[0];
    let mut next = &sorted[1];
    for i in 0..sorted.len() - 1 {
        if frame >= sorted[i].frame && frame < sorted[i + 1].frame {
            prev = &sorted[i];
            next = &sorted[i + 1];
            break;
        }
    }
    let span = (next.frame - prev.frame) as f64;
    if span == 0.0 {
        return (next.r, next.g, next.b, next.a);
    }
    let t = (frame - prev.frame) as f64 / span;
    let tt = match prev.interpolation.as_str() {
        "step" => return (prev.r, prev.g, prev.b, prev.a),
        "smooth" => smoothstep(t),
        _ => t,
    };
    (
        prev.r + (next.r - prev.r) * tt,
        prev.g + (next.g - prev.g) * tt,
        prev.b + (next.b - prev.b) * tt,
        prev.a + (next.a - prev.a) * tt,
    )
}
