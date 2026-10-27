#pragma once
#import <Foundation/Foundation.h>
#include <cstdint>

// A new equation has no OLE owner yet. Word keeps the live insertion Range;
// this transport only owns its ticket and the eventual one-equation fragment.
std::int32_t EquationLabBeginWordInsertion(NSURL* directory,NSDictionary* document,NSDictionary* layout,std::int32_t token);
bool EquationLabWordInsertionActive();
void EquationLabCancelWordInsertion();
NSData* EquationLabClaimWordInsertion(std::int32_t* token);
// Valid only after the fragment claim; -1 means no claimed insertion.
std::int32_t EquationLabWordInsertionInline();
// Claimed fragment's validated format, one UTF-16 code unit + 1 per call;
// 0 terminates and -1 means no claimed insertion. Empty for unnumbered/legacy results.
std::int32_t EquationLabWordInsertionNumberingNext();
void EquationLabFinishWordInsertion(bool ok);
// Call when Word cannot determine whether the live-range insertion took effect.
void EquationLabFinishWordInsertionUncertain();
// Returns the insertion error, or 7 when the outcome/acknowledgement is unconfirmed.
std::int32_t EquationLabWordInsertionError();
