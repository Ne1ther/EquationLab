// Behavioral tests for the native document claim lifecycle using mock HTTP.
#include "word_document_requests.mm"
#include <atomic>
#include <functional>
#include <iostream>
#include <stdexcept>

namespace {
std::atomic<std::uint32_t> transportActive{0};
std::atomic<bool> insertionActive{false};
std::atomic<std::uint32_t> wakeCount{0};

void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}

void runFor(NSTimeInterval seconds){
    NSDate* end=[NSDate dateWithTimeIntervalSinceNow:seconds];
    while(end.timeIntervalSinceNow>0)[[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
}

void waitUntil(const std::function<bool()>& predicate,const char* message){
    NSDate* end=[NSDate dateWithTimeIntervalSinceNow:8];
    while(end.timeIntervalSinceNow>0){
        if(predicate())return;
        [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    throw std::runtime_error(message);
}

NSString* requestId(unichar value){return [@"" stringByPaddingToLength:64 withString:[NSString stringWithCharacters:&value length:1] startingAtIndex:0];}
}

namespace bridge_probe {
std::uint32_t editorTransportActive(){return transportActive.load();}
}

void EquationLabWakeWordHost(){++wakeCount;}
bool EquationLabWordInsertionActive(){return insertionActive.load();}

@interface ELWordDocumentRequestMockProtocol : NSURLProtocol
+ (void)setHandler:(NSDictionary*(^)(NSString*,NSDictionary*))handler;
@end

@implementation ELWordDocumentRequestMockProtocol
static NSDictionary*(^mockHandler)(NSString*,NSDictionary*);
+ (void)setHandler:(NSDictionary*(^)(NSString*,NSDictionary*))handler {
    @synchronized(self){mockHandler=[handler copy];}
}
+ (BOOL)canInitWithRequest:(NSURLRequest*)request {
    return [request.URL.scheme isEqual:@"http"]&&[request.URL.host isEqual:@"127.0.0.1"]&&[request.URL.port isEqual:@37952];
}
+ (NSURLRequest*)canonicalRequestForRequest:(NSURLRequest*)request{return request;}
- (void)startLoading {
    NSDictionary*(^handler)(NSString*,NSDictionary*)=nil;
    @synchronized(ELWordDocumentRequestMockProtocol.class){handler=[mockHandler copy];}
    NSError* error=nil;
    NSData* requestData=self.request.HTTPBody;
    if(!requestData&&self.request.HTTPBodyStream){
        NSInputStream* stream=self.request.HTTPBodyStream;[stream open];NSMutableData* collected=[NSMutableData data];uint8_t buffer[1024];
        while(stream.hasBytesAvailable){NSInteger count=[stream read:buffer maxLength:sizeof(buffer)];if(count<=0)break;[collected appendBytes:buffer length:static_cast<NSUInteger>(count)];}
        [stream close];requestData=collected;
    }
    NSDictionary* body=requestData?[NSJSONSerialization JSONObjectWithData:requestData options:0 error:&error]:nil;
    NSDictionary* result=handler?handler(self.request.URL.lastPathComponent,body):nil;
    if(error||![result isKindOfClass:NSDictionary.class]){
        [self.client URLProtocol:self didFailWithError:error?:[NSError errorWithDomain:@"ELWordDocumentRequestTests" code:1 userInfo:nil]];
        return;
    }
    NSData* data=[NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
    if(error){[self.client URLProtocol:self didFailWithError:error];return;}
    NSHTTPURLResponse* response=[[NSHTTPURLResponse alloc] initWithURL:self.request.URL statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Type":@"application/json"}];
    [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
    [self.client URLProtocol:self didLoadData:data];
    [self.client URLProtocolDidFinishLoading:self];
}
- (void)stopLoading{}
@end

@interface ELWordDocumentRequestMockBackend : NSObject
@property(nonatomic,strong) NSString* firstId;
@property(nonatomic,strong) NSString* replacementId;
@property(nonatomic,strong) NSString* explicitIdentity;
@property(nonatomic,strong) NSString* insertionMode;
@property(nonatomic) BOOL reveal;
@property(nonatomic,strong) NSString* finishedState;
@property(nonatomic,strong) NSMutableDictionary<NSString*,NSString*>* states;
@property(nonatomic,strong) NSMutableArray<NSString*>* statusIds;
@property(nonatomic) NSUInteger takeCount;
@property(nonatomic) NSUInteger statusCount;
@property(nonatomic) NSUInteger finishCount;
@property(nonatomic) NSUInteger workspaceCount;
@property(nonatomic,strong) NSDictionary* lastWorkspace;
- (NSDictionary*)handle:(NSString*)operation body:(NSDictionary*)body;
@end

@implementation ELWordDocumentRequestMockBackend
- (instancetype)init {
    if((self=[super init])){_states=[NSMutableDictionary dictionary];_statusIds=[NSMutableArray array];}
    return self;
}
- (NSDictionary*)handle:(NSString*)operation body:(NSDictionary*)body {
    @synchronized(self){
        if([operation isEqual:@"native-document-take"]){
            ++self.takeCount;
            if(self.takeCount==1)return @{@"state":@"empty"};
            if(self.takeCount==2){
                transportActive.store(1);self.states[self.firstId]=@"delivered";
                NSDictionary* target=@{@"identity":@"process:42",@"snapshot":@7,@"index":@3,@"nativeSha256":self.firstId};
                NSMutableDictionary* reply=[(self.explicitIdentity?@{@"state":@"delivered",@"requestId":self.firstId,@"documentIdentity":self.explicitIdentity}:@{@"state":@"delivered",@"requestId":self.firstId,@"target":target}) mutableCopy];
                if(self.insertionMode)reply[@"insertionMode"]=self.insertionMode;
                if(self.reveal)reply[@"reveal"]=@YES;
                return reply;
            }
            if(self.takeCount==3&&self.replacementId){
                self.states[self.replacementId]=@"delivered";
                return @{@"state":@"delivered",@"requestId":self.replacementId};
            }
            return @{@"state":@"empty"};
        }
        if([operation isEqual:@"native-document-status"]){
            ++self.statusCount;NSString* identifier=body[@"requestId"];
            if(identifier)[self.statusIds addObject:identifier];
            return @{@"requestId":identifier?:@"",@"state":self.states[identifier]?:@"expired"};
        }
        if([operation isEqual:@"native-document-finish"]){++self.finishCount;self.finishedState=body[@"state"];return @{@"requestId":body[@"requestId"]?:@"",@"state":body[@"state"]?:@"failed"};}
        if([operation isEqual:@"native-document-workspace"]){++self.workspaceCount;self.lastWorkspace=[body copy];return @{@"revision":@(self.workspaceCount),@"connected":@YES};}
        return @{@"state":@"empty"};
    }
}
@end

@interface ELWordDocumentRequestDeferredFinishHTTP : ELWordDocumentRequestHTTP
@property(nonatomic,strong) NSMutableDictionary* pendingFinishes;
- (void)completeFinish:(NSString*)identifier state:(NSString*)state;
@end

@implementation ELWordDocumentRequestDeferredFinishHTTP
- (instancetype)init {
    if((self=[super init]))_pendingFinishes=[NSMutableDictionary dictionary];
    return self;
}
- (void)post:(NSString*)operation body:(NSDictionary*)body timeout:(NSTimeInterval)timeout completion:(void(^)(NSDictionary*,NSError*))completion {
    if([operation isEqual:@"native-document-finish"]){self.pendingFinishes[body[@"requestId"]]=[completion copy];return;}
    [super post:operation body:body timeout:timeout completion:completion];
}
- (void)completeFinish:(NSString*)identifier state:(NSString*)state {
    void(^completion)(NSDictionary*,NSError*)=self.pendingFinishes[identifier];
    check(completion!=nil,"expected deferred finish response");
    [self.pendingFinishes removeObjectForKey:identifier];
    if(state)completion(@{@"requestId":identifier,@"state":state},nil);
    else completion(nil,[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorTimedOut userInfo:nil]);
}
@end

static void resetManager(){
    if(bridge_probe::manager){
        ELWordDocumentRequestManager* old=bridge_probe::manager;
        ++old.generation;old.installed=NO;[old.http.session invalidateAndCancel];bridge_probe::manager=nil;
    }
    transportActive.store(0);wakeCount.store(0);runFor(0.03);
}

static ELWordDocumentRequestMockBackend* installScenario(NSString* firstId,NSString* replacementId=nil,NSString* explicitIdentity=nil,NSString* insertionMode=nil,BOOL reveal=NO){
    resetManager();
    ELWordDocumentRequestMockBackend* backend=[ELWordDocumentRequestMockBackend new];backend.firstId=firstId;backend.replacementId=replacementId;backend.explicitIdentity=explicitIdentity;backend.insertionMode=insertionMode;backend.reveal=reveal;
    [ELWordDocumentRequestMockProtocol setHandler:^NSDictionary*(NSString* operation,NSDictionary* body){return [backend handle:operation body:body];}];
    check(bridge_probe::installWordDocumentRequests()==0,"native manager did not install");
    if(reveal)bridge_probe::publishWordWorkspace(@{@"identity":@"process:42",@"name":@"A.docx"},nil,YES);
    waitUntil(^{@synchronized(backend){return backend.statusCount>=1;}},"delivered take was not revalidated");
    return backend;
}

static NSUInteger readCount(ELWordDocumentRequestMockBackend* backend,NSString* key){
    @synchronized(backend){return [[backend valueForKey:key] unsignedIntegerValue];}
}

static void testDelayedReleaseAndSingleClaim(){
    NSString* identifier=requestId('a');ELWordDocumentRequestMockBackend* backend=installScenario(identifier);
    waitUntil(^{return readCount(backend,@"workspaceCount")>=1;},"initial workspace publish did not complete");
    waitUntil(^{return readCount(backend,@"statusCount")>=2;},"busy claim was not polled again");
    check(bridge_probe::manager.claim!=nil&&[bridge_probe::manager.claim[@"requestId"] isEqual:identifier],"busy take claim was discarded");
    check(readCount(backend,@"finishCount")==0,"busy claim was force-cancelled");
    check(bridge_probe::takeWordDocumentRequest()==0,"busy claim produced a VBA token");
    check(bridge_probe::wordDocumentRequestEnvelope(1)==nil,"busy claim envelope reached VBA");
    check(!bridge_probe::beginWordDocumentRequest(1)&&!bridge_probe::wordDocumentRequestIsCurrent(1)&&bridge_probe::currentWordDocumentRequestToken()==0,"busy claim passed a VBA ownership gate");

    bridge_probe::manager.workspacePublishedAt=[NSDate dateWithTimeIntervalSinceNow:-20];
    waitUntil(^{return readCount(backend,@"workspaceCount")>=2;},"workspace heartbeat was not refreshed while waiting");
    transportActive.store(0);
    waitUntil(^{return wakeCount.load()==1&&bridge_probe::manager.revalidated;},"inactive fresh status did not wake the host exactly once");
    runFor(0.35);check(wakeCount.load()==1,"claim generated repeated host wakes");
    std::int32_t token=bridge_probe::takeWordDocumentRequest();
    check(token>0&&bridge_probe::takeWordDocumentRequest()==0,"eligible claim was not exposed exactly once");
    NSDictionary* envelope=bridge_probe::wordDocumentRequestEnvelope(token);
    check([envelope[@"requestId"] isEqual:identifier]&&[envelope[@"target"][ @"identity"] isEqual:@"process:42"]&&[envelope[@"target"][ @"index"] intValue]==3,"claim identity or target changed during deferral");
    check(bridge_probe::beginWordDocumentRequest(token)&&bridge_probe::wordDocumentRequestIsCurrent(token),"fresh single-use claim did not open");
    transportActive.store(1);
    check(bridge_probe::takeWordDocumentRequest()==0,"executing request was delivered twice");
    check(bridge_probe::wordDocumentRequestEnvelope(token)!=nil&&bridge_probe::wordDocumentRequestIsCurrent(token)&&bridge_probe::currentWordDocumentRequestToken()==token,"request's own OLE activation blocked its VBA finish callback");
    check(bridge_probe::finishWordDocumentRequest(token,@"opened")==0,"executing request could not finish");
    waitUntil(^{return bridge_probe::manager.claim==nil;},"finished request retained its claim");
    check(readCount(backend,@"finishCount")==1,"request did not report its opened outcome exactly once");
}

static void testNewRequestDoesNotInheritBusyTakeBackoff(){
    resetManager();
    NSString* identifier=requestId('d');
    NSMutableArray<NSNumber*>* takeWaits=[NSMutableArray array];
    NSMutableDictionary<NSString*,NSString*>* states=[NSMutableDictionary dictionary];
    __block NSUInteger statusCount=0,workspaceCount=0;
    [ELWordDocumentRequestMockProtocol setHandler:^NSDictionary*(NSString* operation,NSDictionary* body){
        if([operation isEqual:@"native-document-take"]){
            [takeWaits addObject:body[@"waitMs"]?:@(-1)];
            if(takeWaits.count==1){transportActive.store(1);return @{@"state":@"empty"};}
            states[identifier]=@"delivered";
            return @{@"state":@"delivered",@"requestId":identifier};
        }
        if([operation isEqual:@"native-document-status"]){
            ++statusCount;NSString* request=body[@"requestId"];
            return @{@"requestId":request?:@"",@"state":states[request]?:@"expired"};
        }
        if([operation isEqual:@"native-document-workspace"]){++workspaceCount;return @{@"revision":@(workspaceCount),@"connected":@YES};}
        if([operation isEqual:@"native-document-finish"])return @{@"state":body[@"state"]?:@"failed"};
        return @{@"state":@"empty"};
    }];
    check(bridge_probe::installWordDocumentRequests()==0,"native manager did not install for active-session take");
    waitUntil(^{return takeWaits.count>=2;},"new request waited behind a stale busy take backoff");
    check([takeWaits[1] isEqual:@20000],"take did not remain long-polled while editor transport was active");
    waitUntil(^{return bridge_probe::manager.waitingForTransportRelease&&statusCount>=1;},"delivered request was not safely deferred while busy");
    runFor(2.25);
    NSDate* releasedAt=NSDate.date;transportActive.store(0);
    waitUntil(^{return bridge_probe::manager.revalidated;},"claim was not revalidated after transport became idle");
    NSTimeInterval releaseLatency=-releasedAt.timeIntervalSinceNow;
    check(releaseLatency<=0.45,"idle release inherited a growing busy-status backoff");
    check(wakeCount.load()==1,"idle release did not wake the Word host exactly once");
    std::int32_t token=bridge_probe::takeWordDocumentRequest();
    check(token>0&&[bridge_probe::wordDocumentRequestEnvelope(token)[@"requestId"] isEqual:identifier],"released request lost its exact identity");
}

static void testTerminalWhileWaiting(NSString* terminal){
    NSString* identifier=requestId([terminal isEqual:@"cancelled"]?'b':'c');ELWordDocumentRequestMockBackend* backend=installScenario(identifier);
    waitUntil(^{return readCount(backend,@"statusCount")>=1;},"waiting claim was not checked");
    @synchronized(backend){backend.states[identifier]=terminal;}
    waitUntil(^{return bridge_probe::manager.claim==nil;},"terminal waiting claim remained retained");
    check(readCount(backend,@"finishCount")==0,"native side finished a cancelled or superseded request");
    check(bridge_probe::takeWordDocumentRequest()==0&&bridge_probe::wordDocumentRequestEnvelope(1)==nil,"terminal waiting claim remained available to VBA");
}

static void testRetiredDocumentMetadata(){
    ELWordDocumentRequestMockBackend* backend=installScenario(requestId('e'));
    bridge_probe::publishWordWorkspace(@{@"identity":@"process:A",@"name":@"A.docx"},@[@{@"identity":@"process:A",@"name":@"A.docx",@"readOnly":@NO,@"numberingRevision":@12},@{@"identity":@"process:B",@"name":@"A.docx",@"readOnly":@YES,@"numberingRevision":@42}]);
    check([bridge_probe::wordWorkspaceNumberingRevision(@"process:A") isEqual:@12]&&[bridge_probe::wordWorkspaceNumberingRevision(@"process:B") isEqual:@42]&&!bridge_probe::wordWorkspaceNumberingRevision(@"process:C"),"same-name workspace documents shared one snapshot numbering revision");
    waitUntil(^{@synchronized(backend){return [backend.lastWorkspace[@"active"] isKindOfClass:NSDictionary.class]&&[backend.lastWorkspace[@"active"][@"identity"] isEqual:@"process:A"];}},"active document was not published");
    bridge_probe::closeWordWorkspaceIdentity(@"process:B");
    waitUntil(^{@synchronized(backend){return [backend.lastWorkspace[@"retiredIdentities"] containsObject:@"process:B"];}},"background document retirement was not published");
    @synchronized(backend){check([backend.lastWorkspace[@"active"][@"identity"] isEqual:@"process:A"],"closing background B changed active A");}
    bridge_probe::closeWordWorkspaceIdentity(@"process:A");
    waitUntil(^{@synchronized(backend){return backend.lastWorkspace[@"active"]==NSNull.null&&[backend.lastWorkspace[@"retiredIdentities"] containsObject:@"process:A"];}},"closing active document did not retire its identity");
    bridge_probe::publishWordWorkspace(@{@"identity":@"process:A",@"name":@"A.docx"},nil);
    waitUntil(^{@synchronized(backend){return [backend.lastWorkspace[@"active"] isKindOfClass:NSDictionary.class]&&![backend.lastWorkspace[@"retiredIdentities"] containsObject:@"process:A"];}},"re-observed document remained retired");
    bridge_probe::publishWordWorkspace(nil,@[]);
    waitUntil(^{@synchronized(backend){return backend.lastWorkspace[@"active"]==NSNull.null&&[backend.lastWorkspace[@"documents"] count]==0&&[backend.lastWorkspace[@"retiredIdentities"] containsObject:@"process:A"];}},"clearing the final workspace lost the previous source retirement");
    for(int i=0;i<130;i++)bridge_probe::closeWordWorkspaceIdentity([NSString stringWithFormat:@"process:%d",i]);
    waitUntil(^{@synchronized(backend){return [backend.lastWorkspace[@"retiredIdentities"] count]==128&&[backend.lastWorkspace[@"retiredIdentities"] containsObject:@"process:129"];}},"retirement history was not bounded and published");
}

static void testExplicitDocumentIdentitySurvivesClaim(){
    NSString* identifier=requestId('f');ELWordDocumentRequestMockBackend* backend=installScenario(identifier,nil,@"process:inactive-22",@"numbered-right");
    waitUntil(^{return readCount(backend,@"statusCount")>=1;},"explicit document request was not revalidated");
    insertionActive.store(true);transportActive.store(0);runFor(0.35);
    check(bridge_probe::takeWordDocumentRequest()==0,"a pending old insertion was ignored by the document claim gate");
    insertionActive.store(false);waitUntil(^{return bridge_probe::manager.revalidated;},"explicit document request did not become claimable");
    std::int32_t token=bridge_probe::takeWordDocumentRequest();NSDictionary* envelope=bridge_probe::wordDocumentRequestEnvelope(token);
    check([envelope[@"documentIdentity"] isEqual:@"process:inactive-22"]&&!envelope[@"target"],"explicit identity changed or conflicted with formula target");
    check([envelope[@"insertionMode"] isEqual:@"numbered-right"],"App insertion intent disappeared before VBA delivery");
    check([backend.lastWorkspace[@"insertionRequestSupport"] boolValue],"new host did not advertise App insertion support");
    check(bridge_probe::beginWordDocumentRequest(token),"explicit identity request did not begin");
    check(bridge_probe::finishWordDocumentRequest(token,@"empty")==0,"empty explicit request did not finish");
    waitUntil(^{return bridge_probe::manager.claim==nil;},"empty explicit request retained its claim");
}

static void testRevealDoesNotRequestAnEditorOrInterruptInsertion(){
    NSString* identifier=requestId('7');ELWordDocumentRequestMockBackend* backend=installScenario(identifier,nil,nil,nil,YES);
    waitUntil(^{return bridge_probe::manager.revalidated;},"reveal did not become claimable during an active editor session");
    check(transportActive.load()!=0,"fixture did not hold the OLE edit open");
    insertionActive.store(true);
    check(bridge_probe::takeWordDocumentRequest(YES)==0,"reveal interrupted an insertion");
    insertionActive.store(false);
    waitUntil(^{return bridge_probe::manager.revalidated;},"reveal did not resume after insertion");
    const std::int32_t token=bridge_probe::takeWordDocumentRequest(YES);
    NSDictionary* envelope=bridge_probe::wordDocumentRequestEnvelope(token);
    check(token>0&&[envelope[@"reveal"] isEqual:@YES]&&[envelope[@"target"][@"index"] isEqual:@3],"the reveal intent or target disappeared before VBA");
    check([backend.lastWorkspace[@"revealRequestSupport"] boolValue],"reveal support was not published");
    check(bridge_probe::beginWordDocumentRequest(token)&&bridge_probe::openingWordDocumentRequestId()==nil,"revealing an equation opened an OLE edit request");
    check(bridge_probe::finishWordDocumentRequest(token,@"opened")==-2,"an open receipt acknowledged a reveal");
    check(bridge_probe::finishWordDocumentRequest(token,@"revealed")==0,"revealed request could not finish");
    waitUntil(^{return bridge_probe::manager.claim==nil;},"finished reveal held its claim");
    check([backend.finishedState isEqual:@"revealed"]&&transportActive.load()!=0,"reveal lost its terminal receipt or ended the edit");
}

static void testRevealFinishAcrossClaimDeadline(bool expirationFirst){
    NSString* revealId=requestId('8');
    NSString* openId=requestId('9');
    installScenario(revealId,openId,nil,nil,YES);
    ELWordDocumentRequestManager* manager=bridge_probe::manager;
    waitUntil(^{return manager.revalidated&&!manager.publishingWorkspace;},"reveal was not ready before its deadline");
    ELWordDocumentRequestDeferredFinishHTTP* http=[ELWordDocumentRequestDeferredFinishHTTP new];
    [manager.http.session invalidateAndCancel];manager.http=http;

    // Move to the end of the reveal window without sleeping for the full TTL.
    manager.claimDeadline=[NSDate dateWithTimeIntervalSinceNow:0.5];
    const std::int32_t revealToken=bridge_probe::takeWordDocumentRequest(YES);
    check(revealToken>0&&bridge_probe::beginWordDocumentRequest(revealToken),"near-deadline reveal did not begin");
    check(bridge_probe::finishWordDocumentRequest(revealToken,@"revealed")==0&&manager.finishing,"near-deadline reveal did not send its finish");
    manager.claimDeadline=[NSDate dateWithTimeIntervalSinceNow:-0.5];
    transportActive.store(0);
    if(expirationFirst){
        check(bridge_probe::takeWordDocumentRequest(YES)==0,"expired reveal was delivered again");
        check(!manager.finishing&&!manager.claim&&manager.token==0,"expiration left a finishing claim and blocked the next take");
    }else{
        [http completeFinish:revealId state:nil];
        check(!manager.finishing&&!manager.claim&&manager.token==0,"finish timeout after deadline left the claim open");
    }
    waitUntil(^{return manager.revalidated&&[manager.claim[@"requestId"] isEqual:openId];},"next open could not be taken after the reveal deadline");
    const std::int32_t openToken=bridge_probe::takeWordDocumentRequest();
    check(openToken>0&&openToken!=revealToken&&bridge_probe::beginWordDocumentRequest(openToken),"replacement open did not receive its own claim");
    check(bridge_probe::finishWordDocumentRequest(openToken,@"opened")==0,"replacement open could not finish");
    if(expirationFirst){
        [http completeFinish:revealId state:@"expired"];
        check(manager.finishing&&manager.token==openToken&&[manager.claim[@"requestId"] isEqual:openId],"late reveal reply cleared the replacement's finish");
    }
    [http completeFinish:openId state:@"opened"];
    check(!manager.finishing&&!manager.claim&&manager.token==0,"replacement open retained claim state after it finished");
}

int main(){@autoreleasepool{try{
    testDelayedReleaseAndSingleClaim();resetManager();
    testNewRequestDoesNotInheritBusyTakeBackoff();resetManager();
    testTerminalWhileWaiting(@"cancelled");resetManager();
    testTerminalWhileWaiting(@"superseded");resetManager();
    testTerminalWhileWaiting(@"expired");resetManager();
    testRetiredDocumentMetadata();resetManager();
    testExplicitDocumentIdentitySurvivesClaim();resetManager();
    testRevealDoesNotRequestAnEditorOrInterruptInsertion();resetManager();
    testRevealFinishAcrossClaimDeadline(true);resetManager();
    testRevealFinishAcrossClaimDeadline(false);resetManager();
    std::cout<<"{\"late_take_retained\":true,\"no_vba_delivery_while_busy\":true,\"delayed_release_single_claim\":true,\"active_session_long_poll\":true,\"idle_release_latency_bound_ms\":250,\"workspace_heartbeat\":true,\"cancelled_while_waiting\":true,\"superseded_while_waiting\":true,\"expired_while_waiting\":true,\"request_identity_preserved\":true,\"explicit_document_identity_preserved\":true,\"reveal_finish_and_expiry_ordering\":true,\"real_word_or_gui_used\":false}\n";
    return 0;
}catch(const std::exception& error){resetManager();std::cerr<<error.what()<<'\n';return 1;}}}
