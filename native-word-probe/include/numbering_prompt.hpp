#pragma once
#include <cstdint>
#import <AppKit/AppKit.h>

namespace bridge_probe::numbering_prompt {
inline NSString* result;
inline NSUInteger cursor = 0;
inline bool busy = false;

inline bool counter(NSString* text) {
    if(!text.length || [text rangeOfCharacterFromSet:NSCharacterSet.decimalDigitCharacterSet.invertedSet].location!=NSNotFound)return false;
    return text.integerValue>=1 && text.integerValue<=32767;
}
inline bool format(NSString* text) {
    if(!text.length || text.length>128 || [text rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound)return false;
    NSRegularExpression* expression=[NSRegularExpression regularExpressionWithPattern:@"#([CSE])([1AaIi])" options:0 error:nil];
    NSArray<NSTextCheckingResult*>* tokens=[expression matchesInString:text options:0 range:NSMakeRange(0,text.length)];
    NSMutableSet<NSString*>* seen=[NSMutableSet set];
    for(NSTextCheckingResult* token in tokens){NSString* kind=[text substringWithRange:[token rangeAtIndex:1]];if([seen containsObject:kind])return false;[seen addObject:kind];}
    NSString* literal=[expression stringByReplacingMatchesInString:text options:0 range:NSMakeRange(0,text.length) withTemplate:@""];
    return [seen containsObject:@"E"] && ![literal containsString:@"#"];
}
inline NSDictionary* request(NSString* text) {
    if(!text || text.length>512)return nil;
    NSArray<NSString*>* parts=[text componentsSeparatedByString:@"\n"];
    if(parts.count!=5 || ![parts[0] isEqual:@"ELNUM1"] || parts[4].length)return nil;
    if([parts[1] isEqual:@"format"] && format(parts[2]) && !parts[3].length)return @{@"context":@NO,@"first":parts[2],@"second":@""};
    if([parts[1] isEqual:@"context"] && counter(parts[2]) && counter(parts[3]))return @{@"context":@YES,@"first":parts[2],@"second":parts[3]};
    return nil;
}
inline void clear() { result=nil;cursor=0; }
inline std::int32_t nextCharacter() {
    if(cursor>=result.length){clear();return 0;}
    return static_cast<std::int32_t>([result characterAtIndex:cursor++]);
}
inline std::int32_t show(NSDictionary* values) {
    clear();
    if(!values || busy || !NSThread.isMainThread)return -2;
    busy=true;
    @try {
        const bool context=[values[@"context"] boolValue];
        NSAlert* alert=[[NSAlert alloc] init];
        alert.messageText=context?@"Chapter and section":@"Number format";
        alert.informativeText=context?@"Start a new equation sequence at the current Word cursor. This does not require Word headings or section breaks.":@"Format for new numbered equations in this document. Example: (#C1.#E1). Existing equations keep their own formats.";
        [alert addButtonWithTitle:@"OK"];[alert addButtonWithTitle:@"Cancel"];
        for(NSButton* button in alert.buttons)button.font=[NSFont systemFontOfSize:NSFont.systemFontSize];
        NSView* content=[[NSView alloc] initWithFrame:NSMakeRect(0,0,420,context?126:86)];
        auto field=[&](NSString* label,NSString* value,CGFloat y,NSString* identifier){
            NSTextField* caption=[NSTextField labelWithString:label];caption.font=[NSFont systemFontOfSize:NSFont.systemFontSize];caption.frame=NSMakeRect(0,y+3,110,24);[content addSubview:caption];
            NSTextField* input=[[NSTextField alloc] initWithFrame:NSMakeRect(114,y,306,26)];input.font=[NSFont systemFontOfSize:NSFont.systemFontSize];input.stringValue=value;input.identifier=identifier;[content addSubview:input];return input;
        };
        NSTextField* first=field(context?@"Chapter":@"Format",values[@"first"],context?84:44,@"EquationLabNumberingFirst");
        NSTextField* second=context?field(@"Section",values[@"second"],44,@"EquationLabNumberingSecond"):nil;
        NSTextField* error=[NSTextField wrappingLabelWithString:@""];error.frame=NSMakeRect(0,0,420,34);error.textColor=NSColor.systemRedColor;error.font=[NSFont systemFontOfSize:11];[content addSubview:error];
        alert.accessoryView=content;alert.window.identifier=@"EquationLabNumberingDialog";alert.window.initialFirstResponder=first;
        for(;;){
            if([alert runModal]!=NSAlertFirstButtonReturn)return 1;
            NSString* one=[first.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
            NSString* two=[second.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
            if(context ? counter(one)&&counter(two) : format(one)) {result=context?[one stringByAppendingFormat:@"\n%@",two]:one;cursor=0;return 0;}
            error.stringValue=context?@"Enter whole numbers from 1 to 32767.":@"Include one #E counter; use #C and #S at most once. Example: (#C1.#E1).";
        }
    } @finally {busy=false;}
}
}
