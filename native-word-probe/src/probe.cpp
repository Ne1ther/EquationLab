#include "word_ole_abi.hpp"
#include <dlfcn.h>
#include <iostream>
#include <string>
using namespace bridge_probe;

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "Usage: abi-probe /path/to/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe [--inspect-shim]\n";
        return 2;
    }
    void* bundle = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!bundle) { std::cerr << "Own probe bundle: " << dlerror() << '\n'; return 3; }
    auto getClass = reinterpret_cast<PublicGetClassObject>(dlsym(bundle, "MathTypeBridgeGetClassObject"));
    auto initialize = reinterpret_cast<Initialize>(dlsym(bundle, "MathTypeBridgeInitialize"));
    auto registerMathType = reinterpret_cast<Initialize>(dlsym(bundle,"MathTypeBridgeRegisterMathTypeClasses"));
    auto state = reinterpret_cast<std::int32_t(*)()>(dlsym(bundle,"MathTypeBridgeMathTypeRegistrationState"));
    auto getMathType = reinterpret_cast<PublicGetClassObject>(dlsym(bundle,"MathTypeBridgeGetMathTypeClassObject"));
    auto startupReceipt = reinterpret_cast<Initialize>(dlsym(bundle,"MathTypeBridgeWriteStartupReceipt"));
    if (!getClass || !initialize || !registerMathType || !state || !getMathType || !startupReceipt) return 4;
    void* object = nullptr;
    bool factoryOk = getClass(&ProbeClassId, &ClassFactoryId, &object) == Ok && object;
    bool objectCreated = false;
    if (factoryOk) {
        auto* factory = static_cast<ClassFactory*>(object);
        void* instance = nullptr;
        objectCreated = factory->CreateInstance(nullptr, UnknownId, &instance) == Ok && instance;
        if(instance)static_cast<Unknown*>(instance)->Release();
        factory->Release();
    }
    void* rejectedObject = nullptr;
    bool rejectsMathType = getClass(&MathTypeWindowsClassId, &ClassFactoryId, &rejectedObject) == ClassNotAvailable && !rejectedObject;
    bool outsideWordGuard = initialize() == -1 && registerMathType() == -1 && startupReceipt() == -1;
    for(const auto* id:{&MathTypeWindowsClassId,&MathTypeMacClassId})rejectsMathType&=getMathType(id,&ClassFactoryId,&rejectedObject)==ClassNotAvailable&&!rejectedObject;
    rejectsMathType&=state()==0;
    std::cout << "{\"own_bundle_loaded\":true,\"factory_vtable_self_test\":" << (factoryOk ? "true" : "false")
        << ",\"equation_object_created\":" << (objectCreated ? "true" : "false")
        << ",\"mathtype_class_not_registered\":" << (rejectsMathType ? "true" : "false")
        << ",\"outside_word_initialize_guard\":" << (outsideWordGuard ? "true" : "false")
        << ",\"startup_receipt_export_guard\":" << (outsideWordGuard ? "true" : "false");
    bool inspectShim = argc > 2 && std::string(argv[2]) == "--inspect-shim";
    bool shimOk = true;
    if (inspectShim) {
        const char* path = "/Applications/Microsoft Word.app/Contents/Frameworks/WordSDKShim.framework/Versions/A/WordSDKShim";
        void* shim = dlopen(path, RTLD_LAZY | RTLD_LOCAL);
        shimOk = shim != nullptr;
        std::cout << ",\"word_sdk_shim_loaded\":" << (shimOk ? "true" : "false");
        if (!shim) std::cerr << "Word SDK shim load: " << dlerror() << '\n';
        for (const auto* name : {"RegisterDllGetClassObjectWithClassIDs_Shim", "CreateMetafilePictWithPDFData_Shim", "DeleteMetafilePict_Shim"}) {
            bool resolved = shim && dlsym(shim, name);
            std::cout << ",\"" << name << "\":" << (resolved ? "true" : "false");
            shimOk &= resolved;
        }
        std::cout << ",\"office_functions_called\":false";
        // Office framework initializers have process lifetime. Let process exit
        // clean them up rather than manually unloading their dependencies.
    }
    std::cout << ",\"loaded_into_word\":false}\n";
    return factoryOk && objectCreated && rejectsMathType && outsideWordGuard && shimOk ? 0 : 5;
}
