#import <AppKit/AppKit.h>
#include "word_insertion.hpp"
#include <cstring>

typedef NS_ENUM(NSUInteger, ELWordInsertionOutcome) {
    ELWordInsertionOutcomeFailed,
    ELWordInsertionOutcomeCommitted,
    ELWordInsertionOutcomeUnconfirmed,
};

// Share the bounded, nonredirecting HTTP client and cooperative activation
// used by existing OLE edits. No network wait runs on Word's main thread.
id EquationLabTransportRequest(NSString*,NSDictionary*,void(^)(NSDictionary*,NSError*));
void EquationLabTransportLaunch(NSString*,void(^)(NSError*));

@interface ELWordInsertion : NSObject
@property(nonatomic,strong) NSURL* directory;
@property(nonatomic,copy) NSString* session;
@property(nonatomic,copy) NSString* ticket;
@property(nonatomic,strong) NSDate* deadline;
@property(nonatomic,strong) NSData* fragment;
@property(nonatomic,copy) NSString* mode;
@property(nonatomic,strong) id request;
@property(nonatomic) std::int32_t token;
@property(nonatomic) std::uint64_t generation;
@property(nonatomic) BOOL claimed;
@property(nonatomic) BOOL ended;
@property(nonatomic) NSUInteger attempts;
- (void)poll;
@end

@interface ELWordAcknowledgement : NSObject
@property(nonatomic,copy,readonly) NSString* ticket;
@property(nonatomic,copy,readonly) NSString* session;
@property(nonatomic,copy,readonly) NSString* key;
@property(nonatomic,readonly) ELWordInsertionOutcome outcome;
@property(nonatomic,readonly) std::uint64_t generation;
@property(nonatomic,strong) NSDate* deadline;
@property(nonatomic,strong) id request;
@property(nonatomic,copy) NSString* state;
@property(nonatomic) NSUInteger attempts;
- (instancetype)initWithTicket:(NSString*)ticket session:(NSString*)session outcome:(ELWordInsertionOutcome)outcome generation:(std::uint64_t)generation;
- (void)start;
@end

namespace {
ELWordInsertion* insertion;
std::int32_t insertionError=0;
std::int32_t acknowledgementError=0;
std::uint64_t insertionGeneration=0;
NSMutableDictionary<NSString*,ELWordAcknowledgement*>* pendingAcknowledgements;
NSMutableArray<ELWordAcknowledgement*>* terminalAcknowledgements;
}

static constexpr NSUInteger MaximumAcknowledgementAttempts=5;
static constexpr NSTimeInterval AcknowledgementDeadlineSeconds=50.0;
static constexpr NSTimeInterval AcknowledgementRetryDelays[]={0.25,0.5,1.0,2.0};
static constexpr NSUInteger MaximumRememberedAcknowledgements=64;

static NSMutableDictionary<NSString*,ELWordAcknowledgement*>* acknowledgementQueue() {
    if(!pendingAcknowledgements)pendingAcknowledgements=[NSMutableDictionary dictionary];
    return pendingAcknowledgements;
}
static NSMutableArray<ELWordAcknowledgement*>* acknowledgementHistory() {
    if(!terminalAcknowledgements)terminalAcknowledgements=[NSMutableArray array];
    return terminalAcknowledgements;
}
static NSString* acknowledgementKey(NSString* ticket,NSString* session) {
    return [NSString stringWithFormat:@"%@:%@",ticket,session];
}
static BOOL hasAcknowledgementKey(NSString* key) {
    for(ELWordAcknowledgement* acknowledgement in acknowledgementHistory())if([acknowledgement.key isEqual:key])return YES;
    return NO;
}
static void recordAcknowledgement(ELWordAcknowledgement* acknowledgement) {
    NSMutableArray* history=acknowledgementHistory();
    if([history containsObject:acknowledgement])return;
    [history addObject:acknowledgement];
    while(history.count>MaximumRememberedAcknowledgements)[history removeObjectAtIndex:0];
}

