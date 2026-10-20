#include "storage_abi.hpp"
#include "ole_object_abi.hpp"
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <dlfcn.h>
#include <array>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <cstdlib>
#include <vector>
#include <unistd.h>
using namespace bridge_probe;
void runObjectTests(void*,const InteropHooks&,const std::vector<std::uint8_t>&,const std::vector<std::uint8_t>&,void*,void(*)(StgMedium*));
void runTransportTests(void*,const InteropHooks&,const std::vector<std::uint8_t>&,std::uint16_t,std::uint16_t);
void runMathTypeAliasTests(void*,void*,void*,void*,const InteropHooks&,const std::vector<std::uint8_t>&,const char*);
namespace {
template<class F> F symbol(void* h, const char* name) {
    auto p = reinterpret_cast<F>(dlsym(h, name));
    if (!p) throw std::runtime_error(std::string("Missing export: ") + name);
    return p;
}
PublicGetClassObject ownGetClass;
HResult(*createBytesApi)(void*,std::int32_t,LockBytes**)=nullptr;
HResult(*createStorageApi)(LockBytes*,std::uint32_t,std::uint32_t,Storage**)=nullptr;
void*(*createPictApi)(CFDataRef,CFTypeRef)=nullptr;
std::int32_t(*deletePictApi)(void*)=nullptr;
HResult createMemoryStorage(Storage** out){LockBytes* bytes=nullptr;auto hr=createBytesApi(nullptr,1,&bytes);if(hr<0)return hr;hr=createStorageApi(bytes,StorageCreateReadWriteExclusive,0,out);bytes->Release();return hr;}
void* createPictAdapter(const std::uint8_t* data,std::size_t size){auto pdf=CFDataCreate(kCFAllocatorDefault,data,static_cast<CFIndex>(size));auto pict=createPictApi(pdf,nullptr);CFRelease(pdf);return pict;}
void deletePictAdapter(void* pict){deletePictApi(pict);}
HResult classCallback(const Guid& clsid, const Guid& iid, void** out) { return ownGetClass(&clsid, &iid, out); }
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
}
int main(int argc, char** argv) {
    if (argc < 2) return 2;
    struct Cleanup {std::string path;~Cleanup(){if(!path.empty()){std::error_code ec;std::filesystem::remove_all(path,ec);}}} cleanup;
    try {
        std::cerr << "stage: load Office frameworks\n";
        const std::string prefix = "/Applications/Microsoft Word.app/Contents/Frameworks/";
        void* shim = dlopen((prefix + "WordSDKShim.framework/Versions/A/WordSDKShim").c_str(), RTLD_NOW | RTLD_LOCAL);
        if (!shim) throw std::runtime_error(dlerror());
        void* com = dlopen((prefix + "COMBase.framework/Versions/A/COMBase").c_str(), RTLD_NOW | RTLD_LOCAL);
        void* ole = dlopen((prefix + "OLE.framework/Versions/A/OLE").c_str(), RTLD_NOW | RTLD_LOCAL);
        void* kernel = dlopen((prefix + "WLMKernel.framework/Versions/A/WLMKernel").c_str(), RTLD_NOW | RTLD_LOCAL);
        void* graphics = dlopen((prefix + "WLMGraphicsDevice.framework/Versions/A/WLMGraphicsDevice").c_str(), RTLD_NOW | RTLD_LOCAL);
        require(com && ole && kernel && graphics, "Required Office framework load failed");
        auto initialize = symbol<HResult(*)(void*, std::uint32_t)>(com, "CoInitializeEx");
        auto uninitialize = symbol<void(*)()>(com, "CoUninitialize");
        auto freeMemory = symbol<void(*)(void*)>(com, "CoTaskMemFree");
        const bool isolatedWlm = argc > 2 && std::string(argv[2]) == "--isolated-wlm";
        std::string privateRegistryDirectory;
        if (isolatedWlm) {
            char pattern[] = "/tmp/native-word-probe.XXXXXX";
            auto* directory = mkdtemp(pattern);
            require(directory != nullptr, "Cannot create private temporary registry directory");
            privateRegistryDirectory = directory;
            cleanup.path=privateRegistryDirectory;
            auto path = privateRegistryDirectory + "/probe.reg";
            require(setenv("MS_GENERATE_REGISTRY_FILE", path.c_str(), 1) == 0, "Cannot select private WLM registry");
            std::cerr << "stage: isolated WLM runtime initialization; private registry=" << path << '\n';
            auto wlmInit = symbol<void(*)()>(kernel, "WlmKernel_FrameworkInit");
            wlmInit();
        }
        const bool testRegistration = isolatedWlm;
        if (testRegistration) {
            std::cerr << "stage: CoInitializeEx (known missing WLM host initialization)\n";
            require(initialize(nullptr, 2) >= 0, "Office COM initialize failed");
        }
        void* own = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
        require(own != nullptr, "Own bundle load failed");
        ownGetClass = symbol<PublicGetClassObject>(own, "MathTypeBridgeGetClassObject");
        auto registerClass = symbol<RegisterClassFactories>(shim, "RegisterDllGetClassObjectWithClassIDs_Shim");
        static Guid probeClass = ProbeClassId;
        static Guid* classList[]{&probeClass, nullptr};
        if (testRegistration) {
        std::cerr << "stage: register private class\n";
        registerClass(classCallback, classList);
        auto getClass = symbol<HResult(*)(const Guid&, std::uint32_t, void*, const Guid&, void**)>(com, "CoGetClassObject");
        void* factory = nullptr;
        std::cerr << "stage: CoGetClassObject\n";
        auto hr = getClass(ProbeClassId, 1, nullptr, ClassFactoryId, &factory);
        require(hr == Ok && factory, "Actual COMBase class-factory lookup failed");
        static_cast<ClassFactory*>(factory)->Release();
        std::cout << "{\"real_com_registration_and_lookup\":true";
        } else {
            (void)registerClass; (void)classList;
            std::cout << "{\"real_com_registration_and_lookup\":null,\"registration_test\":\"blocked_missing_WLM_host_initialization\"";
        }

        std::cerr << "stage: wide-character ABI\n";

        alignas(wchar_t) std::array<std::uint8_t, 512> guidText{};
        auto guidToString = symbol<int(*)(const Guid&, void*, int)>(com, "StringFromGUID2");
        auto textCount = guidToString(ProbeClassId, guidText.data(), 128);
        require(textCount > 0, "GUID string conversion failed");
        std::cerr << "GUID bytes:";
        for (int i = 0; i < 20; ++i) std::cerr << ' ' << static_cast<int>(guidText[i]);
        std::cerr << " count=" << textCount << '\n';
        bool wide16 = guidText[0] == '{' && guidText[1] == 0 && guidText[2] == '7' && guidText[3] == 0;
        require(wide16, "Mac Office wide character ABI is not verified as UTF-16");
        std::cout << ",\"mac_ole_wchar_bytes\":2";

        if(!isolatedWlm){std::cout<<",\"storage_and_pdf_not_run_without_isolated_WLM\":true,\"loaded_into_word\":false}\n";return 0;}

        auto createBytes = symbol<HResult(*)(void*, std::int32_t, LockBytes**)>(ole, "CreateILockBytesOnHGlobal");
        auto createStorage = symbol<HResult(*)(LockBytes*, std::uint32_t, std::uint32_t, Storage**)>(ole, "StgCreateDocfileOnILockBytes");
        createBytesApi=createBytes;createStorageApi=createStorage;
        std::cerr << "stage: structured storage ABI\n";
        LockBytes* bytes = nullptr;
        Storage* storage = nullptr;
        require(createBytes(nullptr, 1, &bytes) == Ok && bytes, "ILockBytes creation failed");
        require(createStorage(bytes, StorageCreateReadWriteExclusive, 0, &storage) == Ok && storage, "IStorage creation failed");
        std::vector<std::uint8_t> payload{0, 1, 2, 0x7f, 0x80, 0xfe, 0xff, 'x', '3'};
        if (argc > 3 && isolatedWlm) {
            std::ifstream input(argv[3], std::ios::binary);
            payload.assign(std::istreambuf_iterator<char>(input), {});
            require(!payload.empty(), "Native payload fixture is empty");
        }
        Stream* stream = nullptr;
        require(storage->CreateStream(u"Equation Native", StorageCreateReadWriteExclusive, 0, 0, &stream) == Ok && stream, "IStorage::CreateStream ABI failed");
        ULong written = 0;
        require(stream->Write(payload.data(), static_cast<ULong>(payload.size()), &written) == Ok && written == payload.size(), "IStream::Write ABI failed");
        StatStg stat{};
        require(stream->Stat(&stat, 1) == Ok && stat.type == 2 && stat.size.value == payload.size(), "STATSTG layout failed");
        ULargeInteger position{};
        require(stream->Seek(LargeInteger{0}, 0, &position) == Ok && position.value == 0, "IStream::Seek ABI failed");
        std::vector<std::uint8_t> copy(payload.size());
        ULong count = 0;
        require(stream->Read(copy.data(), static_cast<ULong>(copy.size()), &count) == Ok && copy == payload, "IStream::Read ABI failed");
        stream->Release();
        require(storage->SetClass(ProbeClassId) == Ok, "IStorage::SetClass ABI failed");
        require(storage->Commit(0) == Ok, "IStorage::Commit ABI failed");
        EnumStatStg* enumerator = nullptr;
        require(storage->EnumElements(0, nullptr, 0, &enumerator) == Ok && enumerator, "IEnumSTATSTG creation failed");
        StatStg entry{};
        ULong fetched = 0;
        require(enumerator->Next(1, &entry, &fetched) == Ok && fetched == 1 && entry.name && std::u16string(entry.name) == u"Equation Native" && entry.size.value == payload.size(), "IEnumSTATSTG ABI failed");
        freeMemory(entry.name);
        enumerator->Release();
        storage->Release();
        bytes->Release();
        std::cout << ",\"real_storage_vtables_and_utf16_names\":true,\"statstg_bytes\":" << sizeof(StatStg)
            << ",\"opaque_payload_roundtrip_bytes\":" << payload.size();

        CFMutableDataRef pdf = CFDataCreateMutable(kCFAllocatorDefault, 0);
        std::cerr << "stage: PDF metafile ABI\n";
        CGDataConsumerRef consumer = CGDataConsumerCreateWithCFData(pdf);
        CGRect box = CGRectMake(0, 0, 72, 36);
        CGContextRef context = CGPDFContextCreate(consumer, &box, nullptr);
        CGPDFContextBeginPage(context, nullptr);
        CGContextSetRGBStrokeColor(context, 0, 0, 0, 1);
        CGContextStrokeRect(context, CGRectMake(4, 4, 64, 28));
        CGPDFContextEndPage(context);
        CGPDFContextClose(context);
        CGContextRelease(context);
        CGDataConsumerRelease(consumer);
        auto createPict = symbol<void*(*)(CFDataRef, CFTypeRef)>(shim, "CreateMetafilePictWithPDFData_Shim");
        auto deletePict = symbol<std::int32_t(*)(void*)>(shim, "DeleteMetafilePict_Shim");
        createPictApi=createPict;deletePictApi=deletePict;
        auto globalLock = symbol<void*(*)(void*)>(kernel, "GlobalLock");
        auto globalUnlock = symbol<std::int32_t(*)(void*)>(kernel, "GlobalUnlock");
        auto globalSize = symbol<std::size_t(*)(void*)>(kernel, "GlobalSize");
        void* pict = createPict(pdf, nullptr);
        require(pict != nullptr && globalSize(pict) == 24, "PDF metafile-pict creation/layout failed");
        auto* p = static_cast<std::uint8_t*>(globalLock(pict));
        std::int32_t mode = 0, width = 0, height = 0;
        std::memcpy(&mode, p, 4); std::memcpy(&width, p + 4, 4); std::memcpy(&height, p + 8, 4);
        require(mode == 8 && width == 2540 && height == 1270, "PDF metafile-pict extents incorrect");
        globalUnlock(pict);
        require(deletePict(pict) != 0, "PDF metafile-pict deletion failed");
        InteropHooks api;
        api.allocate=symbol<void*(*)(std::size_t)>(com,"CoTaskMemAlloc");api.free=freeMemory;
        api.createPict=createPictAdapter;api.deletePict=deletePictAdapter;api.createStorage=createMemoryStorage;api.embedSourceFormat=0xc001;
        if(payload.size()>239){
            auto prepare=symbol<HResult(*)(void*,void*,void*,void*,void*)>(own,"MathTypeBridgePrepareInteropRuntime");
            require(prepare(shim,com,ole,graphics,kernel)==Ok,"Prepare actual Word interop adapters failed");
            std::cerr<<"stage: real Office OleLoad private-class activation\n";
            Storage* loadStorage=nullptr;require(createMemoryStorage(&loadStorage)==Ok,"OleLoad test storage");
            require(loadStorage->SetClass(ProbeClassId)==Ok,"OleLoad private storage class");
            Stream* loadStream=nullptr;require(loadStorage->CreateStream(u"Equation Native",StorageCreateReadWriteExclusive,0,0,&loadStream)==Ok,"OleLoad native stream");
            ULong loadWritten=0;require(loadStream->Write(payload.data(),static_cast<ULong>(payload.size()),&loadWritten)==Ok&&loadWritten==payload.size(),"OleLoad native stream write");loadStream->Release();
            auto oleLoad=symbol<HResult(*)(Storage*,const Guid&,OleClientSite*,void**)>(ole,"OleLoad");
            OleObject* loadedObject=nullptr;auto loadResult=oleLoad(loadStorage,OleObjectId,nullptr,reinterpret_cast<void**>(&loadedObject));
            std::cerr<<"OleLoad result: "<<std::hex<<static_cast<std::uint32_t>(loadResult)<<std::dec<<'\n';
            require(loadResult==Ok&&loadedObject,"Real OleLoad private class activation failed");
            PersistStorage* loadedPersist=nullptr;require(loadedObject->QueryInterface(PersistStorageId,reinterpret_cast<void**>(&loadedPersist))==Ok&&loadedPersist->IsDirty()==1,"Real OleLoad persistence not initialized");loadedPersist->Release();
            require(loadedObject->Close(1)==Ok,"Real OleLoad object Close failed");loadedObject->Release();loadStorage->Release();
            require(symbol<std::uint32_t(*)()>(own,"MathTypeBridgeLiveObjectCount")()==0,"Real OleLoad object did not release");
            std::cout<<",\"real_oleload_activates_private_class_and_persistence\":true";
            api.drawPict=symbol<decltype(api.drawPict)>(own,"MathTypeBridgeDrawPdf");
            std::vector<std::uint8_t> preview(CFDataGetBytePtr(pdf),CFDataGetBytePtr(pdf)+CFDataGetLength(pdf));
            std::vector<std::uint8_t> pixels(128*64*4,255);
            CGColorSpaceRef colorSpace=CGColorSpaceCreateDeviceRGB();
            auto bitmapInfo=static_cast<std::uint32_t>(kCGImageAlphaPremultipliedLast)|static_cast<std::uint32_t>(kCGBitmapByteOrder32Big);
            CGContextRef bitmap=CGBitmapContextCreate(pixels.data(),128,64,8,128*4,colorSpace,bitmapInfo);CGColorSpaceRelease(colorSpace);
            require(bitmap!=nullptr,"Drawing bitmap context creation failed");
            auto wrap=symbol<void*(*)(CGContextRef,const CGRect*,std::int32_t)>(graphics,"WrapContextEx");
            auto deleteDc=symbol<std::int32_t(*)(void*)>(graphics,"DeleteDC");
            CGRect deviceBounds=CGRectMake(0,0,128,64);CGContextRetain(bitmap);void* dc=wrap(bitmap,&deviceBounds,0);require(dc!=nullptr,"CGContext->WLM HDC wrapper failed");
            if(std::getenv("PROBE_CANCEL_SLOTS_ONLY"))std::cerr<<"stage: focused native-session cleanup lifecycle; unrelated legacy-x3 object suites skipped\n";
            else{
                std::cerr<<"stage: own OLE object vtables/lifecycles on real Office storage\n";
                runObjectTests(own,api,payload,preview,dc,symbol<void(*)(StgMedium*)>(ole,"ReleaseStgMedium"));
                if(!std::getenv("PROBE_OBJECT_TESTS_ONLY")){
                    auto cfbPath=(std::filesystem::path(argv[3]).parent_path()/"mathtype-original-x3-cfb.bin").string();
                    std::cerr<<"stage: explicit MathType Windows/Mac alias registration and original storage preservation\n";
                    runMathTypeAliasTests(own,shim,com,ole,api,payload,cfbPath.c_str());
                }
            }
            if(argc>4){
                auto port=std::stoul(argv[4]);require(port>0&&port<=65535,"Invalid test loopback port");
                std::cerr<<"stage: standalone native HTTP editing contract\n";
                auto controlPort=argc>5?std::stoul(argv[5]):0;require(controlPort<=65535,"Invalid control loopback port");
                runTransportTests(own,api,payload,static_cast<std::uint16_t>(port),static_cast<std::uint16_t>(controlPort));
            }
            if(std::getenv("PROBE_CANCEL_SLOTS_ONLY")){
                require(deleteDc(dc)!=0,"Focused test DeleteDC failed");
                require(CFGetRetainCount(bitmap)==1,"Focused test HDC ownership differs from expected");
                CGContextRelease(bitmap);CFRelease(pdf);
                std::cout<<",\"focused_native_session_cleanup\":true,\"loaded_into_word\":false}\n";
                if(testRegistration)uninitialize();
                if(!privateRegistryDirectory.empty())std::filesystem::remove_all(privateRegistryDirectory);
                return 0;
            }
            require(deleteDc(dc)!=0,"DeleteDC failed");
            require(CFGetRetainCount(bitmap)==1,"HDC ownership contract differs from expected");
            CGContextRelease(bitmap);
            std::size_t ink=0,outside=0;for(std::size_t y=0;y<64;++y)for(std::size_t x=0;x<128;++x){auto p=(y*128+x)*4;if(pixels[p]<200&&pixels[p+1]<200&&pixels[p+2]<200){++ink;if(x<16||x>=88||y<64-44||y>=64-8)++outside;}}
            require(ink>50&&outside==0,"Real IViewObject2::Draw did not stay inside requested bitmap bounds");
            std::cout<<",\"real_viewobject_draw_pixels\":"<<ink<<",\"draw_outside_requested_bounds\":"<<outside;
        }
        CFRelease(pdf);
        std::cout << ",\"real_pdf_metafile_wrapper\":true,\"metafile_pict_bytes\":24,\"himetric_extent\":[2540,1270],\"draw_callback_is_mock\":false,\"registered_mathtype\":true,\"registration_scope\":\"isolated_cli_process\",\"loaded_into_word\":false,\"windows_verified\":false}\n";
        if (testRegistration) uninitialize();
        if (!privateRegistryDirectory.empty()) std::filesystem::remove_all(privateRegistryDirectory);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
