#pragma once

#include <cstdint>
#include <cstring>

// Independently declared from fixed-width GUID layout and exported Mach-O types.
// These declarations cover the class-factory boundary only, not the Office SDK.
namespace bridge_probe {
using HResult = std::int32_t;
using ULong = std::uint32_t;
struct Guid {
    std::uint32_t data1;
    std::uint16_t data2;
    std::uint16_t data3;
    std::uint8_t data4[8];
};
static_assert(sizeof(Guid) == 16);
static_assert(alignof(Guid) == 4);
inline bool equal(const Guid& a, const Guid& b) { return std::memcmp(&a, &b, sizeof(Guid)) == 0; }
inline constexpr HResult Ok = 0;
inline constexpr HResult NoInterface = static_cast<HResult>(0x80004002u);
inline constexpr HResult PointerError = static_cast<HResult>(0x80004003u);
inline constexpr HResult ClassNotAvailable = static_cast<HResult>(0x80040111u);
inline constexpr HResult NoAggregation = static_cast<HResult>(0x80040110u);
inline constexpr Guid UnknownId{0, 0, 0, {0xc0, 0, 0, 0, 0, 0, 0, 0x46}};
inline constexpr Guid ClassFactoryId{1, 0, 0, {0xc0, 0, 0, 0, 0, 0, 0, 0x46}};
inline constexpr Guid ProbeClassId{0x7c3f8a56, 0xed57, 0x4c9b, {0xa3, 0x40, 0xc3, 0x0c, 0x78, 0x67, 0xb8, 0x57}};
inline constexpr Guid MathTypeWindowsClassId{0x0002ce03, 0, 0, {0xc0, 0, 0, 0, 0, 0, 0, 0x46}};
inline constexpr Guid MathTypeMacClassId{0x0002ce03, 0, 0, {0xc0, 0, 0, 0, 0, 0, 0, 0x56}};

struct Unknown {
    virtual HResult QueryInterface(const Guid&, void**) = 0;
    virtual ULong AddRef() = 0;
    virtual ULong Release() = 0;
    // No virtual destructor: it would change the COM vtable layout.
};
struct ClassFactory : Unknown {
    virtual HResult CreateInstance(Unknown* outer, const Guid& iid, void** object) = 0;
    virtual HResult LockServer(std::int32_t lock) = 0;
};

// Exact parameter shape encoded by the shipped COMBase export:
// Apex::RegisterDllGetClassObjectWithClassIDs(int (*)(const _GUID&,
// const _GUID&, void**), _GUID**). Return void is supported by its assembly.
using GetClassObject = HResult (*)(const Guid&, const Guid&, void**);
using RegisterClassFactories = void (*)(GetClassObject, Guid**);
using PublicGetClassObject = HResult (*)(const Guid*, const Guid*, void**);
using Initialize = HResult (*)();
}
