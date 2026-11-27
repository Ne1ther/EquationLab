// Exercise the real insertion transport without Word, a GUI or network.
#include "word_host_pump.mm"
#include "word_insertion.mm"
#include <iostream>
#include <stdexcept>

namespace { NSString* openingRequestId=nil; }
namespace bridge_probe { NSString* openingWordDocumentRequestId(){return openingRequestId;} }
void EquationLabDiscardDocumentParts(){}

namespace {
NSMutableArray<NSDictionary*>* calls;
NSMutableArray<NSDictionary*>* delayedAckReplies;
BOOL delayOpen=NO;BOOL delayPoll=NO;BOOL failLaunch=NO;BOOL delayLaunch=NO;BOOL malformed=NO;BOOL delayAcks=NO;BOOL failEveryAck=NO;
BOOL editingPoll=NO;BOOL loadDocument=NO;BOOL delayEnrich=NO;
BOOL replayDelivery=NO;
NSUInteger failedAcksRemaining=0,refusedOpensRemaining=0,failedPollsRemaining=0;
void(^openReply)(NSDictionary*,NSError*);
void(^pollReply)(NSDictionary*,NSError*);
void(^enrichReply)(NSDictionary*,NSError*);
void(^launchReply)(NSError*);
NSString* statusState;
NSString* documentRequestState=@"opened";
NSString* completedMode=@"inline";
id completedNumberFormat=nil;
NSString* ticket=@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
NSDictionary* last(NSString* operation){for(NSDictionary* call in calls.reverseObjectEnumerator)if([call[@"operation"] isEqual:operation])return call[@"body"];return nil;}
NSUInteger count(NSString* operation){NSUInteger result=0;for(NSDictionary* call in calls)if([call[@"operation"] isEqual:operation])++result;return result;}
NSDictionary* callFor(NSString* operation,NSUInteger index){for(NSDictionary* call in calls)if([call[@"operation"] isEqual:operation]){if(index--==0)return call[@"body"];}return nil;}
BOOL waitUntil(BOOL(^predicate)(void),NSTimeInterval timeout){NSDate* deadline=[NSDate dateWithTimeIntervalSinceNow:timeout];while(!predicate()&&deadline.timeIntervalSinceNow>0)[[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];return predicate();}
void replyDelayedAck(NSUInteger index,NSDictionary* result,NSError* error){NSDictionary* item=delayedAckReplies[index];[delayedAckReplies removeObjectAtIndex:index];void(^reply)(NSDictionary*,NSError*)=item[@"reply"];reply(result,error);}
void reset(){if(insertion)EquationLabCancelWordInsertion();calls=[NSMutableArray array];delayedAckReplies=[NSMutableArray array];delayOpen=NO;delayPoll=NO;failLaunch=NO;delayLaunch=NO;malformed=NO;delayAcks=NO;failEveryAck=NO;editingPoll=NO;loadDocument=NO;delayEnrich=NO;replayDelivery=NO;failedAcksRemaining=0;refusedOpensRemaining=0;failedPollsRemaining=0;openReply=nil;pollReply=nil;enrichReply=nil;launchReply=nil;statusState=nil;completedNumberFormat=nil;insertionError=0;acknowledgementError=0;}
std::int32_t begin(std::int32_t token=7){return EquationLabBeginWordInsertion([NSURL fileURLWithPath:@"/tmp"],@{@"identity":@"doc:1",@"snapshot":@(token),@"index":@(-1),@"name":@"Test",@"ooxml":@"<live/>"},@{@"mode":@"inline"},token);}
std::int32_t beginPartial(){return EquationLabBeginWordInsertion([NSURL fileURLWithPath:@"/tmp"],@{@"identity":@"doc:1",@"snapshot":@7,@"index":@(-1),@"name":@"Test",@"ooxml":@"<anchor/>",@"scope":@"insertion",@"count":@30,@"insertionAfter":@{@"index":@25,@"nativeSha256":@"anchor-digest"}},@{@"mode":@"inline"},7);}
NSDictionary* enriched(){return @{@"captureToken":@7,@"identity":@"doc:1",@"snapshot":@8,@"index":@(-1),@"count":@30,@"name":@"Test",@"ooxml":@"<full/>"};}
NSError* ackFailure(){return [NSError errorWithDomain:@"test" code:28 userInfo:nil];}
void replyToLaunchInBackground(NSError* error){
    void(^reply)(NSError*)=launchReply;
    check(reply!=nil,"missing delayed launch fixture");
    launchReply=nil;
    dispatch_semaphore_t returned=dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT,0),^{reply(error);dispatch_semaphore_signal(returned);});
    check(dispatch_semaphore_wait(returned,dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC))==0,"launch callback did not return from background queue");
}
}