static void queueAcknowledgement(NSString* ticket,NSString* session,ELWordInsertionOutcome outcome,std::uint64_t generation);
static void retireInsertionTicket(NSString* ticket,NSString* session,std::uint64_t generation) {
    if(!ticket.length)return;
    NSDictionary* body=@{@"ticket":ticket,@"session":session};
    EquationLabTransportRequest(@"/api/native-cancel",body,^(NSDictionary*,NSError*){
        EquationLabTransportRequest(@"/api/native-poll",body,^(NSDictionary* result,NSError*){
            if([result[@"state"] isEqual:@"complete"]){
                queueAcknowledgement(ticket,session,ELWordInsertionOutcomeFailed,generation);
                return;
            }
            // A poll that was already in flight when Word cancelled may have
            // consumed the fragment first. Its callback is ignored after the
            // insertion ends, so recover that delivered receipt by ticket.
            EquationLabTransportRequest(@"/api/native-status",body,^(NSDictionary* status,NSError*){
                if([status[@"state"] isEqual:@"delivered"])queueAcknowledgement(ticket,session,ELWordInsertionOutcomeFailed,generation);
            });
        });
    });
}
static void endInsertion(ELWordInsertion* state,std::int32_t error,bool cancel) {
    if(!state||state.ended)return;
    state.ended=YES;state.fragment=nil;state.request=nil;
    if(insertion==state){insertion=nil;insertionError=error;}
    if(cancel)retireInsertionTicket(state.ticket,state.session,state.generation);
}

@implementation ELWordAcknowledgement
- (instancetype)initWithTicket:(NSString*)ticket session:(NSString*)session outcome:(ELWordInsertionOutcome)outcome generation:(std::uint64_t)generation {
    if((self=[super init])){
        _ticket=[ticket copy];_session=[session copy];_outcome=outcome;_generation=generation;
        _deadline=[NSDate dateWithTimeIntervalSinceNow:AcknowledgementDeadlineSeconds];_state=@"pending";
    }
    return self;
}
- (NSString*)key {return acknowledgementKey(self.ticket,self.session);}
- (void)finishConfirmed:(BOOL)confirmed {
    if(![self.state isEqual:@"pending"])return;
    self.state=confirmed?@"confirmed":@"unconfirmed";
    id request=self.request;self.request=nil;
    if(!confirmed&&[request respondsToSelector:@selector(cancel)])[request cancel];
    if(acknowledgementQueue()[self.key]==self)[acknowledgementQueue() removeObjectForKey:self.key];
    recordAcknowledgement(self);
    if(self.generation==insertionGeneration)acknowledgementError=self.outcome==ELWordInsertionOutcomeUnconfirmed||!confirmed?7:0;
}
- (void)retryOrFail {
    if(![self.state isEqual:@"pending"])return;
    if(self.attempts>=MaximumAcknowledgementAttempts||self.deadline.timeIntervalSinceNow<=0){[self finishConfirmed:NO];return;}
    NSUInteger delayIndex=self.attempts-1;
    NSTimeInterval delay=AcknowledgementRetryDelays[delayIndex];
    if(delay>=self.deadline.timeIntervalSinceNow){[self finishConfirmed:NO];return;}
    __weak ELWordAcknowledgement* weakSelf=self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<std::int64_t>(delay*NSEC_PER_SEC)),dispatch_get_main_queue(),^{
        ELWordAcknowledgement* state=weakSelf;
        if(state&&[state.state isEqual:@"pending"]&&acknowledgementQueue()[state.key]==state)[state send];
    });
}
- (void)send {
    if(![self.state isEqual:@"pending"])return;
    if(self.deadline.timeIntervalSinceNow<=0||self.attempts>=MaximumAcknowledgementAttempts){[self finishConfirmed:NO];return;}
    self.attempts++;
    NSDictionary* body=self.outcome==ELWordInsertionOutcomeUnconfirmed
        ?@{@"ticket":self.ticket,@"session":self.session,@"ok":@NO,@"uncertain":@YES}
        :@{@"ticket":self.ticket,@"session":self.session,@"ok":@(self.outcome==ELWordInsertionOutcomeCommitted)};
    __weak ELWordAcknowledgement* weakSelf=self;
    self.request=EquationLabTransportRequest(@"/api/native-ack",body,^(NSDictionary* result,NSError* error){
        ELWordAcknowledgement* state=weakSelf;
        if(!state||![state.state isEqual:@"pending"]||acknowledgementQueue()[state.key]!=state)return;
        state.request=nil;
        NSString* expected=state.outcome==ELWordInsertionOutcomeUnconfirmed?@"unconfirmed":state.outcome==ELWordInsertionOutcomeCommitted?@"committed":@"failed";
        id returnedState=result[@"state"];
        if(![returnedState isKindOfClass:NSString.class]){
            id receipt=result[@"receipt"];
            returnedState=[receipt isKindOfClass:NSDictionary.class]?receipt[@"state"]:receipt;
        }
        BOOL includesOK=[result[@"ok"] isKindOfClass:NSNumber.class];
        BOOL coherent=!includesOK||(state.outcome==ELWordInsertionOutcomeUnconfirmed?![result[@"ok"] boolValue]:[result[@"ok"] boolValue]);
        if(!error&&coherent&&[returnedState isKindOfClass:NSString.class]&&[returnedState isEqual:expected]){
            [state finishConfirmed:YES];return;
        }
        [state retryOrFail];
    });
}
- (void)start {
    std::int64_t delay=static_cast<std::int64_t>(AcknowledgementDeadlineSeconds*NSEC_PER_SEC);
    __weak ELWordAcknowledgement* weakSelf=self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,delay),dispatch_get_main_queue(),^{
        ELWordAcknowledgement* state=weakSelf;
        if(state&&[state.state isEqual:@"pending"])[state finishConfirmed:NO];
    });
    [self send];
}
@end

