#include "editor_transport.hpp"
#include "word_document_requests.hpp"
#include "word_host_pump.hpp"
#include "diagnostics.hpp"
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <mach-o/dyld.h>
#include <string>
#include <vector>
#include <atomic>
#include <cerrno>
#include <algorithm>
#include <CommonCrypto/CommonDigest.h>
#include <os/log.h>

NSDictionary* EquationLabCapturedDocumentContext();
void EquationLabDiscardDocumentParts();
BOOL EquationLabDocumentContextIsPendingSelection(NSDictionary* context);
void EquationLabConsumeDocumentSelection(NSDictionary* context);
void EquationLabSetNavigationTarget(std::int32_t index);
std::int32_t EquationLabNewDocumentToken();
BOOL EquationLabArmDocumentActivationAnchor(NSDictionary* context);
NSDictionary* EquationLabTakeDocumentActivationAnchor();
void EquationLabClearDocumentActivationAnchor();
BOOL EquationLabActivationAnchorIsPending();
NSDictionary* EquationLabTakePreCapturedDocumentActivation();
BOOL EquationLabPreCapturedActivationIsPending();

namespace {
constexpr NSUInteger MaxBlob=16*1024*1024;
constexpr NSUInteger MaxResponse=46*1024*1024;
constexpr auto WrongThread=static_cast<bridge_probe::HResult>(0x8001010eu);
std::atomic<std::uint32_t> lastError{0};
// Counts/states only; never expose a document name, path, ticket or equation.
enum : std::uint32_t { CapturePending=1,CaptureReady=2,CaptureTimedOut=3,CaptureSuperseded=4,CaptureRejected=5 };
std::atomic<std::uint32_t> lastCaptureState{0};
// Diagnostic codes contain no equation, ticket, document name, or URL.
enum : std::uint32_t { NetworkFailure=1,InvalidReply=2,LaunchFailure=3,Expired=4,ApplyFailure=5 };
NSDate* documentCapturedAt;
void logOpenPhase(const char* phase,CFAbsoluteTime started){
    static os_log_t logger=os_log_create("app.equationlab.mac","WordHostPerformance");
    os_log_info(logger,"word_open phase=%{public}s elapsed_ms=%.2f",phase,(CFAbsoluteTimeGetCurrent()-started)*1000);
}
NSString* nativeDigest(NSData* data){
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,static_cast<CC_LONG>(data.length),digest);
    NSMutableString* hex=[NSMutableString stringWithCapacity:64];for(auto value:digest)[hex appendFormat:@"%02x",value];return hex;
}
void launchEquationLabURL(NSWorkspace* workspace,NSURL* url,void(^completion)(NSError*),NSArray<NSRunningApplication*>* runningApplications=nil,NSApplication* activationSource=nil){
    // Target the shipping application's stable identity. The scheme's default
    // handler may still point at an older development app with a different ID.
    // Reuse the running copy. LaunchServices can otherwise start the older
    // /Applications copy while a newly opened build owns the edit window.
    NSArray<NSRunningApplication*>* running=runningApplications?:[NSRunningApplication runningApplicationsWithBundleIdentifier:@"app.equationlab.mac"];
    NSURL* applicationURL=nil;
    for(NSRunningApplication* app in running.reverseObjectEnumerator)if(!app.terminated&&app.bundleURL){applicationURL=app.bundleURL;break;}
    if(!applicationURL)applicationURL=[workspace URLForApplicationWithBundleIdentifier:@"app.equationlab.mac"];
    if(!applicationURL){completion([NSError errorWithDomain:@"NativeEquationTransport" code:LaunchFailure userInfo:nil]);return;}
    // The App reveals its retained editor only after this ticket's content
    // has been accepted. Activating here would flash the previous equation
    // first and then activate the same window a second time from Swift.
    NSWorkspaceOpenConfiguration* config=[NSWorkspaceOpenConfiguration configuration];config.activates=NO;
    // macOS 14+ treats activation as a cooperative request. Give the App
    // permission while Word still owns focus; it activates only after the
    // selected formula is ready. A service-only wake must not hand off focus.
    NSApplication* source=activationSource?:NSApp;
    if(source.isActive&&[url.scheme isEqualToString:@"equationlab"]&&([url.host isEqualToString:@"word-edit"]||[url.host isEqualToString:@"word-tool"]))
        [source yieldActivationToApplicationWithBundleIdentifier:@"app.equationlab.mac"];
    [workspace openURLs:@[url] withApplicationAtURL:applicationURL configuration:config completionHandler:^(NSRunningApplication* app,NSError* error){
        NSError* rawError=error?:(!app?[NSError errorWithDomain:@"NativeEquationTransport" code:LaunchFailure userInfo:nil]:nil);
        if(rawError){
            static os_log_t logger=os_log_create("app.equationlab.mac","WordHostLaunch");
            // Keep the original LaunchServices error domain/code for diagnosis.
            // Never log the URL, ticket, document, or NSError userInfo.
            os_log_error(logger,"word_launch failed domain=%{public}@ code=%ld",rawError.domain,(long)rawError.code);
            NSError* reported=[NSError errorWithDomain:@"NativeEquationTransport" code:LaunchFailure userInfo:@{NSUnderlyingErrorKey:rawError,@"retryable":@YES}];
            completion(reported);
        }else completion(nil);
    }];
}
bool nativeValid(NSData* data) {
    if(data.length<29||data.length>MaxBlob)return false;
    auto* b=static_cast<const std::uint8_t*>(data.bytes);
    auto size=static_cast<std::uint32_t>(b[8])|(static_cast<std::uint32_t>(b[9])<<8)|(static_cast<std::uint32_t>(b[10])<<16)|(static_cast<std::uint32_t>(b[11])<<24);
    return b[0]==28&&b[1]==0&&size==data.length-28;
}
bool inWord(){std::uint32_t n=0;_NSGetExecutablePath(nullptr,&n);std::vector<char> path(n+1);return _NSGetExecutablePath(path.data(),&n)==0&&std::string(path.data()).ends_with("/Contents/MacOS/Microsoft Word");}
bool connectionRefused(NSError* error,unsigned depth=0){
    if(!error||depth>4)return false;
    if([error.domain isEqualToString:NSPOSIXErrorDomain]&&error.code==ECONNREFUSED)return true;
    NSNumber* code=error.userInfo[@"_kCFStreamErrorCodeKey"],*domain=error.userInfo[@"_kCFStreamErrorDomainKey"];
    if([code isKindOfClass:NSNumber.class]&&[domain isKindOfClass:NSNumber.class]&&code.intValue==ECONNREFUSED&&domain.intValue==1)return true;
    id underlying=error.userInfo[NSUnderlyingErrorKey];return [underlying isKindOfClass:NSError.class]&&connectionRefused(underlying,depth+1);
}
}