bool EquationLabTransportConnectionRefused(NSError* error){return [error.domain isEqual:NSURLErrorDomain]&&error.code==NSURLErrorCannotConnectToHost;}
id EquationLabTransportRequest(NSString* path,NSDictionary* body,void(^reply)(NSDictionary*,NSError*)) {
    check(NSThread.isMainThread,"insertion entered shared HTTP client on a background queue");
    [calls addObject:@{@"operation":path,@"body":body}];
    if([path isEqual:@"/api/native-insert-open"]){
        if(delayOpen)openReply=[reply copy];
        else if(refusedOpensRemaining){--refusedOpensRemaining;reply(nil,[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCannotConnectToHost userInfo:nil]);}
        else reply(replayDelivery?@{@"ticket":ticket,@"insertionReplay":@YES}:@{@"ticket":ticket},nil);
    }
    else if([path isEqual:@"/api/native-poll"]){
        if(insertion&&insertion.ticket&&delayPoll)pollReply=[reply copy];
        else if(insertion&&insertion.ticket&&failedPollsRemaining){--failedPollsRemaining;reply(nil,ackFailure());}
        else if(insertion&&insertion.ticket&&editingPoll)reply(@{@"state":@"editing",@"loadDocument":@(loadDocument)},nil);
        else if(insertion&&insertion.ticket){NSMutableDictionary* value=[@{@"state":@"complete",@"insertionMode":completedMode,@"docx":[(malformed?[@"wrong" dataUsingEncoding:NSUTF8StringEncoding]:[NSData dataWithBytes:"PK\x03\x04test" length:8]) base64EncodedStringWithOptions:0]} mutableCopy];if(completedNumberFormat)value[@"insertionNumberFormat"]=completedNumberFormat;reply(value,nil);}
        else reply(@{@"state":@"cancelled"},nil);
    }else if([path isEqual:@"/api/native-enrich"]){if(delayEnrich)enrichReply=[reply copy];else reply(@{@"ok":@YES},nil);
    }else if([path isEqual:@"/api/native-document-status"]){reply(@{@"state":documentRequestState},nil);
    }else if([path isEqual:@"/api/native-status"]){if(statusState)reply(@{@"state":statusState},nil);else reply(nil,ackFailure());
    }else if([path isEqual:@"/api/native-ack"]){
        if(delayAcks){[delayedAckReplies addObject:@{@"body":body,@"reply":[reply copy]}];}
        else if(failEveryAck||failedAcksRemaining){if(failedAcksRemaining)--failedAcksRemaining;reply(nil,ackFailure());}
        else reply(@{@"state":[body[@"uncertain"] boolValue]?@"unconfirmed":[body[@"ok"] boolValue]?@"committed":@"failed"},nil);
    }else reply(@{@"ok":@YES},nil);
    return nil;
}
void EquationLabTransportLaunch(NSString* url,void(^reply)(NSError*)) {
    [calls addObject:@{@"operation":@"launch",@"body":@{@"url":url}}];
    if(delayLaunch)launchReply=[reply copy];
    else reply(failLaunch?[NSError errorWithDomain:@"test" code:1 userInfo:nil]:nil);
}