static void queueAcknowledgement(NSString* ticket,NSString* session,ELWordInsertionOutcome outcome,std::uint64_t generation) {
    if(!ticket.length||!session.length)return;
    NSString* key=acknowledgementKey(ticket,session);
    if(acknowledgementQueue()[key]||hasAcknowledgementKey(key))return;
    ELWordAcknowledgement* acknowledgement=[[ELWordAcknowledgement alloc] initWithTicket:ticket session:session outcome:outcome generation:generation];
    acknowledgementQueue()[key]=acknowledgement;
    if(generation==insertionGeneration)acknowledgementError=outcome==ELWordInsertionOutcomeUnconfirmed?7:0;
    [acknowledgement start];
}

@implementation ELWordInsertion
- (void)poll {
    if(self.ended||self!=insertion||self.request||self.fragment)return;
    if(self.deadline.timeIntervalSinceNow<=0){endInsertion(self,3,true);return;}
    __weak ELWordInsertion* weak=self;
    self.request=EquationLabTransportRequest(@"/api/native-poll",@{@"ticket":self.ticket,@"session":self.session},^(NSDictionary* result,NSError* error){
        ELWordInsertion* state=weak;if(!state||state.ended||state!=insertion)return;state.request=nil;
        if(error){if(++state.attempts>3){endInsertion(state,4,true);return;}}
        else if([result[@"state"] isEqual:@"complete"]){
            NSString* mode=[result[@"insertionMode"] isKindOfClass:NSString.class]?result[@"insertionMode"]:nil;
            if(!mode||![@[@"inline",@"display",@"numbered-left",@"numbered-right"] containsObject:mode]){EquationLabFinishWordInsertion(false);return;}
            NSString* encoded=[result[@"docx"] isKindOfClass:NSString.class]?result[@"docx"]:nil;
            NSData* fragment=encoded.length<=24*1024*1024?[[NSData alloc] initWithBase64EncodedString:encoded options:0]:nil;
            if(fragment.length<4||memcmp(fragment.bytes,"PK\x03\x04",4)){EquationLabFinishWordInsertion(false);return;}
            state.mode=mode;state.fragment=fragment;return;
        }else if([result[@"state"] isEqual:@"cancelled"]){endInsertion(state,0,false);return;}
        else if(![result[@"state"] isEqual:@"editing"]){endInsertion(state,5,true);return;}
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,200*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[weak poll];});
    });
}
@end

