#import <Foundation/Foundation.h>
#include "word_document_requests.hpp"
#include "editor_transport.hpp"
#include <algorithm>
#include <cstdlib>
#include <cstring>

namespace {
constexpr NSUInteger MaximumReplyBytes=64*1024;
NSString* const RequestBaseURL=@"http://127.0.0.1:37952";

NSString* randomHostId(){
    unsigned char bytes[32];arc4random_buf(bytes,sizeof(bytes));
    static const char digits[]="0123456789abcdef";char text[65];
    for(NSUInteger i=0;i<sizeof(bytes);++i){text[i*2]=digits[bytes[i]>>4];text[i*2+1]=digits[bytes[i]&15];}
    text[64]='\0';return [NSString stringWithUTF8String:text];
}
BOOL validHexId(id value){
    if(![value isKindOfClass:NSString.class]||[value length]!=64)return NO;
    NSCharacterSet* bad=[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
    return [value rangeOfCharacterFromSet:bad].location==NSNotFound;
}
BOOL validTarget(id value){
    if(![value isKindOfClass:NSDictionary.class])return NO;
    NSDictionary* target=value;id identity=target[@"identity"],snapshot=target[@"snapshot"],index=target[@"index"],digest=target[@"nativeSha256"];
    if(![identity isKindOfClass:NSString.class]||[identity length]<3||[identity length]>256||[identity rangeOfString:@":"].location==NSNotFound)return NO;
    if(![snapshot isKindOfClass:NSNumber.class]||[snapshot intValue]<=0||[snapshot doubleValue]!=[snapshot intValue])return NO;
    if(![index isKindOfClass:NSNumber.class]||[index intValue]<0||[index intValue]>10000||[index doubleValue]!=[index intValue])return NO;
    return validHexId(digest);
}
BOOL terminalState(NSString* state){return [@[@"opened",@"empty",@"no-document",@"failed",@"cancelled",@"superseded",@"expired"] containsObject:state];}
}

@class ELWordDocumentRequestHTTP;
@interface ELWordDocumentRequestTask : NSObject
@property(nonatomic,strong) NSMutableData* response;
@property(nonatomic,copy) void(^completion)(NSDictionary*,NSError*);
@property(nonatomic) BOOL accepted;
@property(nonatomic,strong) NSURLSessionDataTask* task;
@end
@implementation ELWordDocumentRequestTask
@end

@interface ELWordDocumentRequestHTTP : NSObject <NSURLSessionDataDelegate,NSURLSessionTaskDelegate>
@property(nonatomic,strong) NSURLSession* session;
@property(nonatomic,strong) NSMutableDictionary<NSNumber*,ELWordDocumentRequestTask*>* tasks;
- (instancetype)init;
- (void)post:(NSString*)operation body:(NSDictionary*)body timeout:(NSTimeInterval)timeout completion:(void(^)(NSDictionary*,NSError*))completion;
@end
@implementation ELWordDocumentRequestHTTP
- (instancetype)init {
    if((self=[super init])){
        _tasks=[NSMutableDictionary dictionary];
        NSURLSessionConfiguration* config=NSURLSessionConfiguration.ephemeralSessionConfiguration;
        config.URLCache=nil;config.HTTPCookieStorage=nil;config.URLCredentialStorage=nil;
        config.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
        config.timeoutIntervalForRequest=22;config.timeoutIntervalForResource=25;
        _session=[NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:NSOperationQueue.mainQueue];
    }
    return self;
}
- (void)post:(NSString*)operation body:(NSDictionary*)body timeout:(NSTimeInterval)timeout completion:(void(^)(NSDictionary*,NSError*))completion {
    NSMutableURLRequest* request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[RequestBaseURL stringByAppendingFormat:@"/api/%@",operation]]];
    request.HTTPMethod=@"POST";request.timeoutInterval=timeout;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    request.HTTPBody=[NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    ELWordDocumentRequestTask* entry=[ELWordDocumentRequestTask new];entry.response=[NSMutableData data];entry.completion=[completion copy];
    NSURLSessionDataTask* task=[self.session dataTaskWithRequest:request];entry.task=task;self.tasks[@(task.taskIdentifier)]=entry;[task resume];
}
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task willPerformHTTPRedirection:(NSHTTPURLResponse*)response newRequest:(NSURLRequest*)request completionHandler:(void(^)(NSURLRequest*))completionHandler {
    (void)session;(void)task;(void)response;(void)request;completionHandler(nil);
}
- (void)URLSession:(NSURLSession*)session dataTask:(NSURLSessionDataTask*)task didReceiveResponse:(NSURLResponse*)response completionHandler:(void(^)(NSURLSessionResponseDisposition))completionHandler {
    (void)session;ELWordDocumentRequestTask* entry=self.tasks[@(task.taskIdentifier)];
    entry.accepted=[response isKindOfClass:NSHTTPURLResponse.class]&&((NSHTTPURLResponse*)response).statusCode==200&&response.expectedContentLength<=static_cast<long long>(MaximumReplyBytes);
    completionHandler(entry.accepted?NSURLSessionResponseAllow:NSURLSessionResponseCancel);
}
- (void)URLSession:(NSURLSession*)session dataTask:(NSURLSessionDataTask*)task didReceiveData:(NSData*)data {
    (void)session;ELWordDocumentRequestTask* entry=self.tasks[@(task.taskIdentifier)];
    if(!entry||data.length>MaximumReplyBytes||entry.response.length>MaximumReplyBytes-data.length){entry.accepted=NO;[task cancel];return;}
    [entry.response appendData:data];
}
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task didCompleteWithError:(NSError*)error {
    (void)session;ELWordDocumentRequestTask* entry=self.tasks[@(task.taskIdentifier)];[self.tasks removeObjectForKey:@(task.taskIdentifier)];if(!entry)return;
    NSDictionary* result=nil;
    if(!error&&entry.accepted){id parsed=[NSJSONSerialization JSONObjectWithData:entry.response options:0 error:&error];if([parsed isKindOfClass:NSDictionary.class])result=parsed;}
    if(!result&&!error)error=[NSError errorWithDomain:@"EquationLabWordDocumentRequest" code:1 userInfo:nil];
    void(^completion)(NSDictionary*,NSError*)=entry.completion;entry.completion=nil;entry.task=nil;entry.response=nil;
    if(completion)completion(result,error);
}
@end

