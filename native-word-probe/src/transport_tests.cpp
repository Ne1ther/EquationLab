#include "editor_transport.hpp"
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
#include <memory>
#include <fstream>
#include <cstdlib>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
using namespace bridge_probe;
namespace {
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
template<class F> F resolve(void* bundle,const char* name){auto f=reinterpret_cast<F>(dlsym(bundle,name));if(!f)throw std::runtime_error(name);return f;}
std::uint32_t(*transportActive)()=nullptr;std::uint32_t(*documentCaptureAllowed)()=nullptr;
struct Site final:OleClientSite {
    ULong refs=1;int saves=0;bool wrongThread=false,captureReentryBlocked=false;PersistStorage* persist=nullptr;Storage* storage=nullptr;std::thread::id owner=std::this_thread::get_id();
    HResult QueryInterface(const Guid&,void** out)override{if(!out)return PointerError;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs;}ULong Release()override{return --refs;}
    HResult SaveObject()override{wrongThread=std::this_thread::get_id()!=owner;++saves;captureReentryBlocked=transportActive&&documentCaptureAllowed&&transportActive()>0&&documentCaptureAllowed()==0;auto hr=persist->Save(storage,1);return hr==Ok?persist->SaveCompleted(nullptr):hr;}
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
std::thread::id mainThread;std::string lastEditorUrl;std::uint32_t launches=0,wakes=0;std::uint16_t controlPort=0;
bool ownerAddressReuseObserved=false;
enum class WakeMode {Start,Cancel,Timeout};WakeMode wakeMode=WakeMode::Start;OleObject* cancelOnWake=nullptr;
std::string control(const char* command){
    int fd=socket(AF_INET,SOCK_STREAM,0);check(fd>=0,"control socket");timeval timeout{2,0};setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
    sockaddr_in address{};address.sin_family=AF_INET;address.sin_port=htons(controlPort);address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    if(connect(fd,reinterpret_cast<sockaddr*>(&address),sizeof(address))!=0){close(fd);check(false,"loopback test control unavailable");}
    std::string body=std::string("{\"command\":\"")+command+"\"}",request="POST /control HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "+std::to_string(body.size())+"\r\n\r\n"+body;
    auto sent=send(fd,request.data(),request.size(),0);std::string response;char buffer[4096];for(;;){auto got=recv(fd,buffer,sizeof(buffer),0);if(got<=0)break;response.append(buffer,static_cast<std::size_t>(got));}close(fd);
    check(sent==static_cast<ssize_t>(request.size())&&response.starts_with("HTTP/1.1 200"),"test control did not acknowledge service state");
    const auto separator=response.find("\r\n\r\n");
    check(separator!=std::string::npos,"test control response has no body");
    return response.substr(separator+4);
}
bool launch(const char* url,void*){check(std::this_thread::get_id()==mainThread,"launch callback is off owner thread");if(std::string(url)=="equationlab://wake"){++wakes;if(wakeMode==WakeMode::Start)control("start");else if(wakeMode==WakeMode::Cancel&&cancelOnWake)cancelOnWake->Close(1);return true;}check(std::string(url).starts_with("equationlab://word-edit/"),"transport invalid launch scheme");lastEditorUrl=url;++launches;return true;}
template<class Predicate>void spin(Predicate done){auto deadline=CFAbsoluteTimeGetCurrent()+8;while(!done()&&CFAbsoluteTimeGetCurrent()<deadline)CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.025,true);check(done(),"transport operation timed out");}
}
void runTransportTests(void* bundle,const InteropHooks& api,const std::vector<std::uint8_t>& native,std::uint16_t port,std::uint16_t controlServicePort){
    controlPort=controlServicePort;
    mainThread=std::this_thread::get_id();auto install=resolve<HResult(*)(std::uint16_t,LaunchEditorUrl,void*,std::uint32_t)>(bundle,"MathTypeBridgeInstallTransportForTesting");
    auto active=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeTransportActive");auto error=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeTransportLastError");
    transportActive=active;documentCaptureAllowed=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeDocumentCaptureAllowed");
    auto count=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeLiveObjectCount");auto getClass=resolve<PublicGetClassObject>(bundle,"MathTypeBridgeGetClassObject");
    auto setDocument=resolve<HResult(*)(const char*)>(bundle,"MathTypeBridgeSetTransportDocumentForTesting");
    auto ageDocument=resolve<HResult(*)(double)>(bundle,"MathTypeBridgeAgeTransportCaptureForTesting");
    auto clearDocuments=resolve<HResult(*)()>(bundle,"MathTypeBridgeClearTransportDocumentsForTesting");
    auto ownerIdentity=resolve<std::uint64_t(*)()>(bundle,"MathTypeBridgeLastOwnerIdentityForTesting");
    auto takeBackground=resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeTakeBackgroundSave");
    auto backgroundIndex=resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeBackgroundSaveIndex");
    auto failBackground=resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeFailBackgroundSave");
    auto configure=resolve<HResult(*)(const InteropHooks*,std::size_t)>(bundle,"MathTypeBridgeSetInteropHooks");
    check(configure(&api,sizeof(api))==Ok,"transport runtime hooks");
    auto reset=[&]{check(install(port,launch,nullptr,10)==Ok,"install test-only transport");};
    if(const char* documentPath=std::getenv("PROBE_NO_EVENT_DOCUMENT")){
        // Isolated regression: real owner/storage + real backend validation,
        // but no Word UI or selection events. A native write invalidates XML;
        // the next DoVerb must request fresh context instead of losing the list.
        std::ifstream input(documentPath,std::ios::binary);
        std::string document(std::istreambuf_iterator<char>(input),{});
        check(!document.empty()&&controlPort,"no-event document fixture/control");
        reset();check(setDocument(document.c_str())==Ok,"no-event initial document capture");
        TestObject test(getClass,api,native,26);
        test.begin();const auto firstOwner=ownerIdentity();
        spin([&]{return active()==0;});
        auto expected=test.original;expected[239]='4';
        check(test.saved()==expected&&test.site.saves==1&&!test.site.wrongThread&&error()==0,"no-event source was not saved to its real OLE storage");
        check(control("no-event-readback").find("\"fullDocumentCount\":30")!=std::string::npos,"no-event initial context was not validated as 30 formulas");
        // Do not call setDocument again: model no new SelectionChange or
        // BeforeDoubleClick capture. Keep the injected capture object but age
        // its real timestamp so the CLI no-context shortcut cannot mask the
        // production 0.5-second age gate and 1-second capture timeout.
        check(ageDocument(2)==Ok,"no-event capture age setup");
        const auto before=launches;const auto started=CFAbsoluteTimeGetCurrent();
        test.begin();const bool sameOwner=ownerIdentity()==firstOwner;
        bool answeredCapture=false;
        if(const char* refreshPath=std::getenv("PROBE_NO_EVENT_REFRESH_DOCUMENT")){
            auto take=resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeTakeDocumentCaptureRequest");
            std::int32_t token=0;spin([&]{return token||(token=take())>0;});
            check(take()==0,"no-event request was claimed more than once");
            check(resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeDocumentCaptureSnapshot")()==1234&&resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeDocumentCaptureIndex")()==13&&resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeDocumentCaptureIdentity")()==1,"no-event request lost its verified live document anchor");
            std::ifstream refreshInput(refreshPath,std::ios::binary);std::string refresh(std::istreambuf_iterator<char>(refreshInput),{});
            check(setDocument(refresh.c_str())==Ok,"no-event requested live capture response");
            check(launches==before,"capture response opened before request validation/commit");
            check(resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeFinishDocumentCaptureRequest")()==0,"no-event requested capture did not complete");
            answeredCapture=true;
        }
        spin([&]{return launches==before+1;});
        const auto captureState=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeDocumentCaptureState")();
        const auto readback=control("no-event-readback");
        std::cerr<<"NO_EVENT_CAPTURE_OBSERVATION {\"sameOwner\":"<<(sameOwner?"true":"false")<<",\"saveObjectCalls\":"<<test.site.saves<<",\"storedEditedNative\":"<<(test.saved()==expected?"true":"false")<<",\"newSelectionEvents\":0,\"requestedCaptureResponses\":"<<(answeredCapture?1:0)<<",\"captureAgeSeconds\":2,\"captureState\":"<<captureState<<",\"reopenSeconds\":"<<CFAbsoluteTimeGetCurrent()-started<<",\"backend\":"<<readback<<"}\n";
        check(sameOwner,"no-event reopen changed real OLE lifecycle owner");
        // Intentionally expect the required behavior. Helper17 currently fails
        // here; observing a one-item fallback must never turn this test green.
        check(readback.find("\"fullDocumentCount\":30")!=std::string::npos,"Saved same OLE owner reopened without full document context (expected 30 formulas)");
        test.object->Close(1);return;
    }
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
        TestObject test(getClass,api,native,7);auto before=launches;test.begin();spin([&]{return launches==before+1;});
        for(int i=0;i<30;i++){test.begin();spin([&]{return launches==before+2+i;});check(active()==1,"reopen must bring forward the same ticket without leaking sessions");}
        check(test.object->Close(1)==Ok&&active()==0,"pending poll not cancelled by Close");check(test.site.saves==0&&test.saved()==test.original&&test.site.refs==1,"close altered native bytes/site lifetime");
    }
    reset();{
        TestObject test(getClass,api,native,9);test.begin();check(test.object->Close(1)==Ok&&active()==0,"close before native-open reply leaves session");CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.1,false);check(test.site.saves==0&&test.saved()==test.original,"late reply reopened closed object");
    }
    reset();{
        TestObject stale(getClass,api,native,9),latest(getClass,api,native,7);auto before=launches;
        stale.begin();CFRunLoopRunInMode(kCFRunLoopDefaultMode,.08,false);latest.begin();
        spin([&]{return launches==before+1&&active()==1;});CFRunLoopRunInMode(kCFRunLoopDefaultMode,.3,false);
        check(launches==before+1&&stale.site.saves==0&&stale.saved()==stale.original,"late old open flashed over the latest Word selection");
        check(latest.object->Close(1)==Ok&&active()==0,"latest-activation test leaked an edit owner");
    }
    reset();{
        TestObject test(getClass,api,native,11);test.begin();spin([&]{return active()==0;});auto expected=test.original;expected[239]='4';check(test.site.saves==1&&test.saved()==expected,"transient poll retry failed");
    }
    for(auto marker:{16,17}){reset();{
        check(setDocument("{\"index\":0,\"identity\":\"test-doc:1\",\"snapshot\":1234,\"name\":\"test.docx\",\"ooxml\":\"ignored-by-mock\"}")==Ok,"background document setup");
        TestObject source(getClass,api,native,static_cast<std::uint8_t>(marker)),target(getClass,api,native,marker==16?21:22);auto before=launches;
        source.begin();spin([&]{return launches==before+1&&active()==0;});
        check(takeBackground()==1234&&backgroundIndex()==2,"background save lost live snapshot/index binding");
        check(source.site.saves==0&&source.saved()==source.original,"background save changed the previous owner");
        target.begin();check(active()==0&&launches==before+1,"background save opened another editor/ticket instead of committing to target");
        auto expected=target.original;if(marker==16)expected[239]='4';
        check(target.saved()==expected&&target.site.saves==(marker==16?1:0)&&!target.site.wrongThread,"background target hash guard/writeback failed");
        if(marker==16)check(target.site.captureReentryBlocked,"background SaveObject allowed reentrant WordOpenXML capture");
        check(failBackground()==0&&takeBackground()==0,"background save did not release its payload/binding");
        check(setDocument(nullptr)==Ok,"background document cleanup");
    }}
    reset();{
        check(setDocument("{\"index\":0,\"identity\":\"different-doc:1\",\"snapshot\":1234,\"name\":\"test.docx\",\"ooxml\":\"ignored-by-mock\"}")==Ok,"background alternate-document setup");
        TestObject source(getClass,api,native,16);source.begin();spin([&]{return active()==0;});
        check(takeBackground()==0&&source.site.saves==0&&source.saved()==source.original&&error()==2,"cross-document background target was accepted");
        check(setDocument(nullptr)==Ok,"background alternate-document cleanup");
    }
    reset();{
        check(setDocument("{\"index\":0,\"identity\":\"test-doc:1\",\"snapshot\":1233,\"name\":\"test.docx\",\"ooxml\":\"stale-mock\"}")==Ok,"late capture initial setup");
        TestObject source(getClass,api,native,23);auto start=CFAbsoluteTimeGetCurrent();source.begin();
        CFRunLoopRunInMode(kCFRunLoopDefaultMode,.15,false);
        check(active()==1&&source.site.saves==0,"stale context rejected the whole live edit before a fresh capture arrived");
        check(setDocument("{\"index\":0,\"identity\":\"test-doc:1\",\"snapshot\":1234,\"name\":\"test.docx\",\"ooxml\":\"fresh-mock\"}")==Ok,"late capture refreshed setup");
        spin([&]{return active()==0;});auto expected=source.original;expected[239]='4';
        check(source.site.saves==1&&source.saved()==expected&&CFAbsoluteTimeGetCurrent()-start<.8,"fresh document capture did not wake the pending edit promptly");
        check(setDocument(nullptr)==Ok,"late capture cleanup");
    }
    if(controlPort){
        reset();{
            const char* documentA="{\"index\":12,\"identity\":\"test-doc:1\",\"snapshot\":1234,\"name\":\"same-name.docx\",\"ooxml\":\"verified-context-A\"}";
            const char* documentB="{\"index\":12,\"identity\":\"other-doc:2\",\"snapshot\":2222,\"name\":\"same-name.docx\",\"ooxml\":\"verified-context-B\"}";
            TestObject oldDraft(getClass,api,native,7);oldDraft.begin();auto before=launches;spin([&]{return launches==before+1;});
            auto incoming=std::make_unique<TestObject>(getClass,api,native,25);
            check(setDocument(documentA)==Ok,"rejected incoming context seed");control("context-A");incoming->begin();auto firstOwner=ownerIdentity();before=launches;spin([&]{return launches==before+1;});
            // Reject incoming, cancel the preserved old draft, then reopen
            // the SAME real OLE owner. No selection/capture event is sent.
            control("cancel-editing");spin([&]{return active()==0;});check(ageDocument(2)==Ok,"age capture past the production 0.5 second gate");
            before=launches;incoming->begin();check(ownerIdentity()==firstOwner,"same OLE object changed lifecycle identity");spin([&]{return launches==before+1;});
            check(incoming->site.saves==0&&incoming->saved()==incoming->original,"rejected incoming reopen changed Word data");
            control("cancel-editing");spin([&]{return active()==0;});
            // Another same-Native owner and same file name get a separate
            // document binding; neither may borrow the other's context.
            auto other=std::make_unique<TestObject>(getClass,api,native,25);check(setDocument(documentB)==Ok,"same-name second document seed");control("context-B");before=launches;other->begin();check(ownerIdentity()!=firstOwner,"different OLE owners reused a lifecycle identity");spin([&]{return launches==before+1;});
            control("cancel-editing");spin([&]{return active()==0;});control("context-A");before=launches;incoming->begin();spin([&]{return launches==before+1;});control("cancel-editing");spin([&]{return active()==0;});
            check(ageDocument(2)==Ok,"age other document capture");control("context-A");before=launches;incoming->begin();spin([&]{return launches==before+1;});
            control("cancel-editing");spin([&]{return active()==0;});control("context-B");before=launches;other->begin();spin([&]{return launches==before+1;});control("cancel-editing");spin([&]{return active()==0;});
            // A document-clear explicitly invalidates every retained XML
            // snapshot, even though the OLE owner itself remains alive.
            check(clearDocuments()==Ok,"document clear invalidation");check(setDocument(documentB)==Ok,"foreign fresh context after clear");control("context-B");before=launches;incoming->begin();spin([&]{return active()==0;});
            check(launches==before&&error()==2&&incoming->saved()==incoming->original,"known owner accepted another same-Native document after its XML cache was cleared");
            check(clearDocuments()==Ok,"clear foreign context age");control("context-none");before=launches;incoming->begin();spin([&]{return launches==before+1;});control("cancel-editing");spin([&]{return active()==0;});
            check(setDocument(documentA)==Ok,"recapture before native write");control("context-A");before=launches;incoming->begin();spin([&]{return launches==before+1;});control("cancel-editing");spin([&]{return active()==0;});
            {TestObject changed(getClass,api,native,1);changed.begin();spin([&]{return active()==0;});check(changed.site.saves==1,"write-generation invalidation setup");}
            check(ageDocument(2)==Ok,"age capture after a different formula was saved");control("context-none");before=launches;incoming->begin();spin([&]{return active()==0;});
            check(launches==before&&error()==2&&resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeDocumentCaptureState")()==3,"missing requested capture silently downgraded or left an edit busy");
            check(resolve<std::int32_t(*)()>(bundle,"MathTypeBridgeTakeDocumentCaptureRequest")()==0,"timed-out document request stayed pending");
            check(setDocument(documentA)==Ok,"recapture before owner release");control("context-A");before=launches;incoming->begin();spin([&]{return launches==before+1;});control("cancel-editing");spin([&]{return active()==0;});
            auto oldAddress=reinterpret_cast<std::uintptr_t>(incoming->object);incoming.reset();check(ageDocument(2)==Ok,"age capture before new object lifetime");control("context-none");
            bool reusedAddress=false;
            for(unsigned cycle=0;cycle<16&&!reusedAddress;cycle++){
                TestObject replacement(getClass,api,native,25);before=launches;replacement.begin();check(ownerIdentity()!=firstOwner,"released owner identity reused by a replacement object");spin([&]{return launches==before+1;});reusedAddress=reinterpret_cast<std::uintptr_t>(replacement.object)==oldAddress;control("cancel-editing");spin([&]{return active()==0;});
            }
            ownerAddressReuseObserved=reusedAddress;check(setDocument(nullptr)==Ok&&clearDocuments()==Ok,"owner cache test cleanup");control("context-any");
        }
        reset();{
            TestObject test(getClass,api,native,7);auto before=launches;test.begin();spin([&]{return launches==before+1;});
            auto oldUrl=lastEditorUrl;control("cancel-editing");test.begin();
            spin([&]{return launches==before+2;});
            check(lastEditorUrl!=oldUrl&&active()==1&&test.site.saves==0,"cancel then immediate activation reused a terminal ticket or wrong owner");
            check(test.object->Close(1)==Ok&&active()==0&&test.site.refs==1&&test.saved()==test.original,"cancel/reopen race leaked or changed Word storage");
        }
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
    std::cout<<",\"native_http_owner_address_reuse_observed\":"<<(ownerAddressReuseObserved?"true":"false");
    std::cout<<",\"native_http_rejected_incoming_cancel_reopen_retains_verified_context\":true,\"native_http_owner_context_rejects_other_owner_same_native_same_name\":true,\"native_http_owner_context_clear_and_write_invalidate\":true,\"native_http_owner_identity_not_an_address\":true,\"native_http_latest_activation_rejects_late_old_open\":true,\"native_http_late_document_capture_replaces_stale_selection\":true,\"native_http_background_target_save_no_editor_relaunch\":true,\"native_http_background_target_hash_guard\":true,\"native_http_background_cross_document_rejected\":true,\"native_http_edit_save_on_owner_thread\":true,\"native_http_reopen_same_ticket_cycles\":30,\"native_http_cancel_then_immediate_reopen_fresh_ticket\":true,\"native_http_cancel_preserves_original\":true,\"native_http_malformed_reply_rejected\":true,\"native_http_duplicate_ticket_isolated\":true,\"native_http_close_cancels_requests\":true,\"native_http_transient_poll_retry\":true,\"native_http_tests_use_mock_url_launcher\":true";
}
