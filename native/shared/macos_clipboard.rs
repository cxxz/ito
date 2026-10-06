//! Preserve all clipboard representations and only restore while the operation owns it.
use cocoa::appkit::{NSPasteboard, NSPasteboardItem};
use cocoa::base::{id, nil, NO};
use cocoa::foundation::{NSArray, NSData};
use objc::{class, msg_send, sel, sel_impl};

struct OwnedItem(id);
impl Drop for OwnedItem {
    fn drop(&mut self) {
        unsafe {
            let _: () = msg_send![self.0, release];
        }
    }
}

pub struct ClipboardSnapshot {
    items: Vec<OwnedItem>,
    pub change_count: i64,
}

impl ClipboardSnapshot {
    pub unsafe fn capture(pasteboard: id) -> Result<Self, String> {
        let change_count = pasteboard.changeCount();
        let original = pasteboard.pasteboardItems();
        let mut snapshot = Self {
            items: Vec::new(),
            change_count,
        };
        if original == nil {
            return Ok(snapshot);
        }
        if original.count() > 100 {
            return Err("Clipboard contains too many items to preserve safely".into());
        }
        let mut bytes = 0usize;
        for i in 0..original.count() {
            let item = original.objectAtIndex(i);
            let copy: id = msg_send![class!(NSPasteboardItem), new];
            let owned = OwnedItem(copy);
            let types = NSPasteboardItem::types(item);
            for j in 0..types.count() {
                let kind = types.objectAtIndex(j);
                let data = NSPasteboardItem::dataForType(item, kind);
                if data == nil {
                    return Err("Clipboard representation cannot be preserved".into());
                }
                bytes = bytes.saturating_add(data.length() as usize);
                if bytes > 32 * 1024 * 1024 {
                    return Err("Clipboard is too large to preserve safely".into());
                }
                if NSPasteboardItem::setData_forType(copy, data, kind) == NO {
                    return Err("Failed to preserve clipboard representation".into());
                }
            }
            snapshot.items.push(owned);
        }
        if pasteboard.changeCount() != change_count {
            return Err("Clipboard changed while preparing paste".into());
        }
        Ok(snapshot)
    }

    pub unsafe fn restore_if_owned(
        &self,
        pasteboard: id,
        owned_count: i64,
    ) -> Result<bool, String> {
        if pasteboard.changeCount() != owned_count {
            return Ok(false);
        }
        pasteboard.clearContents();
        if !self.items.is_empty() {
            let items: Vec<id> = self.items.iter().map(|item| item.0).collect();
            if pasteboard.writeObjects(NSArray::arrayWithObjects(nil, &items)) == NO {
                return Err("Failed to restore clipboard".into());
            }
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cocoa::appkit::NSPasteboardTypeString;
    use cocoa::foundation::{NSAutoreleasePool, NSString};

    #[test]
    fn restores_text_and_rich_formats_in_a_private_pasteboard() {
        unsafe {
            let _pool = NSAutoreleasePool::new(nil);
            let board = NSPasteboard::pasteboardWithUniqueName(nil);
            let html = NSString::alloc(nil).init_str("public.html");
            NSPasteboard::setString_forType(
                board,
                NSString::alloc(nil).init_str("original"),
                NSPasteboardTypeString,
            );
            NSPasteboard::setString_forType(
                board,
                NSString::alloc(nil).init_str("<b>original</b>"),
                html,
            );
            let snapshot = ClipboardSnapshot::capture(board).unwrap();
            board.clearContents();
            NSPasteboard::setString_forType(
                board,
                NSString::alloc(nil).init_str("dictation"),
                NSPasteboardTypeString,
            );
            assert!(snapshot
                .restore_if_owned(board, board.changeCount())
                .unwrap());
            let value = NSPasteboard::stringForType(board, html);
            assert_ne!(value, nil);
            let text = std::ffi::CStr::from_ptr(NSString::UTF8String(value))
                .to_str()
                .unwrap();
            assert_eq!(text, "<b>original</b>");
            board.releaseGlobally();
        }
    }

    #[test]
    fn a_later_user_copy_is_never_overwritten() {
        unsafe {
            let _pool = NSAutoreleasePool::new(nil);
            let board = NSPasteboard::pasteboardWithUniqueName(nil);
            let snapshot = ClipboardSnapshot::capture(board).unwrap();
            NSPasteboard::setString_forType(
                board,
                NSString::alloc(nil).init_str("dictation"),
                NSPasteboardTypeString,
            );
            let owned = board.changeCount();
            board.clearContents();
            NSPasteboard::setString_forType(
                board,
                NSString::alloc(nil).init_str("user copy"),
                NSPasteboardTypeString,
            );
            assert!(!snapshot.restore_if_owned(board, owned).unwrap());
            let value = NSPasteboard::stringForType(board, NSPasteboardTypeString);
            let text = std::ffi::CStr::from_ptr(NSString::UTF8String(value))
                .to_str()
                .unwrap();
            assert_eq!(text, "user copy");
            board.releaseGlobally();
        }
    }
}
