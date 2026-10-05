use chrono::Utc;
#[cfg(target_os = "windows")]
use rdev::{grab, simulate, Event, EventType, Key};
#[cfg(not(target_os = "windows"))]
use rdev::{grab, Event, EventType, Key};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

mod key_codes;

#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};
#[cfg(target_os = "macos")]
use cocoa::foundation::{NSProcessInfo, NSString};
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum TriggerType {
    #[default]
    Hold,
    DoubleTap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct HotkeyCombo {
    keys: Vec<String>,
    #[serde(default, rename = "triggerType")]
    trigger_type: TriggerType,
}

impl HotkeyCombo {
    fn blocks_keys(&self) -> bool {
        // Modifier taps must remain visible to the OS so Control-click and
        // ordinary modifier chords still work. Hold shortcuts retain blocking.
        self.trigger_type == TriggerType::Hold
            || !self.keys.iter().all(|key| {
                matches!(
                    key.as_str(),
                    "ControlLeft"
                        | "ControlRight"
                        | "ShiftLeft"
                        | "ShiftRight"
                        | "MetaLeft"
                        | "MetaRight"
                        | "Alt"
                        | "AltGr"
                )
            })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "command")]
enum Command {
    #[serde(rename = "register_hotkeys")]
    RegisterHotkeys { hotkeys: Vec<HotkeyCombo> },
    #[serde(rename = "block")]
    Block { keys: Vec<String> },
    #[serde(rename = "unblock")]
    Unblock { key: String },
    #[serde(rename = "get_blocked")]
    GetBlocked,
}

#[derive(Default)]
struct ListenerState {
    registered_hotkeys: Vec<HotkeyCombo>,
    currently_pressed: Vec<String>,
    cmd_pressed: bool,
    ctrl_pressed: bool,
    copy_in_progress: bool,
    blocked_keys: HashSet<String>,
}

static LISTENER_STATE: OnceLock<Mutex<ListenerState>> = OnceLock::new();
static START_TIME: OnceLock<Instant> = OnceLock::new();
static TAP_INTERRUPTED: AtomicBool = AtomicBool::new(false);

fn listener_state() -> &'static Mutex<ListenerState> {
    LISTENER_STATE.get_or_init(|| Mutex::new(ListenerState::default()))
}

fn normalize_key_name(key: &str) -> String {
    if key == "Unknown(179)" {
        "Function".to_string()
    } else {
        key.to_string()
    }
}

fn normalize_key_list(keys: Vec<String>) -> Vec<String> {
    let mut unique = HashSet::new();
    let mut normalized = Vec::new();
    for key in keys {
        let normalized_key = normalize_key_name(&key);
        if unique.insert(normalized_key.clone()) {
            normalized.push(normalized_key);
        }
    }
    normalized
}

/// Prevents macOS App Nap from suspending this process.
/// Returns an activity token that must be retained for the entire process
/// lifetime. On non-macOS platforms, returns a dummy value.
#[cfg(target_os = "macos")]
fn prevent_app_nap() -> id {
    unsafe {
        let process_info = NSProcessInfo::processInfo(nil);
        let reason = NSString::alloc(nil)
            .init_str("Keyboard event monitoring requires continuous operation");

        // NSActivityOptions flags:
        // NSActivityUserInitiated = 0x00FFFFFF (includes all protective flags)
        // This prevents App Nap and idle system sleep
        let options: u64 = 0x00FFFFFF;

        let activity: id = msg_send![process_info, beginActivityWithOptions:options reason:reason];

        activity
    }
}

#[cfg(not(target_os = "macos"))]
fn prevent_app_nap() {
    // No-op on non-macOS platforms
}

