// Exercise the production PDF adapter with a real PDF and a Retina-scaled
// Office medium. No Word process, registration or GUI is used by this test.
#include "interop_runtime.cpp"
#include <iostream>
#include <stdexcept>
namespace bridge_probe {void setInteropHooks(const InteropHooks&) {}}
using namespace bridge_probe;
namespace {
OfficeMetafilePict medium{};
int creates=0,deletes=0,unlocks=0;
bool failLock=false,wrongLayout=false,wrongMode=false;
std::int32_t nativeWidth=1270,nativeHeight=635;
DesktopDpi dpiValue{72,0,1,72,0,1};
const DesktopDpi* dpi(){return &dpiValue;}
CGRect observedBox{};CFDataRef sourcePDF=nullptr;bool originalPassedThrough=false;double filledFraction=0;
void* create(CFDataRef bytes,CFTypeRef){
    ++creates;auto provider=CGDataProviderCreateWithCFData(bytes);auto document=CGPDFDocumentCreateWithProvider(provider);
    auto page=CGPDFDocumentGetPage(document,1);observedBox=CGPDFPageGetBoxRect(page,kCGPDFCropBox);
    const auto w=static_cast<std::size_t>(observedBox.size.width),h=static_cast<std::size_t>(observedBox.size.height);
    std::vector<std::uint8_t> pixels(w*h*4);auto color=CGColorSpaceCreateDeviceRGB();
    auto raster=CGBitmapContextCreate(pixels.data(),w,h,8,w*4,color,kCGImageAlphaPremultipliedLast);CGColorSpaceRelease(color);
    CGContextDrawPDFPage(raster,page);CGContextRelease(raster);
    std::size_t filled=0;for(std::size_t i=3;i<pixels.size();i+=4)if(pixels[i]>240)++filled;filledFraction=static_cast<double>(filled)/(w*h);
    CGPDFDocumentRelease(document);CGDataProviderRelease(provider);originalPassedThrough=CFEqual(bytes,sourcePDF);
    medium={wrongMode?1:8,nativeWidth,nativeHeight,reinterpret_cast<void*>(0x1234)};return &medium;
}
std::int32_t destroy(void*){++deletes;return 1;}
void* lock(void*){return failLock?nullptr:&medium;}
std::int32_t unlock(void*){++unlocks;return 1;}
std::size_t size(void*){return wrongLayout?16:24;}
void check(bool value,const char* text){if(!value)throw std::runtime_error(text);}
}
int main(){
    try{
        createPict=create;deletePict=destroy;lockGlobal=lock;unlockGlobal=unlock;sizeGlobal=size;
        auto bytes=CFDataCreateMutable(kCFAllocatorDefault,0);auto consumer=CGDataConsumerCreateWithCFData(bytes);
        CGRect box=CGRectMake(0,0,72,36);auto context=CGPDFContextCreate(consumer,&box,nullptr);
        CGPDFContextBeginPage(context,nullptr);CGContextFillRect(context,box);CGPDFContextEndPage(context);CGPDFContextClose(context);
        CGContextRelease(context);CGDataConsumerRelease(consumer);
        sourcePDF=bytes;auto data=CFDataGetBytePtr(bytes);auto length=static_cast<std::size_t>(CFDataGetLength(bytes));
        check(pict(data,length)==&medium,"Retina medium rejected");
        check(medium.width==2540&&medium.height==1270&&medium.mapMode==8&&medium.metafile==reinterpret_cast<void*>(0x1234),"Physical extents or medium identity changed incorrectly");
        nativeWidth=2540;nativeHeight=1270;check(pict(data,length)==&medium&&medium.width==2540&&medium.height==1270,"1x extent changed");
        desktopDpi=dpi;dpiValue.xScale=2;dpiValue.yScale=2;
        check(pict(data,length)==&medium&&observedBox.size.width==144&&observedBox.size.height==72&&!originalPassedThrough,"2x presentation carrier not adapted");
        check(filledFraction>0.99,"2x page enlarged without enlarging its drawn content");
        check(medium.width==2540&&medium.height==1270,"Presentation DPI changed physical HIMETRIC extents");
        dpiValue.xScale=1;dpiValue.yScale=1;check(pict(data,length)==&medium&&originalPassedThrough,"1x original PDF bytes changed");
        dpiValue.xScale=1.5;dpiValue.yScale=2;check(pict(data,length)==&medium&&observedBox.size.width==108&&observedBox.size.height==72,"Per-axis noninteger DPI was rounded or ignored");
        check(filledFraction>0.99,"Per-axis page and content scales differ");
        dpiValue.xScale=0;check(!pict(data,length),"Invalid DPI was accepted");dpiValue.xScale=std::numeric_limits<double>::quiet_NaN();check(!pict(data,length),"Nonfinite DPI was accepted");dpiValue.xScale=1;dpiValue.yScale=1;
        wrongLayout=true;check(!pict(data,length)&&deletes==1,"Unknown Office layout was accepted");wrongLayout=false;
        failLock=true;check(!pict(data,length)&&deletes==2,"Failed lock leaked a medium");failLock=false;
        wrongMode=true;check(!pict(data,length)&&deletes==3&&unlocks==6,"Unknown map mode was accepted or remained locked");wrongMode=false;
        const int beforeInvalid=creates;const std::uint8_t invalid[]={1,2,3};check(!pict(invalid,sizeof(invalid))&&creates==beforeInvalid,"Malformed PDF reached Office");
        auto vector=CFDataCreateMutable(kCFAllocatorDefault,0);consumer=CGDataConsumerCreateWithCFData(vector);
        const void* keys[]={kCGPDFContextCreator};const void* values[]={CFSTR("Equation Lab Vector Preview v1")};
        auto info=CFDictionaryCreate(kCFAllocatorDefault,keys,values,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
        context=CGPDFContextCreate(consumer,&box,info);CFRelease(info);
        CGPDFContextBeginPage(context,nullptr);CGContextFillRect(context,box);CGPDFContextEndPage(context);CGPDFContextClose(context);CGContextRelease(context);CGDataConsumerRelease(consumer);
        sourcePDF=vector;dpiValue.xScale=2;dpiValue.yScale=2;
        check(pict(CFDataGetBytePtr(vector),CFDataGetLength(vector))==&medium&&originalPassedThrough&&observedBox.size.width==72&&observedBox.size.height==36&&medium.width==2540&&medium.height==1270,"Vector presentation incorrectly received legacy Retina bitmap compensation");
        CFRelease(vector);CFRelease(bytes);
        std::cout<<"{\"cases\":11,\"retina_and_1x_physical_extents\":true,\"pdf_page_points\":[72,36],\"himetric\":[2540,1270],\"presentation_2x_and_noninteger_per_axis_dpi\":true,\"one_x_original_pdf_bytes_exact\":true,\"invalid_dpi_layout_lock_mode_and_pdf_reject\":true,\"real_word_used\":false}\n";
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
