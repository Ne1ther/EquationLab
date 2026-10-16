#include "interop_runtime.hpp"
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <dlfcn.h>
#include <limits>
#include <mach-o/dyld.h>
#include <string>
#include <vector>
#include <cmath>
#include <cstddef>
#include <cstring>

namespace bridge_probe {
namespace {
template<class F>F find(void* h,const char* name){return reinterpret_cast<F>(dlsym(h,name));}
HResult(*createBytes)(void*,std::int32_t,LockBytes**)=nullptr;
HResult(*createStorage)(LockBytes*,std::uint32_t,std::uint32_t,Storage**)=nullptr;
void*(*createPict)(CFDataRef,CFTypeRef)=nullptr;
std::int32_t(*deletePict)(void*)=nullptr;
void*(*lockGlobal)(void*)=nullptr;
std::int32_t(*unlockGlobal)(void*)=nullptr;
std::size_t(*sizeGlobal)(void*)=nullptr;
// Gfx returns a pointer to a readonly 32-byte pair of scaled DPI values,
// not a scalar or an aggregate returned by value. Verified against actual
// Word 16.113.4 consumers; see docs/history/word-pdf-presentation-sizing.md.
struct DesktopDpi {float xBase;std::uint32_t xPadding;double xScale;float yBase;std::uint32_t yPadding;double yScale;};
static_assert(sizeof(DesktopDpi)==32 && offsetof(DesktopDpi,xScale)==8 && offsetof(DesktopDpi,yBase)==16 && offsetof(DesktopDpi,yScale)==24);
const DesktopDpi*(*desktopDpi)()=nullptr;
CGContextRef(*getContext)(void*)=nullptr;
void* hostShim=nullptr;
HResult memoryStorage(Storage** out){if(!out)return PointerError;*out=nullptr;LockBytes* bytes=nullptr;auto hr=createBytes(nullptr,1,&bytes);if(hr<0)return hr;hr=createStorage(bytes,StorageCreateReadWriteExclusive,0,out);bytes->Release();return hr;}
struct OfficeMetafilePict {std::int32_t mapMode,width,height;void* metafile;};
static_assert(sizeof(OfficeMetafilePict)==24 && offsetof(OfficeMetafilePict,metafile)==16);
void* pict(const std::uint8_t* data,std::size_t size){
    if(!data||!size||size>16*1024*1024||!createPict||!deletePict||!lockGlobal||!unlockGlobal||!sizeGlobal)return nullptr;
    auto pdf=CFDataCreate(kCFAllocatorDefault,data,static_cast<CFIndex>(size));if(!pdf)return nullptr;
    auto provider=CGDataProviderCreateWithCFData(pdf);
    auto document=provider?CGPDFDocumentCreateWithProvider(provider):nullptr;
    if(provider)CGDataProviderRelease(provider);
    auto page=document?CGPDFDocumentGetPage(document,1):nullptr;
    auto box=page?CGPDFPageGetBoxRect(page,kCGPDFCropBox):CGRectZero;
    const double width=box.size.width*2540.0/72.0,height=box.size.height*2540.0/72.0;
    if(!std::isfinite(width)||!std::isfinite(height)||width<1||height<1||width>std::numeric_limits<std::int32_t>::max()||height>std::numeric_limits<std::int32_t>::max()){if(document)CGPDFDocumentRelease(document);CFRelease(pdf);return nullptr;}
    double scaleX=1,scaleY=1;
    // Our path-only renderer converts to genuine EMF in Word. Its dimensions
    // are already physical points. The older PNG-in-PDF carrier alone needs
    // the workaround for Word's 72-PPI bitmap fallback on Retina displays.
    CGPDFStringRef creator=nullptr;auto info=document?CGPDFDocumentGetInfo(document):nullptr;
    constexpr char vectorCreator[]="Equation Lab Vector Preview v1";
    const bool vectorCarrier=info&&CGPDFDictionaryGetString(info,"Creator",&creator)&&CGPDFStringGetLength(creator)==sizeof(vectorCreator)-1&&std::memcmp(CGPDFStringGetBytePtr(creator),vectorCreator,sizeof(vectorCreator)-1)==0;
    if(desktopDpi&&!vectorCarrier){
        const auto dpiPointer=desktopDpi();
        if(!dpiPointer){CGPDFDocumentRelease(document);CFRelease(pdf);return nullptr;}
        const auto dpi=*dpiPointer;
        scaleX=static_cast<double>(dpi.xBase)*dpi.xScale/72.0;scaleY=static_cast<double>(dpi.yBase)*dpi.yScale/72.0;
        if(!std::isfinite(scaleX)||!std::isfinite(scaleY)||scaleX<0.5||scaleY<0.5||scaleX>8||scaleY>8){CGPDFDocumentRelease(document);CFRelease(pdf);return nullptr;}
    }
    // Word's PDF blip path discards METAFILEPICT extents, rasterizes at 72 PPI,
    // then places the pixels using desktop virtual DPI. Adapt only this
    // presentation carrier. Native data, exported PDF and physical extents
    // remain unchanged; a 1x display passes the original PDF through exactly.
    CFMutableDataRef presentation=nullptr;
    if(std::abs(scaleX-1)>1e-9||std::abs(scaleY-1)>1e-9){
        presentation=CFDataCreateMutable(kCFAllocatorDefault,0);
        auto consumer=presentation?CGDataConsumerCreateWithCFData(presentation):nullptr;
        CGRect destination=CGRectMake(0,0,box.size.width*scaleX,box.size.height*scaleY);
        auto context=consumer?CGPDFContextCreate(consumer,&destination,nullptr):nullptr;
        if(consumer)CGDataConsumerRelease(consumer);
        if(!context){if(presentation)CFRelease(presentation);CGPDFDocumentRelease(document);CFRelease(pdf);return nullptr;}
        CGPDFContextBeginPage(context,nullptr);
        // CoreGraphics' fit transform centers small pages without enlarging
        // their contents. Scale the graphics state explicitly as well as the
        // page box, otherwise Word persists a larger image with tiny glyphs.
        CGContextScaleCTM(context,scaleX,scaleY);
        auto originalDestination=CGRectMake(0,0,box.size.width,box.size.height);
        CGContextConcatCTM(context,CGPDFPageGetDrawingTransform(page,kCGPDFCropBox,originalDestination,0,false));
        CGContextDrawPDFPage(context,page);CGPDFContextEndPage(context);CGPDFContextClose(context);CGContextRelease(context);
    }
    auto result=createPict(presentation?presentation:pdf,nullptr);
    if(presentation)CFRelease(presentation);CGPDFDocumentRelease(document);CFRelease(pdf);if(!result)return nullptr;
    // Consumers that do honor METAFILEPICT still receive physical HIMETRIC.
    if(sizeGlobal(result)!=sizeof(OfficeMetafilePict)){deletePict(result);return nullptr;}
    auto picture=static_cast<OfficeMetafilePict*>(lockGlobal(result));
    if(!picture){deletePict(result);return nullptr;}
    const bool valid=picture->mapMode==8&&picture->metafile;
    if(valid){picture->width=static_cast<std::int32_t>(std::llround(width));picture->height=static_cast<std::int32_t>(std::llround(height));}
    unlockGlobal(result);
    if(!valid){deletePict(result);return nullptr;}
    return result;
}
void destroyPict(void* value){deletePict(value);}
}
HResult drawPdfToHdc(const std::uint8_t* bytes,std::size_t size,void* dc,const RectL* bounds){
    if(!bytes||!size||size>16*1024*1024||!dc||!bounds)return InvalidArgument;
    if(!getContext)return NotImplemented;
    auto context=getContext(dc);if(!context)return InvalidArgument;
    auto data=CFDataCreate(kCFAllocatorDefault,bytes,static_cast<CFIndex>(size));if(!data)return Unexpected;
    auto provider=CGDataProviderCreateWithCFData(data);CFRelease(data);if(!provider)return Unexpected;
    auto document=CGPDFDocumentCreateWithProvider(provider);CGDataProviderRelease(provider);if(!document)return FormatError;
    auto page=CGPDFDocumentGetPage(document,1);if(!page){CGPDFDocumentRelease(document);return FormatError;}
    const auto width=static_cast<std::int64_t>(bounds->right)-bounds->left;
    const auto height=static_cast<std::int64_t>(bounds->bottom)-bounds->top;
    if(width<=0||height<=0){CGPDFDocumentRelease(document);return InvalidArgument;}
    CGRect destination=CGRectMake(bounds->left,bounds->top,static_cast<CGFloat>(width),static_cast<CGFloat>(height));
    CGContextSaveGState(context);
    CGContextClipToRect(context,destination);
    auto current=CGContextGetCTM(context);
    if(current.a*current.d-current.b*current.c<0){CGContextTranslateCTM(context,0,destination.origin.y*2+destination.size.height);CGContextScaleCTM(context,1,-1);}
    auto transform=CGPDFPageGetDrawingTransform(page,kCGPDFMediaBox,destination,0,true);
    CGContextConcatCTM(context,transform);CGContextDrawPDFPage(context,page);CGContextRestoreGState(context);
    CGPDFDocumentRelease(document);return Ok;
}
HResult prepareInteropRuntime(void* shim,void* com,void* ole,void* graphics,void* kernel){
    InteropHooks api;
    api.allocate=find<decltype(api.allocate)>(com,"CoTaskMemAlloc");api.free=find<decltype(api.free)>(com,"CoTaskMemFree");
    createBytes=find<decltype(createBytes)>(ole,"CreateILockBytesOnHGlobal");createStorage=find<decltype(createStorage)>(ole,"StgCreateDocfileOnILockBytes");
    createPict=find<decltype(createPict)>(shim,"CreateMetafilePictWithPDFData_Shim");deletePict=find<decltype(deletePict)>(shim,"DeleteMetafilePict_Shim");getContext=find<decltype(getContext)>(graphics,"GetCGClientContextHdc");
    lockGlobal=find<decltype(lockGlobal)>(kernel,"GlobalLock");unlockGlobal=find<decltype(unlockGlobal)>(kernel,"GlobalUnlock");sizeGlobal=find<decltype(sizeGlobal)>(kernel,"GlobalSize");
    auto registerFormat=find<std::uint32_t(*)(const char16_t*)>(kernel,"RegisterClipboardFormatW");
    if(!api.allocate||!api.free||!createBytes||!createStorage||!createPict||!deletePict||!getContext||!registerFormat||!lockGlobal||!unlockGlobal||!sizeGlobal)return NotImplemented;
    auto format=registerFormat(u"Embed Source");if(!format||format>std::numeric_limits<std::uint16_t>::max())return FormatError;
    api.embedSourceFormat=static_cast<std::uint16_t>(format);api.createStorage=memoryStorage;api.createPict=pict;api.deletePict=destroyPict;api.drawPict=drawPdfToHdc;setInteropHooks(api);return Ok;
}
HResult prepareInteropRuntimeInWord(){
    std::uint32_t count=0;_NSGetExecutablePath(nullptr,&count);std::vector<char> path(count+1);
    if(_NSGetExecutablePath(path.data(),&count)!=0)return Unexpected;
    std::string executable(path.data());constexpr auto suffix="/MacOS/Microsoft Word";
    if(!executable.ends_with(suffix))return InvalidArgument;
    auto prefix=executable.substr(0,executable.size()-std::char_traits<char>::length(suffix))+"/Frameworks/";
    auto load=[&](const char* name){auto relative=std::string(name)+".framework/Versions/A/"+name;return dlopen((prefix+relative).c_str(),RTLD_NOW|RTLD_LOCAL);};
    // Office itself owns WLM initialization. Retain these module references for
    // the lifetime of registered factory callbacks; never reinitialize the host.
    if(!hostShim)hostShim=load("WordSDKShim");
    static void* com=load("COMBase");static void* ole=load("OLE");static void* graphics=load("WLMGraphicsDevice");static void* kernel=load("WLMKernel");
    if(!hostShim||!com||!ole||!graphics||!kernel)return NotImplemented;
    static void* gfx=load("Gfx");
    desktopDpi=gfx?find<decltype(desktopDpi)>(gfx,"_ZN3Gfx20GetDesktopVirtualDPIEv"):nullptr;
    // AutoExec registers on Word's main thread. Refresh the cache even before
    // the first formula; Gfx also refreshes it on main-thread GetData calls.
    if(desktopDpi)desktopDpi();
    return prepareInteropRuntime(hostShim,com,ole,graphics,kernel);
}
void* wordSdkShimHandle(){return hostShim;}
}

extern "C" __attribute__((visibility("default")))
bridge_probe::HResult MathTypeBridgePrepareInteropRuntime(void* shim,void* com,void* ole,void* graphics,void* kernel){return bridge_probe::prepareInteropRuntime(shim,com,ole,graphics,kernel);}
extern "C" __attribute__((visibility("default")))
bridge_probe::HResult MathTypeBridgeDrawPdf(const std::uint8_t* bytes,std::size_t size,void* dc,const bridge_probe::RectL* bounds){return bridge_probe::drawPdfToHdc(bytes,size,dc,bounds);}