static void testUnclaimedInsertionTimeout(NSURL* directory){
    reset();
    hostPump=[ELWordHostPump new];
    __weak ELWordHostPump* weakPump=hostPump;
    __block NSUInteger missedWakes=0;
    __block bool acceptMacro=false;
    __block std::int32_t claimedToken=0;
    hostPump.send=^OSStatus(NSString* macro){
        check([macro isEqual:@"EquationLabDocumentContext.ELPollNavigation"],"insertion woke an unexpected macro");
        if(!acceptMacro){++missedWakes;return -1;}
        [weakPump acknowledge];
        claimedToken=EquationLabTakeWordInsertionFile();
        return noErr;
    };
    check(begin(21)==0&&insertion.fragment&&!insertion.claimed&&insertion.deliveryCleanup,"delivery did not arm its unclaimed deadline before waking Word");
    insertion.directory=directory;
    ELWordInsertion* expiredOwner=insertion;
    check(waitUntil(^{return missedWakes>=3&&!hostPump.pending;},2.5),"Word host pump did not exhaust the three wake attempts");
    check(missedWakes==3&&EquationLabWordInsertionActive()&&!expiredOwner.fragmentFile,"missed wakes changed the fragment or staged it before claim");
    dispatch_source_set_timer(expiredOwner.deliveryCleanup,DISPATCH_TIME_NOW,DISPATCH_TIME_FOREVER,0);
    check(waitUntil(^{return !EquationLabWordInsertionActive();},1.0),"unclaimed delivery timeout did not release the Word insertion lock");
    check(!expiredOwner.fragment&&!expiredOwner.fragmentFile&&!expiredOwner.deliveryCleanup,"unclaimed delivery timeout retained fragment state");
    NSDictionary* failed=last(@"/api/native-ack");
    check(count(@"/api/native-ack")==1&&![failed[@"ok"] boolValue]&&!failed[@"uncertain"]&&EquationLabWordInsertionError()==6,"unclaimed delivery was not acknowledged as a definite failure");

    acceptMacro=true;
    check(begin(22)==0,"unclaimed timeout blocked another insertion in the same Word process");
    insertion.directory=directory;
    check(waitUntil(^{return claimedToken==22;},1.0)&&insertion.fragmentFile,"the next healthy Word macro did not claim its own fragment");
    check(!insertion.deliveryCleanup,"a claimed fragment kept the unclaimed deadline armed");
    expireUnclaimedDelivery(expiredOwner);
    expireUnclaimedDelivery(insertion);
    check(EquationLabWordInsertionActive()&&count(@"/api/native-ack")==1,"stale delivery expiry changed a claimed or newer insertion");
    check(EquationLabFinishClaimedWordInsertion(22,WordInsertionOutcome::Committed)==0,"the subsequent insertion did not complete");
    check([last(@"/api/native-ack")[@"ok"] boolValue]&&![last(@"/api/native-ack")[@"session"] isEqual:failed[@"session"]],"retry reused or corrupted the expired session");
    hostPump=nil;

    reset();check(begin(23)==0,"late-claim deadline fixture failed");
    insertion.deliveryCleanupAt=NSProcessInfo.processInfo.systemUptime-1;
    check(EquationLabTakeWordInsertionFile()==0&&!EquationLabWordInsertionActive(),"a late macro claimed a fragment before its overdue timer callback ran");
    check(count(@"/api/native-ack")==1&&![last(@"/api/native-ack")[@"ok"] boolValue]&&!last(@"/api/native-ack")[@"uncertain"],"an expired claim changed the definite failure outcome");
}