fn main() {
    START_TIME.get_or_init(Instant::now);
    // Prevent macOS App Nap from suspending this process
    // Must retain this for the entire process lifetime
    #[allow(clippy::let_unit_value)]
    let _activity = prevent_app_nap();
    // Spawn a thread to read commands from stdin
    thread::spawn(|| {
        let stdin = io::stdin();
        for line in stdin.lock().lines().map_while(Result::ok) {
            match serde_json::from_str::<Command>(&line) {
                Ok(command) => handle_command(command),
                Err(e) => eprintln!("Error parsing command: {}", e),
            }
        }
    });

    // Spawn heartbeat thread
    thread::spawn(|| {
        let mut heartbeat_id = 0u64;
        loop {
            thread::sleep(Duration::from_secs(10)); // Send heartbeat every 10 seconds

            heartbeat_id += 1;
            let heartbeat_json = json!({
                "type": "heartbeat_ping",
                "id": heartbeat_id.to_string(),
                "timestamp": Utc::now().to_rfc3339()
            });

            println!("{}", heartbeat_json);
            io::stdout().flush().unwrap();
        }
    });

    // Start grabbing events
    if let Err(error) = grab(callback) {
        eprintln!("Error: {:?}", error);
    }
}

fn handle_command(command: Command) {
    match command {
        Command::RegisterHotkeys { hotkeys } => {
            if let Ok(mut state) = listener_state().lock() {
                state.registered_hotkeys = hotkeys
                    .into_iter()
                    .map(|hotkey| HotkeyCombo {
                        keys: normalize_key_list(hotkey.keys),
                        trigger_type: hotkey.trigger_type,
                    })
                    .collect();
            }
        }
        Command::Block { keys } => {
            if let Ok(mut state) = listener_state().lock() {
                for key in normalize_key_list(keys) {
                    state.blocked_keys.insert(key);
                }
            }
        }
        Command::Unblock { key } => {
            if let Ok(mut state) = listener_state().lock() {
                state.blocked_keys.remove(&normalize_key_name(&key));
            }
        }
        Command::GetBlocked => {
            let keys = if let Ok(state) = listener_state().lock() {
                state.blocked_keys.iter().cloned().collect::<Vec<_>>()
            } else {
                Vec::new()
            };

            let blocked_json = json!({
                "type": "blocked_keys",
                "keys": keys
            });
            println!("{}", blocked_json);
        }
    }
    let _ = io::stdout().flush();
}

// Check if current pressed keys match any registered hotkey
fn should_block(registered_hotkeys: &[HotkeyCombo], currently_pressed: &[String]) -> bool {
    // Check each registered hotkey
    for hotkey in registered_hotkeys {
        if !hotkey.blocks_keys() {
            continue;
        }
        // A hotkey blocks when ALL its keys are currently pressed
        let all_pressed = hotkey
            .keys
            .iter()
            .all(|key| currently_pressed.contains(key));

        let same_length = hotkey.keys.len() == currently_pressed.len();

        if all_pressed && !hotkey.keys.is_empty() && same_length {
            return true;
        }
    }
    false
}

