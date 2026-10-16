#pragma once
#include "ole_object_abi.hpp"
namespace bridge_probe {
HResult prepareInteropRuntime(void* shim,void* com,void* ole,void* graphics,void* kernel);
HResult prepareInteropRuntimeInWord();
void* wordSdkShimHandle();
HResult drawPdfToHdc(const std::uint8_t*,std::size_t,void*,const RectL*);
}