typedef void(^ProbeReply)(NSDictionary*,NSError*);
@interface ProbeJsonRequest : NSObject <NSURLSessionDataDelegate>
@property(nonatomic,strong) NSURLSession* session;
@property(nonatomic,strong) NSURLSessionDataTask* task;
@property(nonatomic,strong) NSMutableData* response;
@property(nonatomic,copy) ProbeReply completion;
@property(nonatomic) BOOL statusValid;
@property(nonatomic) BOOL cancelled;
- (instancetype)initWithURL:(NSURL*)url body:(NSDictionary*)body completion:(ProbeReply)completion;
- (void)cancel;
@end
@interface ProbeHttpSession : NSObject <NSURLSessionDataDelegate>
@property(nonatomic,strong) NSURLSession* session;
@property(nonatomic,strong) NSMutableDictionary<NSNumber*,ProbeJsonRequest*>* requests;
+ (instancetype)shared;
@end
@implementation ProbeHttpSession
+ (instancetype)shared {static ProbeHttpSession* client;static dispatch_once_t once;dispatch_once(&once,^{client=[ProbeHttpSession new];});return client;}
- (instancetype)init {if((self=[super init])){
    _requests=[NSMutableDictionary dictionary];
    NSURLSessionConfiguration* config=NSURLSessionConfiguration.ephemeralSessionConfiguration;
    config.URLCache=nil;config.HTTPCookieStorage=nil;config.URLCredentialStorage=nil;
    config.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
    config.timeoutIntervalForRequest=10;config.timeoutIntervalForResource=15;
    _session=[NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:NSOperationQueue.mainQueue];
}return self;}
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task willPerformHTTPRedirection:(NSHTTPURLResponse*)response newRequest:(NSURLRequest*)request completionHandler:(void(^)(NSURLRequest*))completionHandler {completionHandler(nil);}
- (void)URLSession:(NSURLSession*)session dataTask:(NSURLSessionDataTask*)task didReceiveResponse:(NSURLResponse*)response completionHandler:(void(^)(NSURLSessionResponseDisposition))completionHandler {
    ProbeJsonRequest* request=self.requests[@(task.taskIdentifier)];
    if(request)[request URLSession:session dataTask:task didReceiveResponse:response completionHandler:completionHandler];else completionHandler(NSURLSessionResponseCancel);
}
- (void)URLSession:(NSURLSession*)session dataTask:(NSURLSessionDataTask*)task didReceiveData:(NSData*)data {[self.requests[@(task.taskIdentifier)] URLSession:session dataTask:task didReceiveData:data];}
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task didCompleteWithError:(NSError*)error {
    ProbeJsonRequest* request=self.requests[@(task.taskIdentifier)];[self.requests removeObjectForKey:@(task.taskIdentifier)];
    [request URLSession:session task:task didCompleteWithError:error];
}
@end
@implementation ProbeJsonRequest
- (instancetype)initWithURL:(NSURL*)url body:(NSDictionary*)body completion:(ProbeReply)completion {
    if((self=[super init])){
        _response=[NSMutableData data];_completion=[completion copy];
        ProbeHttpSession* client=[ProbeHttpSession shared];_session=client.session;
        NSMutableURLRequest* request=[NSMutableURLRequest requestWithURL:url];
        request.HTTPMethod=@"POST";[request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        request.HTTPBody=[NSJSONSerialization dataWithJSONObject:body options:0 error:nullptr];
        _task=[_session dataTaskWithRequest:request];client.requests[@(_task.taskIdentifier)]=self;[_task resume];
    }return self;
}
- (void)cancel {self.cancelled=YES;self.completion=nil;[self.task cancel];[[ProbeHttpSession shared].requests removeObjectForKey:@(self.task.taskIdentifier)];self.response=nil;self.task=nil;self.session=nil;}
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task willPerformHTTPRedirection:(NSHTTPURLResponse*)response newRequest:(NSURLRequest*)request completionHandler:(void(^)(NSURLRequest*))completionHandler {
    (void)session;(void)task;(void)response;(void)request;completionHandler(nil);
}
- (void)URLSession:(NSURLSession*)session dataTask:(NSURLSessionDataTask*)task didReceiveResponse:(NSURLResponse*)response completionHandler:(void(^)(NSURLSessionResponseDisposition))completionHandler {
    (void)session;(void)task;
    self.statusValid=[response isKindOfClass:NSHTTPURLResponse.class]&&((NSHTTPURLResponse*)response).statusCode==200;
    if(response.expectedContentLength>static_cast<long long>(MaxResponse))self.statusValid=NO;
    completionHandler(self.statusValid?NSURLSessionResponseAllow:NSURLSessionResponseCancel);
}
- (void)URLSession:(NSURLSession*)session dataTask:(NSURLSessionDataTask*)task didReceiveData:(NSData*)data {
    (void)session;(void)task;
    if(data.length>MaxResponse||self.response.length>MaxResponse-data.length){self.statusValid=NO;[self.task cancel];return;}
    [self.response appendData:data];
}
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task didCompleteWithError:(NSError*)error {
    (void)task;ProbeReply callback=self.completion;self.completion=nil;
    NSDictionary* json=nil;
    if(!error&&self.statusValid){id parsed=[NSJSONSerialization JSONObjectWithData:self.response options:0 error:&error];if([parsed isKindOfClass:NSDictionary.class])json=parsed;}
    if(!json&&!error)error=[NSError errorWithDomain:@"NativeEquationTransport" code:InvalidReply userInfo:nil];
    self.response=nil;self.task=nil;self.session=nil;
    if(callback&&!self.cancelled)callback(json,error);
}
@end

id EquationLabTransportRequest(NSString* path,NSDictionary* body,void(^completion)(NSDictionary*,NSError*)) {
    return [[ProbeJsonRequest alloc] initWithURL:[NSURL URLWithString:[@"http://127.0.0.1:37952" stringByAppendingString:path]] body:body completion:completion];
}
void EquationLabTransportLaunch(NSString* url,void(^completion)(NSError*)) {
    launchEquationLabURL(NSWorkspace.sharedWorkspace,[NSURL URLWithString:url],completion);
}

@interface ProbeEditState : NSObject
@property(nonatomic) std::uint64_t sessionId;
@property(nonatomic) CFAbsoluteTime started;
@property(nonatomic,strong) NSString* ticket;
@property(nonatomic,strong) NSString* launchURL;
@property(nonatomic) NSUInteger launchAttempts;
@property(nonatomic,strong) NSString* documentRequestId;
@property(nonatomic,strong) NSString* toolIntent;
@property(nonatomic,strong) NSDictionary* deferredReopenTool;
@property(nonatomic,strong) ProbeJsonRequest* request;
@property(nonatomic,strong) NSDate* expires;
@property(nonatomic) NSUInteger failures;
@property(nonatomic) BOOL terminal;
@property(nonatomic) BOOL opening;
@property(nonatomic,strong) NSData* openNative;
@property(nonatomic,strong) NSDictionary* documentContext;
@property(nonatomic,strong) NSDictionary* bindingContext;
@property(nonatomic,strong) NSDate* documentDeadline;
@property(nonatomic,strong) NSString* attemptedDocumentKey;
@property(nonatomic,strong) NSString* openDigest;
@property(nonatomic) std::uint64_t ownerIdentity;
@property(nonatomic) std::uint64_t documentEpoch;
@property(nonatomic) std::int32_t editGeneration;
@property(nonatomic) BOOL awaitingDocument;
@property(nonatomic) BOOL enrichingDocument;
@property(nonatomic) BOOL enrichmentStarted;
@property(nonatomic,strong) ProbeJsonRequest* enrichmentRequest;
@property(nonatomic) BOOL reopenRequested;
@property(nonatomic) NSUInteger pollGeneration;
@property(nonatomic) BOOL pollScheduled;
@property(nonatomic) std::uint64_t activation;
@property(nonatomic) BOOL captureRequested;
@property(nonatomic) BOOL requiresDocumentCapture;
@property(nonatomic) BOOL preCapturedActivation;
@property(nonatomic,strong) NSDictionary* activationBinding;
@property(nonatomic) NSUInteger captureAttempts;
@property(nonatomic,strong) NSDate* wakeDeadline;
@property(nonatomic) BOOL wakeAttempted;
@property(nonatomic) BOOL wakePending;
@property(nonatomic) NSUInteger openRetries;
@end
@implementation ProbeEditState
@end
static NSString* editorLaunchURL(ProbeEditState* state){
    NSString* url=[@"equationlab://word-edit/" stringByAppendingString:state.ticket];
    if([@[@"typography",@"spacing",@"export"] containsObject:state.toolIntent])url=[url stringByAppendingFormat:@"?tool=%@",state.toolIntent];
    if(state.documentRequestId.length)url=[url stringByAppendingFormat:@"%@request=%@",[url containsString:@"?"]?@"&":@"?",state.documentRequestId];
    return url;
}

@interface ProbeBackgroundSave : NSObject
@property(nonatomic,strong) NSString* ticket;
@property(nonatomic,strong) NSString* session;
@property(nonatomic,strong) NSData* native;
@property(nonatomic,strong) NSData* pdf;
@property(nonatomic,strong) NSString* expectedDigest;
@property(nonatomic,strong) NSDictionary* binding;
@property(nonatomic) bridge_probe::SizeL extent;
@property(nonatomic) std::int32_t index;
@property(nonatomic) BOOL claimed;
@property(nonatomic,strong) NSDictionary* numbering;
@property(nonatomic) NSUInteger numberingCursor;
@property(nonatomic) BOOL nativeApplied;
@end
@implementation ProbeBackgroundSave
@end

@interface ProbeCaptureRequest : NSObject
@property(nonatomic,weak) ProbeEditState* state;
@property(nonatomic,strong) NSDictionary* binding;
@property(nonatomic) std::int32_t token;
@property(nonatomic) std::uint64_t activation;
@property(nonatomic) std::uint64_t epoch;
@property(nonatomic) NSUInteger serial;
@property(nonatomic) BOOL claimed;
@end
@implementation ProbeCaptureRequest
@end

@interface ProbeEditorTransport : NSObject
@property(nonatomic,strong) NSMutableDictionary<NSNumber*,ProbeEditState*>* edits;
@property(nonatomic,strong) NSString* baseURL;
@property(nonatomic) bridge_probe::LaunchEditorUrl launch;
@property(nonatomic) void* launchContext;
@property(nonatomic) std::uint32_t interval;
@property(nonatomic) BOOL applying;
@property(nonatomic,strong) ProbeBackgroundSave* backgroundSave;
@property(nonatomic) BOOL numberingSupportRegistered;
@property(nonatomic,strong) NSDictionary* reopenToolHandoff;
@property(nonatomic,strong) NSDictionary* testDocumentContext;
@property(nonatomic) std::uint64_t activation;
@property(nonatomic) std::uint64_t lastOwnerIdentity;
@property(nonatomic) std::uint64_t documentEpoch;
@property(nonatomic) std::int32_t cacheGeneration;
@property(nonatomic) NSUInteger documentBytes;
@property(nonatomic,strong) NSMutableDictionary<NSString*,NSDictionary*>* documentSnapshots;
@property(nonatomic,strong) NSMutableOrderedSet<NSString*>* documentSnapshotOrder;
@property(nonatomic,strong) NSMutableDictionary<NSNumber*,NSDictionary*>* ownerDocuments;
@property(nonatomic,strong) NSMutableOrderedSet<NSNumber*>* ownerDocumentOrder;
// These bounded records contain no XML, document name/path, or owner AddRef.
// A write keeps its live VBA anchor while invalidating every serialized XML.
@property(nonatomic,strong) NSMutableDictionary<NSNumber*,NSDictionary*>* ownerCaptureBindings;
@property(nonatomic,strong) NSMutableOrderedSet<NSNumber*>* ownerCaptureOrder;
@property(nonatomic,strong) ProbeCaptureRequest* captureRequest;
@property(nonatomic) NSUInteger captureSerial;
- (void)begin:(std::uint64_t)sessionId native:(NSData*)native;
- (void)openState:(ProbeEditState*)state;
- (void)applyDeferredReopenTool:(ProbeEditState*)state;
- (bridge_probe::HResult)completeCancelledState:(ProbeEditState*)state;
- (void)launchTicket:(ProbeEditState*)state;
- (void)openEditorURL:(NSString*)url completion:(void(^)(NSError*))completion;
- (void)poll:(ProbeEditState*)state;
- (void)cleanup:(std::uint64_t)sessionId;
- (void)retireTicket:(NSString*)ticket session:(std::uint64_t)sessionId attempt:(NSUInteger)attempt;
- (void)fail:(ProbeEditState*)state code:(std::uint32_t)code;
- (void)failResult:(ProbeEditState*)state code:(std::uint32_t)code;
- (void)documentReady;
- (void)ackBackground:(ProbeBackgroundSave*)save ok:(BOOL)ok;
- (void)ackBackgroundUncertain:(ProbeBackgroundSave*)save;
- (BOOL)applyBackground:(std::uint64_t)sessionId native:(NSData*)native;
- (void)invalidateDocuments;
- (void)forgetOwner:(std::uint64_t)owner;
- (void)rememberDocument:(ProbeEditState*)state;
- (NSDictionary*)documentForOwner:(ProbeEditState*)state;
- (void)rememberCaptureOwner:(std::uint64_t)owner context:(NSDictionary*)context digest:(NSString*)digest;
- (void)requestCapture:(ProbeEditState*)state;
- (std::int32_t)takeCaptureRequest;
- (std::int32_t)finishCaptureRequest:(BOOL)success;
- (void)scheduleCaptureDeadline:(ProbeEditState*)state;
@end
static ProbeEditorTransport* transport=nil;
@implementation ProbeEditorTransport
- (instancetype)init {if((self=[super init])){_edits=[NSMutableDictionary dictionary];_baseURL=@"http://127.0.0.1:37952";_interval=150;
    _documentSnapshots=[NSMutableDictionary dictionary];_documentSnapshotOrder=[NSMutableOrderedSet orderedSet];_ownerDocuments=[NSMutableDictionary dictionary];_ownerDocumentOrder=[NSMutableOrderedSet orderedSet];
    _ownerCaptureBindings=[NSMutableDictionary dictionary];_ownerCaptureOrder=[NSMutableOrderedSet orderedSet];
    _cacheGeneration=bridge_probe::diagnosticValue(static_cast<std::uint32_t>(bridge_probe::Metric::EditGeneration));
}return self;}
- (void)invalidateDocuments {
    ++self.documentEpoch;self.documentBytes=0;[self.ownerDocuments removeAllObjects];[self.ownerDocumentOrder removeAllObjects];[self.documentSnapshots removeAllObjects];[self.documentSnapshotOrder removeAllObjects];
    self.captureRequest=nil;for(ProbeEditState* state in self.edits.allValues)if(state.awaitingDocument)state.captureRequested=NO;
    self.cacheGeneration=bridge_probe::diagnosticValue(static_cast<std::uint32_t>(bridge_probe::Metric::EditGeneration));
}
- (void)expireWrittenDocuments {
    if(self.cacheGeneration!=bridge_probe::diagnosticValue(static_cast<std::uint32_t>(bridge_probe::Metric::EditGeneration)))[self invalidateDocuments];
}
- (void)removeSnapshot:(NSString*)key {
    NSDictionary* snapshot=self.documentSnapshots[key];if(!snapshot)return;
    self.documentBytes-=[snapshot[@"bytes"] unsignedIntegerValue];[self.documentSnapshots removeObjectForKey:key];[self.documentSnapshotOrder removeObject:key];
    for(NSNumber* owner in self.ownerDocuments.allKeys)if([self.ownerDocuments[owner][@"snapshot"] isEqual:key]){[self.ownerDocuments removeObjectForKey:owner];[self.ownerDocumentOrder removeObject:owner];}
}
- (void)forgetCachedOwner:(std::uint64_t)owner {
    NSNumber* token=@(owner);NSString* key=self.ownerDocuments[token][@"snapshot"];[self.ownerDocuments removeObjectForKey:token];[self.ownerDocumentOrder removeObject:token];
    if(key){for(NSDictionary* binding in self.ownerDocuments.allValues)if([binding[@"snapshot"] isEqual:key])return;[self removeSnapshot:key];}
}
- (void)forgetOwner:(std::uint64_t)owner {
    [self forgetCachedOwner:owner];NSNumber* key=@(owner);[self.ownerCaptureBindings removeObjectForKey:key];[self.ownerCaptureOrder removeObject:key];
    if(self.captureRequest.state.ownerIdentity==owner)self.captureRequest=nil;
    if([self.reopenToolHandoff[@"owner"] unsignedLongLongValue]==owner)self.reopenToolHandoff=nil;
    for(ProbeEditState* state in self.edits.allValues)if(state.ownerIdentity==owner)state.deferredReopenTool=nil;
}
- (void)rememberCaptureOwner:(std::uint64_t)owner context:(NSDictionary*)context digest:(NSString*)digest {
    if(!owner||![context[@"identity"] isKindOfClass:NSString.class]||![context[@"snapshot"] isKindOfClass:NSNumber.class]||[context[@"snapshot"] intValue]<=0||![context[@"index"] isKindOfClass:NSNumber.class]||!digest)return;
    NSNumber* key=@(owner);self.ownerCaptureBindings[key]=@{@"identity":context[@"identity"],@"snapshot":context[@"snapshot"],@"index":context[@"index"],@"digest":digest};
    [self.ownerCaptureOrder removeObject:key];[self.ownerCaptureOrder addObject:key];
    while(self.ownerCaptureOrder.count>32)[self forgetOwner:[self.ownerCaptureOrder.firstObject unsignedLongLongValue]];
}
- (void)rememberDocument:(ProbeEditState*)state {
    [self expireWrittenDocuments];NSDictionary* context=state.documentContext;
    if(!state.ownerIdentity||state.documentEpoch!=self.documentEpoch||state.editGeneration!=self.cacheGeneration||![context[@"identity"] isKindOfClass:NSString.class]||![context[@"snapshot"] isKindOfClass:NSNumber.class]||![context[@"ooxml"] isKindOfClass:NSString.class])return;
    [self rememberCaptureOwner:state.ownerIdentity context:context digest:state.openDigest];
    // A current-formula fragment authorizes only its retained OLE owner.
    // Never publish it as a complete, reusable document snapshot.
    if([context[@"scope"] isEqual:@"selection"])return;
    NSString* key=[NSString stringWithFormat:@"%@:%@",context[@"identity"],context[@"snapshot"]];NSUInteger bytes=[context[@"ooxml"] length]*sizeof(unichar);
    NSNumber* owner=@(state.ownerIdentity);NSString* previous=self.ownerDocuments[owner][@"snapshot"];
    if(previous&&![previous isEqual:key])[self forgetCachedOwner:state.ownerIdentity];
    if(bytes>32*1024*1024){[self forgetCachedOwner:state.ownerIdentity];return;}
    NSDictionary* snapshot=self.documentSnapshots[key];
    if(snapshot&&![snapshot[@"context"][@"ooxml"] isEqual:context[@"ooxml"]]){[self removeSnapshot:key];snapshot=nil;}
    if(!snapshot){NSMutableDictionary* shared=[context mutableCopy];[shared removeObjectForKey:@"index"];snapshot=@{@"context":shared,@"bytes":@(bytes)};self.documentSnapshots[key]=snapshot;self.documentBytes+=bytes;}
    [self.documentSnapshotOrder removeObject:key];[self.documentSnapshotOrder addObject:key];
    self.ownerDocuments[owner]=@{@"snapshot":key,@"index":context[@"index"],@"digest":state.openDigest};[self.ownerDocumentOrder removeObject:owner];[self.ownerDocumentOrder addObject:owner];
    while(self.ownerDocumentOrder.count>32)[self forgetCachedOwner:[self.ownerDocumentOrder.firstObject unsignedLongLongValue]];
    while(self.documentSnapshotOrder.count>4||self.documentBytes>32*1024*1024)[self removeSnapshot:self.documentSnapshotOrder.firstObject];
}
- (NSDictionary*)documentForOwner:(ProbeEditState*)state {
    [self expireWrittenDocuments];NSDictionary* binding=self.ownerDocuments[@(state.ownerIdentity)];
    if(!binding)return nil;
    if(![binding[@"digest"] isEqual:state.openDigest]){[self forgetCachedOwner:state.ownerIdentity];return nil;}
    NSDictionary* snapshot=self.documentSnapshots[binding[@"snapshot"]];if(!snapshot)return nil;
    NSMutableDictionary* context=[snapshot[@"context"] mutableCopy];context[@"index"]=binding[@"index"];return context;
}
- (void)requestCapture:(ProbeEditState*)state {
    if(state.captureRequested||state.activation!=self.activation||![self active:state]||!state.awaitingDocument)return;
    NSDictionary* binding=state.activationBinding?:self.ownerCaptureBindings[@(state.ownerIdentity)];
    if(state.activationBinding){
        NSMutableDictionary* activationBinding=[state.activationBinding mutableCopy];
        activationBinding[@"digest"]=state.openDigest;
        binding=activationBinding;
    }
    if(binding&&![binding[@"digest"] isEqual:state.openDigest])return;
    if(!binding&&!state.requiresDocumentCapture)return;
    if(state.captureAttempts>=3){[self captureFailed:state];return;}
    state.captureRequested=YES;state.requiresDocumentCapture=YES;
    ProbeCaptureRequest* request=[ProbeCaptureRequest new];request.state=state;request.binding=binding;request.token=EquationLabNewDocumentToken();request.activation=state.activation;request.epoch=self.documentEpoch;
    os_log_info(OS_LOG_DEFAULT,"WordHostCapture request anchored=%d attempt=%lu",binding!=nil,static_cast<unsigned long>(state.captureAttempts));
    EquationLabDiscardDocumentParts();self.captureRequest=request;lastCaptureState=CapturePending;EquationLabWakeWordHost();
}
- (std::int32_t)takeCaptureRequest {
    ProbeCaptureRequest* request=self.captureRequest;ProbeEditState* state=request.state;
    if(!request||request.claimed||self.applying||self.backgroundSave.claimed)return 0;
    if(!state||![self active:state]||!state.awaitingDocument||state.activation!=self.activation||request.activation!=state.activation||request.epoch!=self.documentEpoch){self.captureRequest=nil;return 0;}
    if(state.documentDeadline.timeIntervalSinceNow<=0){self.captureRequest=nil;BOOL enriching=state.enrichingDocument;[self captureFailed:state];if(!enriching)lastCaptureState=CaptureTimedOut;return 0;}
    request.claimed=YES;request.serial=self.captureSerial;++state.captureAttempts;return request.token;
}
- (std::int32_t)finishCaptureRequest:(BOOL)success {
    ProbeCaptureRequest* request=self.captureRequest;ProbeEditState* state=request.state;
    if(!request||!request.claimed||self.applying||self.backgroundSave.claimed)return -1;
    if(!state||![self active:state]||!state.awaitingDocument||state.activation!=self.activation||request.activation!=state.activation||request.epoch!=self.documentEpoch){self.captureRequest=nil;return -2;}
    if(state.documentDeadline.timeIntervalSinceNow<=0){self.captureRequest=nil;BOOL enriching=state.enrichingDocument;[self captureFailed:state];if(!enriching)lastCaptureState=CaptureTimedOut;return -4;}
    NSDictionary* context=self.testDocumentContext?:EquationLabCapturedDocumentContext();NSDictionary* binding=request.binding;
    BOOL hasBinding=[binding[@"identity"] isKindOfClass:NSString.class]&&[binding[@"snapshot"] isKindOfClass:NSNumber.class]&&[binding[@"index"] isKindOfClass:NSNumber.class]&&[binding[@"digest"] isEqual:state.openDigest];
    BOOL commonMatch=success&&self.captureSerial>request.serial&&documentCapturedAt&&documentCapturedAt.timeIntervalSinceNow>=-.5&&[context[@"captureToken"] isKindOfClass:NSNumber.class]&&[context[@"captureToken"] intValue]==request.token&&[context[@"identity"] isKindOfClass:NSString.class]&&[context[@"snapshot"] isKindOfClass:NSNumber.class]&&[context[@"snapshot"] intValue]>0&&[context[@"index"] isKindOfClass:NSNumber.class]&&[context[@"index"] intValue]>=0;
    BOOL matches=commonMatch&&(!binding||(hasBinding&&[context[@"identity"] isEqual:binding[@"identity"]]&&[context[@"snapshot"] intValue]!=[binding[@"snapshot"] intValue]&&[context[@"index"] isEqual:binding[@"index"]]));
    self.captureRequest=nil;EquationLabDiscardDocumentParts();
    if(!matches){
        state.captureRequested=NO;
        if(state.activation==self.activation&&state.captureAttempts<3){[self requestCapture:state];return -3;}
        [self captureFailed:state];return -3;
    }
    // ELCTX4 is created only after this activation's one-shot request. For a
    // bound owner VBA resolves its retained Document+Range; otherwise it must
    // resolve the exact current OLE selection. The service still verifies the
    // opening Native SHA before attaching document-wide context.
    EquationLabConsumeDocumentSelection(context);
    state.documentContext=context;state.documentEpoch=self.documentEpoch;state.editGeneration=self.cacheGeneration;state.awaitingDocument=NO;lastCaptureState=CaptureReady;
    if(state.enrichingDocument)[self enrichDocument:state];else [self openState:state];return 0;
}
- (void)captureFailed:(ProbeEditState*)state {
    if(!state.enrichingDocument){lastCaptureState=CaptureRejected;[self fail:state code:InvalidReply];return;}
    // Metadata failure must never cancel an already editable OLE transaction.
    // The user can continue writing or save the original owner immediately.
    state.awaitingDocument=NO;state.captureRequested=NO;state.enrichingDocument=NO;lastCaptureState=CaptureReady;
    if(self.captureRequest.state==state){self.captureRequest=nil;EquationLabDiscardDocumentParts();}
    if(![self active:state]||!state.ticket)return;
    [self request:@"/api/native-enrich" body:@{@"ticket":state.ticket,@"session":[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(state.sessionId)],@"initialSnapshot":state.bindingContext[@"snapshot"],@"failed":@YES} reply:^(NSDictionary*,NSError*){}];
}
- (void)enrichDocument:(ProbeEditState*)state {
    NSDictionary* context=state.documentContext;
    if([context[@"scope"] isEqual:@"selection"]||![context[@"identity"] isEqual:state.bindingContext[@"identity"]]||![context[@"index"] isEqual:state.bindingContext[@"index"]]){[self captureFailed:state];return;}
    NSMutableDictionary* document=[context mutableCopy];[document removeObjectForKey:@"captureToken"];
    state.enrichmentRequest=[self request:@"/api/native-enrich" body:@{@"ticket":state.ticket,@"session":[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(state.sessionId)],@"initialSnapshot":state.bindingContext[@"snapshot"],@"document":document} reply:^(NSDictionary* result,NSError* error){
        state.enrichmentRequest=nil;
        if(![self active:state])return;
        if(error||![result[@"ok"] boolValue]){state.documentContext=nil;[self captureFailed:state];return;}
        [self rememberDocument:state];NSMutableDictionary* binding=[context mutableCopy];[binding removeObjectForKey:@"ooxml"];state.bindingContext=binding;
        state.documentContext=nil;state.enrichingDocument=NO;logOpenPhase("document-list-ready",state.started);
    }];
}
- (void)scheduleCaptureDeadline:(ProbeEditState*)state {
    const auto delay=std::max(.001,state.documentDeadline.timeIntervalSinceNow);__weak ProbeEditState* weak=state;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<std::int64_t>(delay*NSEC_PER_SEC)),dispatch_get_main_queue(),^{
        ProbeEditState* current=weak;if(!current||![self active:current]||!current.awaitingDocument)return;
        if(current.enrichingDocument){[self captureFailed:current];return;}
        if(current.activation!=self.activation){lastCaptureState=CaptureSuperseded;bridge_probe::completeEdit(current.sessionId,nullptr,0,false);return;}
        lastCaptureState=CaptureTimedOut;
        if(current.requiresDocumentCapture)[self fail:current code:InvalidReply];
        else{current.awaitingDocument=NO;[self openState:current];}
    });
}
- (BOOL)active:(ProbeEditState*)state {return !state.terminal&&self.edits[@(state.sessionId)]==state;}
- (ProbeJsonRequest*)request:(NSString*)path body:(NSDictionary*)body reply:(ProbeReply)reply {
    return [[ProbeJsonRequest alloc] initWithURL:[NSURL URLWithString:[self.baseURL stringByAppendingString:path]] body:body completion:reply];
}
- (void)retireTicket:(NSString*)ticket session:(std::uint64_t)sessionId attempt:(NSUInteger)attempt {
    if(!ticket.length)return;
    NSString* session=[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(sessionId)];
    NSDictionary* body=@{@"ticket":ticket,@"session":session};
    [self request:@"/api/native-cancel" body:body reply:^(NSDictionary* cancelResult,NSError* cancelError){
        (void)cancelResult;(void)cancelError;
        [self request:@"/api/native-poll" body:body reply:^(NSDictionary* result,NSError* pollError){
            if(pollError)return;
            NSString* state=result[@"state"];
            if([state isEqual:@"complete"]){
                [self request:@"/api/native-ack" body:@{@"ticket":ticket,@"session":session,@"ok":@NO} reply:^(NSDictionary* ack,NSError* ackError){(void)ack;(void)ackError;}];
            }else if([state isEqual:@"editing"]&&attempt<2){
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[self retireTicket:ticket session:sessionId attempt:attempt+1];});
            }
        }];
    }];
}
- (void)cleanup:(std::uint64_t)sessionId {
    NSAssert(NSThread.isMainThread,@"Native OLE owner must be main thread");
    ProbeEditState* state=self.edits[@(sessionId)];if(!state)return;
    if(self.captureRequest.state==state)self.captureRequest=nil;
    state.terminal=YES;state.openNative=nil;state.documentContext=nil;
    [state.enrichmentRequest cancel];state.enrichmentRequest=nil;
    if(!state.opening){[state.request cancel];state.request=nil;}
    [self.edits removeObjectForKey:@(sessionId)];
    if(state.ticket)[self retireTicket:state.ticket session:sessionId attempt:0];
    state.ticket=nil;
}
- (void)fail:(ProbeEditState*)state code:(std::uint32_t)code {
    if(![self active:state])return;lastError=code;
    auto hr=bridge_probe::completeEdit(state.sessionId,nullptr,0,false);
    if(hr!=bridge_probe::Ok)[self cleanup:state.sessionId];
}
- (void)failResult:(ProbeEditState*)state code:(std::uint32_t)code {
    NSString* ticket=state.ticket,*session=[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(state.sessionId)];
    [self fail:state code:code];
    // The server has already delivered a completed payload. A rejected result
    // must acknowledge failure promptly instead of leaving the App waiting
    // until its save timeout with a dead edit owner.
    if(ticket)[self request:@"/api/native-ack" body:@{@"ticket":ticket,@"session":session,@"ok":@NO} reply:^(NSDictionary*,NSError*){}];
}
- (void)schedule:(ProbeEditState*)state {
    if(state.pollScheduled)return;state.pollScheduled=YES;NSUInteger generation=++state.pollGeneration;
    __weak ProbeEditState* weak=state;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<std::int64_t>(self.interval)*NSEC_PER_MSEC),dispatch_get_main_queue(),^{ProbeEditState* current=weak;if(current&&[self active:current]&&current.pollGeneration==generation){current.pollScheduled=NO;[self poll:current];}});
}
- (void)begin:(std::uint64_t)sessionId native:(NSData*)native {
    NSAssert(NSThread.isMainThread,@"Native OLE owner must be main thread");
    if([self applyBackground:sessionId native:native])return;
    // New templates send a fully serialized ELCTX4 before DoVerb. Consume that
    // independent candidate once; ELACT1 remains the older-template fallback.
    NSDictionary* preCapture=EquationLabTakePreCapturedDocumentActivation();
    BOOL preCaptureRejected=[preCapture[@"_preCaptureRejected"] boolValue];
    NSDictionary* activationHint=preCaptureRejected?nil:(preCapture?preCapture:EquationLabTakeDocumentActivationAnchor());
    BOOL preCaptured=activationHint&&[activationHint[@"_preCapturedActivation"] boolValue];
    os_log_info(OS_LOG_DEFAULT,"WordHostCapture activation precaptured=%d rejected=%d anchored=%d",preCaptured,preCaptureRejected,activationHint!=nil);
    ProbeEditState* existing=self.edits[@(sessionId)];
    NSString* documentRequestId=bridge_probe::openingWordDocumentRequestId();
    if(existing){
        existing.activation=++self.activation;
        existing.documentRequestId=documentRequestId;
        if(existing.request||existing.ticket){
            existing.reopenRequested=YES;
            if(existing.ticket&&!existing.request){existing.pollScheduled=NO;++existing.pollGeneration;[self poll:existing];}
            return;
        }
        if(preCaptureRejected){lastCaptureState=CaptureRejected;[self fail:existing code:InvalidReply];return;}
        if(preCaptured){
            NSMutableDictionary* context=[activationHint mutableCopy];[context removeObjectForKey:@"_preCapturedActivation"];
            existing.documentContext=context;existing.preCapturedActivation=YES;existing.awaitingDocument=NO;existing.requiresDocumentCapture=NO;
            existing.captureRequested=NO;if(self.captureRequest.state==existing)self.captureRequest=nil;
            [self openState:existing];return;
        }
        if(existing.awaitingDocument){
            if(activationHint){
                existing.activationBinding=activationHint;
                existing.requiresDocumentCapture=YES;
                existing.captureRequested=NO;
                if(self.captureRequest.state==existing)self.captureRequest=nil;
            }
            // Repeated verbs for this same retained owner share one pending
            // capture. They neither allocate another request nor invalidate a
            // WordOpenXML response that is already being produced for it.
            if(self.captureRequest.state==existing)self.captureRequest.activation=existing.activation;
            [self documentReady];return;
        }
        // Never relaunch a ticket whose cancel/save is already queued. Read
        // the owner's next poll first; a terminal reply will finish the old
        // transaction and reopen this object with a fresh identity.
        existing.reopenRequested=YES;
        if(existing.ticket&&!existing.request){existing.pollScheduled=NO;++existing.pollGeneration;[self poll:existing];}
        return;
    }
    [self expireWrittenDocuments];ProbeEditState* state=[ProbeEditState new];state.started=CFAbsoluteTimeGetCurrent();logOpenPhase("verb",state.started);state.sessionId=sessionId;state.activation=++self.activation;state.openNative=native;state.openDigest=nativeDigest(native);state.ownerIdentity=bridge_probe::editObjectIdentity(sessionId);self.lastOwnerIdentity=state.ownerIdentity;state.documentEpoch=self.documentEpoch;state.editGeneration=self.cacheGeneration;state.expires=[NSDate dateWithTimeIntervalSinceNow:20*60];self.edits[@(sessionId)]=state;
    // completeEdit(reopen:true) invokes this next DoVerb synchronously. Consume
    // its one-shot handoff here so it cannot leak to a later, unrelated open.
    NSDictionary* handoff=self.reopenToolHandoff;self.reopenToolHandoff=nil;
    if(handoff&&[handoff[@"owner"] unsignedLongLongValue]==state.ownerIdentity)state.deferredReopenTool=handoff;
    state.documentRequestId=documentRequestId;
    if(preCaptureRejected){lastCaptureState=CaptureRejected;[self fail:state code:InvalidReply];return;}
    state.activationBinding=activationHint;
    state.preCapturedActivation=preCaptured;
    if(preCaptured){
        NSMutableDictionary* context=[activationHint mutableCopy];[context removeObjectForKey:@"_preCapturedActivation"];
        state.documentContext=context;state.awaitingDocument=NO;state.requiresDocumentCapture=NO;lastCaptureState=CaptureReady;
        logOpenPhase("precapture-ready",state.started);[self openState:state];return;
    }
    // ELACT1 is a legacy anchor only: it requests a fresh post-DoVerb ELCTX4.
    state.requiresDocumentCapture=activationHint!=nil||self.ownerCaptureBindings[@(state.ownerIdentity)]!=nil||inWord();
    state.awaitingDocument=YES;state.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:state.requiresDocumentCapture?10:1];lastCaptureState=CapturePending;
    __weak ProbeEditState* weak=state;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,25*NSEC_PER_MSEC),dispatch_get_main_queue(),^{
        ProbeEditState* current=weak;if(!current||![self active:current]||!current.awaitingDocument)return;
        if(current.activation!=self.activation){lastCaptureState=CaptureSuperseded;bridge_probe::completeEdit(current.sessionId,nullptr,0,false);return;}
        // The isolated CLI launcher has no Word/VBA event source unless a
        // context was explicitly configured by its document-race tests.
        if(self.launch&&!inWord()&&!self.testDocumentContext&&!current.requiresDocumentCapture&&![self documentForOwner:current]){current.awaitingDocument=NO;[self openState:current];return;}
        [self documentReady];
    });
    [self scheduleCaptureDeadline:state];
}
- (void)documentReady {
    NSDictionary* context=self.testDocumentContext?:EquationLabCapturedDocumentContext();
    BOOL anchoredSelection=EquationLabDocumentContextIsPendingSelection(context);
    if(!documentCapturedAt||(!anchoredSelection&&documentCapturedAt.timeIntervalSinceNow<-.5))context=nil;
    for(ProbeEditState* state in self.edits.allValues){
        // WordOpenXML can block the main queue past the deadline. Accept a completed
        // capture while the state still awaits it; the queued timeout callback or
        // cleanup retires the state, while context freshness and identity checks still apply.
        if(!state.awaitingDocument||state.request)continue;
        if(state.activation!=self.activation){if(state.enrichingDocument)[self captureFailed:state];else{lastCaptureState=CaptureSuperseded;bridge_probe::completeEdit(state.sessionId,nullptr,0,false);}continue;}
        if(self.captureRequest.claimed&&self.captureRequest.state==state)continue;
        if(state.requiresDocumentCapture){[self requestCapture:state];continue;}
        NSDictionary* owned=[self documentForOwner:state];NSDictionary* candidate=context;
        NSDictionary* anchor=self.ownerCaptureBindings[@(state.ownerIdentity)];
        if(anchor&&(![candidate[@"identity"] isEqual:anchor[@"identity"]]||![candidate[@"index"] isEqual:anchor[@"index"]]))candidate=nil;
        if(owned&&(!candidate||![candidate[@"identity"] isEqual:owned[@"identity"]]||![candidate[@"index"] isEqual:owned[@"index"]]))candidate=owned;
        NSString* key=candidate?[NSString stringWithFormat:@"%@:%@:%@",candidate[@"identity"]?:@"legacy",candidate[@"snapshot"]?:@0,candidate[@"index"]?:@0]:nil;
        if(!candidate||[state.attemptedDocumentKey isEqual:key]){candidate=owned;key=candidate?[NSString stringWithFormat:@"%@:%@:%@",candidate[@"identity"],candidate[@"snapshot"],candidate[@"index"]]:nil;}
        if(!candidate){[self requestCapture:state];continue;}
        if([state.attemptedDocumentKey isEqual:key]){[self requestCapture:state];continue;}
        state.attemptedDocumentKey=key;
        state.documentContext=candidate;state.documentEpoch=self.documentEpoch;state.editGeneration=self.cacheGeneration;state.awaitingDocument=NO;lastCaptureState=CaptureReady;
        logOpenPhase("capture-ready",state.started);
        if(candidate==context&&anchoredSelection){EquationLabConsumeDocumentSelection(context);anchoredSelection=NO;context=nil;}
        [self openState:state];
    }
}
- (void)ackBackground:(ProbeBackgroundSave*)save ok:(BOOL)ok {
    if(self.backgroundSave!=save)return;self.backgroundSave=nil;
    save.native=nil;save.pdf=nil;save.binding=nil;
    if(!ok)lastError=ApplyFailure;
    [self request:@"/api/native-ack" body:@{@"ticket":save.ticket,@"session":save.session,@"ok":@(ok)} reply:^(NSDictionary*,NSError*){}];
}
- (void)ackBackgroundUncertain:(ProbeBackgroundSave*)save {
    if(self.backgroundSave!=save)return;self.backgroundSave=nil;
    save.native=nil;save.pdf=nil;save.binding=nil;save.numbering=nil;lastError=ApplyFailure;
    [self request:@"/api/native-ack" body:@{@"ticket":save.ticket,@"session":save.session,@"ok":@NO,@"uncertain":@YES} reply:^(NSDictionary*,NSError*){}];
}
- (BOOL)applyBackground:(std::uint64_t)sessionId native:(NSData*)native {
    ProbeBackgroundSave* save=self.backgroundSave;if(!save.claimed)return NO;
    // This is called synchronously by the exact live InlineShape selected by
    // the bound VBA collection. Reject stale/deleted/replaced targets before
    // changing either Native data or the OLE preview.
    if(![nativeDigest(native) isEqual:save.expectedDigest]){
        bridge_probe::completeEdit(sessionId,nullptr,0,false);[self ackBackground:save ok:NO];return YES;
    }
    if(!bridge_probe::bindEditDocument(sessionId,[save.binding[@"identity"] UTF8String])){bridge_probe::completeEdit(sessionId,nullptr,0,false);[self ackBackground:save ok:NO];return YES;}
    NSMutableDictionary* targetBinding=[save.binding mutableCopy];targetBinding[@"index"]=@(save.index);
    [self rememberCaptureOwner:bridge_probe::editObjectIdentity(sessionId) context:targetBinding digest:save.expectedDigest];
    self.applying=YES;
    auto hr=bridge_probe::setSessionPreview(sessionId,static_cast<const std::uint8_t*>(save.pdf.bytes),save.pdf.length,save.extent);
    if(hr==bridge_probe::Ok)hr=bridge_probe::completeEdit(sessionId,static_cast<const std::uint8_t*>(save.native.bytes),save.native.length,true);
    self.applying=NO;
    if(hr!=bridge_probe::Ok)bridge_probe::completeEdit(sessionId,nullptr,0,false);
    if(hr==bridge_probe::Ok&&save.numbering){save.nativeApplied=YES;return YES;}
    [self ackBackground:save ok:hr==bridge_probe::Ok];return YES;
}
- (void)retryOpen:(ProbeEditState*)state {
    if(![self active:state])return;
    if(state.openRetries>=8||state.wakeDeadline.timeIntervalSinceNow<=0){[self fail:state code:NetworkFailure];return;}
    ++state.openRetries;__weak ProbeEditState* weak=state;
    // Production uses500ms; the separate test configuration can shorten it.
    auto delay=std::max<std::uint32_t>(20,std::min<std::uint32_t>(500,self.interval));
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<std::int64_t>(delay)*NSEC_PER_MSEC),dispatch_get_main_queue(),^{ProbeEditState* current=weak;if(current&&[self active:current])[self openState:current];});
}
- (void)wake:(ProbeEditState*)state {
    if(![self active:state])return;state.wakeAttempted=YES;state.wakePending=YES;state.wakeDeadline=[NSDate dateWithTimeIntervalSinceNow:10];
    __weak ProbeEditState* weak=state;
    if(self.launch){BOOL opened=self.launch("equationlab://wake",self.launchContext);state.wakePending=NO;if(![self active:state])return;if(opened)[self retryOpen:state];else[self fail:state code:LaunchFailure];}
    else{
        launchEquationLabURL(NSWorkspace.sharedWorkspace,[NSURL URLWithString:@"equationlab://wake"],^(NSError* error){dispatch_async(dispatch_get_main_queue(),^{ProbeEditState* current=weak;if(!current||![self active:current])return;current.wakePending=NO;if(error)[self fail:current code:LaunchFailure];else[self retryOpen:current];});});
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,10*NSEC_PER_SEC),dispatch_get_main_queue(),^{ProbeEditState* current=weak;if(current&&[self active:current]&&current.wakePending)[self fail:current code:NetworkFailure];});
}
- (void)launchTicket:(ProbeEditState*)state {
    if(![self active:state]||state.activation!=self.activation)return;
    if(!state.launchURL)state.launchURL=editorLaunchURL(state);
    if(state.launchAttempts>=2){[self fail:state code:LaunchFailure];return;}
    ++state.launchAttempts;
    __weak ProbeEditState* weak=state;
    auto completed=^(NSError* error){dispatch_async(dispatch_get_main_queue(),^{
        ProbeEditState* current=weak;
        if(!current||![self active:current])return;
        // A successful launch has already handed this ticket to the editor.
        // Keep polling that exact live edit even if Word activated a newer
        // owner while LaunchServices was completing asynchronously.
        if(!error){[self schedule:current];return;}
        // Failed launches have no delivered editor session to preserve. Retire
        // a stale activation instead of retrying it after ownership changed.
        if(current.activation!=self.activation){[self fail:current code:LaunchFailure];return;}
        if([error.userInfo[@"retryable"] boolValue]&&current.launchAttempts<2){
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC),dispatch_get_main_queue(),^{
                ProbeEditState* retry=weak;
                if(retry&&[self active:retry]&&retry.activation==self.activation)[self launchTicket:retry];
            });
        }else [self fail:current code:LaunchFailure];
    });};
    [self openEditorURL:state.launchURL completion:completed];
}
- (void)openEditorURL:(NSString*)url completion:(void(^)(NSError*))completion {
    if(self.launch){
        BOOL opened=self.launch(url.UTF8String,self.launchContext);
        completion(opened?nil:[NSError errorWithDomain:@"NativeEquationTransport" code:LaunchFailure userInfo:nil]);
    }else launchEquationLabURL(NSWorkspace.sharedWorkspace,[NSURL URLWithString:url],completion);
}
- (void)openState:(ProbeEditState*)state {
    if(![self active:state])return;
    if(state.activation!=self.activation){lastCaptureState=CaptureSuperseded;bridge_probe::completeEdit(state.sessionId,nullptr,0,false);return;}
    [self applyDeferredReopenTool:state];
    NSMutableDictionary* body=[@{@"session":[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(state.sessionId)],@"native":[state.openNative base64EncodedStringWithOptions:0],@"acknowledgement":@YES} mutableCopy];
    if(self.numberingSupportRegistered)body[@"numberingSupport"]=@YES;
    if(state.documentContext){
        // ELCTX4's one-shot token belongs to the Word/native handshake. The
        // service accepts only its public document schema after that check.
        NSMutableDictionary* document=[state.documentContext mutableCopy];
        [document removeObjectForKey:@"captureToken"];
        body[@"document"]=document;
    }
    state.opening=YES;
    logOpenPhase("service-request",state.started);
    state.request=[self request:@"/api/native-open" body:body reply:^(NSDictionary* json,NSError* error){
        ProbeEditState* current=state;current.request=nil;current.opening=NO;
        if(error){
            if(![self active:current])return;
            if(current.activation!=self.activation){lastCaptureState=CaptureSuperseded;bridge_probe::completeEdit(current.sessionId,nullptr,0,false);return;}
            if(connectionRefused(error)){if(!current.wakeAttempted)[self wake:current];else[self retryOpen:current];}
            else if(current.preCapturedActivation){
                // The service checks the opening Native SHA against this exact
                // pre-DoVerb document. Never replace a rejected fast-path
                // candidate with an unrelated post-DoVerb capture.
                [self fail:current code:InvalidReply];
            }
            else if(current.documentContext&&current.documentDeadline.timeIntervalSinceNow>0){
                // A previous selection can still be in the capture slot when
                // Word starts a new verb. The service rejects mismatched
                // Native data; wait briefly for this activation's capture
                // rather than abandoning the whole edit or trusting the old
                // document by name.
                current.documentContext=nil;current.awaitingDocument=YES;lastCaptureState=CaptureRejected;[self documentReady];
            }else[self fail:current code:NetworkFailure];return;
        }
        id ticket=json[@"ticket"],url=json[@"editorUrl"];
        logOpenPhase("service-reply",current.started);
        NSCharacterSet* invalid=[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
        if(![ticket isKindOfClass:NSString.class]||[ticket length]!=64||[ticket rangeOfCharacterFromSet:invalid].location!=NSNotFound||![url isKindOfClass:NSString.class]||![url isEqualToString:[@"equationlab://word-edit/" stringByAppendingString:ticket]]){[self fail:current code:InvalidReply];return;}
        if(![self active:current]){
            current.ticket=ticket;current.openNative=nil;
            [self retireTicket:ticket session:current.sessionId attempt:0];current.ticket=nil;return;
        }
        for(ProbeEditState* other in self.edits.allValues)if(other!=current&&[other.ticket isEqualToString:ticket]){[self fail:current code:InvalidReply];return;}
        current.ticket=ticket;current.openNative=nil;
        if([current.documentContext[@"identity"] isKindOfClass:NSString.class]&&!bridge_probe::bindEditDocument(current.sessionId,[current.documentContext[@"identity"] UTF8String])){[self fail:current code:InvalidReply];return;}
        [self rememberDocument:current];
        if(current.documentContext){NSMutableDictionary* binding=[current.documentContext mutableCopy];[binding removeObjectForKey:@"ooxml"];current.bindingContext=binding;}
        current.documentContext=nil;
        // A later Word activation can arrive while native-open is in flight.
        // Erase this now-known ticket, but never publish its stale URL over
        // the newer document/selection. Already delivered editors retain
        // ownership until the App confirms a draft switch.
        if(current.activation!=self.activation){lastCaptureState=CaptureSuperseded;bridge_probe::completeEdit(current.sessionId,nullptr,0,false);return;}
        logOpenPhase("editor-launch",current.started);
        [self launchTicket:current];
    }];
}
- (void)applyDeferredReopenTool:(ProbeEditState*)state {
    NSDictionary* handoff=state.deferredReopenTool;state.deferredReopenTool=nil;
    if(!handoff||!state.ownerIdentity||[handoff[@"owner"] unsignedLongLongValue]!=state.ownerIdentity)return;
    NSDictionary* context=state.documentContext;
    if([context[@"identity"] isKindOfClass:NSString.class]&&[context[@"identity"] isEqual:handoff[@"identity"]]&&
       [context[@"index"] isKindOfClass:NSNumber.class]&&[context[@"index"] isEqual:handoff[@"index"]]&&
       [@[@"typography",@"spacing",@"export"] containsObject:handoff[@"tool"]])state.toolIntent=handoff[@"tool"];
}
- (bridge_probe::HResult)completeCancelledState:(ProbeEditState*)state {
    NSDictionary* handoff=nil;
    NSDictionary* binding=state.bindingContext;
    if(state.reopenRequested&&state.ownerIdentity&&[@[@"typography",@"spacing",@"export"] containsObject:state.toolIntent]&&
       [binding[@"identity"] isKindOfClass:NSString.class]&&[binding[@"index"] isKindOfClass:NSNumber.class]){
        handoff=@{@"owner":@(state.ownerIdentity),@"identity":binding[@"identity"],@"index":binding[@"index"],@"tool":state.toolIntent};
        self.reopenToolHandoff=handoff;
    }
    bridge_probe::HResult result=bridge_probe::completeEdit(state.sessionId,nullptr,0,false,state.reopenRequested);
    // The real object reopens synchronously. If it did not consume the token,
    // retire it here so a cancelled/failed reopen cannot affect another edit.
    if(self.reopenToolHandoff==handoff)self.reopenToolHandoff=nil;
    return result;
}
- (void)poll:(ProbeEditState*)state {
    if(![self active:state]||state.request)return;if(state.expires.timeIntervalSinceNow<=0){[self fail:state code:Expired];return;}
    __weak ProbeEditState* weak=state;
    state.request=[self request:@"/api/native-poll" body:@{@"ticket":state.ticket} reply:^(NSDictionary* json,NSError* error){
        ProbeEditState* current=weak;if(!current||![self active:current])return;current.request=nil;
        if(error){if(++current.failures<=3)[self schedule:current];else[self fail:current code:NetworkFailure];return;}current.failures=0;
        id status=json[@"state"];
        if([status isEqual:@"editing"]){
            if([json[@"loadDocument"] boolValue]&&!current.enrichmentStarted&&[current.bindingContext[@"scope"] isEqual:@"selection"]){
                current.enrichmentStarted=YES;current.enrichingDocument=YES;current.awaitingDocument=YES;current.requiresDocumentCapture=YES;current.captureRequested=NO;current.captureAttempts=0;
                current.activationBinding=current.bindingContext;current.documentDeadline=[NSDate dateWithTimeIntervalSinceNow:60];
                if(current.activation==self.activation){[self requestCapture:current];[self scheduleCaptureDeadline:current];}else [self captureFailed:current];
            }
            if(current.reopenRequested){current.reopenRequested=NO;NSString* url=editorLaunchURL(current);if(self.launch)self.launch(url.UTF8String,self.launchContext);else launchEquationLabURL(NSWorkspace.sharedWorkspace,[NSURL URLWithString:url],^(NSError*){});}
            [self schedule:current];return;
        }
        if([status isEqual:@"navigate"]){id index=json[@"index"];if(![index isKindOfClass:NSNumber.class]||[index intValue]<0||[index intValue]>10000||[index doubleValue]!=[index intValue]){[self fail:current code:InvalidReply];return;}if(!current.reopenRequested)EquationLabSetNavigationTarget([index intValue]);bridge_probe::completeEdit(current.sessionId,nullptr,0,false,current.reopenRequested);return;}
        if([status isEqual:@"cancelled"]){[self completeCancelledState:current];return;}
        if(![status isEqual:@"complete"]){[self fail:current code:InvalidReply];return;}
        id source=json[@"native"],preview=json[@"pdf"],width=json[@"width"],height=json[@"height"];
        const NSUInteger maxB64=((MaxBlob+2)/3)*4;
        if(![source isKindOfClass:NSString.class]||[source length]>maxB64||![preview isKindOfClass:NSString.class]||[preview length]>maxB64||![width isKindOfClass:NSNumber.class]||![height isKindOfClass:NSNumber.class]){[self failResult:current code:InvalidReply];return;}
        double w=[width doubleValue],h=[height doubleValue];
        if(w<1||h<1||w>INT32_MAX||h>INT32_MAX||w!=static_cast<std::int32_t>(w)||h!=static_cast<std::int32_t>(h)){[self failResult:current code:InvalidReply];return;}
        NSData* native=[[NSData alloc] initWithBase64EncodedString:source options:0];NSData* pdf=[[NSData alloc] initWithBase64EncodedString:preview options:0];
        if(!nativeValid(native)||!pdf.length||pdf.length>MaxBlob){[self failResult:current code:InvalidReply];return;}
        CGDataProviderRef provider=CGDataProviderCreateWithCFData((__bridge CFDataRef)pdf);CGPDFDocumentRef document=provider?CGPDFDocumentCreateWithProvider(provider):nullptr;
        bool validPdf=document&&CGPDFDocumentGetNumberOfPages(document)==1;
        if(document)CGPDFDocumentRelease(document);if(provider)CGDataProviderRelease(provider);
        if(!validPdf){[self failResult:current code:InvalidReply];return;}
        id targetValue=json[@"target"],numberingValue=json[@"numbering"];
        if(numberingValue){
            if(!self.numberingSupportRegistered||![numberingValue isKindOfClass:NSDictionary.class]||[numberingValue count]!=2||![numberingValue[@"format"] isKindOfClass:NSString.class]||[numberingValue[@"format"] length]<1||[numberingValue[@"format"] length]>128||![@[@"left",@"right"] containsObject:numberingValue[@"side"]]||[numberingValue[@"format"] rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound){[self failResult:current code:InvalidReply];return;}
        }
        if(targetValue&&![targetValue isKindOfClass:NSDictionary.class]){[self failResult:current code:InvalidReply];return;}
        NSDictionary* target=targetValue;
        if(target){
            id index=target[@"index"],expected=target[@"expectedNativeSha256"],identity=target[@"documentIdentity"];
            NSCharacterSet* badDigest=[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
            NSDictionary* binding=current.bindingContext;
            if(![target isKindOfClass:NSDictionary.class]||![index isKindOfClass:NSNumber.class]||[index intValue]<0||[index intValue]>10000||[index doubleValue]!=[index intValue]||![expected isKindOfClass:NSString.class]||[expected length]!=64||[expected rangeOfCharacterFromSet:badDigest].location!=NSNotFound||![identity isKindOfClass:NSString.class]||![identity isEqual:binding[@"identity"]]||![binding[@"snapshot"] isKindOfClass:NSNumber.class]||[binding[@"snapshot"] intValue]<=0||self.backgroundSave){
                [self failResult:current code:InvalidReply];return;
            }
            ProbeBackgroundSave* save=[ProbeBackgroundSave new];save.ticket=current.ticket;save.session=[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(current.sessionId)];save.native=native;save.pdf=pdf;save.extent={static_cast<std::int32_t>(w),static_cast<std::int32_t>(h)};save.index=[index intValue];save.expectedDigest=expected;save.binding=binding;save.numbering=numberingValue;self.backgroundSave=save;
            // Release the previous object's edit ownership. Its data is never
            // applied to the target; only the target's subsequent real DoVerb
            // is allowed to supply a client site for the prepared save.
            auto hr=bridge_probe::completeEdit(current.sessionId,nullptr,0,false);
            if(hr!=bridge_probe::Ok){[self ackBackground:save ok:NO];return;}
            EquationLabWakeWordHost();
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW,10*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(self.backgroundSave==save){if(save.nativeApplied)[self ackBackgroundUncertain:save];else [self ackBackground:save ok:NO];}});
            return;
        }
        if(numberingValue){[self failResult:current code:InvalidReply];return;}
        self.applying=YES;
        auto hr=bridge_probe::setSessionPreview(current.sessionId,static_cast<const std::uint8_t*>(pdf.bytes),pdf.length,{static_cast<std::int32_t>(w),static_cast<std::int32_t>(h)});
        // completeEdit synchronously runs the client's SaveObject contract.
        // Capture its identity first: successful completion cleans edit state.
        NSString* ackTicket=current.ticket;
        NSString* ackSession=[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(current.sessionId)];
        if(hr==bridge_probe::Ok)hr=bridge_probe::completeEdit(current.sessionId,static_cast<const std::uint8_t*>(native.bytes),native.length,true,current.reopenRequested);
        self.applying=NO;
        [self request:@"/api/native-ack" body:@{@"ticket":ackTicket,@"session":ackSession,@"ok":@(hr==bridge_probe::Ok)} reply:^(NSDictionary*,NSError*){}];
        if(hr!=bridge_probe::Ok)[self fail:current code:ApplyFailure];
    }];
}
@end

std::int32_t EquationLabQueueEditorTool(NSString* tool){
    if(!NSThread.isMainThread||!transport||![@[@"typography",@"spacing",@"export"] containsObject:tool])return -1;
    for(ProbeEditState* state in transport.edits.allValues){
        if(!state.terminal&&state.activation==transport.activation){state.toolIntent=tool;return 0;}
    }
    return -3;
}

namespace bridge_probe {
namespace {
HResult openTransport(std::uint64_t id,const std::uint8_t* data,std::size_t size,void*){
    if(!NSThread.isMainThread)return WrongThread;
    if(!transport||!data||size<29||size>MaxBlob)return InvalidArgument;
    if(transport.edits.count>=16&&!transport.edits[@(id)])return Unexpected;
    NSData* native=[NSData dataWithBytes:data length:size];if(!nativeValid(native))return StorageHeaderError;
    [transport begin:id native:native];return Ok;
}
void cancelTransport(std::uint64_t id,void*){if(NSThread.isMainThread)[transport cleanup:id];}
void forgetTransportOwner(std::uint64_t id,void*){
    auto forget=^{if(id)[transport forgetOwner:id];else{documentCapturedAt=nil;[transport invalidateDocuments];}};
    if(NSThread.isMainThread)forget();else dispatch_async(dispatch_get_main_queue(),forget);
}
void writtenTransportOwner(std::uint64_t id,const std::uint8_t*,std::size_t,void*){
    if(!NSThread.isMainThread)return;
    // Word may replace the OLE character during SaveObject, invalidating even
    // duplicated VBA ranges. Updating the hash cannot make that old anchor
    // fresh. A later activation must capture its exact current selection (or
    // consume a new preactivation anchor) instead of retrying the written one.
    [transport forgetOwner:id];
}
}
HResult installEditorTransport(){
    if(!NSThread.isMainThread)return WrongThread;
    if(!transport)transport=[ProbeEditorTransport new];
    if(inWord()){
        EquationLabInstallWordHostPump();
        auto requestResult=installWordDocumentRequests();if(requestResult!=0)return static_cast<HResult>(requestResult);
    }
    setEditorHooks(openTransport,nullptr);setEditorCancelHook(cancelTransport);setEditorOwnerForgetHook(forgetTransportOwner);setEditorOwnerWrittenHook(writtenTransportOwner);return Ok;
}
HResult installEditorTransportForTesting(std::uint16_t port,LaunchEditorUrl launch,void* context,std::uint32_t interval){
    if(inWord()||!port||!launch||interval<1||interval>60000)return InvalidArgument;
    if(editorTransportActive()||transport.backgroundSave)return Unexpected;
    auto hr=installEditorTransport();if(hr!=Ok)return hr;
    transport.baseURL=[NSString stringWithFormat:@"http://127.0.0.1:%u",port];transport.launch=launch;transport.launchContext=context;transport.interval=interval;lastError=0;return Ok;
}
std::uint32_t editorTransportActive(){
    auto count=static_cast<std::uint32_t>(transport.edits.count);
    // A direct target commit deliberately has no second HTTP edit state.
    // Still expose its synchronous activation/save as active so VBA's
    // selection handlers cannot re-enter WordOpenXML from SaveObject.
    return count?count:(transport.applying||transport.backgroundSave.claimed?1:0);
}
std::uint32_t editorTransportLastError(){return lastError.load();}
}
void EquationLabDocumentContextDidCapture(){documentCapturedAt=NSDate.date;if(transport){++transport.captureSerial;[transport documentReady];}}
void EquationLabDocumentContextWillCapture(){documentCapturedAt=nil;}
void EquationLabDocumentContextDidClearSelection(){documentCapturedAt=nil;}
void EquationLabDocumentContextDidClear(){documentCapturedAt=nil;EquationLabClearDocumentActivationAnchor();if(transport){[transport invalidateDocuments];for(ProbeEditState* state in transport.edits.allValues)if(state.awaitingDocument&&state.requiresDocumentCapture&&state.activation==transport.activation)[transport requestCapture:state];}}
void EquationLabDocumentContextDidCloseIdentity(std::int32_t identity){
    if(!NSThread.isMainThread||identity<=0||!transport)return;
    EquationLabClearDocumentActivationAnchor();
    NSString* suffix=[NSString stringWithFormat:@":%d",identity];NSMutableArray<NSNumber*>* owners=[NSMutableArray array];
    for(NSNumber* owner in transport.ownerCaptureBindings){if([transport.ownerCaptureBindings[owner][@"identity"] hasSuffix:suffix])[owners addObject:owner];}
    NSMutableArray<ProbeEditState*>* pending=[NSMutableArray array];
    for(ProbeEditState* state in transport.edits.allValues)if(state.awaitingDocument&&[owners containsObject:@(state.ownerIdentity)])[pending addObject:state];
    for(ProbeEditState* state in pending){lastCaptureState=CaptureSuperseded;[transport fail:state code:InvalidReply];}
    for(NSNumber* owner in owners)[transport forgetOwner:owner.unsignedLongLongValue];
}
extern "C" __attribute__((visibility("default")))
bridge_probe::HResult MathTypeBridgeInstallTransportForTesting(std::uint16_t port,bridge_probe::LaunchEditorUrl launch,void* context,std::uint32_t interval){return bridge_probe::installEditorTransportForTesting(port,launch,context,interval);}
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeTransportActive(){return bridge_probe::editorTransportActive();}
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeDocumentCaptureState(){return lastCaptureState.load();}
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeDocumentCaptureAllowed(){
    if(!NSThread.isMainThread)return 0;
    // The user can select another equation while the old editor is still
    // open. Freeze THAT selection too. Only synchronous SaveObject callbacks
    // must avoid re-entering WordOpenXML during a persistence operation.
    return transport&&!transport.applying&&!transport.backgroundSave.claimed?1:0;
}
// VBA uses integer commands only. Take is one-shot and never claims inside
// SaveObject; getters refer exclusively to that same latest activation.
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeCaptureWatch(){return NSThread.isMainThread&&transport&&(bridge_probe::wordDocumentRequestWatch()||transport.ownerCaptureBindings.count||transport.edits.count||transport.backgroundSave||EquationLabPreCapturedActivationIsPending()||EquationLabActivationAnchorIsPending())?1:0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeTakeDocumentCaptureRequest(){return NSThread.isMainThread?[transport takeCaptureRequest]:0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeDocumentCaptureIsEnrichment(){return NSThread.isMainThread&&transport.captureRequest.claimed&&transport.captureRequest.state.enrichingDocument?1:0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeDocumentCaptureRequestToken(){return NSThread.isMainThread&&transport.captureRequest.claimed?transport.captureRequest.token:0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeDocumentCaptureSnapshot(){return NSThread.isMainThread&&transport.captureRequest.claimed?[transport.captureRequest.binding[@"snapshot"] intValue]:0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeDocumentCaptureIndex(){
    // VBA uses zero for an unbound request, and one-based indices only when
    // a retained Document+Range is present. Messaging nil returns zero;
    // adding one before checking the binding would fabricate formula 1.
    return NSThread.isMainThread&&transport.captureRequest.claimed&&transport.captureRequest.binding
        ?[transport.captureRequest.binding[@"index"] intValue]+1:0;
}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeDocumentCaptureIdentity(){return NSThread.isMainThread&&transport.captureRequest.claimed?[[transport.captureRequest.binding[@"identity"] componentsSeparatedByString:@":"].lastObject intValue]:0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeFinishDocumentCaptureRequest(){return NSThread.isMainThread?[transport finishCaptureRequest:YES]:-1;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeFailDocumentCaptureRequest(){return NSThread.isMainThread?[transport finishCaptureRequest:NO]:-1;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeTakeBackgroundSave(){
    if(!NSThread.isMainThread||!transport||transport.edits.count)return 0;
    ProbeBackgroundSave* save=transport.backgroundSave;if(!save||save.claimed)return 0;
    save.claimed=YES;return [save.binding[@"snapshot"] intValue];
}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeBackgroundSaveIndex(){return NSThread.isMainThread&&transport.backgroundSave.claimed?transport.backgroundSave.index+1:0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeRegisterNumberingSupport(){if(!NSThread.isMainThread||!transport)return -1;transport.numberingSupportRegistered=YES;return 0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeBackgroundNumberingSide(){if(!NSThread.isMainThread)return -1;ProbeBackgroundSave* save=transport.backgroundSave;if(!save.claimed||!save.nativeApplied||!save.numbering)return 0;return [save.numbering[@"side"] isEqual:@"left"]?1:2;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeBackgroundNumberingNext(){if(!NSThread.isMainThread)return -1;ProbeBackgroundSave* save=transport.backgroundSave;if(!save.claimed||!save.nativeApplied||!save.numbering)return -1;NSString* format=save.numbering[@"format"];if(save.numberingCursor>=format.length)return 0;return static_cast<std::int32_t>([format characterAtIndex:save.numberingCursor++])+1;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeFinishBackgroundNumbering(){if(!NSThread.isMainThread)return -1;ProbeBackgroundSave* save=transport.backgroundSave;if(!save.claimed||!save.nativeApplied||!save.numbering)return -1;[transport ackBackground:save ok:YES];return 0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeFailBackgroundSave(){if(!NSThread.isMainThread)return -1;ProbeBackgroundSave* save=transport.backgroundSave;if(save){if(save.nativeApplied)[transport ackBackgroundUncertain:save];else [transport ackBackground:save ok:NO];}return 0;}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeBackgroundSaveActivationFinished(){return MathTypeBridgeFailBackgroundSave();}
extern "C" __attribute__((visibility("default")))
bridge_probe::HResult MathTypeBridgeSetTransportDocumentForTesting(const char* json){
    if(inWord()||!NSThread.isMainThread||!transport.launch)return bridge_probe::InvalidArgument;
    if(!json){transport.testDocumentContext=nil;return bridge_probe::Ok;}
    NSData* bytes=[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];id context=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
    if(![context isKindOfClass:NSDictionary.class])return bridge_probe::InvalidArgument;transport.testDocumentContext=context;EquationLabDocumentContextDidCapture();return bridge_probe::Ok;
}
extern "C" __attribute__((visibility("default")))
bridge_probe::HResult MathTypeBridgeArmDocumentActivationForTesting(const char* json){
    if(inWord()||!NSThread.isMainThread||!transport.launch||!json)return bridge_probe::InvalidArgument;
    NSData* bytes=[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];id context=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
    if(![context isKindOfClass:NSDictionary.class]||!EquationLabArmDocumentActivationAnchor(context))return bridge_probe::InvalidArgument;
    return bridge_probe::Ok;
}
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeActivationAnchorPendingForTesting(){return !inWord()&&NSThread.isMainThread?EquationLabActivationAnchorIsPending():0;}
extern "C" __attribute__((visibility("default")))
std::uint64_t MathTypeBridgeLastOwnerIdentityForTesting(){return inWord()?0:transport.lastOwnerIdentity;}
extern "C" __attribute__((visibility("default")))
bridge_probe::HResult MathTypeBridgeClearTransportDocumentsForTesting(){if(inWord()||!NSThread.isMainThread||!transport.launch)return bridge_probe::InvalidArgument;EquationLabDocumentContextDidClear();return bridge_probe::Ok;}
extern "C" __attribute__((visibility("default")))
bridge_probe::HResult MathTypeBridgeAgeTransportCaptureForTesting(double age){if(inWord()||!NSThread.isMainThread||!transport.launch||age<0||age>60)return bridge_probe::InvalidArgument;documentCapturedAt=[NSDate dateWithTimeIntervalSinceNow:-age];return bridge_probe::Ok;}
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeTransportLastError(){return bridge_probe::editorTransportLastError();}
