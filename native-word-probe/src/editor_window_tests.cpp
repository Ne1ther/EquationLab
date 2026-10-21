#include "equation_object.cpp"
#include <iostream>
#include <stdexcept>
using namespace bridge_probe;
namespace {
void check(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
struct Site final:OleClientSite {
    ULong refs=1;std::vector<std::int32_t> visibility;int saves=0;HResult saveResult=Ok;
    HResult QueryInterface(const Guid&,void** out)override{if(!out)return PointerError;*out=this;AddRef();return Ok;}
    ULong AddRef()override{return ++refs;}ULong Release()override{return --refs;}
    HResult SaveObject()override{++saves;return saveResult;}
    HResult GetMoniker(std::uint32_t,std::uint32_t,Unknown** out)override{if(out)*out=nullptr;return NotImplemented;}
    HResult GetContainer(Unknown** out)override{if(out)*out=nullptr;return NotImplemented;}
    HResult ShowObject()override{throw std::runtime_error("editor must not reveal its Word container");}
    HResult OnShowWindow(std::int32_t value)override{visibility.push_back(value);return Ok;}
    HResult RequestNewObjectLayout()override{return Ok;}
};
std::uint64_t session=0;
HResult normalOpen(std::uint64_t id,const std::uint8_t*,std::size_t,void*){session=id;return Ok;}
HResult failedOpen(std::uint64_t,const std::uint8_t*,std::size_t,void*){return Unexpected;}
HResult backgroundApply(std::uint64_t id,const std::uint8_t*,std::size_t,void*){return completeEdit(id,nullptr,0,false);}
}
int main(){try{
    Site first,second;auto* object=new EquationObject(ProbeClassId);setEditorHooks(normalOpen,nullptr);
    check(object->DoVerb(0,nullptr,&first,0,nullptr,nullptr)==Ok,"first open failed");const auto initial=session;
    check(first.visibility==std::vector<std::int32_t>{1},"Word never learned that the editor opened");
    check(object->DoVerb(0,nullptr,&first,0,nullptr,nullptr)==Ok&&session==initial,"repeat activation replaced the session");
    check(first.visibility.size()==1,"repeat activation re-shaded the Word object");
    const std::uint8_t invalid[1]={0};check(completeEdit(session,invalid,1,true)==StorageHeaderError,"invalid save accepted");
    check(first.visibility.size()==1,"failed save cleared Word's open-object state");
    check(completeEdit(session,nullptr,0,false)==Ok&&first.visibility==std::vector<std::int32_t>({1,0}),"cancel did not balance open/close");
    check(object->DoVerb(0,nullptr,&first,0,nullptr,nullptr)==Ok,"save failure setup");
    std::vector<std::uint8_t> native(29);native[0]=28;native[8]=1;first.saveResult=Unexpected;
    check(completeEdit(session,native.data(),native.size(),true)==Unexpected&&first.visibility.back()==1,"container save failure cleared the open window");
    first.saveResult=Ok;
    check(completeEdit(session,native.data(),native.size(),true)==Ok&&first.visibility.back()==0&&first.saves==2,"successful retry did not close the external window");
    check(object->DoVerb(0,nullptr,&first,0,nullptr,nullptr)==Ok,"second open failed");
    check(object->SetClientSite(&second)==Ok&&first.visibility.back()==0,"replaced client site kept stale open shading");
    check(object->DoVerb(0,nullptr,&second,0,nullptr,nullptr)==Ok&&second.visibility==std::vector<std::int32_t>{1},"new site did not receive open state");
    check(object->Close(1)==Ok&&second.visibility==std::vector<std::int32_t>({1,0}),"container close did not balance external window");object->Release();
    Site background;object=new EquationObject(ProbeClassId);setEditorHooks(backgroundApply,nullptr);
    check(object->DoVerb(0,nullptr,&background,0,nullptr,nullptr)==Ok&&background.visibility.empty(),"synchronous background save reported a visible editor");object->Close(1);object->Release();
    Site failed;object=new EquationObject(ProbeClassId);setEditorHooks(failedOpen,nullptr);
    check(object->DoVerb(0,nullptr,&failed,0,nullptr,nullptr)==Unexpected&&failed.visibility.empty(),"failed launch left Word shaded");object->Close(1);object->Release();
    check(first.refs==1&&second.refs==1&&background.refs==1&&failed.refs==1&&liveEquationObjects()==0,"window lifecycle leaked a client/owner");
    std::cout<<"{\"out_of_place_open_close_balanced\":true,\"repeat_open_not_reshaded\":true,\"failed_save_keeps_window\":true,\"background_save_no_window\":true,\"failed_launch_no_window\":true,\"gui_used\":false}\n";
    return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
