// Exercise the real insertion transport without Word, a GUI or network.
#include "word_insertion.mm"
#include <iostream>
#include <stdexcept>

namespace {
NSMutableArray<NSDictionary*>* calls;
NSMutableArray<NSDictionary*>* delayedAckReplies;
BOOL delayOpen=NO;BOOL delayPoll=NO;BOOL failLaunch=NO;BOOL malformed=NO;BOOL delayAcks=NO;BOOL failEveryAck=NO;
NSUInteger failedAcksRemaining=0;
void(^openReply)(NSDictionary*,NSError*);
void(^pollReply)(NSDictionary*,NSError*);
NSString* statusState;
NSString* completedMode=@"inline";
id completedNumberFormat=nil;
NSString* ticket=@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
NSDictionary* last(NSString* operation){for(NSDictionary* call in calls.reverseObjectEnumerator)if([call[@"operation"] isEqual:operation])return call[@"body"];return nil;}
NSUInteger count(NSString* operation){NSUInteger result=0;for(NSDictionary* call in calls)if([call[@"operation"] isEqual:operation])++result;return result;}
NSDictionary* callFor(NSString* operation,NSUInteger index){for(NSDictionary* call in calls)if([call[@"operation"] isEqual:operation]){if(index--==0)return call[@"body"];}return nil;}
BOOL waitUntil(BOOL(^predicate)(void),NSTimeInterval timeout){NSDate* deadline=[NSDate dateWithTimeIntervalSinceNow:timeout];while(!predicate()&&deadline.timeIntervalSinceNow>0)[[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];return predicate();}
void replyDelayedAck(NSUInteger index,NSDictionary* result,NSError* error){NSDictionary* item=delayedAckReplies[index];[delayedAckReplies removeObjectAtIndex:index];void(^reply)(NSDictionary*,NSError*)=item[@"reply"];reply(result,error);}
void reset(){if(insertion)EquationLabCancelWordInsertion();calls=[NSMutableArray array];delayedAckReplies=[NSMutableArray array];delayOpen=NO;delayPoll=NO;failLaunch=NO;malformed=NO;delayAcks=NO;failEveryAck=NO;failedAcksRemaining=0;openReply=nil;pollReply=nil;statusState=nil;completedNumberFormat=nil;insertionError=0;acknowledgementError=0;}
std::int32_t begin(std::int32_t token=7){return EquationLabBeginWordInsertion([NSURL fileURLWithPath:@"/tmp"],@{@"identity":@"doc:1",@"snapshot":@(token),@"index":@(-1),@"name":@"Test",@"ooxml":@"<live/>"},@{@"mode":@"inline"},token);}
NSError* ackFailure(){return [NSError errorWithDomain:@"test" code:28 userInfo:nil];}
}

id EquationLabTransportRequest(NSString* path,NSDictionary* body,void(^reply)(NSDictionary*,NSError*)) {
    [calls addObject:@{@"operation":path,@"body":body}];
    if([path isEqual:@"/api/native-insert-open"]){if(delayOpen)openReply=[reply copy];else reply(@{@"ticket":ticket},nil);}
    else if([path isEqual:@"/api/native-poll"]){
        if(insertion&&insertion.ticket&&delayPoll)pollReply=[reply copy];
        else if(insertion&&insertion.ticket){NSMutableDictionary* value=[@{@"state":@"complete",@"insertionMode":completedMode,@"docx":[(malformed?[@"wrong" dataUsingEncoding:NSUTF8StringEncoding]:[NSData dataWithBytes:"PK\x03\x04test" length:8]) base64EncodedStringWithOptions:0]} mutableCopy];if(completedNumberFormat)value[@"insertionNumberFormat"]=completedNumberFormat;reply(value,nil);}
        else reply(@{@"state":@"cancelled"},nil);
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
    reply(failLaunch?[NSError errorWithDomain:@"test" code:1 userInfo:nil]:nil);
}

int main(){@autoreleasepool{try{
    calls=[NSMutableArray array];delayedAckReplies=[NSMutableArray array];
    reset();check(begin()==0&&EquationLabWordInsertionActive(),"new insertion did not stay pending");
    NSDictionary* opened=last(@"/api/native-insert-open");check([opened[@"document"][@"index"] intValue]==-1&&[opened[@"layout"][@"mode"] isEqual:@"inline"],"lost insertion context");
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
    std::cout<<"{\"blank_open_without_placeholder\":true,\"token_bound_one_shot_fragment\":true,\"second_insertion_rejected\":true,\"late_open_retired_after_cancel\":true,\"launch_failure_cleanup\":true,\"malformed_fragment_rejected\":true,\"close_before_apply_fails_ack\":true,\"lost_ack_retry_success\":true,\"duplicate_finish_cancel_idempotent\":true,\"saved_ack_not_downgraded\":true,\"late_callback_new_insertion_isolated\":true,\"cancel_race_delivered_receipt_rejected\":true,\"all_five_ACKs_lost_reported\":true,\"uncertain_outcome_is_immutable\":true,\"uncertain_ACK_retries_preserve_body\":true,\"real_word_or_gui_used\":false}\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}}