@interface ELWordDocumentRequestManager : NSObject
@property(nonatomic,strong) ELWordDocumentRequestHTTP* http;
@property(nonatomic,copy) NSString* hostId;
@property(nonatomic,strong) NSDictionary* claim;
@property(nonatomic,strong) NSString* openingId;
@property(nonatomic,strong) NSDate* checkedAt;
@property(nonatomic) std::int32_t token;
@property(nonatomic) std::int32_t tokenSequence;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) BOOL installed;
@property(nonatomic) BOOL taking;
@property(nonatomic) BOOL checking;
@property(nonatomic) BOOL revalidated;
@property(nonatomic) BOOL taken;
@property(nonatomic) BOOL executing;
@property(nonatomic) BOOL finishing;
@property(nonatomic) NSUInteger retryCount;
- (void)startTake;
- (void)checkCurrent;
- (void)retryCheck;
- (void)retryTake;
- (void)finish:(NSString*)outcome reason:(NSString*)reason;
@end

@implementation ELWordDocumentRequestManager
- (void)retryTake {
    if(!self.installed||self.claim||self.taking||self.finishing)return;
    NSUInteger generation=self.generation;NSTimeInterval delay=std::min<NSTimeInterval>(2.0,0.25*static_cast<double>(++self.retryCount));__weak ELWordDocumentRequestManager* weak=self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<int64_t>(delay*NSEC_PER_SEC)),dispatch_get_main_queue(),^{ELWordDocumentRequestManager* current=weak;if(current&&current.generation==generation)[current startTake];});
}
- (void)retryCheck {
    if(!self.installed||!self.claim||self.checking||self.finishing)return;
    NSUInteger generation=self.generation;NSTimeInterval delay=std::min<NSTimeInterval>(2.0,0.25*static_cast<double>(++self.retryCount));__weak ELWordDocumentRequestManager* weak=self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<int64_t>(delay*NSEC_PER_SEC)),dispatch_get_main_queue(),^{ELWordDocumentRequestManager* current=weak;if(current&&current.generation==generation)[current checkCurrent];});
}
- (void)startTake {
    if(!self.installed||self.claim||self.taking||self.finishing)return;
    if(bridge_probe::editorTransportActive()!=0){[self retryTake];return;}
    self.taking=YES;NSUInteger generation=self.generation;
    [self.http post:@"native-document-take" body:@{@"hostId":self.hostId,@"waitMs":@20000} timeout:22 completion:^(NSDictionary* result,NSError* error){
        if(generation!=self.generation)return;self.taking=NO;
        if(error){[self retryTake];return;}self.retryCount=0;
        NSString* state=result[@"state"];
        if([state isEqual:@"empty"]){[self startTake];return;}
        id requestId=result[@"requestId"],target=result[@"target"];
        if(![state isEqual:@"delivered"]||!validHexId(requestId)||(target&&!validTarget(target))){[self retryTake];return;}
        NSMutableDictionary* claim=[@{@"requestId":requestId} mutableCopy];if(target)claim[@"target"]=[target copy];
        self.claim=claim;self.token=++self.tokenSequence;if(self.token<=0){self.tokenSequence=1;self.token=1;}
        if(bridge_probe::editorTransportActive()!=0){[self finish:@"cancelled" reason:@"word-session-active"];return;}
        [self checkCurrent];
    }];
}
- (void)finish:(NSString*)outcome reason:(NSString*)reason {
    if(!self.claim||self.finishing)return;
    self.finishing=YES;self.openingId=nil;self.executing=NO;self.revalidated=NO;
    NSUInteger generation=self.generation;NSString* requestId=self.claim[@"requestId"];
    NSMutableDictionary* body=[@{@"hostId":self.hostId,@"requestId":requestId,@"state":outcome} mutableCopy];
    if(reason.length)body[@"reason"]=[reason substringToIndex:MIN(reason.length,160)];
    [self.http post:@"native-document-finish" body:body timeout:5 completion:^(NSDictionary* result,NSError* error){
        if(generation!=self.generation||![self.claim[@"requestId"] isEqual:requestId])return;
        self.finishing=NO;self.claim=nil;self.token=0;self.revalidated=NO;self.taken=NO;self.checkedAt=nil;self.openingId=nil;
        if(error||![result[@"state"] isKindOfClass:NSString.class]){[self retryTake];return;}
        [self startTake];
    }];
}
- (void)checkCurrent {
    if(!self.installed||!self.claim||self.checking||self.finishing)return;
    self.checking=YES;NSUInteger generation=self.generation;NSString* requestId=self.claim[@"requestId"];
    [self.http post:@"native-document-status" body:@{@"requestId":requestId} timeout:5 completion:^(NSDictionary* result,NSError* error){
        if(generation!=self.generation||![self.claim[@"requestId"] isEqual:requestId])return;self.checking=NO;
        NSString* state=result[@"state"];
        if(!error&&[state isEqual:@"delivered"]){self.revalidated=YES;self.checkedAt=NSDate.date;self.retryCount=0;return;}
        if(!error&&terminalState(state)){self.claim=nil;self.token=0;self.revalidated=NO;self.taken=NO;self.checkedAt=nil;self.executing=NO;self.openingId=nil;[self startTake];return;}
        [self retryCheck];
    }];
}
@end

