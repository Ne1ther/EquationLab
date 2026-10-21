#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstdint>
#include <string>
#include <vector>

extern "C" std::int32_t MathTypeBridgeMathTypeRegistrationState();
extern "C" std::int32_t MathTypeBridgeWriteStartupReceipt();

namespace startup_receipt {
NSString* const CompiledHelperVersion=@"0.0.27";
enum : std::int32_t { WrongHost=-1,WrongThread=-4,NotRegistered=-6,InvalidContext=-7,ArtifactMismatch=-8,WriteFailure=-9,InvalidEnvironment=-10 };
struct Environment {
    bool wordHost;
    bool mainThread;
    std::int32_t registrationState;
    NSString* helperExecutable;
    std::int32_t wordPID;
    NSString* wordVersion;
    NSDate* now;
};
struct Descriptor {
    int value=-1;
    explicit Descriptor(int fd):value(fd){}
    ~Descriptor(){if(value>=0)close(value);}
    Descriptor(const Descriptor&)=delete;
    Descriptor& operator=(const Descriptor&)=delete;
};
bool text(id value,NSUInteger limit){return [value isKindOfClass:NSString.class]&&[value length]>0&&[value length]<=limit&&[value rangeOfCharacterFromSet:[NSCharacterSet characterSetWithRange:NSMakeRange(0,1)]].location==NSNotFound;}
NSData* boundedFile(int directory,const char* name,NSUInteger maximum){
    Descriptor file(openat(directory,name,O_RDONLY|O_CLOEXEC|O_NOFOLLOW));struct stat st{};
    if(file.value<0||fstat(file.value,&st)||!S_ISREG(st.st_mode)||st.st_size<1||static_cast<unsigned long long>(st.st_size)>maximum)return nil;
    NSMutableData* data=[NSMutableData dataWithLength:static_cast<NSUInteger>(st.st_size)];
    auto* bytes=static_cast<unsigned char*>(data.mutableBytes);std::size_t at=0;
    while(at<data.length){auto n=read(file.value,bytes+at,data.length-at);if(n<0&&errno==EINTR)continue;if(n<=0)return nil;at+=static_cast<std::size_t>(n);}
    return data;
}
NSString* sha256(NSData* data){
    if(!data||data.length>UINT32_MAX)return nil;unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,static_cast<CC_LONG>(data.length),digest);
    NSMutableString* result=[NSMutableString stringWithCapacity:64];for(unsigned char byte:digest)[result appendFormat:@"%02x",byte];return result;
}
bool hashText(id value){if(!text(value,64)||[value length]!=64)return false;return [value rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]].location==NSNotFound;}
NSDate* parseDate(NSString* value){
    NSISO8601DateFormatter* formatter=[NSISO8601DateFormatter new];formatter.formatOptions=NSISO8601DateFormatWithInternetDateTime|NSISO8601DateFormatWithFractionalSeconds;
    NSDate* result=[formatter dateFromString:value];if(!result){formatter.formatOptions=NSISO8601DateFormatWithInternetDateTime;result=[formatter dateFromString:value];}return result;
}
bool atomicReceipt(int startup,NSData* data){
    if(mkdirat(startup,".EquationLab",0700)&&errno!=EEXIST)return false;
    Descriptor directory(openat(startup,".EquationLab",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW));struct stat st{};
    if(directory.value<0||fstat(directory.value,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=geteuid())return false;
    if(fchmod(directory.value,0700))return false;
    if(fstatat(directory.value,"native-startup-receipt.json",&st,AT_SYMLINK_NOFOLLOW)==0&&!S_ISREG(st.st_mode))return false;
    NSString* temporary=[NSString stringWithFormat:@".native-startup-receipt.%@.tmp",NSUUID.UUID.UUIDString];
    Descriptor file(openat(directory.value,temporary.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600));if(file.value<0)return false;
    bool success=fchmod(file.value,0600)==0;auto* bytes=static_cast<const unsigned char*>(data.bytes);std::size_t at=0;
    while(success&&at<data.length){auto n=write(file.value,bytes+at,data.length-at);if(n<0&&errno==EINTR)continue;if(n<=0){success=false;break;}at+=static_cast<std::size_t>(n);}
    if(success)success=fsync(file.value)==0;
    if(success)success=renameat(directory.value,temporary.fileSystemRepresentation,directory.value,"native-startup-receipt.json")==0;
    if(!success)unlinkat(directory.value,temporary.fileSystemRepresentation,0);
    return success;
}
std::int32_t writeForEnvironment(const Environment& env){
    if(!env.wordHost)return WrongHost;if(!env.mainThread)return WrongThread;if(env.registrationState!=1)return NotRegistered;
    if(!text(env.helperExecutable,4096)||env.wordPID<=0||!text(env.wordVersion,64)||!env.now)return InvalidEnvironment;
    NSURL* executable=[[NSURL fileURLWithPath:env.helperExecutable] URLByResolvingSymlinksInPath];
    NSURL* macOS=executable.URLByDeletingLastPathComponent,*contents=macOS.URLByDeletingLastPathComponent,*bundle=contents.URLByDeletingLastPathComponent,*startup=bundle.URLByDeletingLastPathComponent;
    if(![executable.lastPathComponent isEqualToString:@"MathTypeBridgeProbe"]||![macOS.lastPathComponent isEqualToString:@"MacOS"]||![contents.lastPathComponent isEqualToString:@"Contents"]||![bundle.lastPathComponent isEqualToString:@"MathTypeBridgeProbe.bundle"])return InvalidEnvironment;
    Descriptor startupFD(open(startup.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW));if(startupFD.value<0)return InvalidEnvironment;
    NSData* rawContext=boundedFile(startupFD.value,"EquationLabInstallContext.json",32768);
    id context=rawContext?[NSJSONSerialization JSONObjectWithData:rawContext options:0 error:nullptr]:nil;
    if(![context isKindOfClass:NSDictionary.class]||![context[@"schema"] isEqual:@"equationlab.word-native-install-context.v1"]||!text(context[@"installId"],36)||![[NSUUID alloc] initWithUUIDString:context[@"installId"]]||!text(context[@"templateBuildId"],128)||!text(context[@"helperVersion"],32)||!text(context[@"installedAt"],64)||!hashText(context[@"templateSha256"]))return InvalidContext;
    NSDate* installed=parseDate(context[@"installedAt"]);if(!installed||[installed compare:env.now]==NSOrderedDescending)return InvalidContext;
    Descriptor contentsFD(open(contents.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW));
    NSData* plist=contentsFD.value>=0?boundedFile(contentsFD.value,"Info.plist",32768):nil;
    id info=plist?[NSPropertyListSerialization propertyListWithData:plist options:NSPropertyListImmutable format:nullptr error:nullptr]:nil;
    if(![info isKindOfClass:NSDictionary.class]||![info[@"CFBundleIdentifier"] isEqual:@"local.mathtypebridge.WordOLEProbe"]||![info[@"CFBundleExecutable"] isEqual:@"MathTypeBridgeProbe"]||![info[@"CFBundleShortVersionString"] isEqual:CompiledHelperVersion]||![CompiledHelperVersion isEqual:context[@"helperVersion"]])return ArtifactMismatch;
    NSString* templateHash=sha256(boundedFile(startupFD.value,"EquationLabStartup.dotm",32*1024*1024));
    Descriptor macOSFD(open(macOS.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW));
    NSString* binaryHash=macOSFD.value>=0?sha256(boundedFile(macOSFD.value,"MathTypeBridgeProbe",64*1024*1024)):nil;
    if(!templateHash||![templateHash isEqual:context[@"templateSha256"]]||!binaryHash)return ArtifactMismatch;
    NSISO8601DateFormatter* formatter=[NSISO8601DateFormatter new];formatter.formatOptions=NSISO8601DateFormatWithInternetDateTime|NSISO8601DateFormatWithFractionalSeconds;
    NSDictionary* receipt=@{@"schema":@"equationlab.word-native-startup-receipt.v1",@"entryPoint":@"AutoExec",@"installId":context[@"installId"],@"templateBuildId":context[@"templateBuildId"],@"helperVersion":info[@"CFBundleShortVersionString"],@"templateSha256":templateHash,@"helperPath":executable.path,@"helperSha256":binaryHash,@"wordPID":@(env.wordPID),@"wordVersion":env.wordVersion,@"registrationResult":@0,@"registrationState":@1,@"registeredCLSIDs":@[@"0002CE03-0000-0000-C000-000000000046",@"0002CE03-0000-0000-C000-000000000056"],@"timestamp":[formatter stringFromDate:env.now]};
    NSData* data=[NSJSONSerialization dataWithJSONObject:receipt options:NSJSONWritingSortedKeys error:nullptr];
    return data&&atomicReceipt(startupFD.value,data)?0:WriteFailure;
}
bool inWord(){std::uint32_t n=0;_NSGetExecutablePath(nullptr,&n);std::vector<char> path(n+1);return _NSGetExecutablePath(path.data(),&n)==0&&std::string(path.data()).ends_with("/Contents/MacOS/Microsoft Word");}
}

extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeWriteStartupReceipt(){@autoreleasepool{
    if(!startup_receipt::inWord())return startup_receipt::WrongHost;
    if(!NSThread.isMainThread)return startup_receipt::WrongThread;
    const auto state=MathTypeBridgeMathTypeRegistrationState();if(state!=1)return startup_receipt::NotRegistered;
    Dl_info image{};if(!dladdr(reinterpret_cast<void*>(&MathTypeBridgeWriteStartupReceipt),&image)||!image.dli_fname)return startup_receipt::InvalidEnvironment;
    NSString* path=[NSString stringWithUTF8String:image.dli_fname];
    return startup_receipt::writeForEnvironment({true,true,state,path,static_cast<std::int32_t>(getpid()),[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"],NSDate.date});
}}
