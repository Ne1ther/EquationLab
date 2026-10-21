import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../macos/Views/EquationCanvas.swift',import.meta.url),'utf8');

test('The retained WKWebView observes window reveal and application activation',()=>{
 assert.match(source,/override func viewDidMoveToWindow\(\)/);
  assert.match(source,/NSWindow\.didChangeOcclusionStateNotification/);
 assert.match(source,/NSWindow\.didBecomeKeyNotification/);
 assert.match(source,/NSApplication\.didBecomeActiveNotification/);
 assert.match(source,/NotificationCenter\.default\.removeObserver\(self\)/);
 assert.match(source,/windowWasRevealed\(_ notification: Notification\).*refreshAfterReveal\(\)/s);
 assert.match(source,/applicationBecameActive\(_ notification: Notification\).*refreshAfterReveal\(\)/s);
});

test('Reveal recovery invalidates layout and drawing without replacing editor state',()=>{
 const start=source.indexOf('func refreshAfterReveal() {');
 const end=source.indexOf('@objc private func windowWasRevealed',start);
 assert.ok(start>=0&&end>start,'the public reveal hook is present');
 const hook=source.slice(start,end);
 assert.match(hook,/needsLayout\s*=\s*true/);
 assert.match(hook,/layoutSubtreeIfNeeded\(\)/);
 assert.match(hook,/setNeedsDisplay\(self\.bounds\)/);
 assert.match(hook,/layer\?\.setNeedsDisplay\(\)/);
 assert.match(hook,/window\.dispatchEvent\(new Event\('resize'\)\)/);
 assert.doesNotMatch(hook,/\.focus\(|\.value\s*=|loadHTMLString|loadFileURL|select\(/);
});
