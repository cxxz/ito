use cocoa::appkit::{NSPasteboard, NSPasteboardTypeString};
use cocoa::base::{nil, NO};
use cocoa::foundation::{NSAutoreleasePool, NSString};
use core_graphics::event::{CGEvent, CGEventFlags};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use std::thread;
use std::time::Duration;

use crate::{keyboard_layout, macos_clipboard::ClipboardSnapshot};

pub fn type_text_macos(text: &str, _char_delay: u64) -> Result<(), String> {
    // Prepare events before touching the clipboard so setup failures preserve it.
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Failed to create event source")?;
    let v_keycode = keyboard_layout::get_paste_keycode();
    let down = CGEvent::new_keyboard_event(source.clone(), v_keycode, true)
        .map_err(|_| "Failed to create key down event")?;
    let up = CGEvent::new_keyboard_event(source, v_keycode, false)
        .map_err(|_| "Failed to create key up event")?;
    down.set_flags(CGEventFlags::CGEventFlagCommand);
    up.set_flags(CGEventFlags::CGEventFlagCommand);

    unsafe {
        let _pool = NSAutoreleasePool::new(nil);
        let board = NSPasteboard::generalPasteboard(nil);
        let snapshot = ClipboardSnapshot::capture(board)?;
        if snapshot.change_count != board.changeCount() {
            return Err("Clipboard changed while preparing paste".into());
        }
        let cleared = board.clearContents();
        if board.setString_forType(NSString::alloc(nil).init_str(text), NSPasteboardTypeString)
            == NO
        {
            snapshot.restore_if_owned(board, cleared)?;
            return Err("Failed to set dictation clipboard".into());
        }
        let owned = board.changeCount();
        let current = board.stringForType(NSPasteboardTypeString);
        let verified = current != nil
            && std::ffi::CStr::from_ptr(NSString::UTF8String(current)).to_string_lossy() == text;
        if !verified || board.changeCount() != owned {
            snapshot.restore_if_owned(board, owned)?;
            return Err("Clipboard changed before paste could be dispatched".into());
        }
        down.post(core_graphics::event::CGEventTapLocation::HID);
        thread::sleep(Duration::from_millis(10));
        up.post(core_graphics::event::CGEventTapLocation::HID);

        // Allow the target to consume the paste. Completion stays serialized in
        // the session manager; restoration preserves newer user copies.
        thread::sleep(Duration::from_secs(1));
        snapshot.restore_if_owned(board, owned)?;
        Ok(())
    }
}
