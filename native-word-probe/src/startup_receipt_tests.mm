#include "startup_receipt.mm"
#include <iostream>
#include <stdexcept>
#include <functional>

extern "C" std::int32_t MathTypeBridgeMathTypeRegistrationState(){return 0;}
namespace {
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
void put(NSString* path,NSData* bytes){check([bytes writeToFile:path options:NSDataWritingAtomic error:nullptr],"fixture write failed");}
NSData* json(id object){return [NSJSONSerialization dataWithJSONObject:object options:0 error:nullptr];}
NSData* data(NSString* text){return [text dataUsingEncoding:NSUTF8StringEncoding];}
struct Fixture {
    NSString* root;
    NSString* startup;
    NSString* executable;
    NSString* plist;
    NSString* templatePath;
    NSString* contextPath;
    NSString* receiptPath;
    NSData* binary=data(@"nonexecutable own receipt fixture 0.0.5");
    NSData* templateBytes=data(@"nonexecutable own template fixture; not a Word acceptance artifact");
    NSMutableDictionary* context;
    NSDate* now=startup_receipt::parseDate(@"2026-10-14T08:00:00.000Z");
    Fixture(){
        root=[NSTemporaryDirectory() stringByAppendingPathComponent:[@"equationlab-startup-receipt-" stringByAppendingString:NSUUID.UUID.UUIDString]];
        startup=[root stringByAppendingPathComponent:@"Word Startup Unicode 公式"];
        NSString* bundle=[startup stringByAppendingPathComponent:@"MathTypeBridgeProbe.bundle"],*macOS=[bundle stringByAppendingPathComponent:@"Contents/MacOS"];
        check([NSFileManager.defaultManager createDirectoryAtPath:macOS withIntermediateDirectories:YES attributes:nil error:nullptr],"fixture directories");
        executable=[macOS stringByAppendingPathComponent:@"MathTypeBridgeProbe"];plist=[bundle stringByAppendingPathComponent:@"Contents/Info.plist"];
        templatePath=[startup stringByAppendingPathComponent:@"EquationLabStartup.dotm"];contextPath=[startup stringByAppendingPathComponent:@"EquationLabInstallContext.json"];receiptPath=[startup stringByAppendingPathComponent:@".EquationLab/native-startup-receipt.json"];
        context=[@{@"schema":@"equationlab.word-native-install-context.v1",@"installId":@"0d77c2bd-03f4-4e14-97ad-a7030e198412",@"installedAt":@"2026-10-14T07:00:00.000Z",@"templateBuildId":@"own-fixture-build",@"templateSha256":startup_receipt::sha256(templateBytes),@"helperVersion":startup_receipt::CompiledHelperVersion,@"receiptPath":receiptPath} mutableCopy];
        put(executable,binary);put(templatePath,templateBytes);saveInfo(startup_receipt::CompiledHelperVersion);saveContext();
    }
    ~Fixture(){[NSFileManager.defaultManager removeItemAtPath:root error:nullptr];}
    startup_receipt::Environment environment(){return {true,true,1,executable,static_cast<std::int32_t>(getpid()),@"16.fixture",now};}
    void saveInfo(NSString* version){NSDictionary* info=@{@"CFBundleIdentifier":@"local.mathtypebridge.WordOLEProbe",@"CFBundleExecutable":@"MathTypeBridgeProbe",@"CFBundleShortVersionString":version};put(plist,[NSPropertyListSerialization dataWithPropertyList:info format:NSPropertyListXMLFormat_v1_0 options:0 error:nullptr]);}
    void saveContext(){put(contextPath,json(context));}
    void unchangedFailure(std::int32_t expected,const std::function<void()>& change,const std::function<void()>& restore){
        NSData* before=[NSData dataWithContentsOfFile:receiptPath];change();check(startup_receipt::writeForEnvironment(environment())==expected,"failure result mismatch");check([[NSData dataWithContentsOfFile:receiptPath] isEqual:before],"failure changed existing receipt");restore();
    }
};
}
int main(){@autoreleasepool{try{
    check(MathTypeBridgeWriteStartupReceipt()==startup_receipt::WrongHost,"public outside-Word guard");
    Fixture f;auto env=f.environment();env.wordHost=false;check(startup_receipt::writeForEnvironment(env)==-1,"host guard");env=f.environment();env.mainThread=false;check(startup_receipt::writeForEnvironment(env)==-4,"thread guard");env=f.environment();env.registrationState=0;check(startup_receipt::writeForEnvironment(env)==-6,"registration guard");
    check(![NSFileManager.defaultManager fileExistsAtPath:f.receiptPath],"guard created a receipt");
    check(startup_receipt::writeForEnvironment(f.environment())==0,"valid fixture receipt failed");
    NSDictionary* r=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:f.receiptPath] options:0 error:nullptr];
    check([r[@"schema"] isEqual:@"equationlab.word-native-startup-receipt.v1"]&&[r[@"entryPoint"] isEqual:@"AutoExec"]&&[r[@"installId"] isEqual:f.context[@"installId"]]&&[r[@"templateBuildId"] isEqual:f.context[@"templateBuildId"]],"receipt context identity");
    check([r[@"helperVersion"] isEqual:startup_receipt::CompiledHelperVersion]&&[r[@"helperSha256"] isEqual:startup_receipt::sha256(f.binary)]&&[r[@"templateSha256"] isEqual:startup_receipt::sha256(f.templateBytes)]&&[r[@"wordPID"] intValue]==getpid()&&[r[@"wordVersion"] isEqual:@"16.fixture"]&&[r[@"registrationState"] intValue]==1&&[r[@"registrationResult"] intValue]==0&&[r[@"registeredCLSIDs"] count]==2,"receipt actual metadata");
    struct stat st{};check(stat(f.receiptPath.fileSystemRepresentation,&st)==0&&(st.st_mode&0777)==0600,"receipt must be0600");
    NSDictionary* original=[f.context copy];
    const std::pair<NSString*,id> invalid[]={{@"schema",@"wrong"},{@"installId",@"invalid"},{@"templateBuildId",@""},{@"installedAt",@"2027-01-01T00:00:00.000Z"}};
    for(auto [key,value]:invalid)f.unchangedFailure(-7,[&]{f.context[key]=value;f.saveContext();},[&]{f.context=[original mutableCopy];f.saveContext();});
    f.unchangedFailure(-7,[&]{[NSFileManager.defaultManager removeItemAtPath:f.contextPath error:nullptr];},[&]{f.saveContext();});
    f.unchangedFailure(-7,[&]{put(f.contextPath,data(@"{"));},[&]{f.saveContext();});
    f.unchangedFailure(-8,[&]{f.context[@"helperVersion"]=@"0.0.4";f.saveContext();},[&]{f.context=[original mutableCopy];f.saveContext();});
    f.unchangedFailure(-8,[&]{f.saveInfo(@"999.0.0");f.context[@"helperVersion"]=@"999.0.0";f.saveContext();},[&]{f.saveInfo(startup_receipt::CompiledHelperVersion);f.context=[original mutableCopy];f.saveContext();});
    f.unchangedFailure(-8,[&]{put(f.templatePath,data(@"changed template"));},[&]{put(f.templatePath,f.templateBytes);});
    f.unchangedFailure(-8,[&]{[NSFileManager.defaultManager removeItemAtPath:f.executable error:nullptr];},[&]{put(f.executable,f.binary);});
    NSString* redirect=[f.root stringByAppendingPathComponent:@"unrelated-receipt.json"];f.context[@"receiptPath"]=redirect;f.saveContext();check(startup_receipt::writeForEnvironment(f.environment())==0&&![NSFileManager.defaultManager fileExistsAtPath:redirect],"untrusted receiptPath used");f.context=[original mutableCopy];f.saveContext();
    NSData* before=[NSData dataWithContentsOfFile:f.receiptPath];[NSFileManager.defaultManager removeItemAtPath:f.receiptPath error:nullptr];put(redirect,data(@"preserve this unrelated file"));check(symlink(redirect.fileSystemRepresentation,f.receiptPath.fileSystemRepresentation)==0,"receipt symlink fixture");check(startup_receipt::writeForEnvironment(f.environment())==-9&&[[NSData dataWithContentsOfFile:redirect] isEqual:data(@"preserve this unrelated file")],"receipt symlink followed");unlink(f.receiptPath.fileSystemRepresentation);put(f.receiptPath,before);
    NSString* receiptDir=[f.receiptPath stringByDeletingLastPathComponent],*retained=[f.root stringByAppendingPathComponent:@"retained-receipts"],*outside=[f.root stringByAppendingPathComponent:@"unrelated-directory"];
    check([NSFileManager.defaultManager moveItemAtPath:receiptDir toPath:retained error:nullptr]&&[NSFileManager.defaultManager createDirectoryAtPath:outside withIntermediateDirectories:YES attributes:nil error:nullptr],"directory symlink setup");check(symlink(outside.fileSystemRepresentation,receiptDir.fileSystemRepresentation)==0,"directory symlink fixture");check(startup_receipt::writeForEnvironment(f.environment())==-9&&[NSFileManager.defaultManager contentsOfDirectoryAtPath:outside error:nullptr].count==0,"directory symlink followed");unlink(receiptDir.fileSystemRepresentation);check([NSFileManager.defaultManager moveItemAtPath:retained toPath:receiptDir error:nullptr],"restore receipt directory");
    env=f.environment();env.wordVersion=nil;check(startup_receipt::writeForEnvironment(env)==-10,"missing Word version accepted");
    env=f.environment();env.helperExecutable=[f.executable stringByAppendingString:@"-wrong"];check(startup_receipt::writeForEnvironment(env)==-10,"wrong helper path accepted");
    check(startup_receipt::writeForEnvironment(f.environment())==0,"atomic replacement failed");check([NSFileManager.defaultManager contentsOfDirectoryAtPath:receiptDir error:nullptr].count==1,"temporary receipt leaked");
    std::cout<<"{\"public_outside_word_guard\":true,\"injected_host_thread_registration_guards\":true,\"context_and_compiled_version_bound\":true,\"template_and_helper_file_hashes\":true,\"atomic_receipt_mode0600\":true,\"failure_preserves_previous_receipt\":true,\"untrusted_receipt_path_ignored\":true,\"file_and_directory_symlinks_rejected\":true,\"unicode_startup_path\":true,\"temporary_files_cleaned\":true,\"test_metadata_environment_injected\":true,\"real_word_or_install_used\":false}\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}}
