#include "editor_transport.hpp"
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
using namespace bridge_probe;
namespace {
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
template<class F> F resolve(void* bundle,const char* name){auto f=reinterpret_cast<F>(dlsym(bundle,name));if(!f)throw std::runtime_error(name);return f;}
struct Site final:OleClientSite {
    ULong refs=1;int saves=0;bool wrongThread=false;PersistStorage* persist=nullptr;Storage* storage=nullptr;std::thread::id owner=std::this_thread::get_id();
    HResult QueryInterface(const Guid&,void** out)override{if(!out)return PointerError;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs;}ULong Release()override{return --refs;}
    HResult SaveObject()override{wrongThread=std::this_thread::get_id()!=owner;++saves;auto hr=persist->Save(storage,1);return hr==Ok?persist->SaveCompleted(nullptr):hr;}
    HResult GetMoniker(std::uint32_t,std::uint32_t,Unknown** out)override{if(out)*out=nullptr;return NotImplemented;}
    HResult GetContainer(Unknown** out)override{if(out)*out=nullptr;return NotImplemented;}
    HResult ShowObject()override{return Ok;}HResult OnShowWindow(std::int32_t)override{return Ok;}HResult RequestNewObjectLayout()override{return Ok;}
};
struct TestObject {
    OleObject* object=nullptr;PersistStorage* persist=nullptr;Storage* storage=nullptr;Site site;
    std::vector<std::uint8_t> original;
    TestObject(PublicGetClassObject getClass,const InteropHooks& api,const std::vector<std::uint8_t>& source,std::uint8_t marker):original(source){
        original[27]=marker;ClassFactory* factory=nullptr;
        check(getClass(&ProbeClassId,&ClassFactoryId,reinterpret_cast<void**>(&factory))==Ok,"transport factory");
        check(factory->CreateInstance(nullptr,OleObjectId,reinterpret_cast<void**>(&object))==Ok,"transport object");factory->Release();
        check(object->QueryInterface(PersistStorageId,reinterpret_cast<void**>(&persist))==Ok,"transport persistence");
        check(api.createStorage(&storage)==Ok&&storage->SetClass(ProbeClassId)==Ok,"transport storage");
        Stream* stream=nullptr;check(storage->CreateStream(u"Equation Native",StorageCreateReadWriteExclusive,0,0,&stream)==Ok,"transport native stream");
        ULong written=0;check(stream->Write(original.data(),static_cast<ULong>(original.size()),&written)==Ok&&written==original.size(),"transport native write");stream->Release();
        check(persist->Load(storage)==Ok,"transport native load");site.persist=persist;site.storage=storage;
    }
    void begin(){check(object->DoVerb(0,nullptr,&site,0,nullptr,nullptr)==Ok,"transport DoVerb asynchronous start");}
    std::vector<std::uint8_t> saved(){Stream* stream=nullptr;check(storage->OpenStream(u"Equation Native",nullptr,StorageReadExclusive,0,&stream)==Ok,"transport saved stream");StatStg stat{};check(stream->Stat(&stat,1)==Ok,"transport saved stat");std::vector<std::uint8_t> bytes(stat.size.value);ULong read=0;auto hr=stream->Read(bytes.data(),static_cast<ULong>(bytes.size()),&read);stream->Release();check(hr>=0&&read==bytes.size(),"transport saved read");return bytes;}
    ~TestObject(){if(object)object->Close(1);if(persist)persist->Release();if(object)object->Release();if(storage)storage->Release();}
};
std::thread::id mainThread;std::uint32_t launches=0,wakes=0;std::uint16_t controlPort=0;
enum class WakeMode {Start,Cancel,Timeout};WakeMode wakeMode=WakeMode::Start;OleObject* cancelOnWake=nullptr;
void control(const char* command){
    int fd=socket(AF_INET,SOCK_STREAM,0);check(fd>=0,"control socket");timeval timeout{2,0};setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
    sockaddr_in address{};address.sin_family=AF_INET;address.sin_port=htons(controlPort);address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    if(connect(fd,reinterpret_cast<sockaddr*>(&address),sizeof(address))!=0){close(fd);check(false,"loopback test control unavailable");}
    std::string body=std::string("{\"command\":\"")+command+"\"}",request="POST /control HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "+std::to_string(body.size())+"\r\n\r\n"+body;
    auto sent=send(fd,request.data(),request.size(),0);std::string response;char buffer[4096];for(;;){auto got=recv(fd,buffer,sizeof(buffer),0);if(got<=0)break;response.append(buffer,static_cast<std::size_t>(got));}close(fd);
    check(sent==static_cast<ssize_t>(request.size())&&response.starts_with("HTTP/1.1 200"),"test control did not acknowledge service state");
}
bool launch(const char* url,void*){check(std::this_thread::get_id()==mainThread,"launch callback is off owner thread");if(std::string(url)=="equationlab://wake"){++wakes;if(wakeMode==WakeMode::Start)control("start");else if(wakeMode==WakeMode::Cancel&&cancelOnWake)cancelOnWake->Close(1);return true;}check(std::string(url).starts_with("equationlab://word-edit/"),"transport invalid launch scheme");++launches;return true;}
template<class Predicate>void spin(Predicate done){auto deadline=CFAbsoluteTimeGetCurrent()+8;while(!done()&&CFAbsoluteTimeGetCurrent()<deadline)CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.025,true);check(done(),"transport operation timed out");}
}
void runTransportTests(void* bundle,const InteropHooks& api,const std::vector<std::uint8_t>& native,std::uint16_t port,std::uint16_t controlServicePort){
    controlPort=controlServicePort;
    mainThread=std::this_thread::get_id();auto install=resolve<HResult(*)(std::uint16_t,LaunchEditorUrl,void*,std::uint32_t)>(bundle,"MathTypeBridgeInstallTransportForTesting");
    auto active=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeTransportActive");auto error=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeTransportLastError");
    auto count=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeLiveObjectCount");auto getClass=resolve<PublicGetClassObject>(bundle,"MathTypeBridgeGetClassObject");
    auto configure=resolve<HResult(*)(const InteropHooks*,std::size_t)>(bundle,"MathTypeBridgeSetInteropHooks");
    check(configure(&api,sizeof(api))==Ok,"transport runtime hooks");
    auto reset=[&]{check(install(port,launch,nullptr,10)==Ok,"install test-only transport");};
    reset();{
        TestObject test(getClass,api,native,1);test.begin();check(active()==1&&test.site.saves==0,"DoVerb unexpectedly blocks for HTTP");spin([&]{return active()==0;});
        auto expected=test.original;expected[239]='4';check(test.saved()==expected&&test.site.saves==1&&!test.site.wrongThread&&error()==0,"HTTP result was not saved on OLE owner thread");
        SizeL extent{};check(test.object->GetExtent(1,&extent)==Ok&&extent.width==2540&&extent.height==1270,"transport HIMETRIC extent");
    }
    const std::pair<std::uint8_t,std::uint32_t> failureCases[]={{2,0},{3,2},{4,2},{5,2},{8,1},{10,2}};
    for(auto [marker,expectedError]:failureCases){reset();TestObject test(getClass,api,native,marker);test.begin();spin([&]{return active()==0;});check(test.site.saves==0&&test.saved()==test.original&&error()==expectedError,"cancel/malformed transport modified original storage");}
    reset();{
        TestObject first(getClass,api,native,6),second(getClass,api,native,6);auto before=launches;first.begin();spin([&]{return launches==before+1;});second.begin();spin([&]{return active()==1&&error()==2;});
        check(first.saved()==first.original&&second.saved()==second.original,"duplicate ticket mixed object data");check(first.object->Close(1)==Ok&&active()==0,"close failed to cancel first session");
    }
    reset();{
        TestObject test(getClass,api,native,7);auto before=launches;test.begin();spin([&]{return launches==before+1;});check(test.object->Close(1)==Ok&&active()==0,"pending poll not cancelled by Close");check(test.site.saves==0&&test.saved()==test.original&&test.site.refs==1,"close altered native bytes/site lifetime");
    }
    reset();{
        TestObject test(getClass,api,native,9);test.begin();check(test.object->Close(1)==Ok&&active()==0,"close before native-open reply leaves session");CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.1,false);check(test.site.saves==0&&test.saved()==test.original,"late reply reopened closed object");
    }
    reset();{
        TestObject test(getClass,api,native,11);test.begin();spin([&]{return active()==0;});auto expected=test.original;expected[239]='4';check(test.site.saves==1&&test.saved()==expected,"transient poll retry failed");
    }
    if(controlPort){
        check(wakes==0,"online service/protocol failures unexpectedly launched wake URL");
        control("stop");reset();{
            TestObject test(getClass,api,native,12);wakeMode=WakeMode::Start;auto before=wakes;test.begin();spin([&]{return active()==0;});auto expected=test.original;expected[239]='4';check(wakes==before+1&&test.site.saves==1&&test.saved()==expected&&error()==0,"connection-refused wake/retry did not save normally");
        }
        control("stop");reset();{
            TestObject test(getClass,api,native,13);wakeMode=WakeMode::Cancel;cancelOnWake=test.object;auto before=wakes;test.begin();spin([&]{return active()==0;});cancelOnWake=nullptr;CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.1,false);check(wakes==before+1&&test.site.saves==0&&test.saved()==test.original,"close during wake leaked/applied stale request");
        }
        reset();{
            TestObject test(getClass,api,native,14);wakeMode=WakeMode::Timeout;auto before=wakes;auto start=CFAbsoluteTimeGetCurrent();test.begin();spin([&]{return active()==0;});check(wakes==before+1&&error()==1&&test.site.saves==0&&test.saved()==test.original&&CFAbsoluteTimeGetCurrent()-start<4,"wake service-not-ready retries were not bounded");
        }
        control("start");reset();{
            TestObject test(getClass,api,native,15);auto before=wakes;test.begin();spin([&]{return active()==0;});check(wakes==before&&error()==1&&test.site.saves==0&&test.saved()==test.original,"occupied HTTP endpoint triggered wake or changed source");
        }
        std::cout<<",\"native_http_connection_refused_wakes_once\":true,\"native_http_wake_close_preserves_original\":true,\"native_http_wake_retry_bounded\":true,\"native_http_4xx_does_not_wake\":true";
    }
    check(count()==0&&active()==0,"transport sessions/objects leak");
    std::cout<<",\"native_http_edit_save_on_owner_thread\":true,\"native_http_cancel_preserves_original\":true,\"native_http_malformed_reply_rejected\":true,\"native_http_duplicate_ticket_isolated\":true,\"native_http_close_cancels_requests\":true,\"native_http_transient_poll_retry\":true,\"native_http_tests_use_mock_url_launcher\":true";
}
