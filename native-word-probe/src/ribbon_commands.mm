#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstdint>
#include <string>
#include <atomic>
#include <os/log.h>
#include "diagnostics.hpp"

extern "C" std::int32_t MathTypeBridgeMathTypeRegistrationState();
extern "C" std::int32_t MathTypeBridgeRibbonOpen();
void EquationLabDocumentContextDidCapture();
void EquationLabDocumentContextDidClear();
void EquationLabDocumentContextDidClearSelection();
namespace {
NSDictionary* pendingDocument;NSDictionary* explicitSelectionBase;BOOL pendingDocumentSelection=NO;std::int32_t navigationTarget=0;std::atomic<std::int32_t> bindingToken{0};
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
std::int32_t openTool(NSString* tool){
    if(!validHost())return -1;
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
NSDictionary* decodeDocumentContext(NSString* text,BOOL* selectionBound=nullptr){
    NSRange first=[text rangeOfString:@"\n"];if(!text||first.location==NSNotFound)return nil;
    NSRange second=[text rangeOfString:@"\n" options:0 range:NSMakeRange(NSMaxRange(first),text.length-NSMaxRange(first))];if(second.location==NSNotFound)return nil;
    NSString* index=[text substringToIndex:first.location];NSString* identity=nil;NSNumber* snapshot=nil;BOOL selected=[index isEqualToString:@"ELCTX3"];
    if([index isEqualToString:@"ELCTX2"]||selected){
        NSMutableArray<NSString*>* fields=[NSMutableArray arrayWithCapacity:4];NSUInteger offset=0;
        for(NSUInteger i=0;i<4;i++){
            NSRange line=[text rangeOfString:@"\n" options:0 range:NSMakeRange(offset,text.length-offset)];if(line.location==NSNotFound)return nil;
            [fields addObject:[text substringWithRange:NSMakeRange(offset,line.location-offset)]];offset=NSMaxRange(line);
        }
        NSScanner* docScanner=[NSScanner scannerWithString:fields[1]],*snapshotScanner=[NSScanner scannerWithString:fields[2]];int doc=0,token=0;
        if(![docScanner scanInt:&doc]||!docScanner.isAtEnd||doc<=0||![snapshotScanner scanInt:&token]||!snapshotScanner.isAtEnd||token<=0)return nil;
        static NSString* processIdentity=NSUUID.UUID.UUIDString;
        identity=[NSString stringWithFormat:@"%@:%d",processIdentity,doc];snapshot=@(token);
        index=fields[3];
        first=NSMakeRange(offset-1,1);second=[text rangeOfString:@"\n" options:0 range:NSMakeRange(offset,text.length-offset)];
        if(second.location==NSNotFound)return nil;
    }
    NSScanner* scanner=[NSScanner scannerWithString:index];NSInteger number=-1;
    if(![scanner scanInteger:&number]||!scanner.isAtEnd||number<0||number>10000)return nil;
    NSMutableDictionary* context=[@{@"index":@(number),@"name":[text substringWithRange:NSMakeRange(NSMaxRange(first),second.location-NSMaxRange(first))],@"ooxml":[text substringFromIndex:NSMaxRange(second)]} mutableCopy];
    if(identity){context[@"identity"]=identity;context[@"snapshot"]=snapshot;}
    if(selectionBound)*selectionBound=selected;
    return context;
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
    if(!validHost())return -1;clearDocumentSelectionState();explicitSelectionBase=nil;EquationLabDocumentContextDidClearSelection();
    const CFAbsoluteTime readStarted=CFAbsoluteTimeGetCurrent();
    NSURL* directory=[startupDirectory() URLByAppendingPathComponent:@".EquationLab"];
    NSData* data=inputFile(directory,@"document-context.txt");
    if(!data)return -2;
    const CFAbsoluteTime decodeStarted=CFAbsoluteTimeGetCurrent();
    unlink([directory URLByAppendingPathComponent:@"document-context.txt"].fileSystemRepresentation);
    BOOL selectionBound=NO;NSDictionary* context=decodeDocumentContext([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding],&selectionBound);
    const CFAbsoluteTime decoded=CFAbsoluteTimeGetCurrent();
    if(!context)return -3;installDocumentContext(context,selectionBound);EquationLabDocumentContextDidCapture();
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
std::int32_t clearDocument(){if(!validHost())return -1;clearDocumentContextState();EquationLabDocumentContextDidClear();return 0;}
std::int32_t clearDocumentSelection(){if(!validHost())return -1;clearDocumentSelectionState();EquationLabDocumentContextDidClearSelection();return 0;}
std::int32_t selectDocumentEquation(){
    if(!validHost())return -1;
    NSURL* directory=[startupDirectory() URLByAppendingPathComponent:@".EquationLab"];
    NSString* text=[[NSString alloc] initWithData:inputFile(directory,@"document-selection.txt") encoding:NSUTF8StringEncoding];
    unlink([directory URLByAppendingPathComponent:@"document-selection.txt"].fileSystemRepresentation);
    if(!text)return -2;return applySelectionEquation(text);
}
}
#define RIBBON_EXPORT(name,expression) extern "C" __attribute__((visibility("default"))) std::int32_t name(){@autoreleasepool{return expression;}}
RIBBON_EXPORT(MathTypeBridgeRibbonOpen,openTool(@"editor"))
RIBBON_EXPORT(MathTypeBridgeRibbonTypography,openTool(@"typography"))
RIBBON_EXPORT(MathTypeBridgeRibbonSpacing,openTool(@"spacing"))
RIBBON_EXPORT(MathTypeBridgeRibbonExport,openTool(@"export"))
RIBBON_EXPORT(MathTypeBridgeRibbonHelp,openTool(@"help"))
RIBBON_EXPORT(MathTypeBridgeRibbonCapabilities,openTool(@"capabilities"))
RIBBON_EXPORT(MathTypeBridgeRibbonInline,prepare(@"inline"))
RIBBON_EXPORT(MathTypeBridgeRibbonDisplay,prepare(@"display"))
RIBBON_EXPORT(MathTypeBridgeRibbonRight,prepare(@"numbered-right"))
RIBBON_EXPORT(MathTypeBridgeRibbonLeft,prepare(@"numbered-left"))
RIBBON_EXPORT(MathTypeBridgeRibbonNumber,prepare(@"inline",@"ribbon-number"))
RIBBON_EXPORT(MathTypeBridgeRibbonChapter,prepare(@"inline",@"ribbon-chapter"))
RIBBON_EXPORT(MathTypeBridgeCaptureDocument,captureDocument())
RIBBON_EXPORT(MathTypeBridgeClearDocumentContext,clearDocument())
RIBBON_EXPORT(MathTypeBridgeClearDocumentSelection,clearDocumentSelection())
RIBBON_EXPORT(MathTypeBridgeSelectDocumentEquation,selectDocumentEquation())
RIBBON_EXPORT(MathTypeBridgeCaptureTimingStart,([&](){if(!validHost())return -1;captureTiming={};captureTiming.started=CFAbsoluteTimeGetCurrent();return 0;})())
RIBBON_EXPORT(MathTypeBridgeCaptureTimingXMLReady,([&](){if(!validHost()||captureTiming.started<=0)return -1;captureTiming.xmlReady=CFAbsoluteTimeGetCurrent();return 0;})())
RIBBON_EXPORT(MathTypeBridgeCaptureTimingFileReady,([&](){if(!validHost()||captureTiming.started<=0||captureTiming.xmlReady<captureTiming.started)return -1;captureTiming.fileReady=CFAbsoluteTimeGetCurrent();return 0;})())
RIBBON_EXPORT(MathTypeBridgeEditGeneration,bridge_probe::diagnosticValue(static_cast<std::uint32_t>(bridge_probe::Metric::EditGeneration)))
RIBBON_EXPORT(MathTypeBridgeNewDocumentToken,EquationLabNewDocumentToken())
RIBBON_EXPORT(MathTypeBridgeTakeNavigation,([](){auto target=navigationTarget;navigationTarget=0;return target;})())
