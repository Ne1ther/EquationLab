import AppKit
import WebKit

// Render this test's local HTML in WebKit without a window, activation,
// Dock presence, or desktop capture. It never reads another app's content.
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
let configuration=WKWebViewConfiguration()
let view=WKWebView(frame:NSRect(x:0,y:0,width:1050,height:1100),configuration:configuration)
let input=URL(fileURLWithPath:CommandLine.arguments[1])
let output=URL(fileURLWithPath:CommandLine.arguments[2])
var done=false
var failure:String?
final class Delegate:NSObject,WKNavigationDelegate {
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
  webView.callAsyncJavaScript("await globalThis.ready; return globalThis.readout();",arguments:[:],in:nil,in:.page){result in
   switch result {
   case .failure(let error): failure=error.localizedDescription;done=true
   case .success(let value):
    do {let data=try JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys]);try data.write(to:output.appendingPathExtension("json"))}catch{failure=error.localizedDescription;done=true;return}
    let snapshot=WKSnapshotConfiguration();snapshot.rect=webView.bounds;snapshot.snapshotWidth=1050
    webView.takeSnapshot(with:snapshot){image,error in
     if let image=image,let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]){do{try png.write(to:output.appendingPathExtension("png"))}catch{failure=error.localizedDescription}}
     else{failure=error?.localizedDescription ?? "Empty WK snapshot"}
     done=true
    }
   }
  }
 }
 func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error){failure=error.localizedDescription;done=true}
}
let delegate=Delegate();view.navigationDelegate=delegate
view.loadFileURL(input,allowingReadAccessTo:input.deletingLastPathComponent())
let stop=Date(timeIntervalSinceNow:25)
while !done && Date()<stop {RunLoop.current.run(until:Date(timeIntervalSinceNow:0.02))}
view.stopLoading()
if let failure=failure{fputs(failure+"\n",stderr);exit(1)}
if !done {fputs("Timed out\n",stderr);exit(2)}
print(output.path)
