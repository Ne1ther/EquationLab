#include "word_ole_abi.hpp"
#include "ole_object_abi.hpp"
#include "interop_runtime.hpp"
#include "editor_transport.hpp"
#include "diagnostics.hpp"
#include <atomic>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <string>
#include <vector>

using namespace bridge_probe;
namespace {
class ProbeFactory final : public ClassFactory {
    std::atomic<ULong> references_{1};
    Guid classId_;
public:
    explicit ProbeFactory(Guid id):classId_(id){}
    HResult QueryInterface(const Guid& iid, void** object) override {
        if (!object) return PointerError;
        *object = nullptr;
        if (!equal(iid, UnknownId) && !equal(iid, ClassFactoryId)) return NoInterface;
        *object = static_cast<ClassFactory*>(this);
        AddRef();
        return Ok;
    }
    ULong AddRef() override { return ++references_; }
    ULong Release() override {
        // The registration table retains a process-lifetime callback; this
        // static factory deliberately has process lifetime as well.
        ULong old = references_.load();
        while (old > 1 && !references_.compare_exchange_weak(old, old - 1)) {}
        return old > 1 ? old - 1 : 1;
    }
    HResult CreateInstance(Unknown* outer, const Guid& iid, void** object) override {
        if (!object) return PointerError;
        *object = nullptr;
        return outer ? NoAggregation : makeEquationObject(classId_, iid, object);
    }
    HResult LockServer(std::int32_t) override { return Ok; }
};
ProbeFactory factory(ProbeClassId),windowsFactory(MathTypeWindowsClassId),macFactory(MathTypeMacClassId);
Guid registrationClass = ProbeClassId;
Guid* registrationClasses[]{&registrationClass, nullptr};
std::atomic<bool> registered{false};
std::atomic<bool> registeredMathType{false};
Guid windowsClass=MathTypeWindowsClassId,macClass=MathTypeMacClassId;
Guid* mathTypeClasses[]{&windowsClass,&macClass,nullptr};
HResult getClass(const Guid& clsid, const Guid& iid, void** object) {
    if (!object) return PointerError;
    *object = nullptr;
    if (!equal(clsid, ProbeClassId)) return ClassNotAvailable;
    return factory.QueryInterface(iid, object);
}
HResult getMathTypeClass(const Guid& clsid,const Guid& iid,void** object){
    if(!object)return PointerError;*object=nullptr;
    if(!registeredMathType.load())return ClassNotAvailable;
    if(equal(clsid,MathTypeWindowsClassId))return windowsFactory.QueryInterface(iid,object);
    if(equal(clsid,MathTypeMacClassId))return macFactory.QueryInterface(iid,object);
    return ClassNotAvailable;
}
bool retainOwnModule(){
    // The shim retains callbacks after the VBA loader document can close.
    // Keep our independently owned image loaded until Word process exit.
    static void* retained=nullptr;if(retained)return true;
    Dl_info info{};if(!dladdr(reinterpret_cast<void*>(&getClass),&info)||!info.dli_fname)return false;
    retained=dlopen(info.dli_fname,RTLD_NOW|RTLD_LOCAL);return retained!=nullptr;
}
HResult registerMathType(RegisterClassFactories registerClass){
    if(!registerClass)return -2;
    if(editorTransportActive()!=0)return Unexpected;
    if(!retainOwnModule())return -5;
    if(!registeredMathType.exchange(true))registerClass(&getMathTypeClass,mathTypeClasses);
    return Ok;
}
bool insideWord() {
    std::uint32_t count = 0;
    _NSGetExecutablePath(nullptr, &count);
    std::vector<char> path(count + 1);
    if (_NSGetExecutablePath(path.data(), &count) != 0) return false;
    const std::string value(path.data());
    return value.ends_with("/Contents/MacOS/Microsoft Word");
}
}

extern "C" __attribute__((visibility("default")))
HResult MathTypeBridgeGetClassObject(const Guid* clsid, const Guid* iid, void** object) {
    if (!clsid || !iid) {
        if (object) *object = nullptr;
        return PointerError;
    }
    return getClass(*clsid, *iid, object);
}

extern "C" __attribute__((visibility("default")))
HResult MathTypeBridgeInitialize() {
    if (!insideWord()) return -1;
    if (prepareInteropRuntimeInWord() != Ok) return -3;
    if (installEditorTransport() != Ok) return -4;
    auto registerClass = reinterpret_cast<RegisterClassFactories>(
        dlsym(wordSdkShimHandle(), "RegisterDllGetClassObjectWithClassIDs_Shim"));
    if (!registerClass) return -2;
    if (!retainOwnModule()) return -5;
    if (!registered.exchange(true)) registerClass(&getClass, registrationClasses);
    return Ok;
}

// Explicitly requested process-local routing. Initialize above stays private.
extern "C" __attribute__((visibility("default")))
HResult MathTypeBridgeRegisterMathTypeClasses(){
    if(!insideWord())return -1;
    if(editorTransportActive()!=0)return Unexpected;
    auto hr=MathTypeBridgeInitialize();if(hr!=Ok)return hr;
    return registerMathType(reinterpret_cast<RegisterClassFactories>(dlsym(wordSdkShimHandle(),"RegisterDllGetClassObjectWithClassIDs_Shim")));
}
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeMathTypeRegistrationState(){return registeredMathType.load()?1:0;}
extern "C" __attribute__((visibility("default")))
HResult MathTypeBridgeGetMathTypeClassObject(const Guid* clsid,const Guid* iid,void** out){if(!clsid||!iid){if(out)*out=nullptr;return PointerError;}return getMathTypeClass(*clsid,*iid,out);}
// Standalone runtime test only; this cannot enable aliases in a Word process.
extern "C" __attribute__((visibility("default")))
HResult MathTypeBridgeRegisterMathTypeForTesting(RegisterClassFactories registration){if(insideWord())return InvalidArgument;return registerMathType(registration);}

extern "C" __attribute__((visibility("default")))
HResult MathTypeBridgeSetInteropHooks(const InteropHooks* api, std::size_t size) {
    if (!api || size != sizeof(InteropHooks)) return InvalidArgument;
    setInteropHooks(*api); return Ok;
}
extern "C" __attribute__((visibility("default")))
void MathTypeBridgeSetEditorHooks(OpenEditor open, void* context) { setEditorHooks(open, context); }
extern "C" __attribute__((visibility("default")))
HResult MathTypeBridgeCompleteEdit(std::uint64_t session, const std::uint8_t* data, std::size_t size, std::int32_t apply) { return completeEdit(session, data, size, apply != 0); }
extern "C" __attribute__((visibility("default")))
HResult MathTypeBridgeSetSessionPreview(std::uint64_t session, const std::uint8_t* data, std::size_t size, std::int32_t width, std::int32_t height) { return setSessionPreview(session, data, size, {width,height}); }
extern "C" __attribute__((visibility("default")))
std::uint32_t MathTypeBridgeLiveObjectCount() { return liveEquationObjects(); }
extern "C" __attribute__((visibility("default")))
std::int32_t MathTypeBridgeDiagnostic(std::uint32_t metric) { return diagnosticValue(metric); }

// No load constructor or automatic registration. Both entrypoints are manual;
// MathType routing is enabled only by its separate, explicit entrypoint.