std::int32_t EquationLabBeginWordInsertion(NSURL* directory,NSDictionary* document,NSDictionary* layout,std::int32_t token) {
    if(!NSThread.isMainThread||!directory||!document||token<=0||insertion)return -1;
    ELWordInsertion* state=[ELWordInsertion new];state.directory=directory;state.token=token;
    // Reserve a disjoint, random uint64 session namespace from live OLE IDs.
    std::uint64_t identity=0;arc4random_buf(&identity,sizeof(identity));identity|=1ull<<63;
    state.session=[NSString stringWithFormat:@"%llu",static_cast<unsigned long long>(identity)];
    state.generation=++insertionGeneration;state.deadline=[NSDate dateWithTimeIntervalSinceNow:20*60];insertion=state;insertionError=0;acknowledgementError=0;
    NSDictionary* body=@{@"session":state.session,@"acknowledgement":@YES,@"document":document,@"layout":layout};
    state.request=EquationLabTransportRequest(@"/api/native-insert-open",body,^(NSDictionary* result,NSError* error){
        NSString* ticket=[result[@"ticket"] isKindOfClass:NSString.class]?result[@"ticket"]:nil;
        NSCharacterSet* invalid=[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
        BOOL valid=ticket.length==64&&[ticket rangeOfCharacterFromSet:invalid].location==NSNotFound;
        if(state.ended||insertion!=state){if(valid)retireInsertionTicket(ticket,state.session,state.generation);return;}
        state.request=nil;
        if(error||!valid){endInsertion(state,1,false);return;}
        state.ticket=ticket;
        EquationLabTransportLaunch([@"equationlab://word-edit/" stringByAppendingString:ticket],^(NSError* launchError){
            if(state.ended||insertion!=state)return;
            if(launchError){endInsertion(state,2,true);return;}
            [state poll];
        });
    });
    return 0;
}
bool EquationLabWordInsertionActive(){return insertion!=nil;}
void EquationLabCancelWordInsertion(){if(NSThread.isMainThread&&insertion){if(insertion.fragment)EquationLabFinishWordInsertion(false);else endInsertion(insertion,0,true);}}
NSData* EquationLabClaimWordInsertion(std::int32_t* token){
    if(!NSThread.isMainThread||!insertion.fragment||insertion.claimed)return nil;
    insertion.claimed=YES;if(token)*token=insertion.token;return insertion.fragment;
}
std::int32_t EquationLabWordInsertionInline(){
    if(!NSThread.isMainThread||!insertion.claimed||!insertion.fragment)return -1;
    return [insertion.mode isEqual:@"inline"]?1:0;
}
void EquationLabFinishWordInsertion(bool ok){
    if(!NSThread.isMainThread||!insertion||insertion.ended)return;
    ELWordInsertion* state=insertion;NSString* ticket=state.ticket;NSString* session=state.session;std::uint64_t generation=state.generation;
    endInsertion(state,ok?0:6,false);
    queueAcknowledgement(ticket,session,ok?ELWordInsertionOutcomeCommitted:ELWordInsertionOutcomeFailed,generation);
}
void EquationLabFinishWordInsertionUncertain(){
    if(!NSThread.isMainThread||!insertion||insertion.ended)return;
    ELWordInsertion* state=insertion;NSString* ticket=state.ticket;NSString* session=state.session;std::uint64_t generation=state.generation;
    endInsertion(state,7,false);
    queueAcknowledgement(ticket,session,ELWordInsertionOutcomeUnconfirmed,generation);
}
std::int32_t EquationLabWordInsertionError(){return insertionError?insertionError:acknowledgementError;}
