// Exercise the production capture decoder without loading Word or creating UI.
#include "ribbon_commands.mm"
#include <iostream>
#include <stdexcept>
extern "C" std::int32_t MathTypeBridgeMathTypeRegistrationState(){return 0;}
void EquationLabDocumentContextDidCapture(){}
void EquationLabDocumentContextDidClear(){}
void EquationLabDocumentContextDidClearSelection(){}
void EquationLabDocumentContextWillCapture(){}
void EquationLabDocumentContextDidCloseIdentity(std::int32_t){}
std::int32_t EquationLabBeginWordInsertion(NSURL*,NSDictionary*,NSDictionary*,std::int32_t){return -1;}
std::int32_t EquationLabQueueEditorTool(NSString*){return -1;}
bool EquationLabWordInsertionActive(){return false;}
std::int32_t EquationLabWordInsertionInline(){return 0;}
void EquationLabCancelWordInsertion(){}
NSData* EquationLabClaimWordInsertion(std::int32_t*){return nil;}
void EquationLabFinishWordInsertion(bool){}
void EquationLabFinishWordInsertionUncertain(){}
std::int32_t EquationLabWordInsertionError(){return 0;}
namespace bridge_probe {
void publishWordWorkspace(NSDictionary*,NSArray<NSDictionary*>*){}
void closeWordWorkspaceIdentity(NSString*){}
std::int32_t diagnosticValue(std::uint32_t){return 0;}
std::int32_t takeWordDocumentRequest(){return 0;}
NSDictionary* wordDocumentRequestEnvelope(std::int32_t){return nil;}
BOOL wordDocumentRequestIsCurrent(std::int32_t){return NO;}
BOOL beginWordDocumentRequest(std::int32_t){return NO;}
std::int32_t currentWordDocumentRequestToken(){return 0;}
std::int32_t finishWordDocumentRequest(std::int32_t,NSString*,NSString*){return -1;}
}
namespace {void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}}
int main(){@autoreleasepool{try{
    NSString* requestId=[@"a" stringByPaddingToLength:64 withString:@"a" startingAtIndex:0];
    NSDictionary* request=@{@"requestId":requestId};
    NSArray* requestFields=[[@"ELDREQ2\n1\n" stringByAppendingFormat:@"%@\n0\n\n0\n0\n\n",requestId] componentsSeparatedByString:@"\n"];
    check(wordRequestFieldsMatch(requestFields,request),"current-document request rejected writer's zero snapshot/index fields");
    NSMutableArray* badRequest=[requestFields mutableCopy];badRequest[5]=@"";
    check(!wordRequestFieldsMatch(badRequest,request),"malformed empty snapshot accepted for current-document request");
    NSDictionary* targetRequest=@{@"requestId":requestId,@"target":@{@"identity":@"process:1",@"snapshot":@5,@"index":@2,@"nativeSha256":requestId}};
    NSArray* targetFields=[[@"ELDREQ2\n1\n" stringByAppendingFormat:@"%@\n1\nprocess:1\n5\n2\n%@\n",requestId,requestId] componentsSeparatedByString:@"\n"];
    check(wordRequestFieldsMatch(targetFields,targetRequest),"exact document request lost target fields");
    NSDictionary* explicitRequest=@{@"requestId":requestId,@"documentIdentity":@"process:inactive-42"};
    NSArray* explicitFields=[[@"ELDREQ2\n1\n" stringByAppendingFormat:@"%@\n2\nprocess:inactive-42\n0\n0\n\n",requestId] componentsSeparatedByString:@"\n"];
    check(wordRequestFieldsMatch(explicitFields,explicitRequest),"explicit document identity did not survive the native sidecar");
    NSArray* conflictFields=[[@"ELDREQ2\n1\n" stringByAppendingFormat:@"%@\n2\nprocess:inactive-42\n5\n0\n%@\n",requestId,requestId] componentsSeparatedByString:@"\n"];
    check(!wordRequestFieldsMatch(conflictFields,explicitRequest),"conflicting explicit document request fields were accepted");
    badRequest=[targetFields mutableCopy];badRequest[5]=@"5x";
    check(!wordRequestFieldsMatch(badRequest,targetRequest),"malformed exact snapshot accepted by integer prefix");
    NSString* xml=@"<pkg:package>\n<xml>原始公式</xml>\n</pkg:package>";
    NSDictionary* legacy=decodeDocumentContext([@"0\n测试.docx\n" stringByAppendingString:xml]);
    check([legacy[@"index"] intValue]==0&&[legacy[@"name"] isEqual:@"测试.docx"]&&[legacy[@"ooxml"] isEqual:xml]&&!legacy[@"identity"],"legacy capture changed");
    NSDictionary* first=decodeDocumentContext([@"ELCTX2\n1\n2\n25\n测试.docx\n" stringByAppendingString:xml]);
    check([first[@"index"] intValue]==25&&[first[@"snapshot"] intValue]==2&&[first[@"ooxml"] isEqual:xml]&&[first[@"identity"] hasSuffix:@":1"],"bound capture lost header or XML");
    BOOL selectionBound=NO;NSDictionary* selected=decodeDocumentContext([@"ELCTX3\n1\n2\n25\n测试.docx\n" stringByAppendingString:xml],&selectionBound);
    check(selectionBound&&[selected isEqual:first],"ELCTX3 changed document fields or lost its selection marker");
    selectionBound=YES;NSDictionary* ordinary=decodeDocumentContext([@"ELCTX2\n1\n2\n25\n测试.docx\n" stringByAppendingString:xml],&selectionBound);
    check(!selectionBound&&[ordinary isEqual:first],"ELCTX2 was promoted to a durable selection capture");
    NSDictionary* requested=decodeDocumentContext([NSString stringWithFormat:@"ELCTX4\n77\n1\n3\n25\n测试.docx\n%@",xml],&selectionBound);
    check(selectionBound&&[requested[@"captureToken"] intValue]==77&&[requested[@"identity"] isEqual:first[@"identity"]]&&[requested[@"snapshot"] intValue]==3&&[requested[@"index"] intValue]==25&&[requested[@"ooxml"] isEqual:xml],"ELCTX4 did not preserve its activation request token and document fields");
    NSDictionary* activationFile=decodeDocumentActivationAnchor(@"ELACT1\n1\n3\n25");
    check([activationFile[@"identity"] isEqual:first[@"identity"]]&&[activationFile[@"snapshot"] intValue]==3&&[activationFile[@"index"] intValue]==25,"preactivation file did not resolve the exact captured Doc+Range coordinates");
    for(NSString* invalidActivation in @[@"ELACT1\n0\n3\n25",@"ELACT1\n1\n0\n25",@"ELACT1\n1\n3\n10001",@"ELACT1\n1x\n3\n25",@"ELACT1\n1\n3\n25\nextra"]){check(!decodeDocumentActivationAnchor(invalidActivation),"malformed preactivation file accepted");}
    NSDictionary* fastActivationFile=decodeDocumentActivationAnchor(@"ELACT2\n77\n1\n3\n25");
    check([fastActivationFile[@"nonce"] intValue]==77&&[fastActivationFile[@"identity"] isEqual:first[@"identity"]]&&[fastActivationFile[@"snapshot"] intValue]==3&&[fastActivationFile[@"index"] intValue]==25,"ELACT2 did not decode nonce plus exact Doc+Range coordinates");
    for(NSString* invalidFastActivation in @[@"ELACT2\n0\n1\n3\n25",@"ELACT2\n77\n0\n3\n25",@"ELACT2\n77\n1\n0\n25",@"ELACT2\n77\n1\n3\n10001",@"ELACT2\n77x\n1\n3\n25",@"ELACT2\n77\n1\n3\n25\nextra"]){check(!decodeDocumentActivationAnchor(invalidFastActivation),"malformed ELACT2 preactivation file accepted");}
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
    installDocumentContext(selected,YES);
    check(EquationLabArmDocumentActivationAnchor(selected)&&EquationLabActivationAnchorIsPending(),"exact selection could not arm a preactivation hint");
    NSDictionary* activation=EquationLabTakeDocumentActivationAnchor();
    check([activation[@"identity"] isEqual:selected[@"identity"]]&&[activation[@"snapshot"] isEqual:selected[@"snapshot"]]&&[activation[@"index"] isEqual:selected[@"index"]],"activation hint lost its captured document/range coordinates");
    check(!EquationLabActivationAnchorIsPending()&&!EquationLabTakeDocumentActivationAnchor(),"activation hint was not consumed exactly once");
    check(!EquationLabArmDocumentActivationAnchor(@{@"identity":selected[@"identity"],@"snapshot":@0,@"index":selected[@"index"]})&&!EquationLabActivationAnchorIsPending(),"invalid activation hint was armed");
    installDocumentContext(selected,YES);check(EquationLabArmDocumentActivationAnchor(selected),"activation expiry setup");activationAnchorExpiry=[NSDate dateWithTimeIntervalSinceNow:-1];
    check(!EquationLabActivationAnchorIsPending()&&!EquationLabTakeDocumentActivationAnchor(),"expired activation hint remained usable");
    installDocumentContext(selected,YES);check(EquationLabArmDocumentActivationAnchor(selected),"activation clear setup");
    clearDocumentSelectionState();EquationLabDocumentContextDidClearSelection();
    check(!pendingDocument&&!pendingDocumentSelection&&EquationLabActivationAnchorIsPending(),"ordinary selection clear also discarded the armed activation hint");
    EquationLabClearDocumentActivationAnchor();check(!EquationLabActivationAnchorIsPending(),"explicit activation clear retained the hint");
    NSDictionary* replacement=@{@"identity":@"process:2",@"snapshot":@4,@"index":@8};
    check(EquationLabArmDocumentActivationAnchor(selected)&&EquationLabArmDocumentActivationAnchor(replacement),"fresh activation could not replace an older hint");
    NSDictionary* replaced=EquationLabTakeDocumentActivationAnchor();
    check([replaced[@"identity"] isEqual:replacement[@"identity"]]&&[replaced[@"snapshot"] isEqual:replacement[@"snapshot"]]&&[replaced[@"index"] isEqual:replacement[@"index"]],"fresh activation did not replace the prior Doc+Range hint");
    clearDocumentContextState();
    NSString* fastIdentity=[NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),42];NSDictionary* fastBinding=@{@"identity":fastIdentity,@"index":@12};
    std::int32_t fastNonce=EquationLabIssuePreCapturedDocumentActivationNonce(fastBinding);
    NSDictionary* fastContext=@{@"identity":fastIdentity,@"snapshot":@901,@"index":@12,@"captureToken":@(fastNonce),@"name":@"same-name.docx",@"ooxml":@"<same-formula/>"};
    check(fastNonce>0&&EquationLabCapturePreCapturedDocumentContext(fastContext)==1&&documentCaptureSequence>[preCaptureIssue[@"sequence"] unsignedIntegerValue],"fresh ELCTX4 did not register after nonce issuance");
    check(preparedDocumentActivationNonce()==0,"unarmed pre-capture candidate exposed a reusable nonce");
    check(!EquationLabCapturedDocumentContext()&&!pendingDocumentSelection,"pre-capture candidate leaked into sticky selection state");
    NSDictionary* fastActivation=@{@"nonce":@(fastNonce),@"identity":fastIdentity,@"snapshot":@901,@"index":@12};
    check(EquationLabArmPreCapturedDocumentActivation(fastActivation),"matching ELACT2 failed to arm its independent ELCTX4 candidate");
    check(preparedDocumentActivationNonce()==fastNonce&&preparedDocumentActivationNonce()==fastNonce,"prepared-activation nonce getter consumed or changed the pending candidate");
    NSDictionary* consumedFast=EquationLabTakePreCapturedDocumentActivation();
    check([consumedFast[@"_preCapturedActivation"] boolValue]&&[consumedFast[@"captureToken"] intValue]==fastNonce&&[consumedFast[@"identity"] isEqual:fastIdentity]&&[consumedFast[@"snapshot"] intValue]==901&&[consumedFast[@"index"] intValue]==12&&preparedDocumentActivationNonce()==0&&!EquationLabTakePreCapturedDocumentActivation(),"fast-path candidate was not consumed exactly once with its exact binding");
    fastNonce=EquationLabIssuePreCapturedDocumentActivationNonce(fastBinding);
    NSDictionary* wrongDoc=[@{@"identity":[NSString stringWithFormat:@"%@:%d",documentProcessIdentity(),43],@"snapshot":@902,@"index":@12,@"captureToken":@(fastNonce),@"name":@"same-name.docx",@"ooxml":@"<same-formula/>"} copy];
    check(EquationLabCapturePreCapturedDocumentContext(wrongDoc)==-1&&!EquationLabArmPreCapturedDocumentActivation(@{@"nonce":@(fastNonce),@"identity":fastIdentity,@"snapshot":@902,@"index":@12})&&preparedDocumentActivationNonce()==0,"identical OOXML from another DocIdentity satisfied the issued nonce");
    check([EquationLabTakePreCapturedDocumentActivation()[@"_preCaptureRejected"] boolValue],"cross-document mismatch silently downgraded to a later capture");
    fastNonce=EquationLabIssuePreCapturedDocumentActivationNonce(fastBinding);
    fastContext=@{@"identity":fastIdentity,@"snapshot":@903,@"index":@13,@"captureToken":@(fastNonce),@"name":@"same-name.docx",@"ooxml":@"<same-formula/>"};
    check(EquationLabCapturePreCapturedDocumentContext(fastContext)==-1&&!EquationLabArmPreCapturedDocumentActivation(@{@"nonce":@(fastNonce),@"identity":fastIdentity,@"snapshot":@903,@"index":@12}),"same-document wrong equation index satisfied the issued nonce");
    check([EquationLabTakePreCapturedDocumentActivation()[@"_preCaptureRejected"] boolValue],"index mismatch did not fail closed");
    fastNonce=EquationLabIssuePreCapturedDocumentActivationNonce(fastBinding);
    fastContext=@{@"identity":fastIdentity,@"snapshot":@904,@"index":@12,@"captureToken":@(fastNonce),@"name":@"same-name.docx",@"ooxml":@"<same-formula/>"};
    check(EquationLabCapturePreCapturedDocumentContext(fastContext)==1,"expiry fixture candidate setup");preCaptureExpiry=[NSDate dateWithTimeIntervalSinceNow:-1];
    check(!EquationLabArmPreCapturedDocumentActivation(@{@"nonce":@(fastNonce),@"identity":fastIdentity,@"snapshot":@904,@"index":@12})&&preparedDocumentActivationNonce()==0&&[EquationLabTakePreCapturedDocumentActivation()[@"_preCaptureRejected"] boolValue],"expired candidate remained available or fell back to post-DoVerb capture");
    fastNonce=EquationLabIssuePreCapturedDocumentActivationNonce(fastBinding);fastContext=@{@"identity":fastIdentity,@"snapshot":@905,@"index":@12,@"captureToken":@(fastNonce),@"name":@"same-name.docx",@"ooxml":@"<same-formula/>"};
    check(EquationLabCapturePreCapturedDocumentContext(fastContext)==1&&EquationLabArmPreCapturedDocumentActivation(@{@"nonce":@(fastNonce),@"identity":fastIdentity,@"snapshot":@905,@"index":@12}),"selection-clear candidate setup");
    check(preparedDocumentActivationNonce()==fastNonce,"prepared-activation nonce getter missed the armed candidate");
    clearOrdinaryDocumentSelection();
    check(preparedDocumentActivationNonce()==fastNonce&&[EquationLabTakePreCapturedDocumentActivation()[@"_preCapturedActivation"] boolValue]&&preparedDocumentActivationNonce()==0&&!EquationLabTakePreCapturedDocumentActivation(),"ordinary selection clear erased the candidate or consumption left its nonce reusable");
    fastNonce=EquationLabIssuePreCapturedDocumentActivationNonce(fastBinding);fastContext=@{@"identity":fastIdentity,@"snapshot":@907,@"index":@12,@"captureToken":@(fastNonce),@"name":@"same-name.docx",@"ooxml":@"<same-formula/>"};
    check(EquationLabCapturePreCapturedDocumentContext(fastContext)==1&&EquationLabArmPreCapturedDocumentActivation(@{@"nonce":@(fastNonce),@"identity":fastIdentity,@"snapshot":@907,@"index":@12}),"document-clear candidate setup");
    clearDocumentCaptureState();check(preparedDocumentActivationNonce()==0&&!EquationLabTakePreCapturedDocumentActivation(),"document clear retained the fast-path activation");
    fastNonce=EquationLabIssuePreCapturedDocumentActivationNonce(fastBinding);fastContext=@{@"identity":fastIdentity,@"snapshot":@906,@"index":@12,@"captureToken":@(fastNonce),@"name":@"same-name.docx",@"ooxml":@"<same-formula/>"};
    check(EquationLabCapturePreCapturedDocumentContext(fastContext)==1,"supersession fixture candidate setup");
    std::int32_t replacementNonce=EquationLabIssuePreCapturedDocumentActivationNonce(@{@"identity":fastIdentity,@"index":@13});
    check(replacementNonce>0&&replacementNonce!=fastNonce&&!EquationLabArmPreCapturedDocumentActivation(@{@"nonce":@(fastNonce),@"identity":fastIdentity,@"snapshot":@906,@"index":@12})&&[EquationLabTakePreCapturedDocumentActivation()[@"_preCaptureRejected"] boolValue],"superseded nonce retained or consumed the earlier candidate");
    for(NSString* invalid in @[@"ELCTX2\n0\n2\n0\nfile\n<xml/>",@"ELCTX2\n1\n0\n0\nfile\n<xml/>",@"ELCTX2\n1\n2\n10001\nfile\n<xml/>",@"ELCTX2\n1\n2\n-1\nfile\n<xml/>",@"ELCTX2\n1\n2\n0",@"ELCTX2\n1bad\n2\n0\nfile\n<xml/>",@"invalid"]){check(!decodeDocumentContext(invalid),"malformed context accepted");}
    std::cout<<"{\"legacy_context_preserved\":true,\"bound_context_header_and_xml_preserved\":true,\"elctx3_selection_marker_is_sidechannel_only\":true,\"elctx4_request_token_and_document_fields_preserved\":true,\"elact1_exact_activation_coordinates_and_validation\":true,\"elact2_nonce_and_binding_validation\":true,\"precapture_candidate_is_independent_and_one_shot\":true,\"prepared_activation_nonce_getter_is_read_only_and_one_shot\":true,\"ordinary_selection_clear_preserves_prepared_nonce\":true,\"document_clear_removes_prepared_nonce\":true,\"precapture_mismatch_expiry_clear_supersession_and_cross_document_rejected\":true,\"elctx3_consumption_requires_same_dictionary\":true,\"elsel3_index_marker_preserved\":true,\"elsel4_cached_snapshot_selection\":true,\"text_clear_requires_explicit_matching_tokens\":true,\"document_clear_and_token_mismatch_rejected\":true,\"ordinary_selection_clear_preserves_activation_hint\":true,\"fresh_activation_replaces_previous_hint\":true,\"activation_hint_expiry_and_explicit_clear\":true,\"elctx2_remains_unanchored\":true,\"same_named_documents_have_distinct_identities\":true,\"malformed_bindings_rejected\":10,\"real_word_or_gui_used\":false}\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}}
