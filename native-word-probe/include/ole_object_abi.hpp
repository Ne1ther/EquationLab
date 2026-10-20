#pragma once
#include "storage_abi.hpp"
#include <cstddef>

namespace bridge_probe {
constexpr Guid oleIid(std::uint32_t first) { return {first,0,0,{0xc0,0,0,0,0,0,0,0x46}}; }
inline constexpr Guid OleObjectId=oleIid(0x112), PersistId=oleIid(0x10c), PersistStorageId=oleIid(0x10a), DataObjectId=oleIid(0x10e), ViewObjectId=oleIid(0x10d), ViewObject2Id=oleIid(0x127);
inline constexpr Guid EnumFormatEtcId=oleIid(0x103), EnumOleVerbId=oleIid(0x104), EnumStatDataId=oleIid(0x105);
inline constexpr HResult NotImplemented=static_cast<HResult>(0x80004001u), InvalidArgument=static_cast<HResult>(0x80070057u), Unexpected=static_cast<HResult>(0x8000ffffu);
inline constexpr HResult FormatError=static_cast<HResult>(0x80040064u), TymedError=static_cast<HResult>(0x80040069u), AspectError=static_cast<HResult>(0x8004006bu);
inline constexpr HResult StorageHeaderError=static_cast<HResult>(0x800300fbu), NoConnection=static_cast<HResult>(0x80040004u);
struct SizeL { std::int32_t width,height; };
struct RectL { std::int32_t left,top,right,bottom; };
struct FormatEtc { std::uint16_t format; void* target; std::uint32_t aspect; std::int32_t index; std::uint32_t tymed; };
struct StgMedium { std::uint32_t tymed; union { void* handle; Storage* storage; Stream* stream; OleChar* file; }; Unknown* release; };
static_assert(sizeof(FormatEtc)==32 && sizeof(StgMedium)==24 && sizeof(SizeL)==8 && sizeof(RectL)==16);
struct AdviseSink : Unknown {
    virtual void OnDataChange(FormatEtc*,StgMedium*)=0;
    virtual void OnViewChange(std::uint32_t,std::int32_t)=0;
    virtual void OnRename(Unknown*)=0;
    virtual void OnSave()=0;
    virtual void OnClose()=0;
};
struct OleClientSite : Unknown {
    virtual HResult SaveObject()=0;
    virtual HResult GetMoniker(std::uint32_t,std::uint32_t,Unknown**)=0;
    virtual HResult GetContainer(Unknown**)=0;
    virtual HResult ShowObject()=0;
    virtual HResult OnShowWindow(std::int32_t)=0;
    virtual HResult RequestNewObjectLayout()=0;
};
struct StatData { FormatEtc format; std::uint32_t flags; AdviseSink* sink; std::uint32_t connection; };
struct OleVerb { std::int32_t verb; OleChar* name; std::uint32_t flags,attributes; };
struct EnumFormatEtc : Unknown {
    virtual HResult Next(ULong,FormatEtc*,ULong*)=0;
    virtual HResult Skip(ULong)=0;
    virtual HResult Reset()=0;
    virtual HResult Clone(EnumFormatEtc**)=0;
};
struct EnumOleVerb : Unknown {
    virtual HResult Next(ULong,OleVerb*,ULong*)=0;
    virtual HResult Skip(ULong)=0;
    virtual HResult Reset()=0;
    virtual HResult Clone(EnumOleVerb**)=0;
};
struct EnumStatData : Unknown {
    virtual HResult Next(ULong,StatData*,ULong*)=0;
    virtual HResult Skip(ULong)=0;
    virtual HResult Reset()=0;
    virtual HResult Clone(EnumStatData**)=0;
};
struct PersistStorage : Unknown {
    virtual HResult GetClassID(Guid*)=0;
    virtual HResult IsDirty()=0;
    virtual HResult InitNew(Storage*)=0;
    virtual HResult Load(Storage*)=0;
    virtual HResult Save(Storage*,std::int32_t)=0;
    virtual HResult SaveCompleted(Storage*)=0;
    virtual HResult HandsOffStorage()=0;
};
struct DataObject : Unknown {
    virtual HResult GetData(FormatEtc*,StgMedium*)=0;
    virtual HResult GetDataHere(FormatEtc*,StgMedium*)=0;
    virtual HResult QueryGetData(FormatEtc*)=0;
    virtual HResult GetCanonicalFormatEtc(FormatEtc*,FormatEtc*)=0;
    virtual HResult SetData(FormatEtc*,StgMedium*,std::int32_t)=0;
    virtual HResult EnumFormatEtc(std::uint32_t,bridge_probe::EnumFormatEtc**)=0;
    virtual HResult DAdvise(FormatEtc*,std::uint32_t,AdviseSink*,std::uint32_t*)=0;
    virtual HResult DUnadvise(std::uint32_t)=0;
    virtual HResult EnumDAdvise(EnumStatData**)=0;
};
struct ViewObject2 : Unknown {
    virtual HResult Draw(std::uint32_t,std::int32_t,void*,void*,void*,void*,const RectL*,const RectL*,std::int32_t(*)(std::uintptr_t),std::uintptr_t)=0;
    virtual HResult GetColorSet(std::uint32_t,std::int32_t,void*,void*,void*,void**)=0;
    virtual HResult Freeze(std::uint32_t,std::int32_t,void*,std::uint32_t*)=0;
    virtual HResult Unfreeze(std::uint32_t)=0;
    virtual HResult SetAdvise(std::uint32_t,std::uint32_t,AdviseSink*)=0;
    virtual HResult GetAdvise(std::uint32_t*,std::uint32_t*,AdviseSink**)=0;
    virtual HResult GetExtent(std::uint32_t,std::int32_t,void*,SizeL*)=0;
};
struct OleObject : Unknown {
    virtual HResult SetClientSite(OleClientSite*)=0;
    virtual HResult GetClientSite(OleClientSite**)=0;
    virtual HResult SetHostNames(const OleChar*,const OleChar*)=0;
    virtual HResult Close(std::uint32_t)=0;
    virtual HResult SetMoniker(std::uint32_t,Unknown*)=0;
    virtual HResult GetMoniker(std::uint32_t,std::uint32_t,Unknown**)=0;
    virtual HResult InitFromData(DataObject*,std::int32_t,std::uint32_t)=0;
    virtual HResult GetClipboardData(std::uint32_t,DataObject**)=0;
    virtual HResult DoVerb(std::int32_t,void*,OleClientSite*,std::int32_t,void*,const RectL*)=0;
    virtual HResult EnumVerbs(EnumOleVerb**)=0;
    virtual HResult Update()=0;
    virtual HResult IsUpToDate()=0;
    virtual HResult GetUserClassID(Guid*)=0;
    virtual HResult GetUserType(std::uint32_t,OleChar**)=0;
    virtual HResult SetExtent(std::uint32_t,SizeL*)=0;
    virtual HResult GetExtent(std::uint32_t,SizeL*)=0;
    virtual HResult Advise(AdviseSink*,std::uint32_t*)=0;
    virtual HResult Unadvise(std::uint32_t)=0;
    virtual HResult EnumAdvise(EnumStatData**)=0;
    virtual HResult GetMiscStatus(std::uint32_t,std::uint32_t*)=0;
    virtual HResult SetColorScheme(void*)=0;
};
struct InteropHooks {
    void* (*allocate)(std::size_t)=nullptr;
    void (*free)(void*)=nullptr;
    void* (*createPict)(const std::uint8_t*,std::size_t)=nullptr;
    void (*deletePict)(void*)=nullptr;
    HResult (*createStorage)(Storage**)=nullptr;
    HResult (*drawPict)(const std::uint8_t*,std::size_t,void*,const RectL*)=nullptr;
    std::uint16_t embedSourceFormat=0;
};
using OpenEditor = HResult(*)(std::uint64_t,const std::uint8_t*,std::size_t,void*);
using CancelEditor = void(*)(std::uint64_t,void*);
// A zero identity invalidates all document snapshots after a Native write.
using ForgetEditorOwner = void(*)(std::uint64_t,void*);
using EditorOwnerWritten = void(*)(std::uint64_t,const std::uint8_t*,std::size_t,void*);
HResult makeEquationObject(const Guid&,const Guid&,void**);
void setInteropHooks(const InteropHooks&);
void setEditorHooks(OpenEditor,void*);
void setEditorCancelHook(CancelEditor);
void setEditorOwnerForgetHook(ForgetEditorOwner);
void setEditorOwnerWrittenHook(EditorOwnerWritten);
std::uint64_t editObjectIdentity(std::uint64_t);
bool bindEditDocument(std::uint64_t,const char*);
HResult completeEdit(std::uint64_t,const std::uint8_t*,std::size_t,bool,bool reopen=false);
HResult setSessionPreview(std::uint64_t,const std::uint8_t*,std::size_t,SizeL);
std::uint32_t liveEquationObjects();
}