int main(){@autoreleasepool{try{
    calls=[NSMutableArray array];delayedAckReplies=[NSMutableArray array];
    reset();openingRequestId=@"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";delayOpen=YES;
    check(begin()==0,"pending App insertion did not begin");openReply(nil,ackFailure());
    check(!EquationLabWordInsertionActive()&&count(@"/api/native-document-cancel")==1,"failed App open left its document request waiting");
    reset();delayPoll=YES;documentRequestState=@"cancelled";
    check(begin()==0&&!EquationLabWordInsertionActive(),"cancelled App request retained a live insertion owner");
    check(count(@"/api/native-cancel")==1,"cancelled App request did not retire its native ticket");documentRequestState=@"opened";
    reset();openingRequestId=@"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    check(begin()==0&&EquationLabWordInsertionActive(),"new insertion did not stay pending");
    NSDictionary* opened=last(@"/api/native-insert-open");check([opened[@"document"][@"index"] intValue]==-1&&[opened[@"layout"][@"mode"] isEqual:@"inline"],"lost insertion context");
    check([last(@"launch")[@"url"] containsString:@"?request=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"],"insertion URL lost its App document request ownership");
    check(count(@"/api/native-document-status")==1,"App insertion did not watch its cancelable request");openingRequestId=nil;
    check(!opened[@"native"]&&!opened[@"docx"],"opening created a Word placeholder");
    check(EquationLabWordInsertionInline()==-1,"unclaimed insertion exposed a layout");
    check(begin(8)<0,"second insertion replaced the live Range owner");
    std::int32_t tokenValue=0;NSData* fragment=EquationLabClaimWordInsertion(&tokenValue);check(fragment.length==8&&tokenValue==7,"prepared fragment was not bound to the insertion token");
    check(EquationLabWordInsertionInline()==1,"committed inline fragment lost its layout");
    check(!EquationLabClaimWordInsertion(nullptr),"fragment claimed twice");
    EquationLabFinishWordInsertion(true);check(!EquationLabWordInsertionActive()&&[last(@"/api/native-ack")[@"ok"] boolValue],"success did not acknowledge its own ticket");
    check(!EquationLabClaimWordInsertion(nullptr),"finished fragment became claimable again");
    check(EquationLabWordInsertionInline()==-1,"finished insertion retained layout access");

    reset();completedMode=@"numbered-right";completedNumberFormat=@"（第#C1章·#E1）";
    check(begin()==0&&EquationLabWordInsertionNumberingNext()==-1,"unclaimed insertion exposed its format");
    check(EquationLabClaimWordInsertion(nullptr).length==8,"numbered fragment missing");
    NSMutableString* format=[NSMutableString string];std::int32_t unit=0;
    while((unit=EquationLabWordInsertionNumberingNext())>0)[format appendFormat:@"%C",static_cast<unichar>(unit-1)];
    check([format isEqual:completedNumberFormat]&&unit==0&&EquationLabWordInsertionNumberingNext()==0,"UTF-16 format was lost or repeated");
    EquationLabFinishWordInsertion(true);check(EquationLabWordInsertionNumberingNext()==-1,"finished insertion retained its format");
    for(id invalid in @[@42,@"(#E1)\n",[@"x" stringByPaddingToLength:129 withString:@"x" startingAtIndex:0]]){
        reset();completedMode=@"numbered-right";completedNumberFormat=invalid;check(begin()==0&&!EquationLabClaimWordInsertion(nullptr),"invalid format became insertable");
    }
    reset();completedMode=@"inline";completedNumberFormat=@"(#E1)";check(begin()==0&&!EquationLabClaimWordInsertion(nullptr),"unnumbered result carried a format");
    reset();completedMode=@"display";check(begin()==0,"changed-layout fixture did not open");
    check(EquationLabClaimWordInsertion(nullptr).length==8&&EquationLabWordInsertionInline()==0,"host used initial inline mode instead of the completed display fragment");
    EquationLabFinishWordInsertion(true);
    reset();delayLaunch=YES;
    check(begin()==0&&launchReply!=nil,"asynchronous editor launch fixture missing");
    replyToLaunchInBackground(nil);
    check(count(@"/api/native-poll")==0&&!insertion.fragment,"background launch entered the Word poll before the main queue");
    check(waitUntil(^{return insertion.fragment!=nil;},1.0),"editor launch did not return to the main queue for polling");
    EquationLabFinishWordInsertion(true);
    reset();delayLaunch=YES;refusedOpensRemaining=1;
    check(begin()==0&&launchReply!=nil,"asynchronous service wake fixture missing");
    replyToLaunchInBackground(ackFailure());
    check(EquationLabWordInsertionActive()&&EquationLabWordInsertionError()==0,"background service wake failure mutated the Word owner");
    check(waitUntil(^{return !EquationLabWordInsertionActive();},1.0)&&EquationLabWordInsertionError()==2,"service wake failure did not terminate on the main queue");
    reset();delayLaunch=YES;refusedOpensRemaining=1;
    check(begin()==0,"cancel race service wake did not start");
    replyToLaunchInBackground(nil);
    EquationLabCancelWordInsertion();
    delayLaunch=NO;
    check(begin(8)==0&&EquationLabWordInsertionActive(),"cancelled wake blocked a newer insertion");
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.55]];
    check(insertion.token==8&&count(@"/api/native-insert-open")==2,"stale background wake retried into the newer generation");
    EquationLabFinishWordInsertion(true);
    reset();delayLaunch=YES;refusedOpensRemaining=1;
    check(begin()==0&&launchReply!=nil,"service wake timeout fixture missing");
    replyToLaunchInBackground(nil);
    insertion.serviceWakeDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];
    [insertion checkServiceWakeDeadline];
    check(!EquationLabWordInsertionActive()&&EquationLabWordInsertionError()==1,"service wake timeout did not retire the opening");
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    check(count(@"/api/native-insert-open")==1,"background wake retried after its service deadline");
    reset();delayLaunch=YES;
    check(begin()==0&&launchReply!=nil,"editor timeout fixture missing");
    replyToLaunchInBackground(ackFailure());
    check(EquationLabWordInsertionActive(),"editor failure bypassed the main queue");
    insertion.editorLaunchDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];
    [insertion checkEditorLaunchDeadline];
    check(!EquationLabWordInsertionActive()&&EquationLabWordInsertionError()==2&&count(@"/api/native-cancel")==1,"editor launch timeout did not retire the current ticket");
    delayLaunch=NO;
    check(begin(8)==0&&EquationLabWordInsertionActive(),"editor timeout blocked a newer insertion");
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    check(insertion.token==8&&count(@"/api/native-cancel")==1,"late editor failure changed the newer generation");
    EquationLabFinishWordInsertion(true);
    reset();completedMode=@"invalid";check(begin()==0&&!EquationLabClaimWordInsertion(nullptr),"invalid completed layout became insertable");
    check(![last(@"/api/native-ack")[@"ok"] boolValue],"invalid layout was acknowledged as inserted");
    completedMode=@"inline";

    reset();failedAcksRemaining=1;check(begin()==0,"retry fixture did not open");check(EquationLabClaimWordInsertion(nullptr).length==8,"retry fixture fragment missing");
    NSDictionary* firstAckBody=nil;EquationLabFinishWordInsertion(true);firstAckBody=callFor(@"/api/native-ack",0);
    EquationLabFinishWordInsertion(false);EquationLabCancelWordInsertion();check(count(@"/api/native-ack")==1,"duplicate finish/cancel changed the first acknowledgement");
    check(waitUntil(^{return count(@"/api/native-ack")==2;},3.0),"lost acknowledgement was not retried");
    check([firstAckBody isEqual:callFor(@"/api/native-ack",1)]&&[firstAckBody[@"ok"] boolValue],"retry changed immutable ticket/session/outcome");
    check(EquationLabWordInsertionError()==0,"successful acknowledgement retry left an error");
    queueAcknowledgement(firstAckBody[@"ticket"],firstAckBody[@"session"],ELWordInsertionOutcomeFailed,insertionGeneration);
    check(count(@"/api/native-ack")==2&&[callFor(@"/api/native-ack",0)[@"ok"] boolValue],"a confirmed saved acknowledgement was downgraded to failure");

    reset();check(begin()==0,"late-callback fixture did not open");check(EquationLabClaimWordInsertion(nullptr).length==8,"late-callback first fragment missing");
    delayAcks=YES;EquationLabFinishWordInsertion(true);NSDictionary* oldAck=[delayedAckReplies[0][@"body"] copy];
    delayAcks=NO;check(begin(8)==0&&EquationLabWordInsertionActive(),"pending acknowledgement blocked an independent insertion");
    std::int32_t nextToken=0;check(EquationLabClaimWordInsertion(&nextToken).length==8&&nextToken==8,"new insertion fragment/token was not isolated");
    EquationLabFinishWordInsertion(false);check(count(@"/api/native-ack")==2,"new insertion acknowledgement was lost");
    NSDictionary* newAck=callFor(@"/api/native-ack",1);check(![newAck[@"ok"] boolValue]&&![newAck[@"session"] isEqual:oldAck[@"session"]],"new insertion reused the old acknowledgement identity");
    replyDelayedAck(0,nil,ackFailure());check(waitUntil(^{return count(@"/api/native-ack")==3;},3.0),"late failed callback did not schedule its retry");
    check([oldAck isEqual:callFor(@"/api/native-ack",2)],"late callback retry crossed into the newer insertion");

    reset();delayPoll=YES;statusState=@"delivered";check(begin()==0&&pollReply!=nil,"cancel-race poll was not held");EquationLabCancelWordInsertion();
    check(!EquationLabWordInsertionActive()&&count(@"/api/native-ack")==1&&![[last(@"/api/native-ack") objectForKey:@"ok"] boolValue],"cancel did not reject a fragment delivered by a concurrent poll");
    void(^latePoll)(NSDictionary*,NSError*)=pollReply;pollReply=nil;latePoll(@{@"state":@"complete",@"docx":[[NSData dataWithBytes:"PK\x03\x04test" length:8] base64EncodedStringWithOptions:0]},nil);
    check(count(@"/api/native-ack")==1,"late poll callback repeated the cancellation acknowledgement");

    reset();delayOpen=YES;check(begin()==0,"delayed open failed");EquationLabCancelWordInsertion();check(!EquationLabWordInsertionActive(),"cancel retained a pending insertion");
    openReply(@{@"ticket":ticket},nil);check(last(@"/api/native-cancel")&&!last(@"launch"),"late open resurrected cancelled insertion");
    reset();failLaunch=YES;check(begin()==0&&!EquationLabWordInsertionActive(),"failed launch left insertion active");check(last(@"/api/native-cancel")&&EquationLabWordInsertionError()==2,"failed launch abandoned native ticket");
    reset();refusedOpensRemaining=2;
    check(begin()==0&&EquationLabWordInsertionActive(),"a cold insertion service was treated as a permanent failure");
    check([last(@"launch")[@"url"] isEqual:@"equationlab://wake"],"cold insert did not wake the service without opening the editor");
    check(waitUntil(^{return insertion.fragment!=nil;},3.0),"cold service never retried successfully");
    check(count(@"launch")==2&&count(@"/api/native-insert-open")==3,"cold service repeatedly launched or skipped a retry");
    check([callFor(@"/api/native-insert-open",0) isEqual:callFor(@"/api/native-insert-open",2)],"cold retry changed the session or Word Range binding");
    EquationLabFinishWordInsertion(true);
    reset();refusedOpensRemaining=1;failLaunch=YES;
    check(begin()==0&&!EquationLabWordInsertionActive()&&EquationLabWordInsertionError()==2,"service wake failure stranded the Word insertion owner");
    failLaunch=NO;
    check(begin(8)==0&&EquationLabWordInsertionError()==0&&EquationLabClaimWordInsertion(nullptr).length==8,"another attempt in the same Word session could not insert after a wake failure");
    EquationLabFinishWordInsertion(true);
    reset();replayDelivery=YES;failedPollsRemaining=1;
    check(begin()==0&&waitUntil(^{return insertion.fragment!=nil;},3.0),"a lost delivery did not retry successfully");
    check([callFor(@"/api/native-poll",0)[@"insertionReplay"] boolValue]&&[callFor(@"/api/native-poll",0) isEqual:callFor(@"/api/native-poll",1)],"delivery retry did not repeat the negotiated request");
    check(EquationLabClaimWordInsertion(nullptr).length==8&&!EquationLabClaimWordInsertion(nullptr),"retry exposed the fragment for duplicate insertion");
    EquationLabFinishWordInsertion(true);
    reset();editingPoll=YES;failedPollsRemaining=3;check(begin()==0,"separated poll failures fixture did not begin");
    check(waitUntil(^{return count(@"/api/native-poll")>=4;},3.0)&&insertion.attempts==0,"a successful poll kept an old failure budget");
    failedPollsRemaining=1;editingPoll=NO;
    check(waitUntil(^{return insertion.fragment!=nil;},3.0),"separate transient failures aborted a healthy insertion");
    EquationLabFinishWordInsertion(true);
    reset();malformed=YES;check(begin()==0&&!EquationLabWordInsertionActive(),"malformed fragment was accepted");check(![last(@"/api/native-ack")[@"ok"] boolValue]&&EquationLabWordInsertionError()==6,"malformed result was acknowledged as saved");
    reset();begin();EquationLabCancelWordInsertion();check(![last(@"/api/native-ack")[@"ok"] boolValue],"closing Word after completion did not reject the unapplied insertion");

    reset();failEveryAck=YES;check(begin()==0,"retry exhaustion fixture did not open");check(EquationLabClaimWordInsertion(nullptr).length==8,"retry exhaustion fragment missing");EquationLabFinishWordInsertion(true);
    check(waitUntil(^{return EquationLabWordInsertionError()==7;},8.0),"bounded acknowledgement failure was not surfaced");
    check(count(@"/api/native-ack")==5,"acknowledgement retry count was not bounded");
    for(NSUInteger index=1;index<5;++index)check([callFor(@"/api/native-ack",0) isEqual:callFor(@"/api/native-ack",index)],"exhausted acknowledgement changed immutable request body");
    reset();failedAcksRemaining=1;check(begin()==0&&EquationLabClaimWordInsertion(nullptr).length==8,"uncertain outcome fixture did not open");EquationLabFinishWordInsertionUncertain();
    NSDictionary* uncertainBody=callFor(@"/api/native-ack",0);check(![uncertainBody[@"ok"] boolValue]&&[uncertainBody[@"uncertain"] boolValue],"uncertain outcome did not use the explicit uncertain ACK");
    check(waitUntil(^{return count(@"/api/native-ack")==2;},3.0),"uncertain ACK was not retried");
    check([uncertainBody isEqual:callFor(@"/api/native-ack",1)],"uncertain ACK retry changed its one-shot outcome");
    EquationLabFinishWordInsertion(true);EquationLabFinishWordInsertion(false);check(count(@"/api/native-ack")==2,"a later finish downgraded the immutable uncertain outcome");
    check(EquationLabWordInsertionError()==7,"accepted uncertain outcome was reported as confirmed success");
    reset();openingRequestId=nil;editingPoll=YES;
    check(beginPartial()==0&&EquationLabTakeInsertionDocumentRequest()==0,"insertion captured the full list before editor request");
    loadDocument=YES;[insertion poll];
    check(EquationLabTakeInsertionDocumentRequest()==7&&EquationLabTakeInsertionDocumentRequest()==0,"insertion document request was not one-shot");
    check(EquationLabInsertionDocumentRequestToken()==7,"claimed enrichment lost its token");
    for(NSDictionary* patch in @[@{@"identity":@"other:1"},@{@"count":@29},@{@"snapshot":@7},@{@"index":@0},@{@"captureToken":@8}]){
        NSMutableDictionary* invalid=[enriched() mutableCopy];[invalid addEntriesFromDictionary:patch];
        check(EquationLabFinishInsertionDocumentCapture(invalid)<0,"unbound insertion enrichment was accepted");
    }
    check(EquationLabFinishInsertionDocumentCapture(enriched())==0,"bound insertion enrichment failed");
    NSDictionary* enrichment=last(@"/api/native-enrich");
    check([enrichment[@"initialSnapshot"] intValue]==7&&[enrichment[@"document"][@"insertionAfter"][@"index"] intValue]==25&&!enrichment[@"document"][@"captureToken"],"enrichment lost its initial snapshot/anchor or leaked internal token");
    check(EquationLabInsertionDocumentRequestToken()==0&&EquationLabFinishInsertionDocumentCapture(enriched())<0,"enrichment was replayed");
    check(EquationLabWordInsertionActive(),"loading the sidebar ended insertion");
    reset();editingPoll=YES;loadDocument=YES;beginPartial();check(EquationLabTakeInsertionDocumentRequest()==7,"failure fixture missing claim");
    EquationLabFailInsertionDocumentCapture();
    check([last(@"/api/native-enrich")[@"failed"] boolValue]&&EquationLabWordInsertionActive()&&EquationLabInsertionDocumentRequestToken()==0,"list failure destroyed the editing draft or kept capture pending");
    reset();editingPoll=YES;loadDocument=YES;beginPartial();check(EquationLabTakeInsertionDocumentRequest()==7,"deadline fixture missing claim");
    insertion.enrichmentDeadline=[NSDate dateWithTimeIntervalSinceNow:-1];
    check(EquationLabInsertionDocumentRequestToken()==0&&[last(@"/api/native-enrich")[@"failed"] boolValue],"insertion capture deadline was unbounded");
    reset();editingPoll=YES;loadDocument=YES;delayEnrich=YES;beginPartial();EquationLabTakeInsertionDocumentRequest();
    check(EquationLabFinishInsertionDocumentCapture(enriched())==0&&enrichReply!=nil,"late enrichment fixture failed");
    EquationLabCancelWordInsertion();const auto enrichCount=count(@"/api/native-enrich");enrichReply(nil,ackFailure());
    check(!EquationLabWordInsertionActive()&&EquationLabInsertionDocumentRequestToken()==0&&count(@"/api/native-enrich")==enrichCount,"late list callback resurrected cancelled insertion");
    NSURL* fileDirectory=[NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString] isDirectory:YES];
    check([NSFileManager.defaultManager createDirectoryAtURL:fileDirectory withIntermediateDirectories:NO attributes:@{NSFilePosixPermissions:@0700} error:nil],"file fixture directory missing");
    NSURL* legacyFile=[fileDirectory URLByAppendingPathComponent:@"ribbon-complete-insert.docx"];
    NSData* oldBytes=[@"old fraction" dataUsingEncoding:NSUTF8StringEncoding];
    check([oldBytes writeToURL:legacyFile atomically:YES],"legacy cached-source fixture failed");
    reset();check(EquationLabWordInsertionFileNameNext()==-1,"unclaimed insertion exposed a filename");
    check(begin()==0,"unique file fixture did not open");insertion.directory=fileDirectory;
    NSData* firstBytes=insertion.fragment;
    check(EquationLabTakeWordInsertionFile()==7,"unique file did not claim its token");
    NSMutableString* firstName=[NSMutableString string];std::int32_t nextUnit=0;
    while((nextUnit=EquationLabWordInsertionFileNameNext())>0)[firstName appendFormat:@"%C",static_cast<unichar>(nextUnit-1)];
    check(nextUnit==0&&firstName.length==49&&[firstName hasPrefix:@"word-insert-"]&&[firstName hasSuffix:@".docx"],"unique basename format failed");
    NSURL* firstFile=[fileDirectory URLByAppendingPathComponent:firstName];
    check([[NSData dataWithContentsOfURL:firstFile] isEqual:firstBytes],"claimed file content differs from this insertion");
    struct stat firstStat{};check(!stat(firstFile.fileSystemRepresentation,&firstStat)&&(firstStat.st_mode&0777)==0600,"insertion file permissions changed");
    check(EquationLabTakeWordInsertionFile()==0,"unique file claimed twice");
    check([[NSData dataWithContentsOfURL:legacyFile] isEqual:oldBytes],"unique insertion overwrote the old Word source");
    EquationLabFinishWordInsertion(true);
    check(![NSFileManager.defaultManager fileExistsAtPath:firstFile.path]&&EquationLabWordInsertionFileNameNext()==-1,"committed unique file not retired");
    reset();check(begin()==0,"second unique file fixture did not open");insertion.directory=fileDirectory;
    check(EquationLabTakeWordInsertionFile()==7,"same numeric token could not claim a new unique file");
    NSURL* secondFile=insertion.fragmentFile;
    check(![secondFile isEqual:firstFile],"a reused token reused Word's cached filename");
    EquationLabCancelWordInsertion();
    check(![NSFileManager.defaultManager fileExistsAtPath:secondFile.path],"cancelled unique file not removed");
    reset();check(begin()==0,"failed file fixture did not open");insertion.directory=legacyFile;
    check(EquationLabTakeWordInsertionFile()==-2&&!EquationLabWordInsertionActive(),"file failure fell back to a cached fragment");
    check(![last(@"/api/native-ack")[@"ok"] boolValue]&&[[NSData dataWithContentsOfURL:legacyFile] isEqual:oldBytes],"failed unique file acknowledged success or changed the legacy source");
    check(begin(8)==0&&EquationLabWordInsertionError()==0,"file failure poisoned the next insertion in this host session");
    insertion.directory=fileDirectory;
    check(EquationLabTakeWordInsertionFile()==8,"new insertion could not stage the recovered fragment");
    NSURL* retryFile=insertion.fragmentFile;
    EquationLabFinishWordInsertion(true);
    check([last(@"/api/native-ack")[@"ok"] boolValue]&&![NSFileManager.defaultManager fileExistsAtPath:retryFile.path],"recovered insertion did not commit and clean up");
    reset();check(begin(17)==0,"bound completion fixture did not open");insertion.directory=fileDirectory;
    check(EquationLabFinishClaimedWordInsertion(17,WordInsertionOutcome::Committed)==1,"a completion acknowledged an unclaimed fragment");
    check(EquationLabTakeWordInsertionFile()==17,"bound completion fixture did not claim");
    check(EquationLabFinishClaimedWordInsertion(16,WordInsertionOutcome::Committed)==1&&EquationLabWordInsertionActive(),"a stale notification completed another token");
    check(EquationLabFinishClaimedWordInsertion(17,WordInsertionOutcome::Committed)==0,"the original completion retry did not commit");
    check(EquationLabFinishClaimedWordInsertion(17,WordInsertionOutcome::Failed)==1&&count(@"/api/native-ack")==1,"duplicate result changed the first outcome");
    reset();check(begin(19)==0,"unacknowledged claim fixture did not open");insertion.directory=fileDirectory;
    check(EquationLabTakeWordInsertionFile()==19,"unacknowledged claim fixture did not stage its file");
    NSURL* claimFile=insertion.fragmentFile;
    scheduleClaimCleanup(insertion,0.01);
    check(waitUntil(^{return !EquationLabWordInsertionActive();},1.0),"a claimed insertion remained active without VBA completion");
    check(![NSFileManager.defaultManager fileExistsAtPath:claimFile.path]&&[last(@"/api/native-ack")[@"uncertain"] boolValue],"claim cleanup did not retire the file and report uncertainty");
    check(begin(20)==0&&EquationLabClaimWordInsertion(nullptr).length==8,"claim cleanup blocked the next insertion");
    check(EquationLabFinishClaimedWordInsertion(19,WordInsertionOutcome::Committed)==1&&EquationLabWordInsertionActive(),"late completion contacted the newer insertion");
    check(EquationLabFinishClaimedWordInsertion(20,WordInsertionOutcome::Committed)==0&&count(@"/api/native-ack")==2,"new claim did not complete independently");
    testUnclaimedInsertionTimeout(fileDirectory);
    [NSFileManager.defaultManager removeItemAtURL:fileDirectory error:nil];
    std::cout<<"{\"blank_open_without_placeholder\":true,\"token_bound_one_shot_fragment\":true,\"second_insertion_rejected\":true,\"late_open_retired_after_cancel\":true,\"launch_failure_cleanup\":true,\"malformed_fragment_rejected\":true,\"close_before_apply_fails_ack\":true,\"lost_ack_retry_success\":true,\"duplicate_finish_cancel_idempotent\":true,\"saved_ack_not_downgraded\":true,\"late_callback_new_insertion_isolated\":true,\"cancel_race_delivered_receipt_rejected\":true,\"all_five_ACKs_lost_reported\":true,\"uncertain_outcome_is_immutable\":true,\"uncertain_ACK_retries_preserve_body\":true,\"cold_service_recovered\":true,\"opening_and_staging_failures_allow_next_insertion\":true,\"lost_completion_delivery_retried\":true,\"successful_poll_resets_failure_budget\":true,\"background_launches_use_main_queue\":true,\"late_launches_respect_cancel_and_timeouts\":true,\"completion_retry_targets_only_its_claim\":true,\"lost_completion_notice_releases_claim\":true,\"real_word_or_gui_used\":false}\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}}
