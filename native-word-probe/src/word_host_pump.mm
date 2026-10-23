#import <AppKit/AppKit.h>
#include <unistd.h>
#include <os/log.h>
#include "word_host_pump.hpp"

static constexpr NSTimeInterval kWorkspaceReconciliationInterval=4.0;

// This is Word's own run-VB-macro event, addressed to this process, never to
// another application. The names are fixed; document contents cannot name a
// macro. No activation, interaction, synchronous reply wait or UI scripting.
static NSAppleEventDescriptor* hostMacroEvent(NSString* macro) {
    NSAppleEventDescriptor* event=[NSAppleEventDescriptor appleEventWithEventClass:'sWRD' eventID:'1149'
        targetDescriptor:[NSAppleEventDescriptor descriptorWithProcessIdentifier:getpid()]
        returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    [event setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:macro] forKeyword:'5112'];
    return event;
}
static OSStatus sendHostMacro(NSString* macro) {
    NSAppleEventDescriptor* event=hostMacroEvent(macro);
    NSError* error=nil;
    [event sendEventWithOptions:NSAppleEventSendNoReply|NSAppleEventSendNeverInteract timeout:1 error:&error];
    return error?static_cast<OSStatus>(error.code):noErr;
}

@interface ELWordHostPump : NSObject
@property(nonatomic,copy) OSStatus(^send)(NSString*);
@property(nonatomic) NSUInteger generation;
@property(nonatomic) NSUInteger attempts;
@property(nonatomic) BOOL pending;
@property(nonatomic,strong) dispatch_source_t periodicWakeTimer;
- (void)wake;
- (void)acknowledge;
- (void)startPeriodicWakeWithInterval:(NSTimeInterval)interval leeway:(NSTimeInterval)leeway;
@end

@implementation ELWordHostPump
- (void)dispatch:(NSUInteger)generation {
    if(!self.pending||self.generation!=generation)return;
    ++self.attempts;
    OSStatus status=self.send(@"EquationLabDocumentContext.ELPollNavigation");
    os_log_info(OS_LOG_DEFAULT,"WordHostPump sent attempt=%lu status=%d",static_cast<unsigned long>(self.attempts),status);
    // The callback acknowledges on entry, including when the event is handled
    // inline. A delayed retry can never consume a newer wake's generation.
    if(!self.pending||self.generation!=generation)return;
    if(self.attempts>=3){self.pending=NO;os_log_error(OS_LOG_DEFAULT,"WordHostPump callback was not acknowledged");return;}
    NSTimeInterval delay=self.attempts==1?0.25:1.0;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<int64_t>(delay*NSEC_PER_SEC)),dispatch_get_main_queue(),^{[self dispatch:generation];});
}
- (void)wake {
    if(self.pending)return;
    self.pending=YES;self.attempts=0;NSUInteger generation=++self.generation;
    // Leave the active VBA/OLE callback before entering Word's macro handler.
    dispatch_async(dispatch_get_main_queue(),^{[self dispatch:generation];});
}
- (void)acknowledge {self.pending=NO;++self.generation;}
- (void)startPeriodicWakeWithInterval:(NSTimeInterval)interval leeway:(NSTimeInterval)leeway {
    // One process-lifetime timer recovers missed Word events. All work shares
    // wake's pending flag, so a tick cannot overlap or reset an active retry.
    if(self.periodicWakeTimer||interval<=0)return;
    dispatch_source_t timer=dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER,0,0,dispatch_get_main_queue());
    if(!timer)return;
    self.periodicWakeTimer=timer;
    uint64_t period=static_cast<uint64_t>(interval*NSEC_PER_SEC);
    uint64_t tolerance=static_cast<uint64_t>(MAX(0,leeway)*NSEC_PER_SEC);
    dispatch_source_set_timer(timer,dispatch_time(DISPATCH_TIME_NOW,period),period,tolerance);
    __weak ELWordHostPump* weakSelf=self;
    dispatch_source_set_event_handler(timer,^{[weakSelf wake];});
    dispatch_resume(timer);
}
@end

static ELWordHostPump* hostPump;
static BOOL eligibleHost(){return NSThread.isMainThread&&[[NSBundle mainBundle].bundleIdentifier isEqual:@"com.microsoft.Word"];}
void EquationLabInstallWordHostPump(){
    if(!eligibleHost()||hostPump)return;
    hostPump=[ELWordHostPump new];hostPump.send=^OSStatus(NSString* macro){return sendHostMacro(macro);};
    [hostPump startPeriodicWakeWithInterval:kWorkspaceReconciliationInterval leeway:0.5];
    dispatch_async(dispatch_get_main_queue(),^{
        OSStatus status=sendHostMacro(@"EquationLabEntryPoints.ELInitializeDocumentEvents");
        os_log_info(OS_LOG_DEFAULT,"WordHostPump initialize status=%d",status);
    });
}
void EquationLabWakeWordHost(){if(eligibleHost()){EquationLabInstallWordHostPump();[hostPump wake];}}
void EquationLabWordHostDidPoll(){if(eligibleHost())[hostPump acknowledge];}
