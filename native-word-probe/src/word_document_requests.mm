#include "word_host_pump.hpp"
#import <Foundation/Foundation.h>
#include "word_document_requests.hpp"
#include "editor_transport.hpp"
#include "word_insertion.hpp"
#include <algorithm>
#include <cstdlib>
#include <cstring>

namespace {
constexpr NSUInteger MaximumReplyBytes=512*1024;
constexpr NSTimeInterval RequestLifetimeSeconds=60.0;
bool wordHostBusy(){return bridge_probe::editorTransportActive()!=0||EquationLabWordInsertionActive();}
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
#ifdef EL_WORD_DOCUMENT_REQUESTS_TESTING
        config.protocolClasses=@[NSClassFromString(@"ELWordDocumentRequestMockProtocol")];
#endif
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
@property(nonatomic,strong) NSDate* claimDeadline;
@property(nonatomic) std::int32_t token;
@property(nonatomic) std::int32_t tokenSequence;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) BOOL installed;
@property(nonatomic,strong) NSDictionary* workspace;
@property(nonatomic,strong) NSArray<NSDictionary*>* workspaceDocuments;
@property(nonatomic,strong) NSMutableOrderedSet<NSString*>* retiredIdentities;
@property(nonatomic) NSUInteger workspaceVersion;
@property(nonatomic) BOOL publishingWorkspace;
@property(nonatomic) BOOL hostRegistered;
@property(nonatomic) NSUInteger workspaceRetries;
@property(nonatomic,strong) NSDate* workspacePublishedAt;
- (void)publishWorkspace;
@property(nonatomic) BOOL taking;
@property(nonatomic) BOOL checking;
@property(nonatomic) BOOL revalidated;
@property(nonatomic) BOOL taken;
@property(nonatomic) BOOL executing;
@property(nonatomic) BOOL finishing;
@property(nonatomic) BOOL waitingForTransportRelease;
@property(nonatomic) NSUInteger retryCount;
- (void)startTake;
- (void)checkCurrent;
- (void)retryCheck;
- (void)retryTake;
- (BOOL)expireClaimIfNeeded;
- (void)deferClaimWhileTransportActive;
- (void)maintainWorkspaceHeartbeat;
- (void)finish:(NSString*)outcome reason:(NSString*)reason;
@end

