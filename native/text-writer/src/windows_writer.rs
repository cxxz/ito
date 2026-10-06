#[cfg(target_os = "windows")]
use clipboard_win::{formats, get_clipboard, seq_num, set_clipboard};
use enigo::{Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

/// Type text on Windows using clipboard paste approach
/// This mimics the macOS implementation to avoid character-by-character typing
/// issues
pub fn type_text_windows(text: &str, _char_delay: u64) -> Result<(), String> {
    // Store current clipboard contents to restore later
    let old_contents: Result<String, _> = get_clipboard(formats::Unicode);
    // Preserve non-text clipboard content by using Unicode input directly.
    if old_contents.is_err() {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        return enigo.text(text).map_err(|e| e.to_string());
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    // Set our text to clipboard
    set_clipboard(formats::Unicode, text)
        .map_err(|e| format!("Failed to set clipboard: {:?}", e))?;
    let owned = seq_num();

    let paste_result = (|| {
        // Verify clipboard was actually set by reading it back
        let mut attempts = 0;
        loop {
            match get_clipboard::<String, _>(formats::Unicode) {
                Ok(content) if content == text => break,
                _ => {
                    attempts += 1;
                    if attempts > 50 {
                        return Err("Failed to verify clipboard content was set".to_string());
                    }
                    thread::sleep(Duration::from_millis(2));
                }
            }
        }

        // Simulate Ctrl+V (paste)
        // Press Ctrl
        enigo
            .key(Key::Control, enigo::Direction::Press)
            .map_err(|e| format!("Failed to press Ctrl: {}", e))?;

        // Press V
        enigo
            .key(Key::Unicode('v'), enigo::Direction::Press)
            .map_err(|e| format!("Failed to press V: {}", e))?;

        // Small delay to ensure the key press is registered
        thread::sleep(Duration::from_millis(20));

        // Release V
        enigo
            .key(Key::Unicode('v'), enigo::Direction::Release)
            .map_err(|e| format!("Failed to release V: {}", e))?;

        // Release Ctrl
        enigo
            .key(Key::Control, enigo::Direction::Release)
            .map_err(|e| format!("Failed to release Ctrl: {}", e))?;

        Ok(())
    })();
    // Release modifiers even when an input event fails partway through paste.
    let _ = enigo.key(Key::Unicode('v'), enigo::Direction::Release);
    let _ = enigo.key(Key::Control, enigo::Direction::Release);

    if let Ok(old_text) = old_contents {
        thread::sleep(Duration::from_secs(1));
        if owned.is_some() && seq_num() == owned {
            set_clipboard(formats::Unicode, &old_text)
                .map_err(|e| format!("Failed to restore clipboard: {:?}", e))?;
        }
    }

    paste_result
}
