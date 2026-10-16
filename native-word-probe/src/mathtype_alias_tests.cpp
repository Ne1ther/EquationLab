#include "ole_object_abi.hpp"
#include <dlfcn.h>
#include <fstream>
#include <iostream>
#include <map>
#include <stdexcept>
#include <vector>
using namespace bridge_probe;
namespace {
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
template<class F>F symbol(void* handle,const char* name){auto f=reinterpret_cast<F>(dlsym(handle,name));if(!f)throw std::runtime_error(name);return f;}
using Streams=std::map<std::u16string,std::vector<std::uint8_t>>;
std::vector<std::uint8_t> read(Storage* storage,const char16_t* name){Stream* s=nullptr;check(storage->OpenStream(name,nullptr,StorageReadExclusive,0,&s)==Ok,"alias OpenStream");StatStg stat{};check(s->Stat(&stat,1)==Ok,"alias stream Stat");std::vector<std::uint8_t> bytes(stat.size.value);ULong got=0;auto hr=s->Read(bytes.data(),static_cast<ULong>(bytes.size()),&got);s->Release();check(hr>=0&&got==bytes.size(),"alias Read");return bytes;}
void write(Storage* storage,const char16_t* name,const std::vector<std::uint8_t>& bytes){Stream* s=nullptr;check(storage->CreateStream(name,StorageCreateReadWriteExclusive,0,0,&s)==Ok,"alias CreateStream");ULong done=0;auto hr=s->Write(bytes.data(),static_cast<ULong>(bytes.size()),&done);s->Release();check(hr==Ok&&done==bytes.size(),"alias Write");}
Streams inventory(Storage* storage,const InteropHooks& api){EnumStatStg* e=nullptr;check(storage->EnumElements(0,nullptr,0,&e)==Ok,"alias inventory");Streams all;for(;;){StatStg stat{};ULong got=0;auto hr=e->Next(1,&stat,&got);if(!got)break;check(hr>=0&&stat.name&&stat.type==2,"unexpected source nested entry");std::u16string name(stat.name);api.free(stat.name);all.emplace(name,read(storage,name.c_str()));}e->Release();return all;}
void same(Storage* storage,const Guid& clsid,const Streams& expected,const InteropHooks& api){StatStg stat{};check(storage->Stat(&stat,1)==Ok&&equal(stat.clsid,clsid),"MathType source CLSID changed");check(inventory(storage,api)==expected,"MathType native/CompObj/unknown companion changed");}
struct Site final:OleClientSite {
    ULong refs=1;PersistStorage* persist=nullptr;Storage* storage=nullptr;int saves=0;
    HResult QueryInterface(const Guid&,void** out)override{if(!out)return PointerError;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs;}ULong Release()override{return --refs;}
    HResult SaveObject()override{++saves;auto hr=persist->Save(storage,1);if(hr!=Ok)return hr;hr=storage->Commit(0);return hr==Ok?persist->SaveCompleted(nullptr):hr;}
    HResult GetMoniker(std::uint32_t,std::uint32_t,Unknown** out)override{if(out)*out=nullptr;return NotImplemented;}HResult GetContainer(Unknown** out)override{if(out)*out=nullptr;return NotImplemented;}
    HResult ShowObject()override{return Ok;}HResult OnShowWindow(std::int32_t)override{return Ok;}HResult RequestNewObjectLayout()override{return Ok;}
};
std::uint64_t session=0;
HResult open(std::uint64_t id,const std::uint8_t*,std::size_t,void*){session=id;return Ok;}
}
void runMathTypeAliasTests(void* bundle,void* shim,void* com,void* ole,const InteropHooks& api,const std::vector<std::uint8_t>& native,const char* cfbPath){
    auto state=symbol<std::int32_t(*)()>(bundle,"MathTypeBridgeMathTypeRegistrationState");
    auto get=symbol<PublicGetClassObject>(bundle,"MathTypeBridgeGetMathTypeClassObject");
    auto registerTest=symbol<HResult(*)(RegisterClassFactories)>(bundle,"MathTypeBridgeRegisterMathTypeForTesting");
    void* rejected=reinterpret_cast<void*>(1);check(state()==0&&get(&MathTypeWindowsClassId,&ClassFactoryId,&rejected)==ClassNotAvailable&&!rejected,"MathType aliases enabled before explicit registration");
    auto registration=symbol<RegisterClassFactories>(shim,"RegisterDllGetClassObjectWithClassIDs_Shim");
    check(registerTest(registration)==Ok&&registerTest(registration)==Ok&&state()==1,"explicit MathType registration/idempotency");
    auto lookup=symbol<HResult(*)(const Guid&,std::uint32_t,void*,const Guid&,void**)>(com,"CoGetClassObject");
    auto load=symbol<HResult(*)(Storage*,const Guid&,OleClientSite*,void**)>(ole,"OleLoad");
    auto createBytes=symbol<HResult(*)(void*,std::int32_t,LockBytes**)>(ole,"CreateILockBytesOnHGlobal");
    auto openStorage=symbol<HResult(*)(LockBytes*,Storage*,std::uint32_t,const char16_t**,std::uint32_t,Storage**)>(ole,"StgOpenStorageOnILockBytes");
    auto setEditor=symbol<void(*)(OpenEditor,void*)>(bundle,"MathTypeBridgeSetEditorHooks");
    auto complete=symbol<HResult(*)(std::uint64_t,const std::uint8_t*,std::size_t,std::int32_t)>(bundle,"MathTypeBridgeCompleteEdit");
    auto count=symbol<std::uint32_t(*)()>(bundle,"MathTypeBridgeLiveObjectCount");
    std::ifstream input(cfbPath,std::ios::binary);std::vector<std::uint8_t> cfb(std::istreambuf_iterator<char>(input),{});check(cfb.size()>512&&native.size()==246,"original MathType fixture missing");
    setEditor(open,nullptr);
    for(int scenario=0;scenario<3;++scenario){
        const Guid sourceClass=scenario==1?MathTypeMacClassId:MathTypeWindowsClassId;
        LockBytes* bytes=nullptr;Storage* storage=nullptr;check(createBytes(nullptr,1,&bytes)==Ok,"alias real lock bytes");ULong done=0;check(bytes->WriteAt(ULargeInteger{0},cfb.data(),static_cast<ULong>(cfb.size()),&done)==Ok&&done==cfb.size(),"alias original CFB memory");
        check(openStorage(bytes,nullptr,StorageReadWriteExclusive,nullptr,0,&storage)==Ok,"alias real original CFB storage");bytes->Release();
        check(storage->SetClass(sourceClass)==Ok,"alias fixture class");write(storage,u"Independent unknown companion",{0,255,8,17,33,64,128});
        auto before=inventory(storage,api);check(before.at(u"Equation Native")==native&&before.contains(u"\1CompObj")&&before.contains(u"\1Sh33tJ5"),"alias original identity/native/unknown fixture");
        OleObject* object=nullptr;
        if(scenario<2){ClassFactory* factory=nullptr;check(lookup(sourceClass,1,nullptr,ClassFactoryId,reinterpret_cast<void**>(&factory))==Ok,"real alias CoGetClassObject");factory->Release();check(load(storage,OleObjectId,nullptr,reinterpret_cast<void**>(&object))==Ok,"real alias OleLoad");}
        else{ClassFactory* factory=nullptr;check(get(&MathTypeMacClassId,&ClassFactoryId,reinterpret_cast<void**>(&factory))==Ok&&factory->CreateInstance(nullptr,OleObjectId,reinterpret_cast<void**>(&object))==Ok,"Mac callback for original Windows storage");factory->Release();}
        PersistStorage* persist=nullptr;check(object->QueryInterface(PersistStorageId,reinterpret_cast<void**>(&persist))==Ok,"alias persistence");if(scenario==2)check(persist->Load(storage)==Ok,"cross-routed original Windows Load");
        Guid identity{};check(persist->GetClassID(&identity)==Ok&&equal(identity,sourceClass),"factory route rewrote original class");Site site;site.persist=persist;site.storage=storage;
        auto edited=native;check(edited[239]=='3',"alias x3 fixture");edited[239]='4';
        check(object->DoVerb(0,nullptr,&site,0,nullptr,nullptr)==Ok&&session>0&&complete(session,edited.data(),edited.size(),1)==Ok&&site.saves==1,"alias edit/save callback");
        auto expected=before;expected[u"Equation Native"]=edited;same(storage,sourceClass,expected,api);check(persist->IsDirty()==1,"alias save not clean");
        Storage* target=nullptr;check(api.createStorage(&target)==Ok&&persist->HandsOffStorage()==Ok&&persist->Save(target,0)==Ok&&persist->SaveCompleted(target)==Ok,"alias SaveAs after handoff");same(target,sourceClass,expected,api);
        check(object->DoVerb(0,nullptr,&site,0,nullptr,nullptr)==Ok&&complete(session,nullptr,0,0)==Ok&&site.saves==1,"alias cancel performs no save");same(target,sourceClass,expected,api);
        check(object->Close(1)==Ok,"alias object close");persist->Release();object->Release();storage->Release();target->Release();check(site.refs==1&&count()==0,"alias references leaked");
    }
    setEditor(nullptr,nullptr);
    std::cout<<",\"mathtype_alias_registration_is_explicit\":true,\"real_windows_and_mac_clsid_oleload\":true,\"mathtype_alias_compobj_unknown_native_preserved\":true,\"mac_factory_preserves_windows_source_class\":true,\"mathtype_alias_x3_x4_save_and_cancel\":true,\"mathtype_alias_standalone_scenarios\":3,\"mathtype_alias_registered_in_isolated_runtime\":true";
}