@implementation ELWordDocumentRequestManager
- (void)publishWorkspace {
    if(!self.installed||!self.hostRegistered||self.publishingWorkspace)return;
    self.publishingWorkspace=YES;NSUInteger version=self.workspaceVersion;
    NSMutableDictionary* body=[@{@"hostId":self.hostId,@"active":self.workspace?:NSNull.null,@"retiredIdentities":self.retiredIdentities.array?:@[],@"insertionRequestSupport":@YES} mutableCopy];
    if(self.workspaceDocuments)body[@"documents"]=self.workspaceDocuments;
    [self.http post:@"native-document-workspace" body:body timeout:3 completion:^(NSDictionary* result,NSError* error){
        self.publishingWorkspace=NO;
        if(!error&&[result[@"revision"] isKindOfClass:NSNumber.class]){self.workspaceRetries=0;self.workspacePublishedAt=NSDate.date;if(version!=self.workspaceVersion)[self publishWorkspace];return;}
        if(++self.workspaceRetries>3)return;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{[self publishWorkspace];});
    }];
}
- (void)maintainWorkspaceHeartbeat {
    if(!self.workspacePublishedAt||-self.workspacePublishedAt.timeIntervalSinceNow>=15)[self publishWorkspace];
}
- (BOOL)expireClaimIfNeeded {
    if(!self.claim||!self.claimDeadline||[NSDate.date compare:self.claimDeadline]!=NSOrderedDescending)return NO;
    self.claim=nil;self.claimDeadline=nil;self.token=0;self.revalidated=NO;self.taken=NO;self.checking=NO;self.checkedAt=nil;self.executing=NO;self.openingId=nil;self.waitingForTransportRelease=NO;
    [self startTake];return YES;
}
- (void)deferClaimWhileTransportActive {
    if(!self.claim||self.finishing||self.executing)return;
    self.revalidated=NO;self.taken=NO;self.checkedAt=nil;self.waitingForTransportRelease=YES;
    if(!self.checking)[self checkCurrent];
}
- (void)retryTake {
    if(!self.installed||self.claim||self.taking||self.finishing)return;
    NSUInteger generation=self.generation;NSTimeInterval delay=std::min<NSTimeInterval>(2.0,0.25*static_cast<double>(++self.retryCount));__weak ELWordDocumentRequestManager* weak=self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<int64_t>(delay*NSEC_PER_SEC)),dispatch_get_main_queue(),^{ELWordDocumentRequestManager* current=weak;if(current&&current.generation==generation)[current startTake];});
}
- (void)retryCheck {
    if(!self.installed||!self.claim||self.checking||self.finishing)return;
    if([self expireClaimIfNeeded])return;
    NSUInteger generation=self.generation;NSTimeInterval delay;
    if(self.waitingForTransportRelease)delay=0.25;
    else delay=std::min<NSTimeInterval>(2.0,0.25*static_cast<double>(++self.retryCount));
    __weak ELWordDocumentRequestManager* weak=self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<int64_t>(delay*NSEC_PER_SEC)),dispatch_get_main_queue(),^{ELWordDocumentRequestManager* current=weak;if(current&&current.generation==generation)[current checkCurrent];});
}
- (void)startTake {
    if(!self.installed||self.claim||self.taking||self.finishing)return;
    self.taking=YES;NSUInteger generation=self.generation;
    [self.http post:@"native-document-take" body:@{@"hostId":self.hostId,@"waitMs":self.hostRegistered?@20000:@0} timeout:22 completion:^(NSDictionary* result,NSError* error){
        if(generation!=self.generation)return;self.taking=NO;
        if(error){[self retryTake];return;}self.retryCount=0;self.hostRegistered=YES;self.workspaceRetries=0;[self publishWorkspace];
        NSString* state=result[@"state"];
        if([state isEqual:@"empty"]){[self startTake];return;}
        id requestId=result[@"requestId"],target=result[@"target"],documentIdentity=result[@"documentIdentity"],insertionMode=result[@"insertionMode"];
        if(insertionMode&&(![@[@"inline",@"display",@"numbered-left",@"numbered-right"] containsObject:insertionMode]||(!target&&!documentIdentity))){[self retryTake];return;}
        if(![state isEqual:@"delivered"]||!validHexId(requestId)||(target&&!validTarget(target))||(documentIdentity&&(![documentIdentity isKindOfClass:NSString.class]||[documentIdentity length]<3||[documentIdentity length]>256||[documentIdentity rangeOfString:@":"].location==NSNotFound||target))){[self retryTake];return;}
        NSMutableDictionary* claim=[@{@"requestId":requestId} mutableCopy];if(target)claim[@"target"]=[target copy];if(documentIdentity)claim[@"documentIdentity"]=[documentIdentity copy];
        if(insertionMode)claim[@"insertionMode"]=[insertionMode copy];
        self.claim=claim;self.claimDeadline=[NSDate dateWithTimeIntervalSinceNow:RequestLifetimeSeconds];self.waitingForTransportRelease=NO;self.token=++self.tokenSequence;if(self.token<=0){self.tokenSequence=1;self.token=1;}
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
        self.finishing=NO;self.claim=nil;self.claimDeadline=nil;self.token=0;self.revalidated=NO;self.taken=NO;self.checkedAt=nil;self.openingId=nil;self.waitingForTransportRelease=NO;
        if(error||![result[@"state"] isKindOfClass:NSString.class]){[self retryTake];return;}
        [self startTake];
    }];
}
- (void)checkCurrent {
    if(!self.installed||!self.claim||self.checking||self.finishing)return;
    if([self expireClaimIfNeeded])return;
    self.checking=YES;NSUInteger generation=self.generation;NSString* requestId=self.claim[@"requestId"];
    NSTimeInterval remaining=self.claimDeadline.timeIntervalSinceNow;
    if(remaining<=0){self.checking=NO;[self expireClaimIfNeeded];return;}
    NSTimeInterval timeout=MIN(5.0,remaining);
    [self.http post:@"native-document-status" body:@{@"requestId":requestId} timeout:timeout completion:^(NSDictionary* result,NSError* error){
        if(generation!=self.generation||![self.claim[@"requestId"] isEqual:requestId])return;self.checking=NO;
        if([self expireClaimIfNeeded])return;
        NSString* state=result[@"state"];
        if(!error&&[state isEqual:@"delivered"]){
            if(wordHostBusy()&&!self.executing){self.revalidated=NO;self.taken=NO;self.checkedAt=nil;self.waitingForTransportRelease=YES;[self maintainWorkspaceHeartbeat];[self retryCheck];return;}
            BOOL shouldWake=self.waitingForTransportRelease||!self.taken;
            self.revalidated=YES;self.checkedAt=NSDate.date;self.retryCount=0;self.waitingForTransportRelease=NO;if(shouldWake)EquationLabWakeWordHost();return;
        }
        if(!error&&terminalState(state)){self.claim=nil;self.claimDeadline=nil;self.token=0;self.revalidated=NO;self.taken=NO;self.checkedAt=nil;self.executing=NO;self.openingId=nil;self.waitingForTransportRelease=NO;[self startTake];return;}
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
    if([manager expireClaimIfNeeded])return 0;
    if(wordHostBusy()){[manager deferClaimWhileTransportActive];return 0;}
    if(manager.claim&&(!manager.revalidated||!manager.checkedAt||manager.checkedAt.timeIntervalSinceNow< -1.5)&&!manager.checking){manager.revalidated=NO;[manager checkCurrent];}
    if(!manager.claim||!manager.revalidated||manager.taken||manager.executing||manager.finishing)return 0;
    manager.taken=YES;return manager.token;
}
NSDictionary* wordDocumentRequestEnvelope(std::int32_t token){
    if(NSThread.isMainThread&&[manager expireClaimIfNeeded])return nil;
    // After begin, the requested OLE activation itself owns the active
    // transport. VBA must still be able to identify and finish this request.
    if(NSThread.isMainThread&&wordHostBusy()&&!manager.executing){[manager deferClaimWhileTransportActive];return nil;}
    if(!NSThread.isMainThread||!manager.claim||token<=0||token!=manager.token||!manager.revalidated||!manager.taken)return nil;
    return [manager.claim copy];
}
BOOL beginWordDocumentRequest(std::int32_t token){
    if(NSThread.isMainThread&&[manager expireClaimIfNeeded])return NO;
    if(NSThread.isMainThread&&wordHostBusy()){[manager deferClaimWhileTransportActive];return NO;}
    if(!NSThread.isMainThread||!manager.claim||token<=0||token!=manager.token||!manager.revalidated||!manager.taken||manager.executing||manager.finishing)return NO;
    manager.executing=YES;manager.openingId=[manager.claim[@"requestId"] copy];return YES;
}
BOOL wordDocumentRequestIsCurrent(std::int32_t token){
    if(NSThread.isMainThread&&[manager expireClaimIfNeeded])return NO;
    if(NSThread.isMainThread&&wordHostBusy()&&!manager.executing){[manager deferClaimWhileTransportActive];return NO;}
    return NSThread.isMainThread&&manager.claim&&manager.revalidated&&manager.taken&&token>0&&token==manager.token&&!manager.finishing;
}
std::int32_t currentWordDocumentRequestToken(){
    if(NSThread.isMainThread&&[manager expireClaimIfNeeded])return 0;
    if(NSThread.isMainThread&&wordHostBusy()&&!manager.executing){[manager deferClaimWhileTransportActive];return 0;}
    return NSThread.isMainThread&&manager.claim&&manager.taken&&!manager.finishing?manager.token:0;
}
std::int32_t finishWordDocumentRequest(std::int32_t token,NSString* outcome,NSString* reason){
    if(!NSThread.isMainThread||!manager.claim||token<=0||token!=manager.token||manager.finishing)return -1;
    if(![@[@"opened",@"empty",@"no-document",@"failed",@"cancelled"] containsObject:outcome])return -2;
    [manager finish:outcome reason:reason];
    return 0;
}
void publishWordWorkspace(NSDictionary* active,NSArray<NSDictionary*>* documents){
    if(!NSThread.isMainThread||!manager.installed)return;
    if(!active&&manager.workspace[@"identity"]){
        NSString* previous=manager.workspace[@"identity"];
        if(documents)manager.workspaceDocuments=[documents copy];
        closeWordWorkspaceIdentity(previous);return;
    }
    NSString* identity=active[@"identity"];
    BOOL restored=identity&&[manager.retiredIdentities containsObject:identity];
    for(NSDictionary* document in documents)if([document[@"identity"] isEqual:identity]&&[manager.retiredIdentities containsObject:identity]){restored=YES;break;}
    if(restored)[manager.retiredIdentities removeObject:identity];
    NSArray* copy=documents?[documents copy]:manager.workspaceDocuments;
    if(!restored&&((!active&&!manager.workspace)||[manager.workspace isEqual:active])&&((!documents&&!manager.workspaceDocuments)||[manager.workspaceDocuments isEqual:copy]))return;
    manager.workspace=[active copy];if(documents)manager.workspaceDocuments=copy;++manager.workspaceVersion;manager.workspaceRetries=0;[manager publishWorkspace];
}
void closeWordWorkspaceIdentity(NSString* identity){
    if(!NSThread.isMainThread||!manager.installed||!identity.length)return;
    if(!manager.retiredIdentities)manager.retiredIdentities=[NSMutableOrderedSet orderedSet];
    BOOL changed=![manager.retiredIdentities containsObject:identity];
    if(changed){
        [manager.retiredIdentities addObject:identity];
        while(manager.retiredIdentities.count>128)[manager.retiredIdentities removeObjectAtIndex:0];
    }
    if(manager.workspaceDocuments.count){NSMutableArray* remaining=[manager.workspaceDocuments mutableCopy];NSIndexSet* matches=[remaining indexesOfObjectsPassingTest:^BOOL(NSDictionary* document,NSUInteger index,BOOL* stop){(void)index;(void)stop;return [document[@"identity"] isEqual:identity];}];if(matches.count){[remaining removeObjectsAtIndexes:matches];manager.workspaceDocuments=[remaining copy];changed=YES;}}
    if([manager.workspace[@"identity"] isEqual:identity]){manager.workspace=nil;changed=YES;}
    if(changed){++manager.workspaceVersion;manager.workspaceRetries=0;[manager publishWorkspace];}
}
NSString* openingWordDocumentRequestId(){return NSThread.isMainThread?manager.openingId:nil;}
}
