// Include the implementation to exercise its private production launcher;
// no testing symbol or mutable launcher hook is added to the shipping bundle.
#include "editor_transport.mm"
#include <iostream>
#include <stdexcept>

namespace { NSDictionary* fixtureDocumentContext; BOOL fixtureSelectionPending=NO; NSDictionary* fixtureActivationAnchor; NSDictionary* fixturePreCapturedActivation; BOOL emulateDeferredReopen=NO; NSString* reopenedDocumentIdentity=@"process:77"; }
NSDictionary* EquationLabCapturedDocumentContext(){return fixtureDocumentContext;}
BOOL EquationLabDocumentContextIsPendingSelection(NSDictionary* context){return context&&fixtureSelectionPending&&context==fixtureDocumentContext;}
void EquationLabConsumeDocumentSelection(NSDictionary* context){if(EquationLabDocumentContextIsPendingSelection(context)){fixtureDocumentContext=nil;fixtureSelectionPending=NO;EquationLabDocumentContextDidClearSelection();}}
void EquationLabSetNavigationTarget(std::int32_t){}
std::int32_t EquationLabNewDocumentToken(){static std::int32_t token=100;return ++token;}
BOOL EquationLabArmDocumentActivationAnchor(NSDictionary* context){
    if(![context[@"identity"] isKindOfClass:NSString.class]||![context[@"snapshot"] isKindOfClass:NSNumber.class]||![context[@"index"] isKindOfClass:NSNumber.class])return NO;
    fixtureActivationAnchor=@{@"identity":context[@"identity"],@"snapshot":context[@"snapshot"],@"index":context[@"index"]};return YES;
}
NSDictionary* EquationLabTakeDocumentActivationAnchor(){NSDictionary* result=fixtureActivationAnchor;fixtureActivationAnchor=nil;return result;}
void EquationLabClearDocumentActivationAnchor(){fixtureActivationAnchor=nil;}
BOOL EquationLabActivationAnchorIsPending(){return fixtureActivationAnchor!=nil;}
NSDictionary* EquationLabTakePreCapturedDocumentActivation(){NSDictionary* result=fixturePreCapturedActivation;fixturePreCapturedActivation=nil;return result;}
BOOL EquationLabPreCapturedActivationIsPending(){return [fixturePreCapturedActivation[@"_preCapturedActivation"] boolValue];}

