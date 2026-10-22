import Foundation

enum WordFocusHandoff {
    // Window/key state and NSApp.isActive can lag the workspace's actual
    // foreground owner. Decide from that owner before changing window state.
    static func begin(editorIsFrontmost: Bool, wordIsFrontmost: Bool, fromWord: Bool,
                      activateFromWord: () -> Void, activate: () -> Void) {
        guard !editorIsFrontmost else { return }
        if fromWord {
            if wordIsFrontmost { activateFromWord() }
        } else {
            activate()
        }
    }

    // Returning an editor the user is interacting with is an explicit handoff.
    // A delayed background completion must not activate Word over another app.
    static func finish(editorIsActive: Bool, wordIsActive: Bool,
                       yield: () -> Void, activate: () -> Void, hide: () -> Void) {
        if editorIsActive && !wordIsActive {
            yield()
            activate()
        }
        // Order the activation request before removing the key editor window;
        // otherwise AppKit may choose another app before the handoff arrives.
        hide()
    }
}