fn callback(event: Event) -> Option<Event> {
    match event.event_type {
        EventType::KeyPress(key) => {
            let key_name = format!("{:?}", key);

            // Check for copy combinations before updating modifier states
            // Ignore Cmd+C (macOS) and Ctrl+C (Windows/Linux) combinations to prevent
            // feedback loops with selected-text-reader
            // Update pressed keys BEFORE checking if we should block
            // Normalize Unknown(179) to Function for detection purposes
            let normalized_key = normalize_key_name(&key_name);

            let (
                should_block_event,
                should_block_unknown_179,
                should_block_key,
                _needs_windows_poison,
            ) = {
                let mut state = listener_state()
                    .lock()
                    .expect("Listener state mutex poisoned");

                let should_block_key = state.blocked_keys.contains(&normalized_key);

                if matches!(key, Key::KeyC)
                    && (state.cmd_pressed || state.ctrl_pressed)
                    && !should_block_key
                {
                    state.copy_in_progress = true;
                    // Keep copy out of hold-shortcut handling, but invalidate
                    // pending taps so Control+C cannot count as a Control tap.
                    drop(state);
                    output_shortcut_interrupted();
                    return Some(event);
                }

                if !state.currently_pressed.contains(&normalized_key) {
                    state.currently_pressed.push(normalized_key);
                }

                // Track modifier key states
                if matches!(key, Key::MetaLeft | Key::MetaRight) {
                    state.cmd_pressed = true;
                }
                if matches!(key, Key::ControlLeft | Key::ControlRight) {
                    state.ctrl_pressed = true;
                }

                let should_block_event =
                    should_block(&state.registered_hotkeys, &state.currently_pressed);

                let should_block_unknown_179 = key_name == "Unknown(179)"
                    && state.registered_hotkeys.iter().any(|hotkey| {
                        hotkey.blocks_keys() && hotkey.keys.iter().any(|k| k == "Function")
                    });

                #[cfg(target_os = "windows")]
                let _needs_windows_poison = should_block_event
                    && (state.cmd_pressed
                        || state
                            .currently_pressed
                            .iter()
                            .any(|k| k == "MetaLeft" || k == "MetaRight"));
                #[cfg(not(target_os = "windows"))]
                let _needs_windows_poison = false;

                (
                    should_block_event,
                    should_block_unknown_179,
                    should_block_key,
                    _needs_windows_poison,
                )
            };

            output_event("keydown", &key);

            // Check if we should block based on exact hotkey match
            #[allow(clippy::if_same_then_else)]
            if should_block_event || should_block_key {
                // Windows-specific: Prevent Start menu from opening when Windows key is used in
                // hotkeys Windows shows the Start menu if it sees "Win down →
                // Win up" with no other keys in between. By injecting a
                // harmless key (VK 0xFF), we "poison" the sequence so Windows thinks
                // it was a combo, not a standalone Windows key press
                #[cfg(target_os = "windows")]
                if _needs_windows_poison {
                    // VK 0xFF is documented as "no mapping" - a valid key code with no function
                    let _ = simulate(&EventType::KeyPress(Key::Unknown(0xFF)));
                    let _ = simulate(&EventType::KeyRelease(Key::Unknown(0xFF)));
                }
                None // Block the event from reaching the OS
            } else if should_block_unknown_179 {
                None // Block Unknown(179) if any hotkey uses Function
            } else {
                Some(event) // Let it through
            }
        }
        EventType::KeyRelease(key) => {
            let key_name = format!("{:?}", key);

            // Normalize Unknown(179) to Function for detection purposes
            let normalized_key = normalize_key_name(&key_name);

            {
                let mut state = listener_state()
                    .lock()
                    .expect("Listener state mutex poisoned");

                // Update pressed keys
                state.currently_pressed.retain(|k| k != &normalized_key);

                // Only hide a release if we also hid its press. Otherwise a C
                // pressed before Control (or explicitly blocked) becomes stuck.
                if matches!(key, Key::KeyC) && state.copy_in_progress {
                    state.copy_in_progress = false;
                    // Don't output this C key release event
                    return Some(event);
                }

                // Track modifier key states
                if matches!(key, Key::MetaLeft | Key::MetaRight) {
                    state.cmd_pressed = state
                        .currently_pressed
                        .iter()
                        .any(|key| key == "MetaLeft" || key == "MetaRight");
                }
                if matches!(key, Key::ControlLeft | Key::ControlRight) {
                    state.ctrl_pressed = state
                        .currently_pressed
                        .iter()
                        .any(|key| key == "ControlLeft" || key == "ControlRight");
                }
            }

            output_event("keyup", &key);

            // Always allow key release events through
            Some(event)
        }
        EventType::ButtonPress(_) | EventType::Wheel { .. } => {
            output_shortcut_interrupted();
            Some(event)
        }
        _ => Some(event), // Allow all other events
    }
}

