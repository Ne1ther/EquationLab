import Foundation

enum WordFocusHandoff {
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