namespace bridge_probe {
void setEditorHooks(OpenEditor,void*){}
void setEditorCancelHook(CancelEditor){}
void setEditorOwnerForgetHook(ForgetEditorOwner){}
void setEditorOwnerWrittenHook(EditorOwnerWritten){}
std::uint64_t editObjectIdentity(std::uint64_t){return 0;}
bool bindEditDocument(std::uint64_t,const char*){return true;}
std::int32_t diagnosticValue(std::uint32_t){return 0;}
HResult completeEdit(std::uint64_t session,const std::uint8_t*,std::size_t,bool,bool reopen){
    ProbeEditState* old=transport.edits[@(session)];std::uint64_t owner=old.ownerIdentity;
    [transport cleanup:session];
    if(reopen&&emulateDeferredReopen){
        ProbeEditState* fresh=[ProbeEditState new];fresh.sessionId=session+1000;fresh.activation=++transport.activation;fresh.ownerIdentity=owner;fresh.ticket=[@"e" stringByPaddingToLength:64 withString:@"e" startingAtIndex:0];
        fresh.documentContext=@{@"identity":reopenedDocumentIdentity,@"snapshot":@772,@"index":@12};transport.edits[@(fresh.sessionId)]=fresh;
        NSDictionary* handoff=transport.reopenToolHandoff;transport.reopenToolHandoff=nil;
        if([handoff[@"owner"] unsignedLongLongValue]==owner)fresh.deferredReopenTool=handoff;
        [transport openState:fresh];
    }
    return Ok;
}
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

@interface ReopenToolHandoffTestTransport : ProbeEditorTransport
@property(nonatomic,strong) NSString* reopenedURL;
@end
@implementation ReopenToolHandoffTestTransport
- (void)openState:(ProbeEditState*)state {[self applyDeferredReopenTool:state];self.reopenedURL=editorLaunchURL(state);}
@end
@implementation CaptureTestTransport
- (void)openState:(ProbeEditState*)state {if(state.documentContext)++self.openedContexts;}
@end

@interface ServiceBodyTestTransport : ProbeEditorTransport
@property(nonatomic,strong) NSDictionary* submittedBody;
@end
@implementation ServiceBodyTestTransport
- (ProbeJsonRequest*)request:(NSString*)path body:(NSDictionary*)body reply:(ProbeReply)reply {
    (void)reply;
    if([path isEqual:@"/api/native-open"])self.submittedBody=body;
    return nil;
}
@end

@interface MockTicketLaunchTransport : ProbeEditorTransport
@property(nonatomic,strong) NSMutableArray<NSString*>* attemptedURLs;
@property(nonatomic,strong) NSMutableArray* outcomes;
@property(nonatomic,copy) void(^queuedCompletion)(NSError*);
@property(nonatomic) NSUInteger scheduledPolls;
@end
@implementation MockTicketLaunchTransport
- (instancetype)init {self=[super init];if(self){_attemptedURLs=[NSMutableArray new];_outcomes=[NSMutableArray new];}return self;}
- (void)openEditorURL:(NSString*)url completion:(void(^)(NSError*))completion {
    [self.attemptedURLs addObject:url];
    if(self.queuedCompletion){self.queuedCompletion=[completion copy];return;}
    id outcome=self.outcomes.count?self.outcomes.firstObject:NSNull.null;
    if(self.outcomes.count)[self.outcomes removeObjectAtIndex:0];
    completion(outcome==NSNull.null?nil:outcome);
}
- (void)schedule:(ProbeEditState*)state {++self.scheduledPolls;state.pollScheduled=YES;}
@end

@interface RejectingPreCaptureTransport : ProbeEditorTransport
@property(nonatomic) NSUInteger nativeOpenRequests;
@property(nonatomic,strong) NSDictionary* submittedBody;
@end
@implementation RejectingPreCaptureTransport
- (ProbeJsonRequest*)request:(NSString*)path body:(NSDictionary*)body reply:(ProbeReply)reply {
    if([path isEqual:@"/api/native-open"]){
        ++self.nativeOpenRequests;self.submittedBody=body;
        dispatch_async(dispatch_get_main_queue(),^{reply(nil,[NSError errorWithDomain:@"MockService" code:422 userInfo:nil]);});
    }
    return nil;
}
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
void runTicketToolCases(){
    auto saved=transport;transport=[ProbeEditorTransport new];transport.activation=12;
    ProbeEditState* old=[ProbeEditState new];old.activation=11;old.sessionId=1;old.ticket=[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0];transport.edits[@1]=old;
    check(EquationLabQueueEditorTool(@"spacing")==-3&&!old.toolIntent,"tool attached to an obsolete activation");
    ProbeEditState* latest=[ProbeEditState new];latest.activation=12;latest.sessionId=2;transport.edits[@2]=latest;
    check(EquationLabQueueEditorTool(@"spacing")==0&&[latest.toolIntent isEqual:@"spacing"]&&!old.toolIntent,"tool not bound to the exact pending edit activation");
    latest.ticket=[@"b" stringByPaddingToLength:64 withString:@"b" startingAtIndex:0];
    check([editorLaunchURL(latest) isEqual:[@"equationlab://word-edit/" stringByAppendingFormat:@"%@?tool=spacing",latest.ticket]],"tool URL lost its edit ticket");
    latest.documentRequestId=[@"c" stringByPaddingToLength:64 withString:@"c" startingAtIndex:0];
    check([editorLaunchURL(latest) isEqual:[@"equationlab://word-edit/" stringByAppendingFormat:@"%@?tool=spacing&request=%@",latest.ticket,latest.documentRequestId]],"document request correlation was not combined with the existing tool query");
    latest.toolIntent=nil;
    check([editorLaunchURL(latest) isEqual:[@"equationlab://word-edit/" stringByAppendingFormat:@"%@?request=%@",latest.ticket,latest.documentRequestId]],"document request correlation was omitted without a tool intent");
    latest.documentRequestId=nil;
    check([editorLaunchURL(latest) isEqual:[@"equationlab://word-edit/" stringByAppendingString:latest.ticket]],"an ordinary double-click inherited stale document request correlation");
    check(EquationLabQueueEditorTool(@"invalid?tool=export")==-1,"unrecognized tool accepted");
    latest.terminal=YES;check(EquationLabQueueEditorTool(@"export")==-3,"terminal edit accepted a tool intent");transport=saved;
}
void runDeferredReopenToolHandoffCases(){
    ProbeEditorTransport* savedTransport=transport;BOOL savedEmulation=emulateDeferredReopen;NSString* savedIdentity=reopenedDocumentIdentity;
    ReopenToolHandoffTestTransport* client=[ReopenToolHandoffTestTransport new];client.activation=91;transport=client;emulateDeferredReopen=YES;reopenedDocumentIdentity=@"process:77";
    ProbeEditState* old=[ProbeEditState new];old.sessionId=910;old.activation=91;old.ownerIdentity=77;old.reopenRequested=YES;old.bindingContext=@{@"identity":@"process:77",@"index":@12};client.edits[@910]=old;
    check(EquationLabQueueEditorTool(@"spacing")==0,"same-owner deferred reopen rejected a current spacing intent");
    check([client completeCancelledState:old]==bridge_probe::Ok,"same-owner cancelled reopen did not complete");
    NSString* expected=[@"equationlab://word-edit/" stringByAppendingFormat:@"%@?tool=spacing",[@"e" stringByPaddingToLength:64 withString:@"e" startingAtIndex:0]];
    check([client.reopenedURL isEqual:expected],"immediate cancel/reopen lost the queued tool marker on the fresh ticket");

    client.reopenedURL=nil;client.activation=92;reopenedDocumentIdentity=@"process:88";
    ProbeEditState* wrongDocument=[ProbeEditState new];wrongDocument.sessionId=911;wrongDocument.activation=92;wrongDocument.ownerIdentity=78;wrongDocument.reopenRequested=YES;wrongDocument.bindingContext=@{@"identity":@"process:77",@"index":@12};client.edits[@911]=wrongDocument;
    check(EquationLabQueueEditorTool(@"export")==0,"mismatched-document test did not queue its tool intent");
    NSString* expectedWithoutTool=[@"equationlab://word-edit/" stringByAppendingString:[@"e" stringByPaddingToLength:64 withString:@"e" startingAtIndex:0]];
    check([client completeCancelledState:wrongDocument]==bridge_probe::Ok&&[client.reopenedURL isEqual:expectedWithoutTool],"deferred tool intent crossed a document identity");
    [client cleanup:1010];[client cleanup:1011];transport=savedTransport;emulateDeferredReopen=savedEmulation;reopenedDocumentIdentity=savedIdentity;
}
void pumpUntil(BOOL(^predicate)(void),double seconds,const char* message){
    const auto deadline=CFAbsoluteTimeGetCurrent()+seconds;
    while(!predicate()&&CFAbsoluteTimeGetCurrent()<deadline)CFRunLoopRunInMode(kCFRunLoopDefaultMode,.01,true);
    check(predicate(),message);
}
void runTicketLaunchRetryCases(){
    ProbeEditorTransport* savedTransport=transport;
    auto make=[&](std::uint64_t session,std::uint64_t activation){
        MockTicketLaunchTransport* client=[MockTicketLaunchTransport new];client.activation=activation;
        ProbeEditState* state=[ProbeEditState new];state.sessionId=session;state.activation=activation;
        state.ticket=[@"d" stringByPaddingToLength:64 withString:@"d" startingAtIndex:0];
        client.edits[@(session)]=state;transport=client;return std::pair<MockTicketLaunchTransport*,ProbeEditState*>(client,state);
    };
    {
        auto first=make(801,41);auto client=first.first;auto state=first.second;
        [client.outcomes addObject:[NSError errorWithDomain:@"LaunchServices" code:409 userInfo:@{@"retryable":@YES}]];[client.outcomes addObject:NSNull.null];
        [client launchTicket:state];
        pumpUntil(^{return client.attemptedURLs.count==2&&state.pollScheduled;},2,"transient ticket launch failure did not recover");
        check(client.attemptedURLs.count==2&&[client.attemptedURLs[0] isEqual:client.attemptedURLs[1]],"ticket retry changed its URL");
        check(state.launchAttempts==2&&[client.attemptedURLs[0] isEqual:editorLaunchURL(state)],"ticket retry did not reuse the original editor URL");
        [client cleanup:state.sessionId];
    }
    {
        auto second=make(802,42);auto client=second.first;auto state=second.second;
        [client.outcomes addObject:[NSError errorWithDomain:@"LaunchServices" code:409 userInfo:@{@"retryable":@YES}]];[client.outcomes addObject:[NSError errorWithDomain:@"LaunchServices" code:409 userInfo:@{@"retryable":@YES}]];
        [client launchTicket:state];
        pumpUntil(^{return client.attemptedURLs.count==2&&!client.edits[@(state.sessionId)];},2,"exhausted ticket launch did not fail cleanly");
        check(state.terminal&&client.edits.count==0&&state.launchAttempts==2,"exhausted ticket launch left an active edit");
    }
    {
        auto third=make(803,43);auto client=third.first;auto state=third.second;
        [client.outcomes addObject:[NSError errorWithDomain:@"LaunchServices" code:409 userInfo:@{@"retryable":@YES}]];
        [client launchTicket:state];pumpUntil(^{return client.attemptedURLs.count==1&&state.launchAttempts==1;},1,"initial launch failure was not observed");
        [client cleanup:state.sessionId];CFRunLoopRunInMode(kCFRunLoopDefaultMode,.2,false);
        check(client.attemptedURLs.count==1,"cancelled ticket launched after delayed retry");
    }
    {
        auto fourth=make(804,44);auto client=fourth.first;auto state=fourth.second;
        [client.outcomes addObject:[NSError errorWithDomain:@"LaunchServices" code:409 userInfo:@{@"retryable":@YES}]];
        [client launchTicket:state];pumpUntil(^{return client.attemptedURLs.count==1&&state.launchAttempts==1;},1,"initial launch failure was not observed before owner switch");
        client.activation=45;ProbeEditState* owner=[ProbeEditState new];owner.sessionId=805;owner.activation=45;client.edits[@805]=owner;
        CFRunLoopRunInMode(kCFRunLoopDefaultMode,.2,false);
        check(client.attemptedURLs.count==1&&client.edits[@805]==owner,"stale activation launched after a new owner became current");
        [client cleanup:state.sessionId];[client cleanup:owner.sessionId];
    }
    {
        auto fifth=make(806,46);auto client=fifth.first;auto state=fifth.second;
        state.launchURL=@"equationlab://word-edit/test-ticket";client.queuedCompletion=^(NSError*){};
        [client launchTicket:state];
        auto delivered=client.queuedCompletion;client.queuedCompletion=nil;
        check(client.attemptedURLs.count==1&&client.scheduledPolls==0,"queued launch unexpectedly polled before completion");
        client.activation=47;ProbeEditState* owner=[ProbeEditState new];owner.sessionId=807;owner.activation=47;client.edits[@807]=owner;
        delivered(nil);
        pumpUntil(^{return client.scheduledPolls==1;},2,"successful stale-activation launch did not schedule polling");
        check(client.scheduledPolls==1&&client.edits[@806]==state&&client.edits[@807]==owner,"old delivered ticket did not remain pollable beside the new owner");
        [client cleanup:owner.sessionId];
    }
    transport=savedTransport;
}
ProbeEditState* cacheState(std::uint64_t owner,NSUInteger snapshot,NSUInteger index,NSString* xml){
    ProbeEditState* state=[ProbeEditState new];state.ownerIdentity=owner;state.openDigest=@"same-native-sha";
    state.documentContext=@{@"identity":@"process:1",@"snapshot":@(snapshot),@"index":@(index),@"name":@"same-name.docx",@"ooxml":xml};return state;
}
void runDocumentCacheCases(){
    ProbeEditorTransport* client=[ProbeEditorTransport new];NSString* xml=@"<shared-document/>";
    auto remember=[&](ProbeEditState* state){state.documentEpoch=client.documentEpoch;state.editGeneration=client.cacheGeneration;[client rememberDocument:state];};
    ProbeEditState* sameNativeA=cacheState(70,70,5,xml);sameNativeA.documentContext=@{@"identity":@"process:70",@"snapshot":@70,@"index":@5,@"name":@"same-name.docx",@"ooxml":xml};
    ProbeEditState* sameNativeB=cacheState(71,71,5,xml);sameNativeB.documentContext=@{@"identity":@"process:71",@"snapshot":@71,@"index":@5,@"name":@"same-name.docx",@"ooxml":xml};
    remember(sameNativeA);remember(sameNativeB);
    check([[client documentForOwner:sameNativeA][@"identity"] isEqual:@"process:70"]&&[[client documentForOwner:sameNativeB][@"identity"] isEqual:@"process:71"],"identical Native hashes in same-named documents shared owner identity");
    [client forgetOwner:70];check([client documentForOwner:sameNativeB]!=nil,"releasing one same-Native owner removed the other document's binding");[client forgetOwner:71];
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
    NSDictionary* clearHint=@{@"identity":@"process:99",@"snapshot":@99,@"index":@1};
    check(EquationLabArmDocumentActivationAnchor(clearHint),"document-clear activation setup");EquationLabDocumentContextDidClear();
    check(!EquationLabActivationAnchorIsPending(),"document clear retained an armed activation hint");
    check(EquationLabArmDocumentActivationAnchor(clearHint),"document-close activation setup");EquationLabDocumentContextDidCloseIdentity(99);
    check(!EquationLabActivationAnchorIsPending(),"document close retained an armed activation hint");
    auto makePending=[&](std::uint64_t owner){ProbeEditState* state=cacheState(owner,10,12,@"<never-reused/>");state.sessionId=owner+1000;state.activation=++client.activation;state.awaitingDocument=YES;state.requiresDocumentCapture=YES;state.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:8];client.edits[@(state.sessionId)]=state;return state;};
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
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.15]];
    client.testDocumentContext=@{@"identity":@"process:1",@"snapshot":@11,@"index":@12,@"captureToken":@(token),@"name":@"ignored.docx",@"ooxml":@"<fresh-after-delay/>"};
    EquationLabDocumentContextDidCapture();check(!client.openedContexts,"claimed capture opened before finish validation");
    check(MathTypeBridgeFinishDocumentCaptureRequest()==0&&client.openedContexts==1&&[first.documentContext[@"index"] intValue]==12,"capture taking more than one second did not rebind the exact live Range");
    [client cleanup:first.sessionId];

    ProbeEditState* anchored=makePending(13);
    NSDictionary* activation=@{@"identity":@"process:9",@"snapshot":@90,@"index":@4};
    check(EquationLabArmDocumentActivationAnchor(activation)&&EquationLabActivationAnchorIsPending(),"precise preactivation hint was not armed");
    EquationLabDocumentContextDidClearSelection();check(EquationLabActivationAnchorIsPending(),"ordinary selection clear discarded the preactivation hint");
    [client begin:anchored.sessionId native:nil];
    check(!EquationLabActivationAnchorIsPending()&&client.captureRequest&&client.captureRequest.binding,"DoVerb did not consume the exact hint into a fresh capture request");
    auto anchoredToken=MathTypeBridgeTakeDocumentCaptureRequest();
    check(anchoredToken>0&&MathTypeBridgeDocumentCaptureSnapshot()==90&&MathTypeBridgeDocumentCaptureIndex()==5&&MathTypeBridgeDocumentCaptureIdentity()==9,"selection-loss request did not retain the hinted Doc+Range");
    client.testDocumentContext=@{@"identity":@"process:9",@"snapshot":@90,@"index":@4,@"captureToken":@(anchoredToken),@"name":@"same-name.docx",@"ooxml":@"<identical-formula/>"};EquationLabDocumentContextDidCapture();
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-3&&client.captureRequest,"stale preactivation snapshot was accepted as the fresh ELCTX4 response");
    auto foreignAnchorToken=MathTypeBridgeTakeDocumentCaptureRequest();
    check(foreignAnchorToken>0&&MathTypeBridgeDocumentCaptureSnapshot()==90&&MathTypeBridgeDocumentCaptureIndex()==5&&MathTypeBridgeDocumentCaptureIdentity()==9,"stale response replaced the retained exact target");
    client.testDocumentContext=@{@"identity":@"other-process:10",@"snapshot":@91,@"index":@4,@"captureToken":@(foreignAnchorToken),@"name":@"same-name.docx",@"ooxml":@"<identical-formula/>"};EquationLabDocumentContextDidCapture();
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-3&&client.captureRequest,"identical formula from a foreign document satisfied the one-shot hint");
    auto anchoredRetry=MathTypeBridgeTakeDocumentCaptureRequest();
    check(anchoredRetry>0&&MathTypeBridgeDocumentCaptureSnapshot()==90&&MathTypeBridgeDocumentCaptureIndex()==5&&MathTypeBridgeDocumentCaptureIdentity()==9,"foreign response replaced the retained exact target");
    client.testDocumentContext=@{@"identity":@"process:9",@"snapshot":@91,@"index":@4,@"captureToken":@(anchoredRetry),@"name":@"same-name.docx",@"ooxml":@"<identical-formula/>"};EquationLabDocumentContextDidCapture();
    check(MathTypeBridgeFinishDocumentCaptureRequest()==0&&anchored.documentContext&&[anchored.documentContext[@"snapshot"] intValue]==91&&[anchored.documentContext[@"index"] intValue]==4,"fresh ELCTX4 did not resolve the exact retained target after selection loss");
    [client cleanup:anchored.sessionId];

    client.testDocumentContext=nil;documentCapturedAt=nil;ProbeEditState* foreign=makePending(12);[client requestCapture:foreign];check(client.captureRequest&&!client.captureRequest.binding,"an unbound owner did not receive its own on-demand capture request");
    auto foreignToken=MathTypeBridgeTakeDocumentCaptureRequest();
    check(foreignToken>0&&MathTypeBridgeDocumentCaptureRequestToken()==foreignToken&&MathTypeBridgeDocumentCaptureSnapshot()==0&&MathTypeBridgeDocumentCaptureIndex()==0&&MathTypeBridgeDocumentCaptureIdentity()==0,"unbound first activation exposed a fabricated equation index to VBA");
    client.testDocumentContext=@{@"identity":@"process:2",@"snapshot":@31,@"index":@12,@"captureToken":@(foreignToken),@"name":@"same-name.docx",@"ooxml":@"<same-native-other-document/>"};EquationLabDocumentContextDidCapture();
    check(MathTypeBridgeFinishDocumentCaptureRequest()==0&&[foreign.documentContext[@"identity"] isEqual:@"process:2"],"identical Native from a different document borrowed the previous document identity");[client cleanup:foreign.sessionId];
    ProbeEditState* wrongSha=makePending(11);wrongSha.openDigest=@"untracked-native-change";[client requestCapture:wrongSha];check(!client.captureRequest,"untracked Native SHA inherited a live capture anchor");[client cleanup:wrongSha.sessionId];

    ProbeEditState* strict=makePending(11);[client requestCapture:strict];auto strictToken=MathTypeBridgeTakeDocumentCaptureRequest();
    client.testDocumentContext=@{@"identity":@"other-process:9",@"snapshot":@12,@"index":@12,@"captureToken":@(strictToken),@"name":@"same-name.docx",@"ooxml":@"<wrong-document/>"};EquationLabDocumentContextDidCapture();
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-3&&client.captureRequest&&!strict.terminal,"bound recapture accepted a different document or failed without retry");
    auto indexRetry=MathTypeBridgeTakeDocumentCaptureRequest();client.testDocumentContext=@{@"identity":@"process:1",@"snapshot":@13,@"index":@13,@"captureToken":@(indexRetry),@"name":@"same-name.docx",@"ooxml":@"<wrong-index/>"};EquationLabDocumentContextDidCapture();
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-3&&client.captureRequest&&!strict.terminal,"bound recapture accepted a different formula index or failed without retry");
    auto exactRetry=MathTypeBridgeTakeDocumentCaptureRequest();client.testDocumentContext=@{@"identity":@"process:1",@"snapshot":@14,@"index":@12,@"captureToken":@(exactRetry),@"name":@"same-name.docx",@"ooxml":@"<same-native-exact-anchor/>"};EquationLabDocumentContextDidCapture();
    check(MathTypeBridgeFinishDocumentCaptureRequest()==0&&[strict.documentContext[@"index"] intValue]==12,"strict bound recapture did not accept its exact identity/index/Native binding");[client cleanup:strict.sessionId];

    ProbeEditState* stale=makePending(11);[client requestCapture:stale];auto oldToken=MathTypeBridgeTakeDocumentCaptureRequest();check(oldToken>0,"latest request setup");
    ProbeEditState* latest=makePending(22);latest.documentContext=@{@"identity":@"other-process:2",@"snapshot":@20,@"index":@4,@"name":@"same-name.docx",@"ooxml":@"<other-document/>"};remember(latest);[client invalidateDocuments];[client requestCapture:latest];
    auto newToken=MathTypeBridgeTakeDocumentCaptureRequest();check(newToken>0&&newToken!=oldToken&&MathTypeBridgeDocumentCaptureSnapshot()==20&&MathTypeBridgeDocumentCaptureIdentity()==2,"latest activation reused the superseded owner's request");
    client.testDocumentContext=@{@"identity":@"process:1",@"snapshot":@21,@"index":@4,@"captureToken":@(oldToken),@"name":@"same-name.docx",@"ooxml":@"<superseded/>"};EquationLabDocumentContextDidCapture();
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-3&&client.captureRequest&&client.edits[@(latest.sessionId)],"superseded capture token was accepted or did not retry the active owner");[client cleanup:stale.sessionId];

    ProbeEditState* clear=makePending(22);[client requestCapture:clear];auto clearedToken=MathTypeBridgeTakeDocumentCaptureRequest();check(clearedToken>0,"document clear setup");EquationLabDocumentContextDidClear();
    check(client.captureRequest&&!client.captureRequest.claimed&&client.captureRequest.token!=clearedToken&&client.ownerCaptureBindings[@22]&&!client.documentSnapshots.count&&client.edits[@(clear.sessionId)]&&MathTypeBridgeCaptureWatch()!=0,"global document clear lost its live owner anchor or failed to issue a fresh request");
    [client forgetOwner:22];check(!client.ownerCaptureBindings[@22]&&!client.captureRequest,"exact owner release did not retire its capture binding and pending request");[client cleanup:clear.sessionId];
    auto bindingsBeforeClose=client.ownerCaptureBindings.count;ProbeEditState* closed=makePending(33);remember(closed);[client forgetOwner:33];check(client.ownerCaptureBindings.count==bindingsBeforeClose&&!client.documentSnapshots.count,"owner close did not retire only the released owner's metadata/XML");[client cleanup:closed.sessionId];
    ProbeEditState* documentClosed=cacheState(54,54,0,@"<closed-document/>");documentClosed.documentContext=@{@"identity":@"process:54",@"snapshot":@54,@"index":@0,@"name":@"closed.docx",@"ooxml":@"<closed-document/>"};remember(documentClosed);
    ProbeEditState* otherDocument=cacheState(55,55,0,@"<open-document/>");otherDocument.documentContext=@{@"identity":@"process:55",@"snapshot":@55,@"index":@0,@"name":@"open.docx",@"ooxml":@"<open-document/>"};remember(otherDocument);
    EquationLabDocumentContextDidCloseIdentity(54);
    check(!client.ownerCaptureBindings[@54]&&client.ownerCaptureBindings[@55]&&[client documentForOwner:otherDocument],"exact document close retired another document's live owner or retained the closed binding");
    ProbeEditState* written=cacheState(56,56,2,@"<before-word-replaced-ole/>");remember(written);
    bridge_probe::writtenTransportOwner(56,nullptr,0,nullptr);
    check(!client.ownerCaptureBindings[@56]&&![client documentForOwner:written]&&client.ownerCaptureBindings[@55],"written OLE retained a stale VBA Range binding or retired an unrelated owner");
    [client forgetOwner:55];
    ProbeEditState* expired=makePending(44);remember(expired);[client invalidateDocuments];[client requestCapture:expired];expired.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];
    check(MathTypeBridgeTakeDocumentCaptureRequest()==0&&!client.captureRequest&&!client.edits.count&&lastCaptureState==CaptureTimedOut,"expired unclaimed capture remained busy or could still be claimed");
    ProbeEditState* expiredResponse=makePending(44);[client requestCapture:expiredResponse];check(MathTypeBridgeTakeDocumentCaptureRequest()>0,"timeout left owner unable to retry");expiredResponse.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];
    check(MathTypeBridgeFinishDocumentCaptureRequest()==-4&&!client.captureRequest&&!client.edits.count,"late capture response reopened an expired session");EquationLabDocumentContextDidClear();
    transport=savedTransport;
}
void runPreCapturedActivationCases(){
    ProbeEditorTransport* savedTransport=transport;RejectingPreCaptureTransport* client=[RejectingPreCaptureTransport new];transport=client;
    NSDictionary* context=@{@"identity":@"process:77",@"snapshot":@770,@"index":@12,@"captureToken":@700,@"name":@"same-name.docx",@"ooxml":@"<same-formula/>",@"_preCapturedActivation":@YES};
    fixturePreCapturedActivation=context;
    check(MathTypeBridgeCaptureWatch()==1,"cold pre-captured activation did not keep Word's callback alive");
    [client begin:7700 native:[NSData dataWithBytes:"native" length:6]];
    check(client.nativeOpenRequests==1&&client.submittedBody[@"document"]&&[client.submittedBody[@"document"][@"identity"] isEqual:@"process:77"]&&[client.submittedBody[@"document"][@"index"] intValue]==12&&!client.submittedBody[@"document"][@"captureToken"]&&!client.submittedBody[@"document"][@"_preCapturedActivation"],"DoVerb did not submit the one-shot pre-captured ELCTX4 candidate directly");
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.05]];
    check(client.edits.count==0&&!client.captureRequest&&client.nativeOpenRequests==1,"service SHA rejection fell back to a post-DoVerb capture");
    fixturePreCapturedActivation=@{@"_preCaptureRejected":@YES};client.nativeOpenRequests=0;client.submittedBody=nil;
    [client begin:7701 native:[NSData dataWithBytes:"native" length:6]];
    check(client.nativeOpenRequests==0&&client.edits.count==0&&!client.captureRequest,"rejected/expired fast-path attempt launched a fallback capture");
    check(MathTypeBridgeCaptureWatch()==0,"idle transport kept the Word callback alive");
    client.backgroundSave=[ProbeBackgroundSave new];
    check(!client.backgroundSave.claimed&&MathTypeBridgeCaptureWatch()==1,"unclaimed sidebar save lost the Word callback after owner release");
    client.backgroundSave=nil;
    check(MathTypeBridgeCaptureWatch()==0,"finished sidebar save kept the callback alive");
    transport=savedTransport;
}
void runSelectionSnapshotCases(){
    ProbeEditorTransport* savedTransport=transport;CaptureTestTransport* client=[CaptureTestTransport new];transport=client;
    auto makePending=[&](std::uint64_t id){ProbeEditState* state=[ProbeEditState new];state.sessionId=id;state.ownerIdentity=id;state.openDigest=@"selection-native-sha";state.activation=++client.activation;state.awaitingDocument=YES;state.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:2];client.edits[@(id)]=state;return state;};
    fixtureDocumentContext=@{@"identity":@"process:1",@"snapshot":@7,@"index":@9,@"name":@"same-name.docx",@"ooxml":@"<full-document/>"};NSDictionary* selectedContext=fixtureDocumentContext;fixtureSelectionPending=YES;documentCapturedAt=[NSDate dateWithTimeIntervalSinceNow:-1];
    ProbeEditState* first=makePending(701);[client documentReady];
    check(client.openedContexts==1&&first.documentContext==selectedContext,"aged ELCTX3 selection snapshot was not dispatched to the first owner");
    check(!fixtureDocumentContext&&!fixtureSelectionPending&&!documentCapturedAt,"ELCTX3 selection snapshot was not consumed when dispatched");
    ProbeEditState* second=makePending(702);[client documentReady];
    check(client.openedContexts==1&&!second.documentContext,"a second owner borrowed the consumed selection snapshot");
    [client cleanup:first.sessionId];[client cleanup:second.sessionId];

    ProbeEditState* cached=cacheState(703,7,9,@"<owned-snapshot/>");cached.documentEpoch=client.documentEpoch;cached.editGeneration=client.cacheGeneration;[client rememberDocument:cached];
    auto bytes=client.documentBytes,owners=client.ownerDocuments.count,bindings=client.ownerCaptureBindings.count;
    fixtureDocumentContext=@{@"identity":@"process:1",@"snapshot":@7,@"index":@9,@"name":@"same-name.docx",@"ooxml":@"<full-document/>"};fixtureSelectionPending=YES;documentCapturedAt=NSDate.date;
    EquationLabDocumentContextDidClearSelection();fixtureDocumentContext=nil;fixtureSelectionPending=NO;
    check(client.documentBytes==bytes&&client.ownerDocuments.count==owners&&client.ownerCaptureBindings.count==bindings,"selection clear invalidated retained owner cache");

    fixtureDocumentContext=@{@"identity":@"process:1",@"snapshot":@8,@"index":@9,@"name":@"same-name.docx",@"ooxml":@"<invalidated-selection/>"};fixtureSelectionPending=YES;documentCapturedAt=nil;
    ProbeEditState* invalidated=makePending(705);auto openedAfterClear=client.openedContexts;[client documentReady];
    check(client.openedContexts==openedAfterClear&&!invalidated.documentContext,"ELCTX3 bypassed a missing capture timestamp after write/cache invalidation");
    [client cleanup:invalidated.sessionId];fixtureDocumentContext=nil;fixtureSelectionPending=NO;

    fixtureDocumentContext=@{@"identity":@"process:1",@"snapshot":@8,@"index":@9,@"name":@"same-name.docx",@"ooxml":@"<legacy-document/>"};fixtureSelectionPending=NO;documentCapturedAt=[NSDate dateWithTimeIntervalSinceNow:-1];
    ProbeEditState* expired=makePending(704);auto opened=client.openedContexts;[client documentReady];
    check(client.openedContexts==opened&&!expired.documentContext,"ELCTX2 capture unexpectedly bypassed its 0.5-second TTL");
    [client cleanup:expired.sessionId];client.testDocumentContext=nil;fixtureDocumentContext=nil;fixtureSelectionPending=NO;documentCapturedAt=nil;

    fixtureDocumentContext=@{@"identity":@"process:1",@"snapshot":@9,@"index":@9,@"name":@"same-name.docx",@"ooxml":@"<late-exact-selection/>"};NSDictionary* lateExact=fixtureDocumentContext;fixtureSelectionPending=YES;documentCapturedAt=[NSDate dateWithTimeIntervalSinceNow:-1];
    ProbeEditState* late=makePending(706);late.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];auto beforeLate=client.openedContexts;[client documentReady];
    check(client.openedContexts==beforeLate+1&&late.documentContext==lateExact&&!late.awaitingDocument,"fresh anchored capture arriving after the wall-clock deadline was discarded");
    check(!fixtureDocumentContext&&!fixtureSelectionPending&&!documentCapturedAt,"late exact selection was not consumed once dispatched");[client cleanup:late.sessionId];

    fixtureDocumentContext=@{@"identity":@"process:1",@"snapshot":@10,@"index":@10,@"name":@"same-name.docx",@"ooxml":@"<stale-legacy-capture/>"};fixtureSelectionPending=NO;documentCapturedAt=[NSDate dateWithTimeIntervalSinceNow:-1];
    ProbeEditState* staleLegacy=makePending(707);staleLegacy.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];beforeLate=client.openedContexts;[client documentReady];
    check(client.openedContexts==beforeLate&&!staleLegacy.documentContext,"wall-clock-expired legacy capture bypassed its freshness limit");[client cleanup:staleLegacy.sessionId];

    fixtureDocumentContext=@{@"identity":@"process:1",@"snapshot":@12,@"index":@10,@"name":@"same-name.docx",@"ooxml":@"<sticky-selection/>"};fixtureSelectionPending=YES;documentCapturedAt=NSDate.date;
    ProbeEditState* tokenRequired=makePending(709);tokenRequired.requiresDocumentCapture=YES;beforeLate=client.openedContexts;[client documentReady];
    check(client.openedContexts==beforeLate&&tokenRequired.awaitingDocument&&client.captureRequest.state==tokenRequired,"sticky ELCTX3 selection proved initial ownership without a fresh activation token");[client cleanup:tokenRequired.sessionId];client.captureRequest=nil;

    ProbeEditState* ended=makePending(708);ended.requiresDocumentCapture=YES;ended.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];lastCaptureState=CaptureTimedOut;[client fail:ended code:InvalidReply];
    check(!client.edits[@(ended.sessionId)]&&ended.terminal,"expired on-demand capture did not retire its state");
    fixtureDocumentContext=@{@"identity":@"process:1",@"snapshot":@11,@"index":@11,@"name":@"same-name.docx",@"ooxml":@"<post-timeout-selection/>"};fixtureSelectionPending=YES;documentCapturedAt=NSDate.date;
    beforeLate=client.openedContexts;[client documentReady];
    check(client.openedContexts==beforeLate&&!ended.documentContext,"a later exact selection resurrected a timeout-retired OLE state");
    fixtureDocumentContext=nil;fixtureSelectionPending=NO;documentCapturedAt=nil;
    transport=savedTransport;
}
}
int main(){@autoreleasepool{
    try {
        NSArray<NSString*>* urls=@[@"equationlab://wake",[@"equationlab://word-edit/" stringByAppendingString:[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0]]];
        for(NSString* url in urls){runCase(url,YES,NO,NO);runCase(url,NO,NO,NO);runCase(url,YES,YES,NO);runCase(url,YES,NO,YES);}
        runRunningCase(urls[1],NO);runRunningCase(urls[1],YES);
        runCooperativeActivationCases();
        runTicketToolCases();
        runDeferredReopenToolHandoffCases();
        runTicketLaunchRetryCases();
        ServiceBodyTestTransport* serviceClient=[ServiceBodyTestTransport new];
        ProbeEditState* serviceState=[ProbeEditState new];serviceState.sessionId=9001;serviceState.openNative=[NSData data];
        serviceState.documentContext=@{@"captureToken":@123,@"identity":@"process:1",@"snapshot":@124,@"index":@0,@"name":@"test.docx",@"ooxml":@"<document/>"};
        serviceClient.edits[@9001]=serviceState;[serviceClient openState:serviceState];
        NSDictionary* submittedDocument=serviceClient.submittedBody[@"document"];
        check(submittedDocument.count==5&&!submittedDocument[@"captureToken"]&&[submittedDocument[@"identity"] isEqual:@"process:1"]&&[submittedDocument[@"snapshot"] isEqual:@124],"internal ELCTX4 token leaked into the service's strict public document schema");
        check([serviceState.documentContext[@"captureToken"] isEqual:@123],"service serialization mutated the verified host context");
        runDocumentCacheCases();
        runCaptureRequestCases();
        runPreCapturedActivationCases();
        runSelectionSnapshotCases();
        std::cout<<"{\"on_demand_capture_cases\":16,\"capture_written_owner_anchor_invalidated\":true,\"capture_request_latest_and_deduplicated\":true,\"capture_request_live_anchor_and_native_sha_guard\":true,\"capture_request_document_clear_close_release\":true,\"capture_request_no_xml_in_tiny_binding\":true,\"capture_request_rejects_old_or_foreign_snapshot\":true,\"capture_request_no_saveobject_reentry\":true,\"capture_request_failure_retryable\":true,\"capture_request_rebinds_fresh_index\":true,\"one_shot_activation_hint_consumed_at_DoVerb\":true,\"precaptured_ELCTX4_consumed_at_DoVerb\":true,\"service_rejection_does_not_fallback_to_post_DoVerb_capture\":true,\"ordinary_selection_clear_preserves_activation_anchor\":true,\"document_clear_close_clear_activation_anchor\":true,\"foreign_identical_formula_rejected\":true,\"fresh_ELCTX4_exact_target_after_selection_loss\":true,";
        std::cout<<"\"cases\":16,\"cooperative_focus_yield_cases\":6,\"deferred_same_owner_reopen_preserves_tool_intent\":true,\"deferred_tool_intent_rejects_other_document\":true,\"ticket_launch_retry_recovers\":true,\"ticket_launch_retry_exhausts_cleanly\":true,\"ticket_launch_retry_stops_after_cancel_or_new_activation\":true,\"wake_and_inactive_host_do_not_yield\":true,\"stable_bundle_id\":\"app.equationlab.mac\",\"running_copy_preferred\":true,\"wake_and_edit_use_explicit_application\":true,\"foreground_deferred_until_app_accepts_ticket\":true,\"missing_app_is_launch_failure\":true,\"open_error_is_launch_failure\":true,\"missing_running_app_is_launch_failure\":true,\"default_handler_never_used\":true,\"document_request_url_cases\":3,\"document_cache_shared_snapshot\":true,\"document_cache_owner_limit\":32,\"document_cache_snapshot_limit\":4,\"document_cache_byte_limit\":33554432,\"document_cache_clear_and_close_release_xml\":true,\"document_cache_sha_guard\":true,\"elctx3_survives_ttl_once\":true,\"elctx3_requires_live_capture_timestamp\":true,\"selection_clear_preserves_owned_cache\":true,\"elctx2_ttl_unchanged\":true,\"late_exact_capture_beats_queued_deadline\":true,\"timeout_retirement_not_resurrected\":true,\"stale_legacy_capture_still_expires\":true,\"real_workspace_or_gui_used\":false}\n";
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}}
