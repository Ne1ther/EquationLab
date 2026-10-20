// Include the implementation to exercise its private production launcher;
// no testing symbol or mutable launcher hook is added to the shipping bundle.
#include "editor_transport.mm"
#include <iostream>
#include <stdexcept>

NSDictionary* EquationLabCapturedDocumentContext(){return nil;}
void EquationLabSetNavigationTarget(std::int32_t){}
std::int32_t EquationLabNewDocumentToken(){static std::int32_t token=100;return ++token;}

namespace bridge_probe {
void setEditorHooks(OpenEditor,void*){}
void setEditorCancelHook(CancelEditor){}
void setEditorOwnerForgetHook(ForgetEditorOwner){}
void setEditorOwnerWrittenHook(EditorOwnerWritten){}
std::uint64_t editObjectIdentity(std::uint64_t){return 0;}
bool bindEditDocument(std::uint64_t,const char*){return true;}
std::int32_t diagnosticValue(std::uint32_t){return 0;}
HResult completeEdit(std::uint64_t session,const std::uint8_t*,std::size_t,bool,bool){[transport cleanup:session];return Ok;}
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

@interface FakeRunningEquationApp : NSObject
@property(nonatomic,strong) NSURL* bundleURL;
@property(nonatomic,getter=isTerminated) BOOL terminated;
@end
@implementation FakeRunningEquationApp
@end

@interface CaptureTestTransport : ProbeEditorTransport
@property(nonatomic) NSUInteger openedContexts;
@end
@implementation CaptureTestTransport
- (void)openState:(ProbeEditState*)state {if(state.documentContext)++self.openedContexts;}
@end

@interface FakeActivationSource : NSObject
@property(nonatomic,getter=isActive) BOOL active;
@property(nonatomic,strong) NSMutableArray<NSString*>* yields;
- (void)yieldActivationToApplicationWithBundleIdentifier:(NSString*)bundle;
@end
@implementation FakeActivationSource
- (instancetype)init {self=[super init];if(self)self.yields=[NSMutableArray new];return self;}
- (void)yieldActivationToApplicationWithBundleIdentifier:(NSString*)bundle {[self.yields addObject:bundle];}
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
    launchEquationLabURL((NSWorkspace*)workspace,[NSURL URLWithString:url],^(NSError* error){++callbacks;result=error;},@[]);
    check(callbacks==1,"launch callback count");check(workspace.resolveCalls==1,"stable application not resolved exactly once");
    check([workspace.queriedBundle isEqualToString:@"app.equationlab.mac"],"wrong bundle identity");
    check(workspace.defaultHandlerCalls==0,"launch fell back to scheme handler");
    check(workspace.explicitOpenCalls==(available?1u:0u),"unexpected explicit open count");
    if(available){check([workspace.openedApplication isEqual:workspace.targetApplication],"resolved application URL was discarded");check(workspace.openedURLs.count==1&&[workspace.openedURLs[0].absoluteString isEqualToString:url],"wake/edit URL changed");check(!workspace.activated,"transport must wait for the App's accepted ticket before activating its editor");}
    if(!available||failOpen||missingRunningApplication)check(result&&result.code==LaunchFailure&&[result.domain isEqualToString:@"NativeEquationTransport"],"failure not classified as LaunchFailure");
    else check(!result,"successful explicit launch failed");
}
void runRunningCase(NSString* url,BOOL terminated){
    FakeEquationWorkspace* workspace=[FakeEquationWorkspace new];
    workspace.targetApplication=[NSURL fileURLWithPath:@"/Applications/Old Equation Lab.app"];
    FakeRunningEquationApp* running=[FakeRunningEquationApp new];running.bundleURL=[NSURL fileURLWithPath:@"/tmp/current/Equation Lab.app"];running.terminated=terminated;
    __block NSUInteger callbacks=0;
    launchEquationLabURL((NSWorkspace*)workspace,[NSURL URLWithString:url],^(NSError* error){++callbacks;check(!error,"running-copy launch failed");},@[(NSRunningApplication*)running]);
    check(callbacks==1&&workspace.explicitOpenCalls==1,"running-copy callback/open count");
    check(workspace.resolveCalls==(terminated?1u:0u),"running-copy selection queried an obsolete registration");
    check([workspace.openedApplication isEqual:terminated?workspace.targetApplication:running.bundleURL],"running app copy was not preferred");
}
void runCooperativeActivationCases(){
    for(BOOL active: {NO,YES})for(NSString* host in @[@"wake",@"word-edit",@"word-tool"]){
        FakeEquationWorkspace* workspace=[FakeEquationWorkspace new];workspace.targetApplication=[NSURL fileURLWithPath:@"/tmp/qa/Equation Lab.app"];
        FakeActivationSource* source=[FakeActivationSource new];source.active=active;
        NSString* path=[host isEqualToString:@"word-edit"]?@"/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":([host isEqualToString:@"word-tool"]?@"/editor":@"");
        NSURL* url=[NSURL URLWithString:[NSString stringWithFormat:@"equationlab://%@%@",host,path]];
        launchEquationLabURL((NSWorkspace*)workspace,url,^(NSError* error){check(!error,"cooperative launch failed");},@[],(NSApplication*)source);
        const bool expected=active&&![host isEqualToString:@"wake"];
        check(source.yields.count==(expected?1u:0u),"wake or inactive host yielded focus, or active editor intent did not yield");
        if(expected)check([source.yields.firstObject isEqualToString:@"app.equationlab.mac"],"yield did not target the shipping App");
        check(!workspace.activated,"cooperative handoff revealed the editor before its content was ready");
    }
}
ProbeEditState* cacheState(std::uint64_t owner,NSUInteger snapshot,NSUInteger index,NSString* xml){
    ProbeEditState* state=[ProbeEditState new];state.ownerIdentity=owner;state.openDigest=@"same-native-sha";
    state.documentContext=@{@"identity":@"process:1",@"snapshot":@(snapshot),@"index":@(index),@"name":@"same-name.docx",@"ooxml":xml};return state;
}
void runDocumentCacheCases(){
    ProbeEditorTransport* client=[ProbeEditorTransport new];NSString* xml=@"<shared-document/>";
    auto remember=[&](ProbeEditState* state){state.documentEpoch=client.documentEpoch;state.editGeneration=client.cacheGeneration;[client rememberDocument:state];};
    for(unsigned owner=1;owner<=33;owner++)remember(cacheState(owner,1,owner-1,xml));
    check(client.documentSnapshots.count==1&&client.ownerDocuments.count==32&&client.documentBytes==xml.length*sizeof(unichar),"same document snapshot was duplicated per OLE owner or owner cap failed");
    check(![client documentForOwner:cacheState(1,1,0,xml)]&&[[client documentForOwner:cacheState(33,1,0,xml)][@"index"] intValue]==32,"owner LRU/index association failed");
    ProbeEditState* wrong=cacheState(33,1,0,xml);wrong.openDigest=@"changed-native-sha";
    check(![client documentForOwner:wrong],"changed Native SHA inherited the old owner document");
    [client invalidateDocuments];check(!client.ownerDocuments.count&&!client.documentSnapshots.count&&client.documentBytes==0,"document clear retained full XML");
    for(unsigned owner=1;owner<=5;owner++)remember(cacheState(owner,owner,owner-1,xml));
    check(client.documentSnapshots.count==4&&client.ownerDocuments.count==4&&![client documentForOwner:cacheState(1,1,0,xml)],"document snapshot count cap or eviction cleanup failed");
    [client invalidateDocuments];
    NSString* large=[@"x" stringByPaddingToLength:9*1024*1024 withString:@"x" startingAtIndex:0];
    for(unsigned owner=1;owner<=3;owner++){remember(cacheState(owner,owner,owner-1,large));check(client.documentBytes<=32*1024*1024&&client.documentSnapshots.count<=4,"document XML cache exceeded its total budget");}
    check(client.documentSnapshots.count==1&&client.ownerDocuments.count==1,"byte-budget eviction retained orphaned owner associations");
    [client forgetOwner:3];check(client.documentBytes==0&&!client.documentSnapshots.count,"last owner close retained its XML snapshot");
    for(unsigned snapshot=1;snapshot<=5;snapshot++)remember(cacheState(40,snapshot,0,xml));
    check(client.documentSnapshots.count==1&&client.ownerDocuments.count==1,"rebinding one owner retained orphaned old XML snapshots");[client forgetOwner:40];
    check(client.documentBytes==0&&!client.documentSnapshots.count,"closing a rebound owner retained old XML");
    remember(cacheState(4,4,0,xml));
    NSString* tooLarge=[@"x" stringByPaddingToLength:17*1024*1024 withString:@"x" startingAtIndex:0];remember(cacheState(4,5,0,tooLarge));
    check(client.documentBytes==0&&!client.ownerDocuments.count,"oversized individual document entered the cache");
    check(client.ownerCaptureBindings.count<=32&&client.ownerCaptureOrder.count<=32,"lightweight capture bindings exceeded owner budget");
    for(NSDictionary* binding in client.ownerCaptureBindings.allValues)check(binding.count==4&&!binding[@"ooxml"]&&!binding[@"name"]&&!binding[@"path"],"capture binding retained XML or document names/paths");
}
void runCaptureRequestCases(){
    ProbeEditorTransport* savedTransport=transport;CaptureTestTransport* client=[CaptureTestTransport new];transport=client;
    auto makePending=[&](std::uint64_t owner){ProbeEditState* state=cacheState(owner,10,12,@"<never-reused/>");state.sessionId=owner+1000;state.activation=++client.activation;state.awaitingDocument=YES;state.requiresDocumentCapture=YES;state.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:3];client.edits[@(state.sessionId)]=state;return state;};
    auto remember=[&](ProbeEditState* state){state.documentEpoch=client.documentEpoch;state.editGeneration=client.cacheGeneration;[client rememberDocument:state];};
    ProbeEditState* first=makePending(11);remember(first);[client invalidateDocuments];
    check(client.documentBytes==0&&!client.documentSnapshots.count&&client.ownerCaptureBindings.count==1,"write invalidation lost tiny anchor or retained XML");
    [client requestCapture:first];auto token=client.captureRequest.token;check(token>0,"verified owner did not request fresh capture");
    [client requestCapture:first];check(client.captureRequest.token==token,"repeated context checks duplicated a capture request");
    [client begin:first.sessionId native:nil];check(client.captureRequest.token==token&&client.captureRequest.activation==first.activation,"repeat DoVerb invalidated the same pending request");
    client.applying=YES;check(MathTypeBridgeTakeDocumentCaptureRequest()==0,"capture request was claimed reentrantly inside SaveObject");client.applying=NO;
    check(MathTypeBridgeTakeDocumentCaptureRequest()==token&&MathTypeBridgeTakeDocumentCaptureRequest()==0,"capture request was not one-shot");
    check(MathTypeBridgeDocumentCaptureSnapshot()==10&&MathTypeBridgeDocumentCaptureIndex()==13&&MathTypeBridgeDocumentCaptureIdentity()==1,"capture request changed its precise live anchor");
    [client begin:first.sessionId native:nil];check(client.captureRequest.token==token,"repeat DoVerb duplicated a claimed capture");
    client.testDocumentContext=@{@"identity":@"process:1",@"snapshot":@11,@"index":@14,@"name":@"ignored.docx",@"ooxml":@"<new-index-after-insertion/>"};
    EquationLabDocumentContextDidCapture();check(!client.openedContexts,"claimed capture opened before finish validation");
    check(MathTypeBridgeFinishDocumentCaptureRequest()==0&&client.openedContexts==1&&[first.documentContext[@"index"] intValue]==14,"requested capture could not rebind a live Range to its fresh index");
    [client cleanup:first.sessionId];

    client.testDocumentContext=nil;documentCapturedAt=nil;ProbeEditState* foreign=makePending(12);[client requestCapture:foreign];check(!client.captureRequest,"different owner with identical Native borrowed a capture anchor");[client cleanup:foreign.sessionId];
    ProbeEditState* wrongSha=makePending(11);wrongSha.openDigest=@"untracked-native-change";[client requestCapture:wrongSha];check(!client.captureRequest,"untracked Native SHA inherited a live capture anchor");[client cleanup:wrongSha.sessionId];

    ProbeEditState* stale=makePending(11);[client requestCapture:stale];auto oldToken=MathTypeBridgeTakeDocumentCaptureRequest();check(oldToken>0,"latest request setup");
    ProbeEditState* latest=makePending(22);latest.documentContext=@{@"identity":@"other-process:2",@"snapshot":@20,@"index":@4,@"name":@"same-name.docx",@"ooxml":@"<other-document/>"};remember(latest);[client invalidateDocuments];[client requestCapture:latest];
    auto newToken=MathTypeBridgeTakeDocumentCaptureRequest();check(newToken>0&&newToken!=oldToken&&MathTypeBridgeDocumentCaptureSnapshot()==20&&MathTypeBridgeDocumentCaptureIdentity()==2,"latest activation reused the superseded owner's request");
    client.testDocumentContext=@{@"identity":@"process:1",@"snapshot":@21,@"index":@4,@"name":@"same-name.docx",@"ooxml":@"<foreign/>"};++client.captureSerial;documentCapturedAt=NSDate.date;
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-3&&!client.edits[@(latest.sessionId)]&&!client.captureRequest,"foreign-document response was accepted or left its session busy");[client cleanup:stale.sessionId];

    ProbeEditState* retry=makePending(22);[client requestCapture:retry];check(MathTypeBridgeTakeDocumentCaptureRequest()>0,"rejected capture left owner unable to retry");
    client.testDocumentContext=@{@"identity":@"other-process:2",@"snapshot":@20,@"index":@4,@"name":@"same-name.docx",@"ooxml":@"<old-xml/>"};++client.captureSerial;documentCapturedAt=NSDate.date;
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-3&&!client.edits[@(retry.sessionId)],"capture request accepted an old serialized snapshot");
    ProbeEditState* clear=makePending(22);[client requestCapture:clear];check(MathTypeBridgeTakeDocumentCaptureRequest()>0,"document clear setup");EquationLabDocumentContextDidClear();
    check(!client.captureRequest&&!client.ownerCaptureBindings.count&&!client.documentSnapshots.count&&!client.edits.count&&MathTypeBridgeCaptureWatch()==0,"document close/switch retained a pending request, owner anchor or busy edit");
    ProbeEditState* closed=makePending(33);remember(closed);[client forgetOwner:33];check(!client.ownerCaptureBindings.count&&!client.documentSnapshots.count,"owner close retained capture metadata/XML");[client cleanup:closed.sessionId];
    ProbeEditState* expired=makePending(44);remember(expired);[client invalidateDocuments];[client requestCapture:expired];expired.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];
    check(MathTypeBridgeTakeDocumentCaptureRequest()==0&&!client.captureRequest&&!client.edits.count&&lastCaptureState==CaptureTimedOut,"expired unclaimed capture remained busy or could still be claimed");
    ProbeEditState* expiredResponse=makePending(44);[client requestCapture:expiredResponse];check(MathTypeBridgeTakeDocumentCaptureRequest()>0,"timeout left owner unable to retry");expiredResponse.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-4&&!client.captureRequest&&!client.edits.count,"late capture response reopened an expired session");EquationLabDocumentContextDidClear();
    transport=savedTransport;
}
}
int main(){@autoreleasepool{
    try {
        NSArray<NSString*>* urls=@[@"equationlab://wake",[@"equationlab://word-edit/" stringByAppendingString:[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0]]];
        for(NSString* url in urls){runCase(url,YES,NO,NO);runCase(url,NO,NO,NO);runCase(url,YES,YES,NO);runCase(url,YES,NO,YES);}
        runRunningCase(urls[1],NO);runRunningCase(urls[1],YES);
        runCooperativeActivationCases();
        runDocumentCacheCases();
        runCaptureRequestCases();
        std::cout<<"{\"on_demand_capture_cases\":16,\"capture_same_owner_write_no_selection_event\":true,\"capture_request_latest_and_deduplicated\":true,\"capture_request_live_anchor_and_native_sha_guard\":true,\"capture_request_document_clear_close_release\":true,\"capture_request_no_xml_in_tiny_binding\":true,\"capture_request_rejects_old_or_foreign_snapshot\":true,\"capture_request_no_saveobject_reentry\":true,\"capture_request_failure_retryable\":true,\"capture_request_rebinds_fresh_index\":true,";
        std::cout<<"\"cases\":16,\"cooperative_focus_yield_cases\":6,\"wake_and_inactive_host_do_not_yield\":true,\"stable_bundle_id\":\"app.equationlab.mac\",\"running_copy_preferred\":true,\"wake_and_edit_use_explicit_application\":true,\"foreground_deferred_until_app_accepts_ticket\":true,\"missing_app_is_launch_failure\":true,\"open_error_is_launch_failure\":true,\"missing_running_app_is_launch_failure\":true,\"default_handler_never_used\":true,\"document_cache_shared_snapshot\":true,\"document_cache_owner_limit\":32,\"document_cache_snapshot_limit\":4,\"document_cache_byte_limit\":33554432,\"document_cache_clear_and_close_release_xml\":true,\"document_cache_sha_guard\":true,\"real_workspace_or_gui_used\":false}\n";
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}}
