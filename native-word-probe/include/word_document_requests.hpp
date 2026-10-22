#pragma once
#import <Foundation/Foundation.h>
#include <cstdint>

namespace bridge_probe {

std::int32_t installWordDocumentRequests();
std::uint32_t wordDocumentRequestWatch();
std::int32_t takeWordDocumentRequest();
NSDictionary* wordDocumentRequestEnvelope(std::int32_t token);
BOOL beginWordDocumentRequest(std::int32_t token);
BOOL wordDocumentRequestIsCurrent(std::int32_t token);
std::int32_t currentWordDocumentRequestToken();
std::int32_t finishWordDocumentRequest(std::int32_t token,NSString* outcome,NSString* reason=nil);
NSString* openingWordDocumentRequestId();

}
