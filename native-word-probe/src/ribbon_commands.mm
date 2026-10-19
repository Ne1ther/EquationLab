#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstdint>
#include <string>

extern "C" std::int32_t MathTypeBridgeMathTypeRegistrationState();
extern "C" std::int32_t MathTypeBridgeRibbonOpen();
namespace { NSDictionary* pendingDocument; std::int32_t navigationTarget=0; }
// Word owns this snapshot while the object remains selected. Selection/document
// events invalidate it; repeated OLE activation must not consume it once.
NSDictionary* EquationLabCapturedDocumentContext(){return pendingDocument;}
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
    NSURL* app=[NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:@"app.equationlab.mac"];
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
std::int32_t captureDocument(){
    if(!validHost())return -1;pendingDocument=nil;
    NSURL* directory=[startupDirectory() URLByAppendingPathComponent:@".EquationLab"];
    NSData* data=inputFile(directory,@"document-context.txt");
    if(!data)return -2;
    unlink([directory URLByAppendingPathComponent:@"document-context.txt"].fileSystemRepresentation);
    NSString* text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSRange first=[text rangeOfString:@"\n"];if(!text||first.location==NSNotFound)return -3;
    NSRange second=[text rangeOfString:@"\n" options:0 range:NSMakeRange(NSMaxRange(first),text.length-NSMaxRange(first))];if(second.location==NSNotFound)return -3;
    NSString* index=[text substringToIndex:first.location];NSScanner* scanner=[NSScanner scannerWithString:index];NSInteger number=-1;
    if(![scanner scanInteger:&number]||!scanner.isAtEnd||number<0||number>10000)return -3;
    pendingDocument=@{@"index":@(number),@"name":[text substringWithRange:NSMakeRange(NSMaxRange(first),second.location-NSMaxRange(first))],@"ooxml":[text substringFromIndex:NSMaxRange(second)]};
    return 0;
}
std::int32_t clearDocument(){if(!validHost())return -1;pendingDocument=nil;return 0;}
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
RIBBON_EXPORT(MathTypeBridgeTakeNavigation,([](){auto target=navigationTarget;navigationTarget=0;return target;})())
