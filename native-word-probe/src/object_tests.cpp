#include "ole_object_abi.hpp"
#include "diagnostics.hpp"
#include <dlfcn.h>
#include <atomic>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
using namespace bridge_probe;
namespace {
void check(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
template<class F>F resolve(void* h,const char* name){auto f=reinterpret_cast<F>(dlsym(h,name));if(!f)throw std::runtime_error(name);return f;}
using Complete=HResult(*)(std::uint64_t,const std::uint8_t*,std::size_t,std::int32_t);
using Preview=HResult(*)(std::uint64_t,const std::uint8_t*,std::size_t,std::int32_t,std::int32_t);
std::uint64_t activeSession=0;
std::vector<std::uint8_t> openedBytes;
HResult openEditor(std::uint64_t id,const std::uint8_t* data,std::size_t size,void*){activeSession=id;openedBytes.assign(data,data+size);return Ok;}
struct Sink final:AdviseSink{
    ULong refs=1;int data=0,view=0,save=0,close=0;
    std::uint32_t lastMedium=0,lastAspect=0;bool metadataPresent=false;
    ViewObject2* replaceOnView=nullptr;AdviseSink* replacement=nullptr;
    HResult QueryInterface(const Guid&,void** out)override{if(!out)return PointerError;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs;}ULong Release()override{return --refs;}
    void OnDataChange(FormatEtc* format,StgMedium* medium)override{++data;metadataPresent=format&&medium;if(format)lastAspect=format->aspect;if(medium)lastMedium=medium->tymed;}void OnViewChange(std::uint32_t,std::int32_t)override{++view;if(replaceOnView)replaceOnView->SetAdvise(1,0,replacement);}
    void OnRename(Unknown*)override{}void OnSave()override{++save;}void OnClose()override{++close;}
};
struct Site final:OleClientSite{
    ULong refs=1;int saves=0;PersistStorage* persist=nullptr;Storage* storage=nullptr;
    bool savePersists=true;
    HResult QueryInterface(const Guid&,void** out)override{if(!out)return PointerError;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs;}ULong Release()override{return --refs;}
    HResult SaveObject()override{++saves;if(!savePersists)return Ok;auto hr=persist->Save(storage,1);return hr<0?hr:persist->SaveCompleted(nullptr);}
    HResult GetMoniker(std::uint32_t,std::uint32_t,Unknown** out)override{if(out)*out=nullptr;return NotImplemented;}
    HResult GetContainer(Unknown** out)override{if(out)*out=nullptr;return NotImplemented;}
    HResult ShowObject()override{return Ok;}HResult OnShowWindow(std::int32_t)override{return Ok;}HResult RequestNewObjectLayout()override{return Ok;}
};
void writeStream(Storage* storage,const char16_t* name,const std::vector<std::uint8_t>& bytes){Stream* s=nullptr;check(storage->CreateStream(name,StorageCreateReadWriteExclusive,0,0,&s)==Ok,"create test stream");ULong n=0;auto hr=s->Write(bytes.data(),static_cast<ULong>(bytes.size()),&n);s->Release();check(hr==Ok&&n==bytes.size(),"write test stream");}
std::vector<std::uint8_t> readStream(Storage* storage,const char16_t* name){Stream* s=nullptr;check(storage->OpenStream(name,nullptr,StorageReadExclusive,0,&s)==Ok,"open test stream");StatStg stat{};check(s->Stat(&stat,1)==Ok,"stat test stream");std::vector<std::uint8_t> data(static_cast<std::size_t>(stat.size.value));ULong n=0;auto hr=s->Read(data.data(),static_cast<ULong>(data.size()),&n);s->Release();check(hr>=0&&n==data.size(),"read test stream");return data;}
}

void runObjectTests(void* bundle,const InteropHooks& api,const std::vector<std::uint8_t>& original,const std::vector<std::uint8_t>& pdf,void* drawingDc,void(*releaseMedium)(StgMedium*)){
    check(original.size()>239,"real MTEF fixture missing");
    auto setApi=resolve<HResult(*)(const InteropHooks*,std::size_t)>(bundle,"MathTypeBridgeSetInteropHooks");
    auto setEditor=resolve<void(*)(OpenEditor,void*)>(bundle,"MathTypeBridgeSetEditorHooks");
    auto complete=resolve<Complete>(bundle,"MathTypeBridgeCompleteEdit");auto preview=resolve<Preview>(bundle,"MathTypeBridgeSetSessionPreview");
    auto count=resolve<std::uint32_t(*)()>(bundle,"MathTypeBridgeLiveObjectCount");
    auto diagnostic=resolve<std::int32_t(*)(std::uint32_t)>(bundle,"MathTypeBridgeDiagnostic");
    auto metric=[&](Metric id){return diagnostic(static_cast<std::uint32_t>(id));};
    check(diagnostic(0)==2&&diagnostic(10000)==InvalidArgument,"diagnostic ABI version/bounds");
    auto getClass=resolve<PublicGetClassObject>(bundle,"MathTypeBridgeGetClassObject");
    check(setApi(&api,sizeof(api))==Ok,"configure native API hooks");setEditor(openEditor,nullptr);
    ClassFactory* factory=nullptr;check(getClass(&ProbeClassId,&ClassFactoryId,reinterpret_cast<void**>(&factory))==Ok,"private class factory");
    void* rejected=reinterpret_cast<void*>(1);check(factory->CreateInstance(reinterpret_cast<Unknown*>(1),UnknownId,&rejected)==NoAggregation&&!rejected,"aggregation rejected");
    OleObject* object=nullptr;check(factory->CreateInstance(nullptr,OleObjectId,reinterpret_cast<void**>(&object))==Ok,"construct equation object");factory->Release();
    PersistStorage* persist=nullptr;DataObject* data=nullptr;ViewObject2* view=nullptr;
    check(object->QueryInterface(PersistStorageId,reinterpret_cast<void**>(&persist))==Ok,"persist interface");
    check(object->QueryInterface(DataObjectId,reinterpret_cast<void**>(&data))==Ok,"data interface");
    check(object->QueryInterface(ViewObject2Id,reinterpret_cast<void**>(&view))==Ok,"view interface");
    for(auto* p:{static_cast<Unknown*>(persist),static_cast<Unknown*>(data),static_cast<Unknown*>(view)}){Unknown* identity=nullptr;check(p->QueryInterface(UnknownId,reinterpret_cast<void**>(&identity))==Ok&&identity==static_cast<Unknown*>(object),"shared COM identity");identity->Release();}
    Guid unknownGuid{0xffffffff,0,0,{}};rejected=reinterpret_cast<void*>(1);check(object->QueryInterface(unknownGuid,&rejected)==NoInterface&&!rejected,"QI clears unsupported result");
    Storage* source=nullptr;check(api.createStorage(&source)==Ok,"source storage");check(source->SetClass(ProbeClassId)==Ok,"source class");
    const std::vector<std::uint8_t> opaque{0,0xff,0x91,'O','P','A','Q','U','E'};
    writeStream(source,u"Equation Native",original);writeStream(source,u"\1CompObj",opaque);writeStream(source,u"Unrecognized future stream",opaque);
    check(persist->Load(source)==Ok&&persist->IsDirty()==1,"load is clean");check(persist->Load(source)==Unexpected,"duplicate Load fails safely");
    Guid classId{};check(persist->GetClassID(&classId)==Ok&&equal(classId,ProbeClassId),"classID preserved");
    Site site;site.persist=persist;site.storage=source;Sink sink;
    check(object->SetClientSite(&site)==Ok,"set client site");OleClientSite* siteCopy=nullptr;check(object->GetClientSite(&siteCopy)==Ok&&siteCopy==&site,"get client site");siteCopy->Release();
    std::uint32_t oleCookie=0,dataCookie=0;check(object->Advise(&sink,&oleCookie)==Ok,"OLE advise");
    check(view->SetAdvise(1,0,&sink)==Ok,"view advise");AdviseSink* sinkCopy=nullptr;std::uint32_t aspect=0,flags=0;check(view->GetAdvise(&aspect,&flags,&sinkCopy)==Ok&&sinkCopy==&sink&&aspect==1,"view advise getter");sinkCopy->Release();
    Sink wildcardSink,delayedSink,stopSink;std::uint32_t wildcardCookie=0,delayedCookie=0,stopCookie=0;
    FormatEtc wildcard{0,nullptr,0xffffffffu,-1,0xffffffffu},notReadyPict{3,nullptr,1,-1,32};
    check(data->QueryGetData(&notReadyPict)==FormatError,"preview initially unavailable");
    check(data->DAdvise(&wildcard,3,&wildcardSink,&wildcardCookie)==Ok&&wildcardSink.data==1&&wildcardSink.metadataPresent&&wildcardSink.lastMedium==0&&wildcardSink.lastAspect==0xffffffffu,"OLE wildcard/NODATA accepted with valid metadata");
    check(data->DAdvise(&notReadyPict,6,&delayedSink,&delayedCookie)==Ok&&delayedSink.data==0&&delayedSink.refs==2,"preview advise accepted before data exists; ONLYONCE not consumed by failed PRIMEFIRST");
    check(data->DAdvise(&notReadyPict,65,&stopSink,&stopCookie)==Ok&&stopSink.data==0,"DATAONSTOP deferred");
    std::uint32_t rejectedCookie=123;check(data->DAdvise(&wildcard,0,&wildcardSink,&rejectedCookie)<0&&rejectedCookie==0,"invalid wildcard request rejected and cookie cleared");
    check(object->DoVerb(0,nullptr,&site,0,nullptr,nullptr)==Ok&&openedBytes==original,"DoVerb sends original opaque MTEF");
    check(preview(activeSession,pdf.data(),pdf.size(),2540,1270)==Ok,"attach real PDF preview");
    FormatEtc pict{3,nullptr,1,-1,32};check(data->QueryGetData(&pict)==Ok,"metafile format accepted");
    check(data->DAdvise(&pict,1,&sink,&dataCookie)==Ok,"data advise");
    auto edited=original;edited[239]^=1;
    std::atomic<HResult> background{Ok};auto id=activeSession;
    std::thread worker([&]{background=complete(id,edited.data(),edited.size(),1);});worker.join();check(background==static_cast<HResult>(0x8001010eu),"background Word callbacks rejected");
    std::vector<std::uint8_t> bad(10);check(complete(id,bad.data(),bad.size(),1)==StorageHeaderError,"invalid native header rejected");
    check(complete(id,edited.data(),edited.size(),1)==Ok,"apply edit and client SaveObject");
    check(site.saves==1&&sink.save==1&&sink.view==1&&sink.data==1,"save/view/data notifications");
    check(wildcardSink.data==2&&delayedSink.data==1&&delayedSink.metadataPresent&&delayedSink.lastMedium==32&&delayedSink.refs==1&&data->DUnadvise(delayedCookie)==NoConnection&&stopSink.data==0,"wildcard and delayed presentation notify on actual edit; DATAONSTOP stays deferred");
    check(metric(Metric::SaveObjectResult)==Ok&&metric(Metric::PersistSaveResult)==Ok&&metric(Metric::SaveCompletedResult)==Ok&&metric(Metric::Dirty)==0&&metric(Metric::NoScribble)==0&&metric(Metric::ClientPresent)==1,"metadata diagnostics observe normal persistence path");
    check(persist->IsDirty()==1&&readStream(source,u"Equation Native")==edited,"new MTEF committed cleanly");
    check(readStream(source,u"\1CompObj")==opaque&&readStream(source,u"Unrecognized future stream")==opaque,"unknown source streams preserved");
    check(complete(id,edited.data(),edited.size(),1)==NoConnection,"stale session rejected");
    Sink primeSink,reentrantSink,replacementSink;std::uint32_t primeCookie=0;
    check(data->DAdvise(&pict,7,&primeSink,&primeCookie)==Ok&&primeSink.data==1&&sink.data==1&&primeSink.refs==1&&data->DUnadvise(primeCookie)==NoConnection,"PRIMEFIRST targets only new sink; ONLYONCE releases before callback");
    reentrantSink.replaceOnView=view;reentrantSink.replacement=&replacementSink;
    check(view->SetAdvise(1,6,&reentrantSink)==Ok&&reentrantSink.view==1,"reentrant view PRIMEFIRST");sinkCopy=nullptr;check(view->GetAdvise(nullptr,nullptr,&sinkCopy)==Ok&&sinkCopy==&replacementSink,"ONLYONCE does not erase reentrant replacement");sinkCopy->Release();check(view->SetAdvise(1,0,&sink)==Ok&&reentrantSink.refs==1&&replacementSink.refs==1,"reentrant sink references balanced");

    FormatEtc canonical{};check(data->GetCanonicalFormatEtc(&pict,&canonical)==static_cast<HResult>(0x40130u)&&canonical.target==nullptr,"canonical format");
    FormatEtc badFormat=pict;badFormat.tymed=8;check(data->QueryGetData(&badFormat)==TymedError,"bad tymed rejected");
    check(data->SetData(&pict,nullptr,0)==NotImplemented,"unsupported external SetData is safe");
    EnumFormatEtc* formats=nullptr;check(data->EnumFormatEtc(1,&formats)==Ok,"format enumeration");FormatEtc next{};ULong fetched=0;check(formats->Next(1,&next,&fetched)==Ok&&fetched==1&&next.format==3,"format enumerator layout");EnumFormatEtc* formatsCopy=nullptr;check(formats->Clone(&formatsCopy)==Ok&&formatsCopy->Reset()==Ok&&formatsCopy->Skip(2)==Ok,"format clone/reset/skip");formatsCopy->Release();formats->Release();
    EnumOleVerb* verbs=nullptr;check(object->EnumVerbs(&verbs)==Ok,"verb enumeration");OleVerb verb{};check(verbs->Next(1,&verb,&fetched)==Ok&&verb.verb==0&&std::u16string(verb.name)==u"Open","verb UTF16 layout");api.free(verb.name);EnumOleVerb* verbsCopy=nullptr;check(verbs->Clone(&verbsCopy)==Ok&&verbsCopy->Reset()==Ok&&verbsCopy->Skip(2)==Ok,"verb clone/reset/skip");verbsCopy->Release();verbs->Release();
    EnumStatData* advises=nullptr;check(object->EnumAdvise(&advises)==Ok,"advise enumeration");StatData stat{};check(advises->Next(1,&stat,&fetched)==Ok&&stat.sink==&sink&&stat.connection==oleCookie,"STATDATA layout");stat.sink->Release();EnumStatData* advisesCopy=nullptr;check(advises->Clone(&advisesCopy)==Ok&&advisesCopy->Reset()==Ok&&advisesCopy->Skip(1)==Ok,"advise clone/reset/skip");advisesCopy->Release();advises->Release();
    check(data->EnumDAdvise(&advises)==Ok,"data advise enumeration");advises->Release();
    OleChar* label=nullptr;check(object->GetUserType(1,&label)==Ok&&label,"user label allocation");api.free(label);
    SizeL extent{};check(view->GetExtent(1,-1,nullptr,&extent)==Ok&&extent.width==2540&&object->GetExtent(1,&extent)==Ok,"both extent methods");
    SizeL changed{5080,2540};check(object->SetExtent(1,&changed)==Ok,"set extent");
    std::uint32_t misc=1;check(object->GetMiscStatus(1,&misc)==Ok&&misc==0&&object->SetColorScheme(nullptr)==Ok,"misc/color slots");
    check(object->SetHostNames(u"Probe",u"Document")==Ok&&object->Update()==Ok&&object->IsUpToDate()==Ok,"host/update slots");
    check(object->GetUserClassID(&classId)==Ok&&object->SetMoniker(0,nullptr)==NotImplemented,"user class/moniker slots");
    Unknown* moniker=nullptr;check(object->GetMoniker(0,0,&moniker)==NotImplemented&&!moniker&&object->InitFromData(nullptr,0,0)==NotImplemented,"moniker/initfromdata slots");
    DataObject* clipboard=nullptr;check(object->GetClipboardData(0,&clipboard)==Ok&&clipboard==data,"clipboard interface");clipboard->Release();
    void* palette=reinterpret_cast<void*>(1);check(view->GetColorSet(1,-1,nullptr,nullptr,nullptr,&palette)==NotImplemented&&!palette,"palette slot");
    std::uint32_t freeze=1;check(view->Freeze(1,-1,nullptr,&freeze)==NotImplemented&&freeze==0&&view->Unfreeze(0)==NotImplemented,"freeze slots fail explicitly");
    RectL bounds{16,8,88,44};check(view->Draw(1,-1,nullptr,nullptr,nullptr,drawingDc,&bounds,nullptr,nullptr,0)==Ok,"view Draw callback argument ABI");

    StgMedium medium{};check(data->GetData(&pict,&medium)==Ok&&medium.tymed==32&&medium.handle,"real PDF presentation medium");releaseMedium(&medium);
    FormatEtc embedded{api.embedSourceFormat,nullptr,1,-1,8};check(data->GetData(&embedded,&medium)==Ok&&medium.tymed==8&&readStream(medium.storage,u"Equation Native")==edited&&readStream(medium.storage,u"Unrecognized future stream")==opaque,"embedded source medium");releaseMedium(&medium);
    Storage* target=nullptr;check(api.createStorage(&target)==Ok,"target storage");medium={8,{.storage=target},nullptr};check(data->GetDataHere(&embedded,&medium)==Ok&&readStream(target,u"Equation Native")==edited,"GetDataHere storage");
    check(object->DoVerb(0,nullptr,&site,0,nullptr,nullptr)==Ok,"pending editor before container save");
    check(persist->Save(target,0)==Ok&&persist->Save(target,0)==Unexpected,"NoScribble save gate");
    check(preview(activeSession,pdf.data(),pdf.size(),2540,1270)==Unexpected&&complete(activeSession,edited.data(),edited.size(),1)==Unexpected,"NoScribble rejects both pending preview and native edits");
    check(persist->SaveCompleted(target)==Ok&&complete(activeSession,nullptr,0,0)==Ok&&persist->HandsOffStorage()==Ok,"SaveCompleted/HandsOffStorage");
    Storage* afterHandsOff=nullptr;check(api.createStorage(&afterHandsOff)==Ok&&persist->Save(afterHandsOff,0)==Ok&&readStream(afterHandsOff,u"Unrecognized future stream")==opaque,"HandsOff retains opaque snapshot for SaveAs");check(persist->SaveCompleted(afterHandsOff)==Ok,"resume storage after handoff");
    check(object->DoVerb(0,nullptr,&site,0,nullptr,nullptr)==Ok,"second edit session");check(complete(activeSession,nullptr,0,0)==Ok&&site.saves==1,"cancel does not save");
    check(data->DUnadvise(dataCookie)==Ok&&data->DUnadvise(dataCookie)==NoConnection,"data unadvise");
    check(data->DUnadvise(wildcardCookie)==Ok,"wildcard unadvise");
    check(object->Unadvise(oleCookie)==Ok&&object->Unadvise(oleCookie)==NoConnection,"OLE unadvise");
    check(object->Advise(&sink,&oleCookie)==Ok,"close observer");
    check(object->DoVerb(0,nullptr,&site,0,nullptr,nullptr)==Ok,"pending edit for close test");id=activeSession;check(object->Close(1)==Ok&&sink.close==1&&complete(id,nullptr,0,0)==NoConnection,"Close cancels pending edit safely");
    Site reopenedSite;reopenedSite.persist=persist;reopenedSite.storage=source;
    check(object->DoVerb(0,nullptr,nullptr,0,nullptr,nullptr)==Unexpected,"closed owner cannot reopen without a host site");
    check(object->DoVerb(0,nullptr,&reopenedSite,0,nullptr,nullptr)==Ok&&activeSession!=id&&openedBytes==edited,"same OLE owner reopens on a new host site with retained native data");
    auto reopenedSession=activeSession;
    check(reopenedSession!=id&&complete(id,edited.data(),edited.size(),1)==NoConnection&&activeSession==reopenedSession,"closed session cannot affect reopened owner");
    check(complete(reopenedSession,nullptr,0,0)==Ok,"reopened session cancels independently");
    Storage* reopenedSave=nullptr;check(api.createStorage(&reopenedSave)==Ok&&persist->Save(reopenedSave,0)==Ok,"reopened owner can save from its retained snapshot");
    check(readStream(reopenedSave,u"Equation Native")==edited&&readStream(reopenedSave,u"Unrecognized future stream")==opaque,"reopened save preserves native data and unknown streams");
    check(persist->SaveCompleted(reopenedSave)==Ok,"reopened save completes");
    check(stopSink.data==1&&stopSink.lastMedium==32&&stopSink.refs==1,"DATAONSTOP sends final real presentation and releases sink");
    check(site.refs==1&&sink.refs==1,"client/sink references balanced at close");
    check(object->Close(1)==Ok,"reopened owner closes cleanly");
    check(reopenedSite.refs==1,"reopened host site reference released on close");
    view->Release();data->Release();persist->Release();object->Release();source->Release();target->Release();afterHandsOff->Release();reopenedSave->Release();
    check(count()==0,"no surviving equation objects/sessions");
    {
        ClassFactory* f=nullptr;OleObject* o=nullptr;PersistStorage* p=nullptr;Storage* s=nullptr;
        check(getClass(&ProbeClassId,&ClassFactoryId,reinterpret_cast<void**>(&f))==Ok&&f->CreateInstance(nullptr,OleObjectId,reinterpret_cast<void**>(&o))==Ok,"nonpersisting-container object");f->Release();
        check(o->QueryInterface(PersistStorageId,reinterpret_cast<void**>(&p))==Ok&&api.createStorage(&s)==Ok&&s->SetClass(ProbeClassId)==Ok,"nonpersisting-container storage");writeStream(s,u"Equation Native",original);check(p->Load(s)==Ok,"nonpersisting-container load");
        Site passive;passive.persist=p;passive.storage=s;passive.savePersists=false;
        const auto saveBefore=metric(Metric::PersistSaveCalls),withoutBefore=metric(Metric::SaveObjectWithoutPersistSave);
        check(o->DoVerb(0,nullptr,&passive,0,nullptr,nullptr)==Ok&&complete(activeSession,edited.data(),edited.size(),1)==Ok,"container can acknowledge without calling persistence");
        check(p->IsDirty()==Ok&&readStream(s,u"Equation Native")==original&&metric(Metric::PersistSaveCalls)==saveBefore&&metric(Metric::SaveObjectWithoutPersistSave)==withoutBefore+1&&metric(Metric::SaveObjectResult)==Ok,"metadata distinguishes acknowledged edit from actual storage save");
        check(p->Save(s,1)==Ok&&p->SaveCompleted(nullptr)==Ok&&readStream(s,u"Equation Native")==edited,"later container-driven persistence writes edit without source bypass");
        o->Close(1);p->Release();o->Release();s->Release();check(passive.refs==1&&count()==0,"nonpersisting-container lifetime balanced");
    }
    for(int i=0;i<100;++i){void* p=nullptr;ClassFactory* f=nullptr;check(getClass(&ProbeClassId,&ClassFactoryId,reinterpret_cast<void**>(&f))==Ok&&f->CreateInstance(nullptr,DataObjectId,&p)==Ok,"factory lifetime stress");static_cast<DataObject*>(p)->Release();f->Release();}
    check(count()==0,"100 object cycles balance");setEditor(nullptr,nullptr);
    std::cout<<",\"ole_object_identity_and_all_vtable_slots\":true,\"opaque_mtef_and_unknown_streams_preserved\":true,\"save_no_scribble_handoff_cancel_close\":true,\"cross_thread_submission_rejected\":true,\"advise_and_client_references_balanced\":true,\"reentrant_advise_and_primefirst_isolated\":true,\"wildcard_and_delayed_preview_advise\":true,\"dataonstop_final_real_presentation\":true,\"metadata_diagnostics_detect_ack_without_persistence\":true,\"real_office_release_stg_medium\":true,\"object_cycles_without_live_instances\":100";
}
