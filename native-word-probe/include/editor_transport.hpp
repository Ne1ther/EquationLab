#pragma once
#include "ole_object_abi.hpp"
namespace bridge_probe {
using LaunchEditorUrl = bool(*)(const char*,void*);
HResult installEditorTransport();
HResult installEditorTransportForTesting(std::uint16_t,LaunchEditorUrl,void*,std::uint32_t);
std::uint32_t editorTransportActive();
std::uint32_t editorTransportLastError();
}