fn output_event(event_type: &str, key: &Key) {
    TAP_INTERRUPTED.store(false, Ordering::Relaxed);
    let monotonic_ms = START_TIME.get_or_init(Instant::now).elapsed().as_millis();
    let timestamp = Utc::now().to_rfc3339();
    let key_name = format!("{:?}", key);

    let event_json = json!({
        "type": event_type,
        "key": key_name,
        "timestamp": timestamp,
        "monotonic_ms": monotonic_ms,
        "raw_code": key_codes::key_to_code(key)
    });

    println!("{}", event_json);
    let _ = io::stdout().flush();
}

fn output_shortcut_interrupted() {
    // One interruption is enough until another key event; avoid flooding the
    // pipe with trackpad scroll events while no new tap can have started.
    if TAP_INTERRUPTED.swap(true, Ordering::Relaxed) {
        return;
    }
    println!("{}", json!({ "type": "shortcut-interrupted" }));
    let _ = io::stdout().flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hotkey(keys: &[&str], trigger_type: TriggerType) -> HotkeyCombo {
        HotkeyCombo {
            keys: keys.iter().map(|key| key.to_string()).collect(),
            trigger_type,
        }
    }

    #[test]
    fn double_tap_control_preserves_os_modifier_events() {
        let shortcuts = vec![
            hotkey(&["ControlLeft"], TriggerType::DoubleTap),
            hotkey(&["ControlLeft", "Function"], TriggerType::Hold),
        ];
        assert!(!should_block(&shortcuts, &["ControlLeft".into()]));
        assert!(!should_block(
            &shortcuts,
            &["ControlLeft".into(), "KeyA".into()]
        ));
        assert!(should_block(
            &shortcuts,
            &["ControlLeft".into(), "Function".into()]
        ));
    }

    #[test]
    fn configurable_hold_and_non_modifier_shortcuts_still_block() {
        for shortcut in [
            hotkey(&["ControlRight"], TriggerType::Hold),
            hotkey(&["Alt", "Space"], TriggerType::Hold),
            hotkey(&["ControlLeft", "KeyD"], TriggerType::DoubleTap),
        ] {
            assert!(should_block(
                std::slice::from_ref(&shortcut),
                &shortcut.keys
            ));
        }
    }

    #[test]
    fn older_registrations_default_to_hold() {
        let shortcut: HotkeyCombo = serde_json::from_str(r#"{"keys":["ControlLeft"]}"#).unwrap();
        assert_eq!(shortcut.trigger_type, TriggerType::Hold);
        assert!(shortcut.blocks_keys());
        let shortcut: HotkeyCombo =
            serde_json::from_str(r#"{"keys":["ControlLeft"],"triggerType":"double-tap"}"#).unwrap();
        assert!(!shortcut.blocks_keys());
    }

    #[test]
    fn copy_interrupts_taps_without_losing_visible_key_releases() {
        *listener_state().lock().unwrap() = ListenerState::default();
        let send = |event_type| {
            callback(Event {
                event_type,
                name: None,
                time: std::time::SystemTime::now(),
            })
        };
        send(EventType::KeyPress(Key::ControlLeft));
        send(EventType::KeyPress(Key::ControlRight));
        send(EventType::KeyRelease(Key::ControlLeft));
        assert!(listener_state().lock().unwrap().ctrl_pressed);
        assert!(send(EventType::KeyPress(Key::KeyC)).is_some());
        assert!(TAP_INTERRUPTED.load(Ordering::Relaxed));
        assert!(listener_state().lock().unwrap().copy_in_progress);
        send(EventType::KeyRelease(Key::KeyC));
        send(EventType::KeyRelease(Key::ControlRight));
        assert!(!listener_state().lock().unwrap().ctrl_pressed);

        // A C press emitted before Control must also emit its release.
        send(EventType::KeyPress(Key::KeyC));
        send(EventType::KeyPress(Key::ControlLeft));
        output_shortcut_interrupted();
        send(EventType::KeyRelease(Key::KeyC));
        assert!(!TAP_INTERRUPTED.load(Ordering::Relaxed));
        send(EventType::KeyRelease(Key::ControlLeft));
        assert!(listener_state()
            .lock()
            .unwrap()
            .currently_pressed
            .is_empty());
    }
}