namespace bridge_probe {
namespace {
ELWordDocumentRequestManager* manager;
}
std::int32_t installWordDocumentRequests(){
    if(!NSThread.isMainThread)return -1;
    if(manager.installed)return 0;
    if(!manager){manager=[ELWordDocumentRequestManager new];manager.http=[ELWordDocumentRequestHTTP new];manager.hostId=randomHostId();manager.generation=1;}
    manager.installed=YES;[manager startTake];return 0;
}
std::uint32_t wordDocumentRequestWatch(){return NSThread.isMainThread&&manager.installed?1:0;}
std::int32_t takeWordDocumentRequest(){
    if(!NSThread.isMainThread||!manager.installed)return 0;
    if(editorTransportActive()!=0)return 0;
    if(manager.claim&&(!manager.revalidated||!manager.checkedAt||manager.checkedAt.timeIntervalSinceNow< -1.5)&&!manager.checking){manager.revalidated=NO;[manager checkCurrent];}
    if(!manager.claim||!manager.revalidated||manager.taken||manager.executing||manager.finishing)return 0;
    manager.taken=YES;return manager.token;
}
NSDictionary* wordDocumentRequestEnvelope(std::int32_t token){
    if(!NSThread.isMainThread||!manager.claim||token<=0||token!=manager.token||!manager.revalidated||!manager.taken)return nil;
    return [manager.claim copy];
}
BOOL beginWordDocumentRequest(std::int32_t token){
    if(!NSThread.isMainThread||!manager.claim||token<=0||token!=manager.token||!manager.revalidated||!manager.taken||manager.executing||manager.finishing)return NO;
    manager.executing=YES;manager.openingId=[manager.claim[@"requestId"] copy];return YES;
}
BOOL wordDocumentRequestIsCurrent(std::int32_t token){
    return NSThread.isMainThread&&manager.claim&&manager.revalidated&&manager.taken&&token>0&&token==manager.token&&!manager.finishing;
}
std::int32_t currentWordDocumentRequestToken(){return NSThread.isMainThread&&manager.claim&&manager.taken&&!manager.finishing?manager.token:0;}
std::int32_t finishWordDocumentRequest(std::int32_t token,NSString* outcome,NSString* reason){
    if(!NSThread.isMainThread||!manager.claim||token<=0||token!=manager.token||manager.finishing)return -1;
    if(![@[@"opened",@"empty",@"no-document",@"failed",@"cancelled"] containsObject:outcome])return -2;
    [manager finish:outcome reason:reason];
    return 0;
}
NSString* openingWordDocumentRequestId(){return NSThread.isMainThread?manager.openingId:nil;}
}
