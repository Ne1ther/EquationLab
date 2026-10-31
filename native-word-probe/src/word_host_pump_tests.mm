#include "word_host_pump.mm"
#include <iostream>
#include <stdexcept>
@interface ELMarkedTextClientMock : NSObject
@property(nonatomic) BOOL marked;
@property(nonatomic) NSUInteger queries;
@end
@implementation ELMarkedTextClientMock
- (BOOL)hasMarkedText {++self.queries;return self.marked;}
@end
static void check(bool ok,const char* text){if(!ok)throw std::runtime_error(text);}
static void runFor(NSTimeInterval seconds){NSDate* end=[NSDate dateWithTimeIntervalSinceNow:seconds];while(end.timeIntervalSinceNow>0)[[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];}
int main(){@autoreleasepool{try{
    NSAppleEventDescriptor* event=hostMacroEvent(@"EquationLabDocumentContext.ELPollNavigation");
    check(event.eventClass=='sWRD'&&event.eventID=='1149',"not Word's run-VB-macro event");
    check([[event paramDescriptorForKeyword:'5112'].stringValue isEqual:@"EquationLabDocumentContext.ELPollNavigation"],"macro parameter changed");
    NSAppleEventDescriptor* target=[event attributeDescriptorForKeyword:keyAddressAttr];
    pid_t pid=0;check(target.descriptorType==typeKernelProcessID&&target.data.length==sizeof(pid),"wake was not addressed to a PID");
    [target.data getBytes:&pid length:sizeof(pid)];check(pid==getpid(),"wake can target another process");
    EquationLabInstallWordHostPump();EquationLabWakeWordHost();EquationLabScheduleWordHostPoll();check(!hostPump,"non-Word process installed a host dispatcher");
    ELMarkedTextClientMock* client=[ELMarkedTextClientMock new];
    check(!textClientHasMarkedText(nil),"nil client reported marked text");
    check(!textClientHasMarkedText([NSObject new]),"client without hasMarkedText reported marked text");
    check(!textClientHasMarkedText(client)&&client.queries==1,"unmarked client was not queried correctly");
    client.marked=YES;
    check(textClientHasMarkedText(client)&&client.queries==2,"marked client was not queried correctly");
    ELWordHostPump* initial=[ELWordHostPump new];__block NSUInteger initSent=0,navSent=0;__block BOOL initMarked=YES;
    __weak ELWordHostPump* initWeak=initial;
    initial.deferMacro=^BOOL{return initMarked;};
    initial.send=^OSStatus(NSString* macro){
        if([macro isEqual:@"EquationLabEntryPoints.ELInitializeDocumentEvents"]){++initSent;[initWeak acknowledgeInitialization];}
        else {check([macro isEqual:@"EquationLabDocumentContext.ELPollNavigation"],"unexpected initialization macro");++navSent;[initWeak acknowledge];}
        return noErr;
    };
    [initial initializeWordEvents];[initial wake];[initial wake];runFor(0.6);
    check(initSent==0&&navSent==0&&initial.pending&&initial.attempts==0,"initialization bypassed marked text or spent retries");
    initMarked=NO;runFor(0.45);
    check(initSent==1&&navSent==1&&!initial.pending&&!initial.initializationPending,"initialization did not hand queued navigation off once");
    runFor(0.35);check(initSent==1&&navSent==1,"initialization or queued navigation repeated");
    initMarked=YES;[initial wake];runFor(0.1);NSUInteger initGeneration=initial.generation;
    [initial acknowledgeInitialization];[initial acknowledgeInitialization];
    check(initial.pending&&initial.navigationRequested&&initial.generation==initGeneration,"late initialization ack consumed new navigation");
    initMarked=NO;runFor(0.4);check(navSent==2&&!initial.pending,"navigation after late initialization ack was lost");
    ELWordHostPump* initScheduled=[ELWordHostPump new];__block NSUInteger initScheduledPolls=0;
    __weak ELWordHostPump* initScheduledWeak=initScheduled;
    initScheduled.send=^OSStatus(NSString* macro){
        if([macro isEqual:@"EquationLabEntryPoints.ELInitializeDocumentEvents"])[initScheduledWeak acknowledgeInitialization];
        else {++initScheduledPolls;[initScheduledWeak acknowledge];}return noErr;
    };
    [initScheduled schedulePoll];[initScheduled initializeWordEvents];runFor(0.3);
    check(initScheduled.pollScheduled&&initScheduledPolls==0,"initialization acknowledgement cancelled an unrelated scheduled poll");
    runFor(0.95);check(initScheduledPolls==1&&!initScheduled.pending&&!initScheduled.pollScheduled,"scheduled poll did not survive initialization");
    ELWordHostPump* unconfirmed=[ELWordHostPump new];__block NSUInteger failedInit=0,afterRearm=0;
    __weak ELWordHostPump* unconfirmedWeak=unconfirmed;
    unconfirmed.send=^OSStatus(NSString* macro){
        if([macro isEqual:@"EquationLabEntryPoints.ELInitializeDocumentEvents"]){++failedInit;if(failedInit>3)[unconfirmedWeak acknowledgeInitialization];}
        else {++afterRearm;[unconfirmedWeak acknowledge];}return noErr;
    };
    [unconfirmed initializeWordEvents];runFor(1.6);
    check(failedInit==3&&!unconfirmed.pending&&unconfirmed.initializationPending,"unconfirmed initialization exceeded retry budget");
    [unconfirmed wake];runFor(0.4);
    check(failedInit==4&&afterRearm==1&&!unconfirmed.pending&&!unconfirmed.initializationPending,"explicit wake failed to rearm initialization and navigation");
    ELWordHostPump* pump=[ELWordHostPump new];__block NSUInteger sent=0;
    __weak ELWordHostPump* weak=pump;
    pump.send=^OSStatus(NSString* macro){check([macro isEqual:@"EquationLabDocumentContext.ELPollNavigation"],"untrusted macro accepted");++sent;[weak acknowledge];return noErr;};
    for(int i=0;i<40;++i)[pump wake];check(sent==0,"wake reentered the caller");runFor(0.1);
    check(sent==1&&!pump.pending,"ready work did not coalesce into one acknowledged callback");
    pump.send=^OSStatus(NSString*){++sent;return -1;};[pump wake];runFor(0.1);check(sent==2&&pump.pending,"failed send did not remain pending");
    [pump acknowledge];pump.send=^OSStatus(NSString*){++sent;[weak acknowledge];return noErr;};[pump wake];runFor(0.4);
    check(sent==3&&!pump.pending,"old delayed retry consumed or repeated a newer wake");
    pump.send=^OSStatus(NSString*){++sent;return -1;};[pump wake];runFor(1.5);check(sent==6&&!pump.pending,"unacknowledged callbacks exceeded their bounded retry budget");
    ELWordHostPump* scheduled=[ELWordHostPump new];__block NSUInteger scheduledSent=0;
    __block BOOL scheduledMarked=NO;__weak ELWordHostPump* scheduledWeak=scheduled;
    scheduled.deferMacro=^BOOL{return scheduledMarked;};
    scheduled.send=^OSStatus(NSString*){++scheduledSent;[scheduledWeak acknowledge];return noErr;};
    for(int i=0;i<40;++i)[scheduled schedulePoll];
    runFor(0.7);check(scheduledSent==0&&scheduled.pollScheduled,"scheduled poll fired early or lost its single flight");
    runFor(0.5);check(scheduledSent==1&&!scheduled.pollScheduled&&!scheduled.pending,"scheduled calls did not coalesce into one callback at one second");
    runFor(0.3);check(scheduledSent==1,"scheduled calls produced duplicate callbacks");
    scheduledMarked=YES;[scheduled schedulePoll];runFor(1.35);
    check(scheduledSent==1&&scheduled.pending&&scheduled.attempts==0&&!scheduled.pollScheduled,"scheduled poll bypassed marked text or spent retries");
    scheduledMarked=NO;runFor(0.4);check(scheduledSent==2&&!scheduled.pending,"scheduled poll did not resume after marked text ended");
    [scheduled schedulePoll];runFor(0.2);[scheduled acknowledge];runFor(1.0);
    check(scheduledSent==2&&!scheduled.pollScheduled,"another poll's acknowledgement did not cancel the old delay");
    [scheduled schedulePoll];runFor(0.3);[scheduled acknowledge];[scheduled schedulePoll];
    runFor(0.8);check(scheduledSent==2&&scheduled.pollScheduled,"old delay consumed the replacement schedule");
    runFor(0.4);check(scheduledSent==3&&!scheduled.pollScheduled,"replacement schedule did not fire once");
    [scheduled schedulePoll];runFor(0.2);[scheduled wake];runFor(0.2);
    check(scheduledSent==4&&!scheduled.pending&&!scheduled.pollScheduled,"explicit wake was lost while a poll was scheduled");
    runFor(0.9);check(scheduledSent==4,"acknowledged explicit wake left a stale scheduled callback");
    ELWordHostPump* periodic=[ELWordHostPump new];__block NSUInteger periodicSent=0;
    __weak ELWordHostPump* periodicWeak=periodic;
    periodic.send=^OSStatus(NSString*){++periodicSent;[periodicWeak acknowledge];return noErr;};
    [periodic startPeriodicWakeWithInterval:0.2 leeway:0.01];[periodic startPeriodicWakeWithInterval:0.2 leeway:0.01];runFor(0.72);
    check(kWorkspaceReconciliationInterval>=3.0&&kWorkspaceReconciliationInterval<=5.0,"production reconciliation interval is outside its bounded cadence");
    check(periodic.periodicWakeTimer!=nil,"periodic reconciliation timer was not installed");
    check(periodicSent>=2&&periodicSent<=5,"periodic timer was missing or accumulated duplicate sources");
    dispatch_source_cancel(periodic.periodicWakeTimer);periodic.periodicWakeTimer=nil;
    ELWordHostPump* composing=[ELWordHostPump new];__block NSUInteger composingSent=0;
    __block BOOL marked=YES;
    __weak ELWordHostPump* composingWeak=composing;
    composing.deferMacro=^BOOL{return marked;};
    composing.send=^OSStatus(NSString*){++composingSent;[composingWeak acknowledge];return noErr;};
    [composing startPeriodicWakeWithInterval:0.1 leeway:0.01];[composing wake];
    NSUInteger composingGeneration=composing.generation;runFor(0.66);
    check(composingSent==0&&composing.attempts==0&&composing.pending&&composing.generation==composingGeneration,"marked text spent attempts, sent work, or allowed a new generation");
    runFor(kWorkspaceReconciliationInterval);
    check(composingSent==0&&composing.attempts==0&&composing.pending&&composing.generation==composingGeneration,"marked text did not survive the production reconciliation interval");
    dispatch_source_cancel(composing.periodicWakeTimer);composing.periodicWakeTimer=nil;
    marked=NO;runFor(0.4);
    check(composingSent==1&&!composing.pending&&composing.attempts==1,"ending composition did not resume exactly once");
    runFor(0.3);check(composingSent==1,"composition recovery sent a duplicate callback");
    ELWordHostPump* cancelled=[ELWordHostPump new];__block NSUInteger cancelledSent=0;
    __block BOOL cancelMarked=YES;
    __weak ELWordHostPump* cancelledWeak=cancelled;
    cancelled.deferMacro=^BOOL{return cancelMarked;};
    cancelled.send=^OSStatus(NSString*){++cancelledSent;[cancelledWeak acknowledge];return noErr;};
    [cancelled wake];runFor(0.3);NSUInteger cancelledGeneration=cancelled.generation;
    [cancelled acknowledge];cancelMarked=NO;runFor(0.35);
    check(cancelledSent==0&&!cancelled.pending&&cancelled.generation!=cancelledGeneration,"acknowledged deferred generation revived");
    cancelMarked=YES;[cancelled wake];runFor(0.1);[cancelled acknowledge];
    [cancelled wake];NSUInteger replacementGeneration=cancelled.generation;
    for(int i=0;i<20;++i)[cancelled wake];runFor(0.1);
    check(cancelled.pending&&cancelled.attempts==0&&cancelled.generation==replacementGeneration,"new wakes did not coalesce while marked");
    cancelMarked=NO;runFor(0.6);
    check(cancelledSent==1&&!cancelled.pending&&cancelled.attempts==1,"stale deferred generation interfered with replacement wake");
    ELWordHostPump* gated=[ELWordHostPump new];__block NSUInteger gatedSent=0;
    __block BOOL background=NO;__block BOOL gatedMarked=YES;__weak ELWordHostPump* gatedWeak=gated;
    gated.periodicWakeAllowed=^BOOL{return background;};
    gated.deferMacro=^BOOL{return gatedMarked;};
    gated.send=^OSStatus(NSString*){++gatedSent;[gatedWeak acknowledge];return noErr;};
    [gated startPeriodicWakeWithInterval:0.1 leeway:0.01];runFor(0.36);
    check(gatedSent==0&&!gated.pending&&gated.attempts==0,"disallowed periodic wake sent a macro");
    [gated wake];runFor(0.3);
    check(gatedSent==0&&gated.pending&&gated.attempts==0,"explicit wake bypassed marked text guard");
    gatedMarked=NO;runFor(0.3);
    check(gatedSent==1&&!gated.pending,"explicit wake was blocked with periodic wake disabled");
    background=YES;runFor(0.35);
    check(gatedSent>=3&&gatedSent<=5,"periodic wake did not resume in background");
    dispatch_source_cancel(gated.periodicWakeTimer);gated.periodicWakeTimer=nil;
    ELWordHostPump* stalled=[ELWordHostPump new];__block NSUInteger stalledSent=0;
    stalled.send=^OSStatus(NSString*){++stalledSent;return -1;};[stalled startPeriodicWakeWithInterval:0.1 leeway:0.01];runFor(0.76);
    check(stalledSent==2&&stalled.pending&&stalled.attempts==2,"periodic ticks reset retry state or overlapped a pending callback");
    dispatch_source_cancel(stalled.periodicWakeTimer);stalled.periodicWakeTimer=nil;
    std::cout<<"{\"self_pid_only\":true,\"deferred_and_coalesced\":true,\"acknowledged\":true,\"stale_retry_isolated\":true,\"retry_limit\":3,\"scheduled_single_flight\":true,\"scheduled_marked_deferral\":true,\"scheduled_ack_cancels\":true,\"scheduled_generation_isolated\":true,\"scheduled_explicit_wake\":true,\"periodic_single_timer\":true,\"periodic_ticks_coalesce_during_retry\":true,\"marked_client_query\":true,\"marked_text_defers_without_attempts\":true,\"cancelled_generation_isolated\":true,\"explicit_and_background_wake\":true,\"real_word_or_gui_used\":false}\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}}
