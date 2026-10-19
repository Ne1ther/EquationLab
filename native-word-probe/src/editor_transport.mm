#include "editor_transport.hpp"
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <mach-o/dyld.h>
#include <string>
#include <vector>
#include <atomic>
#include <cerrno>
#include <algorithm>

NSDictionary* EquationLabCapturedDocumentContext();
void EquationLabSetNavigationTarget(std::int32_t index);

namespace {
constexpr NSUInteger MaxBlob=16*1024*1024;
constexpr NSUInteger MaxResponse=46*1024*1024;
constexpr auto WrongThread=static_cast<bridge_probe::HResult>(0x8001010eu);
std::atomic<std::uint32_t> lastError{0};
// Diagnostic codes contain no equation, ticket, document name, or URL.
enum : std::uint32_t { NetworkFailure=1,InvalidReply=2,LaunchFailure=3,Expired=4,ApplyFailure=5 };
void launchEquationLabURL(NSWorkspace* workspace,NSURL* url,void(^completion)(NSError*)){
    // Target the shipping application's stable identity. The scheme's default
    // handler may still point at an older development app with a different ID.
    NSURL* applicationURL=[workspace URLForApplicationWithBundleIdentifier:@"app.equationlab.mac"];
    if(!applicationURL){completion([NSError errorWithDomain:@"NativeEquationTransport" code:LaunchFailure userInfo:nil]);return;}
    NSWorkspaceOpenConfiguration* config=[NSWorkspaceOpenConfiguration configuration];config.activates=NO;
    [workspace openURLs:@[url] withApplicationAtURL:applicationURL configuration:config completionHandler:^(NSRunningApplication* app,NSError* error){
        completion(error||!app?[NSError errorWithDomain:@"NativeEquationTransport" code:LaunchFailure userInfo:nil]:nil);
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
@implementation ProbeJsonRequest
- (instancetype)initWithURL:(NSURL*)url body:(NSDictionary*)body completion:(ProbeReply)completion {
    if((self=[super init])){
        _response=[NSMutableData data];_completion=[completion copy];
        NSURLSessionConfiguration* config=NSURLSessionConfiguration.ephemeralSessionConfiguration;
        config.URLCache=nil;config.HTTPCookieStorage=nil;config.URLCredentialStorage=nil;
        config.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
        config.timeoutIntervalForRequest=10;config.timeoutIntervalForResource=15;
        _session=[NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:NSOperationQueue.mainQueue];
        NSMutableURLRequest* request=[NSMutableURLRequest requestWithURL:url];
        request.HTTPMethod=@"POST";[request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        request.HTTPBody=[NSJSONSerialization dataWithJSONObject:body options:0 error:nullptr];
        _task=[_session dataTaskWithRequest:request];[_task resume];
    }return self;
}
- (void)cancel {self.cancelled=YES;self.completion=nil;[self.task cancel];[self.session invalidateAndCancel];self.response=nil;}
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
    self.response=nil;self.task=nil;[session finishTasksAndInvalidate];self.session=nil;
    if(callback&&!self.cancelled)callback(json,error);
}
@end

@interface ProbeEditState : NSObject
@property(nonatomic) std::uint64_t sessionId;
@property(nonatomic,strong) NSString* ticket;
@property(nonatomic,strong) ProbeJsonRequest* request;
@property(nonatomic,strong) NSDate* expires;
@property(nonatomic) NSUInteger failures;
@property(nonatomic) BOOL terminal;
@property(nonatomic,strong) NSData* openNative;
@property(nonatomic,strong) NSDictionary* documentContext;
@property(nonatomic) BOOL awaitingDocument;
@property(nonatomic,strong) NSDate* wakeDeadline;
@property(nonatomic) BOOL wakeAttempted;
@property(nonatomic) BOOL wakePending;
@property(nonatomic) NSUInteger openRetries;
@end
@implementation ProbeEditState
@end

@interface ProbeEditorTransport : NSObject
@property(nonatomic,strong) NSMutableDictionary<NSNumber*,ProbeEditState*>* edits;
@property(nonatomic,strong) NSString* baseURL;
@property(nonatomic) bridge_probe::LaunchEditorUrl launch;
@property(nonatomic) void* launchContext;
@property(nonatomic) std::uint32_t interval;
- (void)begin:(std::uint64_t)sessionId native:(NSData*)native;
- (void)openState:(ProbeEditState*)state;
- (void)poll:(ProbeEditState*)state;
- (void)cleanup:(std::uint64_t)sessionId;
- (void)fail:(ProbeEditState*)state code:(std::uint32_t)code;
@end
static ProbeEditorTransport* transport=nil;
@implementation ProbeEditorTransport
- (instancetype)init {if((self=[super init])){_edits=[NSMutableDictionary dictionary];_baseURL=@"http://127.0.0.1:37952";_interval=150;}return self;}
- (BOOL)active:(ProbeEditState*)state {return !state.terminal&&self.edits[@(state.sessionId)]==state;}
- (ProbeJsonRequest*)request:(NSString*)path body:(NSDictionary*)body reply:(ProbeReply)reply {
    return [[ProbeJsonRequest alloc] initWithURL:[NSURL URLWithString:[self.baseURL stringByAppendingString:path]] body:body completion:reply];
}
- (void)cleanup:(std::uint64_t)sessionId {
    NSAssert(NSThread.isMainThread,@"Native OLE owner must be main thread");
    ProbeEditState* state=self.edits[@(sessionId)];if(!state)return;
    state.terminal=YES;state.openNative=nil;state.documentContext=nil;[state.request cancel];state.request=nil;[self.edits removeObjectForKey:@(sessionId)];
    if(state.ticket){
        // Best-effort immediate erasure; a missing endpoint leaves server TTL cleanup.
        __block ProbeJsonRequest* cancelRequest=nil;
        cancelRequest=[self request:@"/api/native-cancel" body:@{@"ticket":state.ticket} reply:^(NSDictionary* json,NSError* error){(void)json;(void)error;cancelRequest=nil;}];
    }
    state.ticket=nil;
}
- (void)fail:(ProbeEditState*)state code:(std::uint32_t)code {
    if(![self active:state])return;lastError=code;
    auto hr=bridge_probe::completeEdit(state.sessionId,nullptr,0,false);
    if(hr!=bridge_probe::Ok)[self cleanup:state.sessionId];
}
- (void)schedule:(ProbeEditState*)state {
    __weak ProbeEditState* weak=state;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<std::int64_t>(self.interval)*NSEC_PER_MSEC),dispatch_get_main_queue(),^{ProbeEditState* current=weak;if(current&&[self active:current])[self poll:current];});
}
- (void)begin:(std::uint64_t)sessionId native:(NSData*)native {
    NSAssert(NSThread.isMainThread,@"Native OLE owner must be main thread");
    if(self.edits[@(sessionId)])return;
    ProbeEditState* state=[ProbeEditState new];state.sessionId=sessionId;state.openNative=native;state.expires=[NSDate dateWithTimeIntervalSinceNow:20*60];self.edits[@(sessionId)]=state;
    // On macOS the OLE verb can arrive before Word's selection event. Allow
    // that event to capture the live document before freezing the source binding.
    state.awaitingDocument=YES;
    __weak ProbeEditState* weak=state;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC),dispatch_get_main_queue(),^{
        ProbeEditState* current=weak;if(!current||![self active:current])return;
        current.documentContext=EquationLabCapturedDocumentContext();current.awaitingDocument=NO;
        [self openState:current];
    });
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
- (void)openState:(ProbeEditState*)state {
    if(![self active:state])return;
    __weak ProbeEditState* weak=state;
    NSMutableDictionary* body=[@{@"session":[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(state.sessionId)],@"native":[state.openNative base64EncodedStringWithOptions:0],@"acknowledgement":@YES} mutableCopy];
    if(state.documentContext)body[@"document"]=state.documentContext;
    state.request=[self request:@"/api/native-open" body:body reply:^(NSDictionary* json,NSError* error){
        ProbeEditState* current=weak;if(!current||![self active:current])return;current.request=nil;
        if(error){if(connectionRefused(error)){if(!current.wakeAttempted)[self wake:current];else[self retryOpen:current];}else[self fail:current code:NetworkFailure];return;}
        id ticket=json[@"ticket"],url=json[@"editorUrl"];
        NSCharacterSet* invalid=[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
        if(![ticket isKindOfClass:NSString.class]||[ticket length]!=64||[ticket rangeOfCharacterFromSet:invalid].location!=NSNotFound||![url isKindOfClass:NSString.class]||![url isEqualToString:[@"equationlab://word-edit/" stringByAppendingString:ticket]]){[self fail:current code:InvalidReply];return;}
        for(ProbeEditState* other in self.edits.allValues)if(other!=current&&[other.ticket isEqualToString:ticket]){[self fail:current code:InvalidReply];return;}
        current.ticket=ticket;current.openNative=nil;current.documentContext=nil;
        if(self.launch){if(!self.launch([url UTF8String],self.launchContext)){[self fail:current code:LaunchFailure];return;}[self schedule:current];}
        else {
            launchEquationLabURL(NSWorkspace.sharedWorkspace,[NSURL URLWithString:url],^(NSError* launchError){dispatch_async(dispatch_get_main_queue(),^{ProbeEditState* active=weak;if(!active||![self active:active])return;if(launchError)[self fail:active code:LaunchFailure];else[self schedule:active];});});
        }
    }];
}
- (void)poll:(ProbeEditState*)state {
    if(![self active:state])return;if(state.expires.timeIntervalSinceNow<=0){[self fail:state code:Expired];return;}
    __weak ProbeEditState* weak=state;
    state.request=[self request:@"/api/native-poll" body:@{@"ticket":state.ticket} reply:^(NSDictionary* json,NSError* error){
        ProbeEditState* current=weak;if(!current||![self active:current])return;current.request=nil;
        if(error){if(++current.failures<=3)[self schedule:current];else[self fail:current code:NetworkFailure];return;}current.failures=0;
        id status=json[@"state"];
        if([status isEqual:@"editing"]){[self schedule:current];return;}
        if([status isEqual:@"navigate"]){id index=json[@"index"];if(![index isKindOfClass:NSNumber.class]||[index intValue]<0||[index intValue]>10000||[index doubleValue]!=[index intValue]){[self fail:current code:InvalidReply];return;}EquationLabSetNavigationTarget([index intValue]);[self fail:current code:0];return;}
        if([status isEqual:@"cancelled"]){[self fail:current code:0];return;}
        if(![status isEqual:@"complete"]){[self fail:current code:InvalidReply];return;}
        id source=json[@"native"],preview=json[@"pdf"],width=json[@"width"],height=json[@"height"];
        const NSUInteger maxB64=((MaxBlob+2)/3)*4;
        if(![source isKindOfClass:NSString.class]||[source length]>maxB64||![preview isKindOfClass:NSString.class]||[preview length]>maxB64||![width isKindOfClass:NSNumber.class]||![height isKindOfClass:NSNumber.class]){[self fail:current code:InvalidReply];return;}
        double w=[width doubleValue],h=[height doubleValue];
        if(w<1||h<1||w>INT32_MAX||h>INT32_MAX||w!=static_cast<std::int32_t>(w)||h!=static_cast<std::int32_t>(h)){[self fail:current code:InvalidReply];return;}
        NSData* native=[[NSData alloc] initWithBase64EncodedString:source options:0];NSData* pdf=[[NSData alloc] initWithBase64EncodedString:preview options:0];
        if(!nativeValid(native)||!pdf.length||pdf.length>MaxBlob){[self fail:current code:InvalidReply];return;}
        CGDataProviderRef provider=CGDataProviderCreateWithCFData((__bridge CFDataRef)pdf);CGPDFDocumentRef document=provider?CGPDFDocumentCreateWithProvider(provider):nullptr;
        bool validPdf=document&&CGPDFDocumentGetNumberOfPages(document)==1;
        if(document)CGPDFDocumentRelease(document);if(provider)CGDataProviderRelease(provider);
        if(!validPdf){[self fail:current code:InvalidReply];return;}
        auto hr=bridge_probe::setSessionPreview(current.sessionId,static_cast<const std::uint8_t*>(pdf.bytes),pdf.length,{static_cast<std::int32_t>(w),static_cast<std::int32_t>(h)});
        // completeEdit synchronously runs the client's SaveObject contract.
        // Capture its identity first: successful completion cleans edit state.
        NSString* ackTicket=current.ticket;
        NSString* ackSession=[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(current.sessionId)];
        if(hr==bridge_probe::Ok)hr=bridge_probe::completeEdit(current.sessionId,static_cast<const std::uint8_t*>(native.bytes),native.length,true);
        [self request:@"/api/native-ack" body:@{@"ticket":ackTicket,@"session":ackSession,@"ok":@(hr==bridge_probe::Ok)} reply:^(NSDictionary*,NSError*){}];
        if(hr!=bridge_probe::Ok)[self fail:current code:ApplyFailure];
    }];
}
@end

namespace bridge_probe {
namespace {
HResult openTransport(std::uint64_t id,const std::uint8_t* data,std::size_t size,void*){
    if(!NSThread.isMainThread)return WrongThread;
    if(!transport||!data||size<29||size>MaxBlob)return InvalidArgument;
    if(transport.edits.count>=16)return Unexpected;
    NSData* native=[NSData dataWithBytes:data length:size];if(!nativeValid(native))return StorageHeaderError;
    [transport begin:id native:native];return Ok;
}
void cancelTransport(std::uint64_t id,void*){if(NSThread.isMainThread)[transport cleanup:id];}
}
HResult installEditorTransport(){
    if(!NSThread.isMainThread)return WrongThread;
    if(!transport)transport=[ProbeEditorTransport new];
    setEditorHooks(openTransport,nullptr);setEditorCancelHook(cancelTransport);return Ok;
}
HResult installEditorTransportForTesting(std::uint16_t port,LaunchEditorUrl launch,void* context,std::uint32_t interval){
    if(inWord()||!port||!launch||interval<1||interval>60000)return InvalidArgument;
    if(editorTransportActive())return Unexpected;
    auto hr=installEditorTransport();if(hr!=Ok)return hr;
    transport.baseURL=[NSString stringWithFormat:@"http://127.0.0.1:%u",port];transport.launch=launch;transport.launchContext=context;transport.interval=interval;lastError=0;return Ok;
}
std::uint32_t editorTransportActive(){return static_cast<std::uint32_t>(transport.edits.count);}
std::uint32_t editorTransportLastError(){return lastError.load();}
}
extern "C" __attribute__((visibility("default")))
bridge_probe::HResult MathTypeBridgeInstallTransportForTesting(std::uint16_t port,bridge_probe::LaunchEditorUrl launch,void* context,std::uint32_t interval){return bridge_probe::installEditorTransportForTesting(port,launch,context,interval);}
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeTransportActive(){return bridge_probe::editorTransportActive();}
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeDocumentCaptureAllowed(){
    if(!NSThread.isMainThread)return 0;
    if(transport.edits.count!=1)return 0;
    return ((ProbeEditState*)transport.edits.allValues.firstObject).awaitingDocument?1:0;
}
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeTransportLastError(){return bridge_probe::editorTransportLastError();}
