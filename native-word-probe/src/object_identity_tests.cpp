// Compile the unmodified production object into this isolated CLI. Reuse its
// exact allocation to prove that the lifecycle token is independent of `this`.
#include "equation_object.cpp"
#include <cstddef>
#include <iostream>
#include <new>
#include <stdexcept>
namespace {
alignas(std::max_align_t) unsigned char objectMemory[sizeof(bridge_probe::EquationObject)];
bool reuseObjectMemory=false,objectMemoryInUse=false;
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
}
void* operator new(std::size_t size){
    if(reuseObjectMemory&&size==sizeof(objectMemory)){if(objectMemoryInUse)throw std::bad_alloc();objectMemoryInUse=true;return objectMemory;}
    if(void* result=std::malloc(size))return result;throw std::bad_alloc();
}
void operator delete(void* pointer)noexcept{if(pointer==objectMemory)objectMemoryInUse=false;else std::free(pointer);}
void operator delete(void* pointer,std::size_t)noexcept{operator delete(pointer);}
int main(){try{
    reuseObjectMemory=true;
    auto* first=new bridge_probe::EquationObject(bridge_probe::ProbeClassId);auto firstIdentity=first->identity();auto firstAddress=reinterpret_cast<std::uintptr_t>(first);
    check(first->bindDocument("document-A"),"first owner document bind");check(first->Release()==0&&!objectMemoryInUse,"first owner lifetime did not end");
    auto* second=new bridge_probe::EquationObject(bridge_probe::ProbeClassId);
    check(reinterpret_cast<std::uintptr_t>(second)==firstAddress,"test allocator did not reuse the real object address");
    check(second->identity()!=firstIdentity,"object lifecycle identity reused an old address identity");check(second->bindDocument("document-B"),"replacement inherited the released owner's document binding");
    check(second->Release()==0&&!objectMemoryInUse,"replacement lifetime did not end");reuseObjectMemory=false;
    check(bridge_probe::liveEquationObjects()==0,"object identity test leaked a native owner");
    std::cout<<"{\"production_object_same_address_reused\":true,\"replacement_has_new_lifecycle_identity\":true,\"replacement_does_not_inherit_document_identity\":true,\"no_native_owners_leaked\":true,\"real_word_or_gui_used\":false}\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
