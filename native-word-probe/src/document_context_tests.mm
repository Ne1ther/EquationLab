// Exercise the production capture decoder without loading Word or creating UI.
#include "ribbon_commands.mm"
#include <iostream>
#include <stdexcept>
extern "C" std::int32_t MathTypeBridgeMathTypeRegistrationState(){return 0;}
void EquationLabDocumentContextDidCapture(){}
void EquationLabDocumentContextDidClear(){}
void EquationLabDocumentContextDidClearSelection(){}
namespace bridge_probe {std::int32_t diagnosticValue(std::uint32_t){return 0;}}
namespace {void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}}
int main(){@autoreleasepool{try{
    NSString* xml=@"<pkg:package>\n<xml>原始公式</xml>\n</pkg:package>";
    NSDictionary* legacy=decodeDocumentContext([@"0\n测试.docx\n" stringByAppendingString:xml]);
    check([legacy[@"index"] intValue]==0&&[legacy[@"name"] isEqual:@"测试.docx"]&&[legacy[@"ooxml"] isEqual:xml]&&!legacy[@"identity"],"legacy capture changed");
    NSDictionary* first=decodeDocumentContext([@"ELCTX2\n1\n2\n25\n测试.docx\n" stringByAppendingString:xml]);
    check([first[@"index"] intValue]==25&&[first[@"snapshot"] intValue]==2&&[first[@"ooxml"] isEqual:xml]&&[first[@"identity"] hasSuffix:@":1"],"bound capture lost header or XML");
    BOOL selectionBound=NO;NSDictionary* selected=decodeDocumentContext([@"ELCTX3\n1\n2\n25\n测试.docx\n" stringByAppendingString:xml],&selectionBound);
    check(selectionBound&&[selected isEqual:first],"ELCTX3 changed document fields or lost its selection marker");
    selectionBound=YES;NSDictionary* ordinary=decodeDocumentContext([@"ELCTX2\n1\n2\n25\n测试.docx\n" stringByAppendingString:xml],&selectionBound);
    check(!selectionBound&&[ordinary isEqual:first],"ELCTX2 was promoted to a durable selection capture");
    pendingDocument=selected;pendingDocumentSelection=YES;check(EquationLabDocumentContextIsPendingSelection(selected),"captured ELCTX3 was not marked pending");
    NSDictionary* equalButDistinct=[selected mutableCopy];check(!EquationLabDocumentContextIsPendingSelection(equalButDistinct),"equal context borrowed another dictionary's pending selection");
    EquationLabConsumeDocumentSelection(equalButDistinct);check(pendingDocument==selected&&pendingDocumentSelection,"nonidentical context consumed the pending selection");
    EquationLabConsumeDocumentSelection(selected);check(!pendingDocument&&!pendingDocumentSelection,"exact selection consumption left global context pending");
    NSInteger selectedIndex=-1,documentIdentity=0,snapshotToken=0;selectionBound=NO;BOOL explicitCached=NO;
    check(decodeSelectionEquation(@"ELSEL3\n9",&selectedIndex,&selectionBound)&&selectedIndex==9&&selectionBound,"ELSEL3 index update lost its precise selection marker");
    check(decodeSelectionEquation(@"9",&selectedIndex,&selectionBound)&&selectedIndex==9&&!selectionBound,"ordinary index update became selection-bound");
    check(!decodeSelectionEquation(@"ELSEL3\n9x",&selectedIndex,&selectionBound),"malformed ELSEL3 index was accepted");
    check(decodeSelectionEquation(@"ELSEL4\n1\n2\n26",&selectedIndex,&selectionBound,&documentIdentity,&snapshotToken,&explicitCached)&&selectedIndex==26&&selectionBound&&explicitCached&&documentIdentity==1&&snapshotToken==2,"ELSEL4 did not retain its explicit identity/snapshot/index");
    check(!decodeSelectionEquation(@"ELSEL4\n1\n2\n26\nextra",&selectedIndex,&selectionBound,&documentIdentity,&snapshotToken,&explicitCached),"malformed ELSEL4 fields were accepted");
    check(!decodeSelectionEquation(@"ELSEL4\n1x\n2\n26",&selectedIndex,&selectionBound,&documentIdentity,&snapshotToken,&explicitCached),"nonnumeric ELSEL4 identity was accepted");
    check(!decodeSelectionEquation(@"ELSEL4\n1\n0\n26",&selectedIndex,&selectionBound,&documentIdentity,&snapshotToken,&explicitCached),"zero ELSEL4 snapshot was accepted");
    installDocumentContext(selected,YES);
    EquationLabConsumeDocumentSelection(selected);check(!pendingDocument&&!pendingDocumentSelection,"consumed selection remained automatically eligible");
    check(applySelectionEquation(@"ELSEL4\n1\n2\n26")==0&&[pendingDocument[@"index"] integerValue]==26&&pendingDocumentSelection,"explicit cached selection did not restore the requested object");
    clearDocumentSelectionState();check(!pendingDocument&&!pendingDocumentSelection,"text click did not clear pending selection eligibility");
    check(applySelectionEquation(@"ELSEL4\n1\n2\n9")==0&&[pendingDocument[@"index"] integerValue]==9&&pendingDocumentSelection,"matching explicit snapshot could not be reused after text clear");
    clearDocumentSelectionState();
    check(applySelectionEquation(@"ELSEL4\n2\n2\n9")==-4&&!pendingDocument,"cached selection accepted a different document identity");
    check(applySelectionEquation(@"ELSEL4\n1\n3\n9")==-4&&!pendingDocument,"cached selection accepted a different snapshot token");
    check(applySelectionEquation(@"ELSEL3\n9")==-1&&!pendingDocument,"legacy selection was recovered from the cached base");
    check(applySelectionEquation(@"ELSEL4\n1\n2\n9x")==-3&&!pendingDocument,"malformed cached selection changed pending state");
    clearDocumentContextState();check(applySelectionEquation(@"ELSEL4\n1\n2\n9")==-1&&!pendingDocument,"document clear retained a reusable snapshot base");
    installDocumentContext(ordinary,NO);check(applySelectionEquation(@"ELSEL4\n1\n2\n9")==0&&pendingDocumentSelection,"explicit cached selection was not made precise");
    clearDocumentContextState();
    NSDictionary* next=decodeDocumentContext(@"ELCTX2\n1\n3\n0\n测试.docx\n<xml/>");
    NSDictionary* other=decodeDocumentContext(@"ELCTX2\n2\n4\n0\n测试.docx\n<xml/>");
    check([first[@"identity"] isEqual:next[@"identity"]]&&![first[@"identity"] isEqual:other[@"identity"]],"document identity relies on file name or snapshot");
    for(NSString* invalid in @[@"ELCTX2\n0\n2\n0\nfile\n<xml/>",@"ELCTX2\n1\n0\n0\nfile\n<xml/>",@"ELCTX2\n1\n2\n10001\nfile\n<xml/>",@"ELCTX2\n1\n2\n-1\nfile\n<xml/>",@"ELCTX2\n1\n2\n0",@"ELCTX2\n1bad\n2\n0\nfile\n<xml/>",@"invalid"]){check(!decodeDocumentContext(invalid),"malformed context accepted");}
    std::cout<<"{\"legacy_context_preserved\":true,\"bound_context_header_and_xml_preserved\":true,\"elctx3_selection_marker_is_sidechannel_only\":true,\"elctx3_consumption_requires_same_dictionary\":true,\"elsel3_index_marker_preserved\":true,\"elsel4_cached_snapshot_selection\":true,\"text_clear_requires_explicit_matching_tokens\":true,\"document_clear_and_token_mismatch_rejected\":true,\"elctx2_remains_unanchored\":true,\"same_named_documents_have_distinct_identities\":true,\"malformed_bindings_rejected\":10,\"real_word_or_gui_used\":false}\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}}
