import AppKit
import WebKit

// No window, activation, screen capture, or interaction with another app.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
final class Bridge: NSObject, WKScriptMessageHandler {
 func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
  guard let body = message.body as? [String: Any],
        let data = try? JSONSerialization.data(withJSONObject: body),
        let json = String(data: data, encoding: .utf8) else { return }
  // The bridge is a UI timing stub; Node separately validates each real
  // MathLive result with the production native pipeline.
  let reply = "{ok:true,data:{svg:'',nativeBytes:1,warnings:[]}}"
  let script = "window.imeRequests.push(\(json)); if (\(json).id) window.nativeReply({id:\(json).id,result:\(reply)}); window.dispatchEvent(new Event('ime-request'));"
  message.webView?.evaluateJavaScript(script, completionHandler: nil)
 }
}
let bridge = Bridge()
let configuration = WKWebViewConfiguration()
configuration.userContentController.add(bridge, name: "native")
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1050, height: 1100), configuration: configuration)
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
var done = false
var failure: String?
final class Delegate: NSObject, WKNavigationDelegate {
 func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
  webView.callAsyncJavaScript("await globalThis.ready; return globalThis.readout();", arguments: [:], in: nil, in: .page) { result in
   switch result {
   case .failure(let error): failure = error.localizedDescription
   case .success(let value):
    do { try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: output) }
    catch { failure = error.localizedDescription }
   }
   done = true
  }
 }
 func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failure = error.localizedDescription; done = true }
}
let delegate = Delegate()
view.navigationDelegate = delegate
view.loadFileURL(input, allowingReadAccessTo: input.deletingLastPathComponent())
let stop = Date(timeIntervalSinceNow: 30)
while !done && Date() < stop { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02)) }
view.stopLoading()
if let failure = failure { fputs(failure + "\n", stderr); exit(1) }
if !done {
 var diagnosticDone = false
 view.evaluateJavaScript("globalThis.readout && globalThis.readout()") { value, _ in
  if let value = value, let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: output) }
  diagnosticDone = true
 }
 let diagnosticStop = Date(timeIntervalSinceNow: 2)
 while !diagnosticDone && Date() < diagnosticStop { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02)) }
 fputs("Timed out; partial readout saved if available\n", stderr); exit(2)
}
