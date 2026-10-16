#pragma once
#include "word_ole_abi.hpp"

namespace bridge_probe {
// Office's exported wide-character APIs use 16-bit WCHAR even on arm64 macOS.
// Native Clang wchar_t is 32-bit and must not be passed to those interfaces.
using OleChar = char16_t;
union ULargeInteger { std::uint64_t value; struct { std::uint32_t low, high; } parts; };
union LargeInteger { std::int64_t value; struct { std::uint32_t low; std::int32_t high; } parts; };
struct FileTime { std::uint32_t low, high; };
struct StatStg {
    OleChar* name;
    std::uint32_t type;
    ULargeInteger size;
    FileTime modification, creation, access;
    std::uint32_t mode, locksSupported;
    Guid clsid;
    std::uint32_t stateBits, reserved;
};
static_assert(sizeof(ULargeInteger) == 8 && sizeof(StatStg) == 80);
struct Stream : Unknown {
    virtual HResult Read(void*, ULong, ULong*) = 0;
    virtual HResult Write(const void*, ULong, ULong*) = 0;
    virtual HResult Seek(LargeInteger, std::uint32_t, ULargeInteger*) = 0;
    virtual HResult SetSize(ULargeInteger) = 0;
    virtual HResult CopyTo(Stream*, ULargeInteger, ULargeInteger*, ULargeInteger*) = 0;
    virtual HResult Commit(std::uint32_t) = 0;
    virtual HResult Revert() = 0;
    virtual HResult LockRegion(ULargeInteger, ULargeInteger, std::uint32_t) = 0;
    virtual HResult UnlockRegion(ULargeInteger, ULargeInteger, std::uint32_t) = 0;
    virtual HResult Stat(StatStg*, std::uint32_t) = 0;
    virtual HResult Clone(Stream**) = 0;
};
struct EnumStatStg : Unknown {
    virtual HResult Next(ULong, StatStg*, ULong*) = 0;
    virtual HResult Skip(ULong) = 0;
    virtual HResult Reset() = 0;
    virtual HResult Clone(EnumStatStg**) = 0;
};
struct Storage : Unknown {
    virtual HResult CreateStream(const OleChar*, std::uint32_t, std::uint32_t, std::uint32_t, Stream**) = 0;
    virtual HResult OpenStream(const OleChar*, void*, std::uint32_t, std::uint32_t, Stream**) = 0;
    virtual HResult CreateStorage(const OleChar*, std::uint32_t, std::uint32_t, std::uint32_t, Storage**) = 0;
    virtual HResult OpenStorage(const OleChar*, Storage*, std::uint32_t, OleChar**, std::uint32_t, Storage**) = 0;
    virtual HResult CopyTo(std::uint32_t, const Guid*, OleChar**, Storage*) = 0;
    virtual HResult MoveElementTo(const OleChar*, Storage*, const OleChar*, std::uint32_t) = 0;
    virtual HResult Commit(std::uint32_t) = 0;
    virtual HResult Revert() = 0;
    virtual HResult EnumElements(std::uint32_t, void*, std::uint32_t, EnumStatStg**) = 0;
    virtual HResult DestroyElement(const OleChar*) = 0;
    virtual HResult RenameElement(const OleChar*, const OleChar*) = 0;
    virtual HResult SetElementTimes(const OleChar*, const FileTime*, const FileTime*, const FileTime*) = 0;
    virtual HResult SetClass(const Guid&) = 0;
    virtual HResult SetStateBits(std::uint32_t, std::uint32_t) = 0;
    virtual HResult Stat(StatStg*, std::uint32_t) = 0;
};
struct LockBytes : Unknown {
    virtual HResult ReadAt(ULargeInteger, void*, ULong, ULong*) = 0;
    virtual HResult WriteAt(ULargeInteger, const void*, ULong, ULong*) = 0;
    virtual HResult Flush() = 0;
    virtual HResult SetSize(ULargeInteger) = 0;
    virtual HResult LockRegion(ULargeInteger, ULargeInteger, std::uint32_t) = 0;
    virtual HResult UnlockRegion(ULargeInteger, ULargeInteger, std::uint32_t) = 0;
    virtual HResult Stat(StatStg*, std::uint32_t) = 0;
};
inline constexpr std::uint32_t StorageReadWriteExclusive = 0x12;
inline constexpr std::uint32_t StorageReadExclusive = 0x10;
inline constexpr std::uint32_t StorageCreateReadWriteExclusive = 0x1012;
}
