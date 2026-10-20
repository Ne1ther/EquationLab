#include "ole_object_abi.hpp"
#include "diagnostics.hpp"
#include <array>
#include <algorithm>
#include <atomic>
#include <map>
#include <mutex>
#include <thread>
#include <vector>
#include <limits>
#include <cstdlib>

namespace bridge_probe {
namespace {
constexpr std::size_t MaxBytes=16*1024*1024;
constexpr HResult WrongThread=static_cast<HResult>(0x8001010eu);
constexpr auto MetricCount=static_cast<std::size_t>(Metric::Count);
struct Diagnostics {
    std::array<std::atomic<std::int32_t>,MetricCount> values{};
    Diagnostics(){for(auto m:{Metric::SaveObjectResult,Metric::PersistSaveResult,Metric::SaveCompletedResult,Metric::ApplyResult,Metric::PreviewResult,Metric::LoadResult,Metric::DAdviseResult,Metric::SnapshotResult,Metric::DoVerbResult,Metric::CancelResult})values[static_cast<std::size_t>(m)]=std::numeric_limits<std::int32_t>::max();}
} diagnostics;
void record(Metric m,std::int32_t n){diagnostics.values[static_cast<std::size_t>(m)].store(n);}
void increment(Metric m){diagnostics.values[static_cast<std::size_t>(m)].fetch_add(1);}
std::int32_t current(Metric m){return diagnostics.values[static_cast<std::size_t>(m)].load();}
template<class T> class Ref {
    T* p_=nullptr;
public:
    Ref()=default;
    explicit Ref(T* p):p_(p){if(p_)p_->AddRef();}
    Ref(const Ref& r):Ref(r.p_){}
    Ref(Ref&& r) noexcept:p_(r.p_){r.p_=nullptr;}
    ~Ref(){if(p_)p_->Release();}
    Ref& operator=(Ref r){std::swap(p_,r.p_);return *this;}
    T* get()const{return p_;}
    T* operator->()const{return p_;}
    explicit operator bool()const{return p_!=nullptr;}
};
InteropHooks hooks;
OpenEditor openEditor=nullptr;
CancelEditor cancelEditor=nullptr;
ForgetEditorOwner forgetEditorOwner=nullptr;
EditorOwnerWritten editorOwnerWritten=nullptr;
void* editorContext=nullptr;
std::atomic<std::uint32_t> live{0};
// The service outlives Word. A restarted Word must not reuse identifiers still
// retained by an earlier host process, including unconsumed cancellations.
std::uint64_t firstSession(){std::uint64_t value;arc4random_buf(&value,sizeof(value));return (value&0x7fffffffffffffffull)|1;}
std::atomic<std::uint64_t> nextSession{firstSession()};
class EquationObject;
std::mutex sessionMutex;
std::map<std::uint64_t,EquationObject*> sessions;
bool validNative(const std::uint8_t* b,std::size_t size){
    if(!b||size<29||size>MaxBytes)return false;
    const std::uint16_t header=b[0]|(b[1]<<8);
    const std::uint32_t length=static_cast<std::uint32_t>(b[8])|(static_cast<std::uint32_t>(b[9])<<8)|(static_cast<std::uint32_t>(b[10])<<16)|(static_cast<std::uint32_t>(b[11])<<24);
    return header==28&&length==size-28;
}
bool sameStorage(Storage* a,Storage* b){
    if(a==b)return true;
    if(!a||!b)return false;
    Unknown *ia=nullptr,*ib=nullptr;
    a->QueryInterface(UnknownId,reinterpret_cast<void**>(&ia));
    b->QueryInterface(UnknownId,reinterpret_cast<void**>(&ib));
    bool same=ia&&ib&&ia==ib;
    if(ia)ia->Release();if(ib)ib->Release();
    return same;
}
OleChar* copyText(const OleChar* text,const InteropHooks& api){
    if(!api.allocate)return nullptr;
    const auto count=std::char_traits<OleChar>::length(text)+1;
    auto* p=static_cast<OleChar*>(api.allocate(count*sizeof(OleChar)));
    if(p)std::memcpy(p,text,count*sizeof(OleChar));
    return p;
}
class FormatEnumerator final:public EnumFormatEtc {
    std::atomic<ULong> refs_{1};std::vector<FormatEtc> values_;std::size_t cursor_=0;
public:
    FormatEnumerator(std::vector<FormatEtc> v,std::size_t c=0):values_(std::move(v)),cursor_(c){}
    HResult QueryInterface(const Guid& iid,void** out)override{if(!out)return PointerError;*out=nullptr;if(!equal(iid,UnknownId)&&!equal(iid,EnumFormatEtcId))return NoInterface;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs_;} ULong Release()override{auto n=--refs_;if(!n)delete this;return n;}
    HResult Next(ULong n,FormatEtc* out,ULong* fetched)override{if(!out||(!fetched&&n!=1))return PointerError;ULong done=0;while(done<n&&cursor_<values_.size())out[done++]=values_[cursor_++];if(fetched)*fetched=done;return done==n?Ok:1;}
    HResult Skip(ULong n)override{auto available=values_.size()-cursor_;cursor_+=std::min<std::size_t>(n,available);return n<=available?Ok:1;}
    HResult Reset()override{cursor_=0;return Ok;}
    HResult Clone(EnumFormatEtc** out)override{if(!out)return PointerError;*out=new FormatEnumerator(values_,cursor_);return Ok;}
};
class VerbEnumerator final:public EnumOleVerb {
    std::atomic<ULong> refs_{1};std::size_t cursor_=0;InteropHooks api_;
public:
    explicit VerbEnumerator(InteropHooks api,std::size_t c=0):cursor_(c),api_(api){}
    HResult QueryInterface(const Guid& iid,void** out)override{if(!out)return PointerError;*out=nullptr;if(!equal(iid,UnknownId)&&!equal(iid,EnumOleVerbId))return NoInterface;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs_;}ULong Release()override{auto n=--refs_;if(!n)delete this;return n;}
    HResult Next(ULong n,OleVerb* out,ULong* fetched)override{if(!out||(!fetched&&n!=1))return PointerError;ULong done=0;while(done<n&&cursor_<2){auto* name=copyText(cursor_?u"Edit":u"Open",api_);if(!name){if(fetched)*fetched=done;return NotImplemented;}out[done++]={static_cast<std::int32_t>(cursor_++),name,0,2};}if(fetched)*fetched=done;return done==n?Ok:1;}
    HResult Skip(ULong n)override{auto a=2-cursor_;cursor_+=std::min<std::size_t>(n,a);return n<=a?Ok:1;}
    HResult Reset()override{cursor_=0;return Ok;}
    HResult Clone(EnumOleVerb** out)override{if(!out)return PointerError;*out=new VerbEnumerator(api_,cursor_);return Ok;}
};
struct Connection {FormatEtc format{};std::uint32_t flags=0;Ref<AdviseSink> sink;};
class AdviseEnumerator final:public EnumStatData {
    std::atomic<ULong> refs_{1};std::vector<std::pair<std::uint32_t,Connection>> values_;std::size_t cursor_=0;
public:
    explicit AdviseEnumerator(const std::map<std::uint32_t,Connection>& values):values_(values.begin(),values.end()){}
    AdviseEnumerator(const AdviseEnumerator& r):values_(r.values_),cursor_(r.cursor_){}
    HResult QueryInterface(const Guid& iid,void** out)override{if(!out)return PointerError;*out=nullptr;if(!equal(iid,UnknownId)&&!equal(iid,EnumStatDataId))return NoInterface;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs_;}ULong Release()override{auto n=--refs_;if(!n)delete this;return n;}
    HResult Next(ULong n,StatData* out,ULong* fetched)override{if(!out||(!fetched&&n!=1))return PointerError;ULong done=0;while(done<n&&cursor_<values_.size()){auto& c=values_[cursor_++];c.second.sink->AddRef();out[done++]={c.second.format,c.second.flags,c.second.sink.get(),c.first};}if(fetched)*fetched=done;return done==n?Ok:1;}
    HResult Skip(ULong n)override{auto a=values_.size()-cursor_;cursor_+=std::min<std::size_t>(n,a);return n<=a?Ok:1;}
    HResult Reset()override{cursor_=0;return Ok;}
    HResult Clone(EnumStatData** out)override{if(!out)return PointerError;*out=new AdviseEnumerator(*this);return Ok;}
};

class EquationObject final:public OleObject,public PersistStorage,public DataObject,public ViewObject2 {
    std::atomic<ULong> refs_{1};
    Guid classId_;InteropHooks api_;std::thread::id owner_=std::this_thread::get_id();
    Ref<Storage> source_,backup_;Ref<OleClientSite> client_;Ref<AdviseSink> viewSink_;
    std::map<std::uint32_t,Connection> oleSinks_,dataSinks_;
    std::vector<std::uint8_t> native_,pdf_;
    SizeL extent_{2540,1270};bool dirty_=false,noScribble_=false,loaded_=false,closed_=false;
    std::uint32_t nextCookie_=1,viewAspect_=1,viewFlags_=0;
    std::uint64_t session_=0;
    const std::uint64_t identity_=nextSession++;
    std::string documentIdentity_;
    void gauges(){record(Metric::ClientPresent,client_?1:0);record(Metric::SourceStorage,source_?1:0);record(Metric::Dirty,dirty_);record(Metric::NoScribble,noScribble_);record(Metric::DataSinks,static_cast<std::int32_t>(dataSinks_.size()));record(Metric::OleSinks,static_cast<std::int32_t>(oleSinks_.size()));record(Metric::ViewSink,viewSink_?1:0);}
    template<class F>HResult measured(Metric calls,Metric result,F&& action){increment(calls);auto hr=action();record(result,hr);if(correctThread())gauges();return hr;}
    HResult requestSave(){auto site=client_;if(!site)return NoConnection;auto before=current(Metric::PersistSaveCalls);increment(Metric::SaveObjectCalls);auto hr=site->SaveObject();record(Metric::SaveObjectResult,hr);if(hr>=0&&current(Metric::PersistSaveCalls)==before)increment(Metric::SaveObjectWithoutPersistSave);gauges();return hr;}
    HResult snapshot(Storage* target){
        return measured(Metric::SnapshotCalls,Metric::SnapshotResult,[&]() -> HResult {
        if(!target)return PointerError;
        if(!validNative(native_.data(),native_.size()))return StorageHeaderError;
        auto original=source_?source_:backup_;
        if(original&&!sameStorage(original.get(),target)){auto hr=original->CopyTo(0,nullptr,nullptr,target);if(hr<0)return hr;}
        auto classResult=target->SetClass(classId_);if(classResult<0)return classResult;
        Stream* raw=nullptr;auto hr=target->CreateStream(u"Equation Native",StorageCreateReadWriteExclusive,0,0,&raw);if(hr<0)return hr;
        Ref<Stream> stream(raw);raw->Release();ULong written=0;
        hr=stream->Write(native_.data(),static_cast<ULong>(native_.size()),&written);
        return hr<0?hr:written==native_.size()?Ok:Unexpected;});
    }
    void notifyView(){auto sink=viewSink_;if(viewFlags_&4)viewSink_={};if(sink){increment(Metric::ViewNotifications);sink->OnViewChange(1,-1);}gauges();}
    void notifyDataConnection(std::uint32_t cookie,Connection connection,bool stopping=false){
        StgMedium medium{};auto format=connection.format;
        const bool noData=(connection.flags&1)&&!(stopping&&(connection.flags&64));
        if(!noData&&GetData(&format,&medium)!=Ok)return;
        if(connection.flags&4)dataSinks_.erase(cookie);
        increment(Metric::DataNotifications);connection.sink->OnDataChange(&format,&medium);releaseMedium(medium);gauges();
    }
    void notifyData(bool stopping=false){auto copy=dataSinks_;for(auto& [cookie,c]:copy)if(dataSinks_.contains(cookie)&&((c.flags&64)!=0)==stopping)notifyDataConnection(cookie,c,stopping);}
    void releaseMedium(StgMedium& medium){if(medium.release)medium.release->Release();else if(medium.tymed==32&&medium.handle&&api_.deletePict)api_.deletePict(medium.handle);else if(medium.tymed==8&&medium.storage)medium.storage->Release();medium={};}
public:
    explicit EquationObject(Guid clsid):classId_(clsid),api_(hooks){++live;}
    ~EquationObject(){if(forgetEditorOwner)forgetEditorOwner(identity_,editorContext);--live;}
    std::uint64_t identity()const{return identity_;}
    bool bindDocument(const char* identity){if(!identity||!correctThread())return false;if(documentIdentity_.empty())documentIdentity_=identity;return documentIdentity_==identity;}
    bool correctThread()const{return owner_==std::this_thread::get_id();}
    HResult QueryInterface(const Guid& iid,void** out)override{
        if(equal(iid,oleIid(0x126)))increment(Metric::RunnableQueries);
        if(!out)return PointerError;*out=nullptr;
        if(equal(iid,UnknownId)||equal(iid,OleObjectId))*out=static_cast<OleObject*>(this);
        else if(equal(iid,PersistId)||equal(iid,PersistStorageId))*out=static_cast<PersistStorage*>(this);
        else if(equal(iid,DataObjectId))*out=static_cast<DataObject*>(this);
        else if(equal(iid,ViewObjectId)||equal(iid,ViewObject2Id))*out=static_cast<ViewObject2*>(this);
        else return NoInterface;AddRef();return Ok;
    }
    ULong AddRef()override{return ++refs_;}ULong Release()override{auto n=--refs_;if(!n)delete this;return n;}
    HResult GetClassID(Guid* id)override{if(!id)return PointerError;*id=classId_;return Ok;}
    HResult IsDirty()override{return dirty_?Ok:1;}
    HResult InitNew(Storage* storage)override{if(!storage)return PointerError;if(loaded_)return Unexpected;source_=Ref<Storage>(storage);loaded_=true;dirty_=true;return Ok;}
    HResult Load(Storage* storage)override{return measured(Metric::LoadCalls,Metric::LoadResult,[&]() -> HResult {
        if(!storage)return PointerError;if(loaded_)return Unexpected;
        Stream* raw=nullptr;auto hr=storage->OpenStream(u"Equation Native",nullptr,StorageReadExclusive,0,&raw);if(hr<0)return hr;
        Ref<Stream> stream(raw);raw->Release();StatStg stat{};hr=stream->Stat(&stat,1);if(hr<0)return hr;
        if(stat.size.value>MaxBytes||stat.size.value<29)return StorageHeaderError;
        std::vector<std::uint8_t> data(static_cast<std::size_t>(stat.size.value));ULong read=0;hr=stream->Read(data.data(),static_cast<ULong>(data.size()),&read);
        if(hr<0||read!=data.size()||!validNative(data.data(),data.size()))return StorageHeaderError;
        StatStg root{};if(storage->Stat(&root,1)==Ok&&!equal(root.clsid,Guid{}))classId_=root.clsid;
        if(api_.createStorage){Storage* copy=nullptr;hr=api_.createStorage(&copy);if(hr<0)return hr;Ref<Storage> clone(copy);copy->Release();hr=storage->CopyTo(0,nullptr,nullptr,clone.get());if(hr<0)return hr;clone->SetClass(classId_);backup_=std::move(clone);}
        source_=Ref<Storage>(storage);native_=std::move(data);loaded_=true;dirty_=false;return Ok;});
    }
    HResult Save(Storage* storage,std::int32_t same)override{return measured(Metric::PersistSaveCalls,Metric::PersistSaveResult,[&]() -> HResult {record(Metric::SameAsLoad,same);if(noScribble_)return Unexpected;auto hr=snapshot(storage);if(hr==Ok)noScribble_=true;return hr;});}
    HResult SaveCompleted(Storage* storage)override{return measured(Metric::SaveCompletedCalls,Metric::SaveCompletedResult,[&]() -> HResult {if(!noScribble_&&source_)increment(Metric::SaveCompletedWithoutSave);if(storage)source_=Ref<Storage>(storage);noScribble_=false;dirty_=false;auto sinks=oleSinks_;for(auto& [cookie,c]:sinks){(void)cookie;increment(Metric::SaveNotifications);c.sink->OnSave();}return Ok;});}
    HResult HandsOffStorage()override{source_={};gauges();return Ok;}
    HResult SetClientSite(OleClientSite* site)override{increment(Metric::SetClientSiteCalls);client_=Ref<OleClientSite>(site);gauges();return Ok;}
    HResult GetClientSite(OleClientSite** site)override{if(!site)return PointerError;*site=client_.get();if(*site)(*site)->AddRef();return Ok;}
    HResult SetHostNames(const OleChar*,const OleChar*)override{return Ok;}
    HResult Close(std::uint32_t mode)override{
        increment(Metric::CloseCalls);record(Metric::CloseMode,static_cast<std::int32_t>(mode));
        if(!correctThread())return WrongThread;Ref<OleObject> hold(static_cast<OleObject*>(this));
        if(closed_)return Ok;
        if(mode!=1&&dirty_&&client_){auto hr=requestSave();if(hr<0)return hr;}
        if(session_)completeEdit(session_,nullptr,0,false);
        if(forgetEditorOwner)forgetEditorOwner(identity_,editorContext);
        notifyData(true);
        auto sinks=oleSinks_;oleSinks_.clear();dataSinks_.clear();viewSink_={};client_={};source_={};backup_={};closed_=true;
        for(auto& [cookie,c]:sinks){(void)cookie;increment(Metric::CloseNotifications);c.sink->OnClose();}gauges();return Ok;
    }
    HResult SetMoniker(std::uint32_t,Unknown*)override{return NotImplemented;}
    HResult GetMoniker(std::uint32_t a,std::uint32_t b,Unknown** out)override{if(!out)return PointerError;*out=nullptr;return client_?client_->GetMoniker(a,b,out):NotImplemented;}
    HResult InitFromData(DataObject*,std::int32_t,std::uint32_t)override{return NotImplemented;}
    HResult GetClipboardData(std::uint32_t,DataObject** out)override{if(!out)return PointerError;*out=static_cast<DataObject*>(this);AddRef();return Ok;}
    HResult DoVerb(std::int32_t verb,void*,OleClientSite* site,std::int32_t,void*,const RectL*)override{return measured(Metric::DoVerbCalls,Metric::DoVerbResult,[&]() -> HResult {
        if(!correctThread())return WrongThread;if(closed_||noScribble_)return Unexpected;
        if(verb!=0&&verb!=1&&verb!=-1&&verb!=-2)return static_cast<HResult>(0x80040181u);
        if(site)SetClientSite(site);if(!openEditor)return NotImplemented;
        // An external editor may be behind Word or hidden. Re-activation must
        // bring that SAME session back, without allocating another OLE owner.
        if(session_)return openEditor(session_,native_.data(),native_.size(),editorContext);
        session_=nextSession++;AddRef();{std::lock_guard lock(sessionMutex);sessions[session_]=this;}
        auto id=session_;auto hr=openEditor(id,native_.data(),native_.size(),editorContext);
        if(hr<0)completeEdit(id,nullptr,0,false);return hr;});
    }
    HResult EnumVerbs(EnumOleVerb** out)override{if(!out)return PointerError;*out=new VerbEnumerator(api_);return Ok;}
    HResult Update()override{return Ok;}HResult IsUpToDate()override{return Ok;}
    HResult GetUserClassID(Guid* out)override{return GetClassID(out);}
    HResult GetUserType(std::uint32_t,OleChar** out)override{if(!out)return PointerError;*out=copyText(u"MathType Bridge Native Probe",api_);return *out?Ok:NotImplemented;}
    HResult SetExtent(std::uint32_t aspect,SizeL* size)override{if(!size)return PointerError;if(aspect!=1)return AspectError;if(size->width<=0||size->height<=0)return InvalidArgument;extent_=*size;return Ok;}
    HResult GetExtent(std::uint32_t aspect,SizeL* size)override{if(!size)return PointerError;if(aspect!=1)return AspectError;*size=extent_;return Ok;}
    HResult Advise(AdviseSink* sink,std::uint32_t* cookie)override{if(!sink||!cookie)return PointerError;*cookie=nextCookie_++;oleSinks_[*cookie]={{},0,Ref<AdviseSink>(sink)};gauges();return Ok;}
    HResult Unadvise(std::uint32_t cookie)override{auto hr=oleSinks_.erase(cookie)?Ok:NoConnection;gauges();return hr;}
    HResult EnumAdvise(EnumStatData** out)override{if(!out)return PointerError;*out=new AdviseEnumerator(oleSinks_);return Ok;}
    HResult GetMiscStatus(std::uint32_t aspect,std::uint32_t* status)override{if(!status)return PointerError;*status=0;return aspect==1?Ok:AspectError;}
    HResult SetColorScheme(void*)override{return Ok;}
    HResult QueryGetData(FormatEtc* format)override{if(!format)return PointerError;if(format->aspect!=1)return AspectError;if(format->target||format->index!=-1)return FormatError;if(format->format==3&&!pdf_.empty())return format->tymed&32?Ok:TymedError;if(format->format==api_.embedSourceFormat&&api_.embedSourceFormat)return format->tymed&8?Ok:TymedError;return FormatError;}
    HResult GetData(FormatEtc* format,StgMedium* medium)override{if(!medium)return PointerError;*medium={};auto hr=QueryGetData(format);if(hr!=Ok)return hr;if(format->format==3){if(!api_.createPict)return NotImplemented;medium->handle=api_.createPict(pdf_.data(),pdf_.size());if(!medium->handle)return Unexpected;medium->tymed=32;return Ok;}if(!api_.createStorage)return NotImplemented;Storage* stg=nullptr;hr=api_.createStorage(&stg);if(hr<0)return hr;hr=snapshot(stg);if(hr<0){stg->Release();return hr;}medium->tymed=8;medium->storage=stg;return Ok;}
    HResult GetDataHere(FormatEtc* format,StgMedium* medium)override{if(!medium)return PointerError;auto hr=QueryGetData(format);if(hr<0)return hr;if(format->format!=api_.embedSourceFormat||medium->tymed!=8||!medium->storage)return TymedError;return snapshot(medium->storage);}
    HResult GetCanonicalFormatEtc(FormatEtc* input,FormatEtc* out)override{if(!input||!out)return PointerError;*out=*input;out->target=nullptr;return static_cast<HResult>(0x00040130u);}
    HResult SetData(FormatEtc*,StgMedium*,std::int32_t)override{return NotImplemented;}
    HResult EnumFormatEtc(std::uint32_t direction,bridge_probe::EnumFormatEtc** out)override{if(!out)return PointerError;*out=nullptr;if(direction!=1)return NotImplemented;std::vector<FormatEtc> values;if(!pdf_.empty())values.push_back({3,nullptr,1,-1,32});if(api_.embedSourceFormat)values.push_back({api_.embedSourceFormat,nullptr,1,-1,8});*out=new FormatEnumerator(std::move(values));return Ok;}
    HResult DAdvise(FormatEtc* format,std::uint32_t flags,AdviseSink* sink,std::uint32_t* cookie)override{
        auto action=[&]() -> HResult {if(cookie)*cookie=0;if(!format||!sink||!cookie)return PointerError;record(Metric::DAdviseFormat,format->format);record(Metric::DAdviseAspect,static_cast<std::int32_t>(format->aspect));if(format->target)return FormatError;
        const bool wildcard=format->format==0&&format->aspect==0xffffffffu&&format->index==-1&&format->tymed==0xffffffffu&&(flags&1);
        if(!wildcard){if(format->aspect!=1)return AspectError;if(format->index!=-1)return FormatError;if(format->format==3){if(!(format->tymed&32))return TymedError;}else if(format->format==api_.embedSourceFormat&&api_.embedSourceFormat){if(!(format->tymed&8))return TymedError;}else return FormatError;}
        *cookie=nextCookie_++;dataSinks_[*cookie]={*format,flags,Ref<AdviseSink>(sink)};if(flags&2)notifyDataConnection(*cookie,dataSinks_.at(*cookie));return Ok;};
        auto hr=action();record(Metric::DAdviseResult,hr);if(hr<0)increment(Metric::DAdviseRejected);gauges();return hr;
    }
    HResult DUnadvise(std::uint32_t cookie)override{auto hr=dataSinks_.erase(cookie)?Ok:NoConnection;gauges();return hr;}
    HResult EnumDAdvise(EnumStatData** out)override{if(!out)return PointerError;*out=new AdviseEnumerator(dataSinks_);return Ok;}
    HResult Draw(std::uint32_t aspect,std::int32_t index,void*,void* target,void*,void* dc,const RectL* bounds,const RectL*,std::int32_t(*keepGoing)(std::uintptr_t),std::uintptr_t context)override{if(aspect!=1)return AspectError;if(index!=-1||target)return FormatError;if(!bounds||!dc)return PointerError;if(keepGoing&&!keepGoing(context))return static_cast<HResult>(0x80004004u);return api_.drawPict?api_.drawPict(pdf_.data(),pdf_.size(),dc,bounds):NotImplemented;}
    HResult GetColorSet(std::uint32_t,std::int32_t,void*,void*,void*,void** palette)override{if(!palette)return PointerError;*palette=nullptr;return NotImplemented;}
    HResult Freeze(std::uint32_t,std::int32_t,void*,std::uint32_t* cookie)override{if(!cookie)return PointerError;*cookie=0;return NotImplemented;}
    HResult Unfreeze(std::uint32_t)override{return NotImplemented;}
    HResult SetAdvise(std::uint32_t aspect,std::uint32_t flags,AdviseSink* sink)override{if(aspect!=1)return AspectError;viewAspect_=aspect;viewFlags_=flags;viewSink_=Ref<AdviseSink>(sink);if(flags&2)notifyView();gauges();return Ok;}
    HResult GetAdvise(std::uint32_t* aspect,std::uint32_t* flags,AdviseSink** sink)override{if(aspect)*aspect=viewAspect_;if(flags)*flags=viewFlags_;if(sink){*sink=viewSink_.get();if(*sink)(*sink)->AddRef();}return Ok;}
    HResult GetExtent(std::uint32_t aspect,std::int32_t index,void* target,SizeL* out)override{if(index!=-1||target)return FormatError;return GetExtent(aspect,out);}
    HResult finish(std::uint64_t id,const std::uint8_t* data,std::size_t size,bool apply){return measured(apply?Metric::ApplyCalls:Metric::CancelCalls,apply?Metric::ApplyResult:Metric::CancelResult,[&]() -> HResult {
        if(!correctThread())return WrongThread;if(id!=session_)return NoConnection;
        if(apply){if(noScribble_||closed_)return Unexpected;if(!validNative(data,size))return StorageHeaderError;native_.assign(data,data+size);dirty_=true;increment(Metric::EditGeneration);if(forgetEditorOwner)forgetEditorOwner(0,editorContext);if(editorOwnerWritten)editorOwnerWritten(identity_,native_.data(),native_.size(),editorContext);notifyData();notifyView();if(client_){auto hr=requestSave();if(hr<0)return hr;}}
        session_=0;return Ok;});
    }
    HResult preview(const std::uint8_t* data,std::size_t size,SizeL extent){return measured(Metric::PreviewCalls,Metric::PreviewResult,[&]() -> HResult {if(!correctThread())return WrongThread;if(noScribble_||closed_)return Unexpected;if(!data||!size||size>MaxBytes||extent.width<=0||extent.height<=0)return InvalidArgument;pdf_.assign(data,data+size);extent_=extent;return Ok;});}
};
}
void setInteropHooks(const InteropHooks& api){hooks=api;}
void setEditorHooks(OpenEditor open,void* context){openEditor=open;editorContext=context;cancelEditor=nullptr;forgetEditorOwner=nullptr;editorOwnerWritten=nullptr;}
void setEditorCancelHook(CancelEditor cancel){cancelEditor=cancel;}
void setEditorOwnerForgetHook(ForgetEditorOwner forget){forgetEditorOwner=forget;}
void setEditorOwnerWrittenHook(EditorOwnerWritten written){editorOwnerWritten=written;}
std::uint64_t editObjectIdentity(std::uint64_t session){std::lock_guard lock(sessionMutex);auto it=sessions.find(session);return it==sessions.end()?0:it->second->identity();}
bool bindEditDocument(std::uint64_t session,const char* identity){std::lock_guard lock(sessionMutex);auto it=sessions.find(session);return it!=sessions.end()&&it->second->bindDocument(identity);}
std::uint32_t liveEquationObjects(){return live.load();}
std::int32_t diagnosticValue(std::uint32_t metric){if(metric==0)return 2;return metric<MetricCount?diagnostics.values[metric].load():InvalidArgument;}
HResult makeEquationObject(const Guid& clsid,const Guid& iid,void** out){if(!out)return PointerError;*out=nullptr;auto* object=new EquationObject(clsid);auto hr=object->QueryInterface(iid,out);object->Release();return hr;}
HResult completeEdit(std::uint64_t id,const std::uint8_t* data,std::size_t size,bool apply,bool reopen){
    EquationObject* object=nullptr;{std::lock_guard lock(sessionMutex);auto it=sessions.find(id);if(it==sessions.end())return NoConnection;object=it->second;object->AddRef();}
    auto hr=object->finish(id,data,size,apply);
    if(hr==Ok){bool removed=false;{std::lock_guard lock(sessionMutex);removed=sessions.erase(id)>0;}if(removed){if(cancelEditor)cancelEditor(id,editorContext);object->Release();}}
    // A new user activation can arrive while the previous cancellation/save
    // is being consumed. Finish that transaction first, then allocate a fresh
    // session on this SAME live OLE object and client site.
    if(hr==Ok&&reopen)hr=object->DoVerb(0,nullptr,nullptr,0,nullptr,nullptr);
    object->Release();return hr;
}
HResult setSessionPreview(std::uint64_t id,const std::uint8_t* data,std::size_t size,SizeL extent){
    EquationObject* object=nullptr;{std::lock_guard lock(sessionMutex);auto it=sessions.find(id);if(it==sessions.end())return NoConnection;object=it->second;object->AddRef();}
    auto hr=object->preview(data,size,extent);object->Release();return hr;
}
}
