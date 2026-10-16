// Include the implementation to exercise its private production launcher;
// no testing symbol or mutable launcher hook is added to the shipping bundle.
#include "editor_transport.mm"
#include <iostream>
#include <stdexcept>

namespace bridge_probe {
void setEditorHooks(OpenEditor,void*){}
void setEditorCancelHook(CancelEditor){}
HResult completeEdit(std::uint64_t,const std::uint8_t*,std::size_t,bool){return Unexpected;}
HResult setSessionPreview(std::uint64_t,const std::uint8_t*,std::size_t,SizeL){return Unexpected;}
}

@interface FakeEquationWorkspace : NSObject
@property(nonatomic,strong) NSURL* targetApplication;
@property(nonatomic,strong) NSString* queriedBundle;
@property(nonatomic,strong) NSURL* openedApplication;
@property(nonatomic,strong) NSArray<NSURL*>* openedURLs;
@property(nonatomic) NSUInteger resolveCalls;
@property(nonatomic) NSUInteger explicitOpenCalls;
@property(nonatomic) NSUInteger defaultHandlerCalls;
@property(nonatomic) BOOL activated;
@property(nonatomic) BOOL failOpen;
@property(nonatomic) BOOL missingRunningApplication;
- (NSURL*)URLForApplicationWithBundleIdentifier:(NSString*)bundle;
- (void)openURLs:(NSArray<NSURL*>*)urls withApplicationAtURL:(NSURL*)application configuration:(NSWorkspaceOpenConfiguration*)config completionHandler:(void(^)(NSRunningApplication*,NSError*))completion;
- (void)openURL:(NSURL*)url configuration:(NSWorkspaceOpenConfiguration*)config completionHandler:(void(^)(NSRunningApplication*,NSError*))completion;
@end
@implementation FakeEquationWorkspace
- (NSURL*)URLForApplicationWithBundleIdentifier:(NSString*)bundle {self.queriedBundle=bundle;++self.resolveCalls;return self.targetApplication;}
- (void)openURLs:(NSArray<NSURL*>*)urls withApplicationAtURL:(NSURL*)application configuration:(NSWorkspaceOpenConfiguration*)config completionHandler:(void(^)(NSRunningApplication*,NSError*))completion {
    ++self.explicitOpenCalls;self.openedURLs=urls;self.openedApplication=application;self.activated=config.activates;
    NSError* error=self.failOpen?[NSError errorWithDomain:@"FakeLaunch" code:99 userInfo:nil]:nil;
    // The production helper only checks the success object's presence.
    NSRunningApplication* app=self.failOpen||self.missingRunningApplication?nil:(NSRunningApplication*)[NSObject new];completion(app,error);
}
- (void)openURL:(NSURL*)url configuration:(NSWorkspaceOpenConfiguration*)config completionHandler:(void(^)(NSRunningApplication*,NSError*))completion {
    (void)url;(void)config;++self.defaultHandlerCalls;completion(nil,[NSError errorWithDomain:@"WrongDefaultHandler" code:1 userInfo:nil]);
}
@end

namespace {
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
void runCase(NSString* url,BOOL available,BOOL failOpen,BOOL missingRunningApplication){
    FakeEquationWorkspace* workspace=[FakeEquationWorkspace new];
    // Neither this fake target nor the obsolete default path is opened.
    workspace.targetApplication=available?[NSURL fileURLWithPath:@"/tmp/qa/Equation Lab.app"]:nil;
    workspace.failOpen=failOpen;workspace.missingRunningApplication=missingRunningApplication;
    __block NSUInteger callbacks=0;__block NSError* result=nil;
    launchEquationLabURL((NSWorkspace*)workspace,[NSURL URLWithString:url],^(NSError* error){++callbacks;result=error;});
    check(callbacks==1,"launch callback count");check(workspace.resolveCalls==1,"stable application not resolved exactly once");
    check([workspace.queriedBundle isEqualToString:@"app.equationlab.mac"],"wrong bundle identity");
    check(workspace.defaultHandlerCalls==0,"launch fell back to scheme handler");
    check(workspace.explicitOpenCalls==(available?1u:0u),"unexpected explicit open count");
    if(available){check([workspace.openedApplication isEqual:workspace.targetApplication],"resolved application URL was discarded");check(workspace.openedURLs.count==1&&[workspace.openedURLs[0].absoluteString isEqualToString:url],"wake/edit URL changed");check(workspace.activated,"app activation disabled");}
    if(!available||failOpen||missingRunningApplication)check(result&&result.code==LaunchFailure&&[result.domain isEqualToString:@"NativeEquationTransport"],"failure not classified as LaunchFailure");
    else check(!result,"successful explicit launch failed");
}
}
int main(){@autoreleasepool{
    try {
        NSArray<NSString*>* urls=@[@"equationlab://wake",[@"equationlab://word-edit/" stringByAppendingString:[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0]]];
        for(NSString* url in urls){runCase(url,YES,NO,NO);runCase(url,NO,NO,NO);runCase(url,YES,YES,NO);runCase(url,YES,NO,YES);}
        std::cout<<"{\"cases\":8,\"stable_bundle_id\":\"app.equationlab.mac\",\"wake_and_edit_use_explicit_application\":true,\"missing_app_is_launch_failure\":true,\"open_error_is_launch_failure\":true,\"missing_running_app_is_launch_failure\":true,\"default_handler_never_used\":true,\"real_workspace_or_gui_used\":false}\n";
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}}
