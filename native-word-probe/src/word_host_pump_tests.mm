#include "word_host_pump.mm"
#include <iostream>
#include <stdexcept>
static void check(bool ok,const char* text){if(!ok)throw std::runtime_error(text);}
static void runFor(NSTimeInterval seconds){NSDate* end=[NSDate dateWithTimeIntervalSinceNow:seconds];while(end.timeIntervalSinceNow>0)[[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];}
int main(){@autoreleasepool{try{
    NSAppleEventDescriptor* event=hostMacroEvent(@"EquationLabDocumentContext.ELPollNavigation");
    check(event.eventClass=='sWRD'&&event.eventID=='1149',"not Word's run-VB-macro event");
    check([[event paramDescriptorForKeyword:'5112'].stringValue isEqual:@"EquationLabDocumentContext.ELPollNavigation"],"macro parameter changed");
    NSAppleEventDescriptor* target=[event attributeDescriptorForKeyword:keyAddressAttr];
    pid_t pid=0;check(target.descriptorType==typeKernelProcessID&&target.data.length==sizeof(pid),"wake was not addressed to a PID");
    [target.data getBytes:&pid length:sizeof(pid)];check(pid==getpid(),"wake can target another process");
    EquationLabInstallWordHostPump();EquationLabWakeWordHost();check(!hostPump,"non-Word process installed a host dispatcher");
    ELWordHostPump* pump=[ELWordHostPump new];__block NSUInteger sent=0;
    __weak ELWordHostPump* weak=pump;
    pump.send=^OSStatus(NSString* macro){check([macro isEqual:@"EquationLabDocumentContext.ELPollNavigation"],"untrusted macro accepted");++sent;[weak acknowledge];return noErr;};
    for(int i=0;i<40;++i)[pump wake];check(sent==0,"wake reentered the caller");runFor(0.1);
    check(sent==1&&!pump.pending,"ready work did not coalesce into one acknowledged callback");
    pump.send=^OSStatus(NSString*){++sent;return -1;};[pump wake];runFor(0.1);check(sent==2&&pump.pending,"failed send did not remain pending");
    [pump acknowledge];pump.send=^OSStatus(NSString*){++sent;[weak acknowledge];return noErr;};[pump wake];runFor(0.4);
    check(sent==3&&!pump.pending,"old delayed retry consumed or repeated a newer wake");
    pump.send=^OSStatus(NSString*){++sent;return -1;};[pump wake];runFor(1.5);check(sent==6&&!pump.pending,"unacknowledged callbacks exceeded their bounded retry budget");
    ELWordHostPump* periodic=[ELWordHostPump new];__block NSUInteger periodicSent=0;
    __weak ELWordHostPump* periodicWeak=periodic;
    periodic.send=^OSStatus(NSString*){++periodicSent;[periodicWeak acknowledge];return noErr;};
    [periodic startPeriodicWakeWithInterval:0.2 leeway:0.01];[periodic startPeriodicWakeWithInterval:0.2 leeway:0.01];runFor(0.72);
    check(kWorkspaceReconciliationInterval>=3.0&&kWorkspaceReconciliationInterval<=5.0,"production reconciliation interval is outside its bounded cadence");
    check(periodic.periodicWakeTimer!=nil,"periodic reconciliation timer was not installed");
    check(periodicSent>=2&&periodicSent<=5,"periodic timer was missing or accumulated duplicate sources");
    dispatch_source_cancel(periodic.periodicWakeTimer);periodic.periodicWakeTimer=nil;
    ELWordHostPump* stalled=[ELWordHostPump new];__block NSUInteger stalledSent=0;
    stalled.send=^OSStatus(NSString*){++stalledSent;return -1;};[stalled startPeriodicWakeWithInterval:0.1 leeway:0.01];runFor(0.76);
    check(stalledSent==2&&stalled.pending&&stalled.attempts==2,"periodic ticks reset retry state or overlapped a pending callback");
    dispatch_source_cancel(stalled.periodicWakeTimer);stalled.periodicWakeTimer=nil;
    std::cout<<"{\"self_pid_only\":true,\"deferred_and_coalesced\":true,\"acknowledged\":true,\"stale_retry_isolated\":true,\"retry_limit\":3,\"periodic_single_timer\":true,\"periodic_ticks_coalesce_during_retry\":true,\"real_word_or_gui_used\":false}\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}}
