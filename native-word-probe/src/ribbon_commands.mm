#include "word_host_pump.hpp"
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstdint>
#include <climits>
#include <string>
#include <atomic>
#include <os/log.h>
#include "diagnostics.hpp"
#include "word_insertion.hpp"
#include "word_document_requests.hpp"

extern "C" std::int32_t MathTypeBridgeMathTypeRegistrationState();
extern "C" std::int32_t MathTypeBridgeRibbonOpen();
void EquationLabFinishWordInsertionUncertain();
void EquationLabDocumentContextDidCapture();
void EquationLabDocumentContextDidClear();
void EquationLabDocumentContextDidClearSelection();
void EquationLabDocumentContextDidCloseIdentity(std::int32_t identity);
void EquationLabDocumentContextWillCapture();
std::int32_t EquationLabQueueEditorTool(NSString* tool);
BOOL EquationLabArmDocumentActivationAnchor(NSDictionary* context);
NSDictionary* EquationLabTakeDocumentActivationAnchor();
void EquationLabClearDocumentActivationAnchor();
BOOL EquationLabActivationAnchorIsPending();
NSDictionary* EquationLabTakePreCapturedDocumentActivation();
namespace {
NSDictionary* pendingDocument;NSDictionary* explicitSelectionBase;BOOL pendingDocumentSelection=NO;std::int32_t navigationTarget=0;std::atomic<std::int32_t> bindingToken{0};
std::int32_t EquationLabCapturePreCapturedDocumentContext(NSDictionary* context);
void EquationLabClearPreCapturedDocumentActivation();
struct CaptureTiming {CFAbsoluteTime started=0,xmlReady=0,fileReady=0;};CaptureTiming captureTiming;
}
// Word owns the latest captured snapshot. ELCTX2 remains short-lived; an exact
// ELCTX3 selection snapshot is consumed once when first dispatched to an OLE owner.
NSDictionary* EquationLabCapturedDocumentContext(){return pendingDocument;}
BOOL EquationLabDocumentContextIsPendingSelection(NSDictionary* context){return context&&pendingDocumentSelection&&context==pendingDocument;}
void EquationLabConsumeDocumentSelection(NSDictionary* context){
    if(!EquationLabDocumentContextIsPendingSelection(context))return;
    pendingDocument=nil;pendingDocumentSelection=NO;EquationLabDocumentContextDidClearSelection();
}
std::int32_t EquationLabNewDocumentToken(){return ++bindingToken;}
void EquationLabSetNavigationTarget(std::int32_t index){navigationTarget=index+1;}
namespace {
NSURL* startupDirectory(){
    Dl_info info{};
    if(!dladdr(reinterpret_cast<void*>(&MathTypeBridgeRibbonOpen),&info)||!info.dli_fname)return nil;
    NSURL* executable=[NSURL fileURLWithPath:[NSString stringWithUTF8String:info.dli_fname]];
    return executable.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent;
}
bool validHost(){return NSThread.isMainThread&&[[NSBundle mainBundle].bundleIdentifier isEqual:@"com.microsoft.Word"]&&MathTypeBridgeMathTypeRegistrationState()==1;}
NSString* documentProcessIdentity(){static NSString* identity=NSUUID.UUID.UUIDString;return identity;}
NSData* inputFile(NSURL* directory,NSString* name){
    NSURL* file=[directory URLByAppendingPathComponent:name];int fd=open(file.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
    if(fd<0)return nil;struct stat st{};
    if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=geteuid()||st.st_size>30*1024*1024){close(fd);return nil;}
    NSMutableData* data=[NSMutableData dataWithLength:static_cast<NSUInteger>(st.st_size)];auto* bytes=static_cast<unsigned char*>(data.mutableBytes);std::size_t used=0;
    while(used<data.length){auto n=read(fd,bytes+used,data.length-used);if(n<=0){close(fd);return nil;}used+=static_cast<std::size_t>(n);}close(fd);return data;
}
bool outputFile(NSURL* directory,NSString* name,NSData* data){
    if(!data||data.length>46*1024*1024)return false;
    NSURL* file=[directory URLByAppendingPathComponent:name];int fd=open(file.fileSystemRepresentation,O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW|O_CLOEXEC,0600);
    if(fd<0)return false;struct stat st{};bool ok=!fstat(fd,&st)&&S_ISREG(st.st_mode)&&st.st_uid==geteuid()&&!fchmod(fd,0600);
    auto* bytes=static_cast<const unsigned char*>(data.bytes);std::size_t used=0;
    while(ok&&used<data.length){auto n=write(fd,bytes+used,data.length-used);if(n<=0)ok=false;else used+=static_cast<std::size_t>(n);}close(fd);return ok;
}
BOOL wordRequestHexId(id value){
    if(![value isKindOfClass:NSString.class]||[value length]!=64)return NO;
    NSCharacterSet* bad=[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
    return [value rangeOfCharacterFromSet:bad].location==NSNotFound;
}
BOOL wordRequestTarget(id value){
    if(![value isKindOfClass:NSDictionary.class])return NO;
    NSDictionary* target=value;id identity=target[@"identity"],snapshot=target[@"snapshot"],index=target[@"index"],digest=target[@"nativeSha256"];
    return [identity isKindOfClass:NSString.class]&&[identity length]>=3&&[identity length]<=256&&[identity rangeOfString:@":"].location!=NSNotFound&&[snapshot isKindOfClass:NSNumber.class]&&[snapshot intValue]>0&&[snapshot doubleValue]==[snapshot intValue]&&[index isKindOfClass:NSNumber.class]&&[index intValue]>=0&&[index intValue]<=10000&&[index doubleValue]==[index intValue]&&wordRequestHexId(digest);
}
BOOL wordRequestFieldsMatch(NSArray<NSString*>* fields,NSDictionary* envelope){
    if(fields.count!=9||![fields[0] isEqual:@"ELDREQ2"]||fields[8].length||![envelope[@"requestId"] isEqual:fields[2]])return NO;
    NSDictionary* target=envelope[@"target"];NSString* documentIdentity=envelope[@"documentIdentity"];
    if([fields[3] isEqual:@"0"])return !target&&!documentIdentity&&!fields[4].length&&[fields[5] isEqual:@"0"]&&[fields[6] isEqual:@"0"]&&!fields[7].length;
    if([fields[3] isEqual:@"1"])return wordRequestTarget(target)&&!documentIdentity&&[target[@"identity"] isEqual:fields[4]]&&[[target[@"snapshot"] stringValue] isEqual:fields[5]]&&[[target[@"index"] stringValue] isEqual:fields[6]]&&[target[@"nativeSha256"] isEqual:fields[7]];
    return [fields[3] isEqual:@"2"]&&!target&&[documentIdentity isKindOfClass:NSString.class]&&[documentIdentity isEqual:fields[4]]&&[fields[5] isEqual:@"0"]&&[fields[6] isEqual:@"0"]&&!fields[7].length;
}
NSDictionary* wordDocumentRequestFromFile(NSInteger* tokenOut=nullptr){
    if(!validHost())return nil;
    NSURL* directory=[startupDirectory() URLByAppendingPathComponent:@".EquationLab"];
    NSData* data=inputFile(directory,@"native-document-request.txt");if(!data)return nil;
    NSString* text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];NSArray<NSString*>* fields=[text componentsSeparatedByString:@"\n"];
    if(fields.count!=9||![fields[0] isEqual:@"ELDREQ2"]||fields[8].length)return nil;
    NSScanner* tokenScanner=[NSScanner scannerWithString:fields[1]];NSInteger token=0;
    if(![tokenScanner scanInteger:&token]||!tokenScanner.isAtEnd||token<=0||token>INT32_MAX||!wordRequestHexId(fields[2]))return nil;
    NSDictionary* envelope=bridge_probe::wordDocumentRequestEnvelope(static_cast<std::int32_t>(token));
    if(!envelope||![envelope[@"requestId"] isEqual:fields[2]]||!bridge_probe::wordDocumentRequestIsCurrent(static_cast<std::int32_t>(token)))return nil;
    if(!wordRequestFieldsMatch(fields,envelope))return nil;
    if(tokenOut)*tokenOut=token;return envelope;
}
std::int32_t takeWordDocumentRequest(){
    if(!validHost())return -1;
    auto token=bridge_probe::takeWordDocumentRequest();if(token<=0)return token;
    NSDictionary* envelope=bridge_probe::wordDocumentRequestEnvelope(token);NSString* requestId=envelope[@"requestId"];
    if(!wordRequestHexId(requestId)){bridge_probe::finishWordDocumentRequest(token,@"failed",@"invalid-request-id");return -2;}
    NSDictionary* target=envelope[@"target"];NSString* documentIdentity=envelope[@"documentIdentity"];NSString* targetIdentity=documentIdentity?:@"",*digest=@"";NSNumber* snapshot=@0,*index=@0;NSString* targetFlag=documentIdentity?@"2":@"0";
    if(target){
        if(!wordRequestTarget(target)){bridge_probe::finishWordDocumentRequest(token,@"failed",@"invalid-target");return -2;}
        NSString* expectedPrefix=[documentProcessIdentity() stringByAppendingString:@":"];
        if(![target[@"identity"] hasPrefix:expectedPrefix]){bridge_probe::finishWordDocumentRequest(token,@"failed",@"document-process-mismatch");return -2;}
        targetFlag=@"1";targetIdentity=target[@"identity"];snapshot=target[@"snapshot"];index=target[@"index"];digest=target[@"nativeSha256"];
    }
    if(documentIdentity){
        NSString* expectedPrefix=[documentProcessIdentity() stringByAppendingString:@":"];
        if(![documentIdentity hasPrefix:expectedPrefix]){bridge_probe::finishWordDocumentRequest(token,@"failed",@"document-process-mismatch");return -2;}
        NSString* tokenText=[documentIdentity substringFromIndex:expectedPrefix.length];NSScanner* scanner=[NSScanner scannerWithString:tokenText];int identityToken=0;
        if(![scanner scanInt:&identityToken]||!scanner.isAtEnd||identityToken<=0){bridge_probe::finishWordDocumentRequest(token,@"failed",@"invalid-document-identity");return -2;}
    }
    NSString* text=[NSString stringWithFormat:@"ELDREQ2\n%d\n%@\n%@\n%@\n%@\n%@\n%@\n",token,requestId,targetFlag,targetIdentity,snapshot,index,digest];
    NSData* bytes=[text dataUsingEncoding:NSUTF8StringEncoding];
    if(!outputFile([startupDirectory() URLByAppendingPathComponent:@".EquationLab"],@"native-document-request.txt",bytes)){
        bridge_probe::finishWordDocumentRequest(token,@"failed",@"request-file-write");return -2;
    }
    return token;
}
std::int32_t currentWordDocumentRequest(){
    NSInteger token=0;auto envelope=wordDocumentRequestFromFile(&token);return envelope&&bridge_probe::wordDocumentRequestIsCurrent(static_cast<std::int32_t>(token))?1:0;
}
std::int32_t beginCurrentWordDocumentRequest(){
    NSInteger token=0;auto envelope=wordDocumentRequestFromFile(&token);(void)envelope;
    return envelope&&bridge_probe::beginWordDocumentRequest(static_cast<std::int32_t>(token))?1:0;
}
std::int32_t finishCurrentWordDocumentRequest(NSString* outcome){
    NSInteger token=0;auto envelope=wordDocumentRequestFromFile(&token);(void)envelope;
    if(!envelope)token=bridge_probe::currentWordDocumentRequestToken();
    if(token<=0)return -1;
    return bridge_probe::finishWordDocumentRequest(static_cast<std::int32_t>(token),outcome);
}
NSDictionary* activationAnchor=nil;
NSDate* activationAnchorExpiry=nil;
NSDictionary* preCaptureIssue=nil;
NSDictionary* preCaptureCandidate=nil;
NSDate* preCaptureExpiry=nil;
NSUInteger documentCaptureSequence=0;
BOOL preCaptureWasCaptured=NO;
BOOL preCaptureWasArmed=NO;
BOOL preCaptureWasRejected=NO;
constexpr NSTimeInterval ActivationAnchorLifetime=5.0;
constexpr NSTimeInterval PreCaptureLifetime=15.0;
std::int32_t openTool(NSString* tool){
    if(!validHost())return -1;
    if([@[@"typography",@"spacing",@"export"] containsObject:tool])return EquationLabQueueEditorTool(tool);
    NSURL* app=nil;
    for(NSRunningApplication* running in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"app.equationlab.mac"].reverseObjectEnumerator)if(!running.terminated&&running.bundleURL){app=running.bundleURL;break;}
    if(!app)app=[NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:@"app.equationlab.mac"];
    if(!app)return -2;
    NSURL* url=[NSURL URLWithString:[@"equationlab://word-tool/" stringByAppendingString:tool]];
    NSWorkspaceOpenConfiguration* config=[NSWorkspaceOpenConfiguration configuration];config.activates=YES;
    [NSWorkspace.sharedWorkspace openURLs:@[url] withApplicationAtURL:app configuration:config completionHandler:nil];return 0;
}
NSDictionary* request(NSString* operation,NSDictionary* body){
    NSURLSessionConfiguration* configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.timeoutIntervalForRequest=10;configuration.timeoutIntervalForResource=15;
    NSURLSession* session=[NSURLSession sessionWithConfiguration:configuration];
    NSMutableURLRequest* request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[@"http://127.0.0.1:37952/api/" stringByAppendingString:operation]]];
    request.HTTPMethod=@"POST";[request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    request.HTTPBody=[NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    dispatch_semaphore_t semaphore=dispatch_semaphore_create(0);
    __block NSDictionary* result=nil;
    NSURLSessionDataTask* task=[session dataTaskWithRequest:request completionHandler:^(NSData* data,NSURLResponse* response,NSError* error){
        if(!error&&[(NSHTTPURLResponse*)response statusCode]==200&&data.length<46*1024*1024){id parsed=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];if([parsed isKindOfClass:NSDictionary.class])result=parsed;}
        dispatch_semaphore_signal(semaphore);
    }];
    [task resume];if(dispatch_semaphore_wait(semaphore,dispatch_time(DISPATCH_TIME_NOW,15*NSEC_PER_SEC)))[task cancel];
    [session invalidateAndCancel];return result;
}
std::int32_t prepare(NSString* layout,NSString* operation=@"ribbon-create"){
    if(!validHost())return -1;NSURL* startup=startupDirectory();if(!startup)return -2;
    NSURL* directory=[startup URLByAppendingPathComponent:@".EquationLab"];
    NSString* settings=[[NSString alloc] initWithData:inputFile(directory,@"ribbon-settings.txt") encoding:NSUTF8StringEncoding];
    NSArray<NSString*>* lines=[settings componentsSeparatedByString:@"\n"];
    NSDictionary* options=@{@"mode":layout,@"numberFormat":lines.count>0?lines[0]:@"(#E1)",@"chapter":@(lines.count>1?[lines[1] integerValue]:1),@"section":@(lines.count>2?[lines[2] integerValue]:1),@"equation":@(lines.count>3?[lines[3] integerValue]:1)};
    NSDictionary* result=request(operation,@{@"layout":options});
    if(![result[@"docx"] isKindOfClass:NSString.class]||![result[@"ooxml"] isKindOfClass:NSString.class])return -3;
    NSData* docx=[[NSData alloc] initWithBase64EncodedString:result[@"docx"] options:0];NSData* xml=[result[@"ooxml"] dataUsingEncoding:NSUTF8StringEncoding];
    if(docx.length<4||memcmp(docx.bytes,"PK\x03\x04",4)||!outputFile(directory,@"ribbon-insert.docx",docx)||!outputFile(directory,@"ribbon-insert.xml",xml))return -4;
    return 0;
}
std::int32_t prepareInsertion(NSString* layout);
NSDictionary* decodeDocumentContext(NSString* text,BOOL* selectionBound=nullptr){
    NSRange first=[text rangeOfString:@"\n"];if(!text||first.location==NSNotFound)return nil;
    NSRange second=[text rangeOfString:@"\n" options:0 range:NSMakeRange(NSMaxRange(first),text.length-NSMaxRange(first))];if(second.location==NSNotFound)return nil;
    NSString* index=[text substringToIndex:first.location];NSString* identity=nil;NSNumber* snapshot=nil;NSNumber* captureToken=nil;BOOL selected=[index isEqualToString:@"ELCTX3"],requested=[index isEqualToString:@"ELCTX4"];
    if([index isEqualToString:@"ELCTX2"]||selected||requested){
        NSMutableArray<NSString*>* fields=[NSMutableArray arrayWithCapacity:requested?5:4];NSUInteger offset=0;
        for(NSUInteger i=0;i<(requested?5u:4u);i++){
            NSRange line=[text rangeOfString:@"\n" options:0 range:NSMakeRange(offset,text.length-offset)];if(line.location==NSNotFound)return nil;
            [fields addObject:[text substringWithRange:NSMakeRange(offset,line.location-offset)]];offset=NSMaxRange(line);
        }
        NSUInteger base=requested?1:0;NSScanner* docScanner=[NSScanner scannerWithString:fields[base+1]],*snapshotScanner=[NSScanner scannerWithString:fields[base+2]];int doc=0,token=0;
        if(![docScanner scanInt:&doc]||!docScanner.isAtEnd||doc<=0||![snapshotScanner scanInt:&token]||!snapshotScanner.isAtEnd||token<=0)return nil;
        if(requested){NSScanner* requestScanner=[NSScanner scannerWithString:fields[1]];int request=0;if(![requestScanner scanInt:&request]||!requestScanner.isAtEnd||request<=0)return nil;captureToken=@(request);}
        identity=[NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),doc];snapshot=@(token);
        index=fields[base+3];
        first=NSMakeRange(offset-1,1);second=[text rangeOfString:@"\n" options:0 range:NSMakeRange(offset,text.length-offset)];
        if(second.location==NSNotFound)return nil;
    }
    NSScanner* scanner=[NSScanner scannerWithString:index];NSInteger number=-1;
    if(![scanner scanInteger:&number]||!scanner.isAtEnd||number<0||number>10000)return nil;
    NSMutableDictionary* context=[@{@"index":@(number),@"name":[text substringWithRange:NSMakeRange(NSMaxRange(first),second.location-NSMaxRange(first))],@"ooxml":[text substringFromIndex:NSMaxRange(second)]} mutableCopy];
    if(identity){context[@"identity"]=identity;context[@"snapshot"]=snapshot;}
    if(captureToken)context[@"captureToken"]=captureToken;
    if(selectionBound)*selectionBound=selected||requested;
    return context;
}
std::int32_t prepareInsertion(NSString* layout){
    if(!validHost())return -1;NSURL* startup=startupDirectory();if(!startup)return -2;
    NSURL* directory=[startup URLByAppendingPathComponent:@".EquationLab"];
    NSString* text=[[NSString alloc] initWithData:inputFile(directory,@"ribbon-insertion-context.txt") encoding:NSUTF8StringEncoding];
    NSDictionary* context=decodeDocumentContext(text);if(!context[@"identity"]||!context[@"snapshot"])return -3;
    NSMutableDictionary* document=[context mutableCopy];document[@"index"]=@(-1);
    NSString* settings=[[NSString alloc] initWithData:inputFile(directory,@"ribbon-settings.txt") encoding:NSUTF8StringEncoding];
    NSArray<NSString*>* lines=[settings componentsSeparatedByString:@"\n"];
    NSDictionary* options=@{@"mode":layout,@"numberFormat":lines.count>0?lines[0]:@"(#E1)",@"chapter":@(lines.count>1?[lines[1] integerValue]:1),@"section":@(lines.count>2?[lines[2] integerValue]:1),@"equation":@(lines.count>3?[lines[3] integerValue]:1)};
    return EquationLabBeginWordInsertion(directory,document,options,[context[@"snapshot"] intValue]);
}
BOOL decodeSelectionEquation(NSString* text,NSInteger* index,BOOL* selectionBound,NSInteger* documentIdentity=nullptr,NSInteger* snapshotToken=nullptr,BOOL* explicitCached=nullptr){
    if(!text||!index)return NO;
    BOOL bound=NO,cached=NO;NSInteger document=0,snapshot=0;
    if([text hasPrefix:@"ELSEL4\n"]){
        NSArray<NSString*>* fields=[text componentsSeparatedByString:@"\n"];
        if(fields.count!=4||![fields[0] isEqual:@"ELSEL4"])return NO;
        auto positiveLong=[](NSString* value,NSInteger* out){
            if(!value.length)return NO;
            for(NSUInteger i=0;i<value.length;i++){unichar c=[value characterAtIndex:i];if(c<'0'||c>'9')return NO;}
            NSScanner* scanner=[NSScanner scannerWithString:value];NSInteger number=0;
            if(![scanner scanInteger:&number]||!scanner.isAtEnd||number<=0||number>INT32_MAX)return NO;
            *out=number;return YES;
        };
        if(!positiveLong(fields[1],&document)||!positiveLong(fields[2],&snapshot))return NO;
        text=fields[3];bound=YES;cached=YES;
    }else if([text hasPrefix:@"ELSEL3\n"]){bound=YES;text=[text substringFromIndex:7];}
    NSScanner* scanner=[NSScanner scannerWithString:text];NSInteger number=-1;
    if(![scanner scanInteger:&number]||!scanner.isAtEnd||number<0||number>10000)return NO;
    *index=number;if(selectionBound)*selectionBound=bound;if(documentIdentity)*documentIdentity=document;if(snapshotToken)*snapshotToken=snapshot;if(explicitCached)*explicitCached=cached;return YES;
}
void installDocumentContext(NSDictionary* context,BOOL selectionBound){
    pendingDocument=context;pendingDocumentSelection=selectionBound;
    // Keep one shallow immutable dictionary as a selection-only base. The
    // large OOXML NSString is shared; it is never copied into this slot.
    explicitSelectionBase=[context copy];
}
void clearDocumentSelectionState(){pendingDocument=nil;pendingDocumentSelection=NO;}
void clearDocumentContextState(){clearDocumentSelectionState();explicitSelectionBase=nil;}
std::int32_t applySelectionEquation(NSString* text){
    NSInteger index=-1,document=0,snapshot=0;BOOL selectionBound=NO,explicitCached=NO;
    if(!decodeSelectionEquation(text,&index,&selectionBound,&document,&snapshot,&explicitCached))return -3;
    NSDictionary* source=nil;
    if(explicitCached){
        if(!explicitSelectionBase)return -1;
        NSString* suffix=[NSString stringWithFormat:@":%ld",static_cast<long>(document)];
        if(![explicitSelectionBase[@"identity"] isKindOfClass:NSString.class]||![explicitSelectionBase[@"identity"] hasSuffix:suffix]||![explicitSelectionBase[@"snapshot"] isKindOfClass:NSNumber.class]||[explicitSelectionBase[@"snapshot"] integerValue]!=snapshot)return -4;
        source=explicitSelectionBase;
    }else{
        if(!pendingDocument)return -1;
        source=pendingDocument;
    }
    NSMutableDictionary* next=[source mutableCopy];next[@"index"]=@(index);pendingDocument=next;pendingDocumentSelection=selectionBound;EquationLabDocumentContextDidCapture();return 0;
}
std::int32_t captureDocument(){
    if(!validHost())return -1;clearDocumentSelectionState();explicitSelectionBase=nil;EquationLabDocumentContextWillCapture();
    const CFAbsoluteTime readStarted=CFAbsoluteTimeGetCurrent();
    NSURL* directory=[startupDirectory() URLByAppendingPathComponent:@".EquationLab"];
    NSData* data=inputFile(directory,@"document-context.txt");
    if(!data)return -2;
    const CFAbsoluteTime decodeStarted=CFAbsoluteTimeGetCurrent();
    unlink([directory URLByAppendingPathComponent:@"document-context.txt"].fileSystemRepresentation);
    BOOL selectionBound=NO;NSDictionary* context=decodeDocumentContext([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding],&selectionBound);
    const CFAbsoluteTime decoded=CFAbsoluteTimeGetCurrent();
    if(!context)return -3;
    std::int32_t preCaptured=EquationLabCapturePreCapturedDocumentContext(context);
    if(preCaptured<0){captureTiming={};return -4;}
    if(preCaptured==0){installDocumentContext(context,selectionBound);EquationLabDocumentContextDidCapture();}
    const CFAbsoluteTime finished=CFAbsoluteTimeGetCurrent();
    if(captureTiming.started>0&&captureTiming.xmlReady>=captureTiming.started&&captureTiming.fileReady>=captureTiming.xmlReady){
        const double total=(finished-captureTiming.started)*1000.0;
        const double xml=(captureTiming.xmlReady-captureTiming.started)*1000.0;
        const double write=(captureTiming.fileReady-captureTiming.xmlReady)*1000.0;
        const double decode=(decoded-decodeStarted)*1000.0;
        const double read=(decodeStarted-readStarted)*1000.0;
        const double finalize=(finished-decoded)*1000.0;
        os_log_info(OS_LOG_DEFAULT,"WordHostPerformance xml_ms=%.3f vba_utf8_write_ms=%.3f file_read_ms=%.3f native_decode_ms=%.3f capture_finalize_ms=%.3f total_ms=%.3f",xml,write,read,decode,finalize,total);
    }
    captureTiming={};
    return 0;
}
void clearDocumentCaptureState(){clearDocumentContextState();EquationLabClearDocumentActivationAnchor();}
std::int32_t clearDocument(){if(!validHost())return -1;clearDocumentCaptureState();EquationLabDocumentContextDidClear();return 0;}
std::int32_t closeDocumentIdentity(){
    if(!validHost())return -1;NSURL* directory=[startupDirectory() URLByAppendingPathComponent:@".EquationLab"];
    EquationLabClearDocumentActivationAnchor();
    NSData* data=inputFile(directory,@"document-close.txt");unlink([directory URLByAppendingPathComponent:@"document-close.txt"].fileSystemRepresentation);
    NSString* text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];NSArray<NSString*>* fields=[text componentsSeparatedByString:@"\n"];
    if(fields.count!=2||![fields[0] isEqual:@"ELCLOSE1"])return -2;NSScanner* scanner=[NSScanner scannerWithString:fields[1]];int identity=0;
    if(![scanner scanInt:&identity]||!scanner.isAtEnd||identity<=0)return -3;EquationLabDocumentContextDidCloseIdentity(identity);
    bridge_probe::closeWordWorkspaceIdentity([NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),identity]);return 0;
}
bool scanActivationInteger(NSString* value,int minimum,int maximum,int* result){
    if(!value.length||!result)return false;
    for(NSUInteger index=0;index<value.length;index++){unichar character=[value characterAtIndex:index];if(character<'0'||character>'9')return false;}
    NSScanner* scanner=[NSScanner scannerWithString:value];int number=0;
    if(![scanner scanInt:&number]||!scanner.isAtEnd||number<minimum||number>maximum)return false;
    *result=number;return true;
}
NSDictionary* decodeDocumentActivationAnchor(NSString* text){
    if(![text isKindOfClass:NSString.class])return nil;
    NSArray<NSString*>* fields=[text componentsSeparatedByString:@"\n"];int nonce=0,identity=0,snapshot=0,index=0;
    if(fields.count==4&&[fields[0] isEqual:@"ELACT1"]){
        if(!scanActivationInteger(fields[1],1,INT32_MAX,&identity)||!scanActivationInteger(fields[2],1,INT32_MAX,&snapshot)||!scanActivationInteger(fields[3],0,10000,&index))return nil;
        return @{@"identity":[NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),identity],@"snapshot":@(snapshot),@"index":@(index)};
    }
    if(fields.count!=5||![fields[0] isEqual:@"ELACT2"]||!scanActivationInteger(fields[1],1,INT32_MAX,&nonce)||!scanActivationInteger(fields[2],1,INT32_MAX,&identity)||!scanActivationInteger(fields[3],1,INT32_MAX,&snapshot)||!scanActivationInteger(fields[4],0,10000,&index))return nil;
    return @{@"nonce":@(nonce),@"identity":[NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),identity],@"snapshot":@(snapshot),@"index":@(index)};
}
void EquationLabClearPreCapturedDocumentActivation(){
    preCaptureIssue=nil;preCaptureCandidate=nil;preCaptureExpiry=nil;
    preCaptureWasCaptured=NO;preCaptureWasArmed=NO;preCaptureWasRejected=NO;
}
std::int32_t EquationLabIssuePreCapturedDocumentActivationNonce(NSDictionary* binding){
    NSString* identity=binding[@"identity"];NSNumber* index=binding[@"index"];
    if(![identity isKindOfClass:NSString.class]||[identity rangeOfString:@":"].location==NSNotFound||![index isKindOfClass:NSNumber.class]||index.integerValue<0||index.integerValue>10000||index.doubleValue!=index.integerValue)return 0;
    EquationLabClearDocumentActivationAnchor();
    std::int32_t nonce=EquationLabNewDocumentToken();if(nonce<=0)return 0;
    preCaptureIssue=@{@"nonce":@(nonce),@"identity":[identity copy],@"index":@(index.integerValue),@"sequence":@(documentCaptureSequence)};
    preCaptureExpiry=[NSDate dateWithTimeIntervalSinceNow:PreCaptureLifetime];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,static_cast<std::int64_t>(PreCaptureLifetime*NSEC_PER_SEC)),dispatch_get_main_queue(),^{
        if([preCaptureIssue[@"nonce"] intValue]==nonce){preCaptureCandidate=nil;preCaptureWasRejected=YES;preCaptureWasArmed=NO;}
    });
    return nonce;
}
// Return 1 for a retained fast-path candidate, 0 for an ordinary ELCTX4
// response, and -1 when the issued nonce was present but its binding failed.
std::int32_t EquationLabCapturePreCapturedDocumentContext(NSDictionary* context){
    ++documentCaptureSequence;
    NSNumber* token=context[@"captureToken"];
    if(!preCaptureIssue||![token isKindOfClass:NSNumber.class]||token.integerValue!=[preCaptureIssue[@"nonce"] integerValue])return 0;
    if(preCaptureWasCaptured){preCaptureCandidate=nil;preCaptureWasRejected=YES;return -1;}
    BOOL fresh=preCaptureExpiry&&preCaptureExpiry.timeIntervalSinceNow>0&&documentCaptureSequence>[preCaptureIssue[@"sequence"] unsignedIntegerValue];
    BOOL matches=fresh&&[context[@"identity"] isEqual:preCaptureIssue[@"identity"]]&&[context[@"index"] isEqual:preCaptureIssue[@"index"]]&&[context[@"snapshot"] isKindOfClass:NSNumber.class]&&[context[@"snapshot"] integerValue]>0&&[context[@"ooxml"] isKindOfClass:NSString.class];
    preCaptureWasCaptured=YES;
    if(!matches){preCaptureCandidate=nil;preCaptureWasRejected=YES;return -1;}
    preCaptureCandidate=[context copy];return 1;
}
BOOL EquationLabArmPreCapturedDocumentActivation(NSDictionary* activation){
    NSNumber* nonce=activation[@"nonce"];
    if(!preCaptureIssue||![nonce isKindOfClass:NSNumber.class]||nonce.integerValue!=[preCaptureIssue[@"nonce"] integerValue])return NO;
    BOOL matches=!preCaptureWasArmed&&!preCaptureWasRejected&&preCaptureWasCaptured&&preCaptureExpiry&&preCaptureExpiry.timeIntervalSinceNow>0&&preCaptureCandidate&&[activation[@"identity"] isEqual:preCaptureIssue[@"identity"]]&&[activation[@"identity"] isEqual:preCaptureCandidate[@"identity"]]&&[activation[@"index"] isEqual:preCaptureIssue[@"index"]]&&[activation[@"index"] isEqual:preCaptureCandidate[@"index"]]&&[activation[@"snapshot"] isEqual:preCaptureCandidate[@"snapshot"]];
    if(!matches){preCaptureWasRejected=YES;preCaptureCandidate=nil;return NO;}
    preCaptureWasArmed=YES;return YES;
}
NSDictionary* takePreCapturedDocumentActivation(){
    if(!preCaptureIssue)return nil;
    NSDictionary* result=nil;
    if(preCaptureWasArmed&&!preCaptureWasRejected&&preCaptureExpiry&&preCaptureExpiry.timeIntervalSinceNow>0&&preCaptureCandidate){
        NSMutableDictionary* activation=[preCaptureCandidate mutableCopy];activation[@"_preCapturedActivation"]=@YES;result=[activation copy];
    }else result=@{@"_preCaptureRejected":@YES};
    EquationLabClearPreCapturedDocumentActivation();return result;
}
std::int32_t preparedDocumentActivationNonce(){
    if(!preCaptureIssue||!preCaptureWasArmed||!preCaptureWasCaptured||preCaptureWasRejected||!preCaptureCandidate||!preCaptureExpiry||preCaptureExpiry.timeIntervalSinceNow<=0)return 0;
    NSNumber* issuedNonce=preCaptureIssue[@"nonce"];
    if(![issuedNonce isKindOfClass:NSNumber.class]||![preCaptureCandidate[@"captureToken"] isEqual:issuedNonce])return 0;
    if(![preCaptureCandidate[@"identity"] isEqual:preCaptureIssue[@"identity"]]||![preCaptureCandidate[@"index"] isEqual:preCaptureIssue[@"index"]])return 0;
    return issuedNonce.intValue;
}
std::int32_t issueDocumentActivationNonce(){
    if(!validHost())return -1;NSURL* startup=startupDirectory();if(!startup)return -2;
    EquationLabClearDocumentActivationAnchor();
    NSURL* directory=[startup URLByAppendingPathComponent:@".EquationLab"];
    NSURL* file=[directory URLByAppendingPathComponent:@"document-activation-request.txt"];
    NSData* data=inputFile(directory,@"document-activation-request.txt");if(!data)return -3;unlink(file.fileSystemRepresentation);
    NSString* text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];NSArray<NSString*>* fields=[text componentsSeparatedByString:@"\n"];
    int identity=0,index=0;if(fields.count!=3||![fields[0] isEqual:@"ELACT0"]||!scanActivationInteger(fields[1],1,INT32_MAX,&identity)||!scanActivationInteger(fields[2],0,10000,&index))return -4;
    NSDictionary* binding=@{@"identity":[NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),identity],@"index":@(index)};
    return EquationLabIssuePreCapturedDocumentActivationNonce(binding);
}
std::int32_t prepareDocumentActivation(){
    if(!validHost())return -1;
    NSURL* startup=startupDirectory();if(!startup)return -2;
    NSURL* directory=[startup URLByAppendingPathComponent:@".EquationLab"];
    NSURL* file=[directory URLByAppendingPathComponent:@"document-activation.txt"];
    NSData* data=inputFile(directory,@"document-activation.txt");
    if(!data){os_log_info(OS_LOG_DEFAULT,"WordHostCapture prepare result=missing");return -2;}
    unlink(file.fileSystemRepresentation);
    NSDictionary* context=decodeDocumentActivationAnchor([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
    if(!context){os_log_info(OS_LOG_DEFAULT,"WordHostCapture prepare result=invalid");return -3;}
    BOOL fast=context[@"nonce"]!=nil;
    if(!fast)EquationLabClearPreCapturedDocumentActivation();
    BOOL armed=fast?EquationLabArmPreCapturedDocumentActivation(context):EquationLabArmDocumentActivationAnchor(context);
    os_log_info(OS_LOG_DEFAULT,"WordHostCapture prepare armed=%d",armed);
    return armed?0:-4;
}
// Word can drop its ordinary selection while entering an OLE verb. The
// independently issued activation survives that transient callback until
// consumption, expiry, an exact replacement target, or document teardown.
void clearOrdinaryDocumentSelection(){clearDocumentSelectionState();EquationLabDocumentContextDidClearSelection();}
std::int32_t clearDocumentSelection(){if(!validHost())return -1;clearOrdinaryDocumentSelection();return 0;}
std::int32_t clearDocumentSelectionDuringCapture(){if(!validHost())return -1;clearOrdinaryDocumentSelection();return 0;}
std::int32_t selectDocumentEquation(){
    if(!validHost())return -1;
    NSURL* directory=[startupDirectory() URLByAppendingPathComponent:@".EquationLab"];
    NSString* text=[[NSString alloc] initWithData:inputFile(directory,@"document-selection.txt") encoding:NSUTF8StringEncoding];
    unlink([directory URLByAppendingPathComponent:@"document-selection.txt"].fileSystemRepresentation);
    if(!text)return -2;return applySelectionEquation(text);
}
}
NSDictionary* EquationLabTakePreCapturedDocumentActivation(){return takePreCapturedDocumentActivation();}
BOOL EquationLabPreCapturedActivationIsPending(){return preparedDocumentActivationNonce()>0;}
void EquationLabClearDocumentActivationAnchor(){
    if(activationAnchor)os_log_info(OS_LOG_DEFAULT,"WordHostCapture clear armed=1");
    activationAnchor=nil;activationAnchorExpiry=nil;
    EquationLabClearPreCapturedDocumentActivation();
    if(validHost()){NSURL* startup=startupDirectory();if(startup){NSURL* directory=[startup URLByAppendingPathComponent:@".EquationLab"];unlink([[directory URLByAppendingPathComponent:@"document-activation.txt"] fileSystemRepresentation]);}}
}
BOOL EquationLabActivationAnchorIsPending(){
    if(!activationAnchor||!activationAnchorExpiry||activationAnchorExpiry.timeIntervalSinceNow<=0){EquationLabClearDocumentActivationAnchor();return NO;}
    return YES;
}
BOOL EquationLabArmDocumentActivationAnchor(NSDictionary* context){
    if(![context isKindOfClass:NSDictionary.class])return NO;
    NSString* identity=context[@"identity"];NSNumber* snapshot=context[@"snapshot"];NSNumber* index=context[@"index"];
    if(![identity isKindOfClass:NSString.class]||[identity rangeOfString:@":"].location==NSNotFound||![snapshot isKindOfClass:NSNumber.class]||snapshot.integerValue<=0||![index isKindOfClass:NSNumber.class]||index.integerValue<0||index.integerValue>10000)return NO;
    activationAnchor=@{@"identity":[identity copy],@"snapshot":@(snapshot.integerValue),@"index":@(index.integerValue)};
    activationAnchorExpiry=[NSDate dateWithTimeIntervalSinceNow:ActivationAnchorLifetime];
    return YES;
}
NSDictionary* EquationLabTakeDocumentActivationAnchor(){
    NSDictionary* result=EquationLabActivationAnchorIsPending()?activationAnchor:nil;
    EquationLabClearDocumentActivationAnchor();
    return result;
}
#define RIBBON_EXPORT(name,expression) extern "C" __attribute__((visibility("default"))) std::int32_t name(){@autoreleasepool{return expression;}}
RIBBON_EXPORT(MathTypeBridgeRibbonOpen,openTool(@"editor"))
RIBBON_EXPORT(MathTypeBridgeRibbonTypography,openTool(@"typography"))
RIBBON_EXPORT(MathTypeBridgeRibbonSpacing,openTool(@"spacing"))
RIBBON_EXPORT(MathTypeBridgeRibbonExport,openTool(@"export"))
RIBBON_EXPORT(MathTypeBridgeRibbonHelp,openTool(@"help"))
RIBBON_EXPORT(MathTypeBridgeRibbonCapabilities,openTool(@"capabilities"))
RIBBON_EXPORT(MathTypeBridgeRibbonInline,prepareInsertion(@"inline"))
RIBBON_EXPORT(MathTypeBridgeRibbonDisplay,prepareInsertion(@"display"))
RIBBON_EXPORT(MathTypeBridgeRibbonRight,prepareInsertion(@"numbered-right"))
RIBBON_EXPORT(MathTypeBridgeRibbonLeft,prepareInsertion(@"numbered-left"))
RIBBON_EXPORT(MathTypeBridgeInsertionActive,EquationLabWordInsertionActive()?1:0)
RIBBON_EXPORT(MathTypeBridgeInsertionInline,EquationLabWordInsertionInline())
RIBBON_EXPORT(MathTypeBridgeCancelInsertion,([&](){EquationLabCancelWordInsertion();return 0;})())
RIBBON_EXPORT(MathTypeBridgeFinishInsertion,([&](){EquationLabFinishWordInsertion(true);return 0;})())
RIBBON_EXPORT(MathTypeBridgeFailInsertion,([&](){EquationLabFinishWordInsertion(false);return 0;})())
RIBBON_EXPORT(MathTypeBridgeUncertainInsertion,([&](){EquationLabFinishWordInsertionUncertain();return 0;})())
RIBBON_EXPORT(MathTypeBridgeInsertionError,EquationLabWordInsertionError())
RIBBON_EXPORT(MathTypeBridgeTakeInsertion,([&](){
    if(!validHost())return -1;
    EquationLabWordHostDidPoll();
    std::int32_t token=0;NSData* data=EquationLabClaimWordInsertion(&token);if(!data)return 0;
    if(!outputFile([startupDirectory() URLByAppendingPathComponent:@".EquationLab"],@"ribbon-complete-insert.docx",data)){EquationLabFinishWordInsertion(false);return -2;}
    return token;
})())
RIBBON_EXPORT(MathTypeBridgeRibbonNumber,prepare(@"inline",@"ribbon-number"))
RIBBON_EXPORT(MathTypeBridgeRibbonChapter,prepare(@"inline",@"ribbon-chapter"))
RIBBON_EXPORT(MathTypeBridgeCaptureDocument,captureDocument())
RIBBON_EXPORT(MathTypeBridgeIssueDocumentActivationNonce,issueDocumentActivationNonce())
RIBBON_EXPORT(MathTypeBridgePreparedDocumentActivationNonce,validHost()?preparedDocumentActivationNonce():-1)
RIBBON_EXPORT(MathTypeBridgeClearDocumentContext,clearDocument())
RIBBON_EXPORT(MathTypeBridgeCloseDocumentIdentity,closeDocumentIdentity())
RIBBON_EXPORT(MathTypeBridgeClearDocumentSelection,clearDocumentSelection())
RIBBON_EXPORT(MathTypeBridgeClearDocumentSelectionDuringCapture,clearDocumentSelectionDuringCapture())
RIBBON_EXPORT(MathTypeBridgeClearDocumentActivationAnchor,([&](){if(!validHost())return -1;EquationLabClearDocumentActivationAnchor();return 0;})())
RIBBON_EXPORT(MathTypeBridgePrepareDocumentActivation,prepareDocumentActivation())
RIBBON_EXPORT(MathTypeBridgeSelectDocumentEquation,selectDocumentEquation())
RIBBON_EXPORT(MathTypeBridgeCaptureTimingStart,([&](){if(!validHost())return -1;captureTiming={};captureTiming.started=CFAbsoluteTimeGetCurrent();return 0;})())
RIBBON_EXPORT(MathTypeBridgeCaptureTimingXMLReady,([&](){if(!validHost()||captureTiming.started<=0)return -1;captureTiming.xmlReady=CFAbsoluteTimeGetCurrent();return 0;})())
RIBBON_EXPORT(MathTypeBridgeCaptureTimingFileReady,([&](){if(!validHost()||captureTiming.started<=0||captureTiming.xmlReady<captureTiming.started)return -1;captureTiming.fileReady=CFAbsoluteTimeGetCurrent();return 0;})())
RIBBON_EXPORT(MathTypeBridgeEditGeneration,bridge_probe::diagnosticValue(static_cast<std::uint32_t>(bridge_probe::Metric::EditGeneration)))
RIBBON_EXPORT(MathTypeBridgeNewDocumentToken,EquationLabNewDocumentToken())
RIBBON_EXPORT(MathTypeBridgeTakeNavigation,([](){auto target=navigationTarget;navigationTarget=0;return target;})())
RIBBON_EXPORT(MathTypeBridgeClearWordWorkspace,([&](){if(!validHost())return -1;bridge_probe::publishWordWorkspace(nil,@[]);return 0;})())
RIBBON_EXPORT(MathTypeBridgeQueueWorkspaceRefresh,([&](){if(!validHost())return -1;EquationLabWakeWordHost();return 0;})())
RIBBON_EXPORT(MathTypeBridgePublishWordWorkspace,([&](){
    if(!validHost())return -1;
    NSData* data=inputFile([startupDirectory() URLByAppendingPathComponent:@".EquationLab"],@"active-document.txt");
    if(!data||data.length>512*1024)return -2;
    NSString* text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSArray* lines=[text componentsSeparatedByString:@"\n"];
    if(lines.count==3&&[lines[0] isEqual:@"ELWORK1"]&&[lines[2] length]<=512){
        NSScanner* scanner=[NSScanner scannerWithString:lines[1]];int token=0;
        if(![scanner scanInt:&token]||!scanner.isAtEnd||token<=0)return -3;
        NSString* identity=[NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),token];
        bridge_probe::publishWordWorkspace(@{@"identity":identity,@"name":lines[2]},nil);return 0;
    }
    if(lines.count<4||![lines[0] isEqual:@"ELWORK2"])return -2;
    NSScanner* activeScanner=[NSScanner scannerWithString:lines[1]];int activeToken=0;
    if(![activeScanner scanInt:&activeToken]||!activeScanner.isAtEnd||activeToken<0)return -3;
    NSScanner* countScanner=[NSScanner scannerWithString:lines[2]];int count=0;
    NSString* finalField=lines.lastObject;
    if(![countScanner scanInt:&count]||!countScanner.isAtEnd||count<0||count>128||lines.count!=static_cast<NSUInteger>(4+count*3)||finalField.length)return -4;
    NSMutableArray* documents=[NSMutableArray arrayWithCapacity:count];NSMutableSet* identities=[NSMutableSet set];NSDictionary* active=nil;
    for(int i=0;i<count;i++){
        NSString* tokenText=lines[3+i*3],*readOnly=lines[4+i*3],*name=lines[5+i*3];NSScanner* tokenScanner=[NSScanner scannerWithString:tokenText];int token=0;
        if(![tokenScanner scanInt:&token]||!tokenScanner.isAtEnd||token<=0||![@[@"0",@"1"] containsObject:readOnly]||name.length>512||[name rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound)return -5;
        NSString* identity=[NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),token];if([identities containsObject:identity])return -5;[identities addObject:identity];
        NSDictionary* document=@{@"identity":identity,@"name":name,@"readOnly":@([readOnly isEqual:@"1"])};[documents addObject:document];if(token==activeToken)active=@{@"identity":identity,@"name":name};
    }
    if((count==0&&activeToken!=0)||(count>0&&!active))return -6;
    bridge_probe::publishWordWorkspace(active,documents);return 0;
})())
RIBBON_EXPORT(MathTypeBridgeTakeWordDocumentRequest,takeWordDocumentRequest())
RIBBON_EXPORT(MathTypeBridgeWordDocumentRequestCurrent,currentWordDocumentRequest())
RIBBON_EXPORT(MathTypeBridgeBeginWordDocumentRequest,beginCurrentWordDocumentRequest())
RIBBON_EXPORT(MathTypeBridgeFinishWordDocumentRequestOpened,finishCurrentWordDocumentRequest(@"opened"))
RIBBON_EXPORT(MathTypeBridgeFinishWordDocumentRequestEmpty,finishCurrentWordDocumentRequest(@"empty"))
RIBBON_EXPORT(MathTypeBridgeFinishWordDocumentRequestNoDocument,finishCurrentWordDocumentRequest(@"no-document"))
RIBBON_EXPORT(MathTypeBridgeFinishWordDocumentRequestFailed,finishCurrentWordDocumentRequest(@"failed"))
