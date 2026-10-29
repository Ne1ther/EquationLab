#pragma once
#include <cstdint>
#import <AppKit/AppKit.h>

namespace bridge_probe::reference_picker {
inline NSString* result;
inline NSUInteger cursor=0;
inline bool busy=false;
inline void clear(){result=nil;cursor=0;}
inline std::int32_t nextCharacter(){if(cursor>=result.length){clear();return 0;}return static_cast<std::int32_t>([result characterAtIndex:cursor++]);}

// The sidecar contains only a bounded list for this one synchronous request.
// Ordinals are display information; the returned identity is the bookmark.
inline NSArray<NSDictionary*>* request(NSString* text){
    if(!text || text.length>2*1024*1024)return nil;
    NSArray<NSString*>* lines=[text componentsSeparatedByString:@"\n"];
    if(lines.count<4 || ![lines[0] isEqual:@"ELREF1"] || lines.lastObject.length)return nil;
    NSInteger count=lines[1].integerValue;
    if(count<1 || count>2000 || ![lines[1] isEqual:[@(count) stringValue]] || lines.count!=static_cast<NSUInteger>(count+3))return nil;
    NSRegularExpression* name=[NSRegularExpression regularExpressionWithPattern:@"^EL_[A-Za-z0-9_]{1,37}$" options:0 error:nil];
    NSMutableSet<NSString*>* names=[NSMutableSet set];NSMutableArray<NSDictionary*>* values=[NSMutableArray arrayWithCapacity:count];
    for(NSInteger i=0;i<count;i++){
        NSArray<NSString*>* fields=[lines[i+2] componentsSeparatedByString:@"\t"];
        if(fields.count!=4 || ![fields[0] isEqual:[@(i+1) stringValue]] || !fields[2].length || fields[2].length>128 || fields[3].length>256)return nil;
        if([name numberOfMatchesInString:fields[1] options:0 range:NSMakeRange(0,fields[1].length)]!=1 || [names containsObject:fields[1].lowercaseString])return nil;
        for(NSString* field in fields)if([field rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound)return nil;
        [names addObject:fields[1].lowercaseString];
        [values addObject:@{@"ordinal":@(i+1),@"bookmark":fields[1],@"number":fields[2],@"context":fields[3]}];
    }
    return values;
}
inline NSArray<NSDictionary*>* filtered(NSArray<NSDictionary*>* values,NSString* query){
    if(!values || query.length>256)return @[];
    NSString* term=[query stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if(!term.length)return values;
    NSMutableArray<NSDictionary*>* matches=[NSMutableArray array];
    for(NSDictionary* item in values){
        NSString* text=[NSString stringWithFormat:@"%@ %@ %@",item[@"ordinal"],item[@"number"],item[@"context"]];
        if([text rangeOfString:term options:NSCaseInsensitiveSearch|NSDiacriticInsensitiveSearch].location!=NSNotFound)[matches addObject:item];
    }
    return matches;
}
}

@interface ELReferencePickerController : NSObject <NSTableViewDataSource,NSTableViewDelegate,NSSearchFieldDelegate>
@property(nonatomic,strong) NSArray<NSDictionary*>* values;
@property(nonatomic,strong) NSArray<NSDictionary*>* visible;
@property(nonatomic,strong) NSTableView* table;
@property(nonatomic,strong) NSSearchField* search;
@property(nonatomic,strong) NSTextField* countLabel;
@property(nonatomic,strong) NSButton* insertButton;
- (void)refresh;
- (NSString*)selectedBookmark;
@end

@implementation ELReferencePickerController
- (NSInteger)numberOfRowsInTableView:(NSTableView*)tableView{(void)tableView;return static_cast<NSInteger>(self.visible.count);}
- (NSView*)tableView:(NSTableView*)tableView viewForTableColumn:(NSTableColumn*)column row:(NSInteger)row{
    (void)tableView;(void)column;
    NSDictionary* item=self.visible[row];
    NSTextField* label=[NSTextField wrappingLabelWithString:[NSString stringWithFormat:@"%@  %@\n%@",item[@"ordinal"],item[@"number"],item[@"context"]]];
    label.font=[NSFont systemFontOfSize:12];label.lineBreakMode=NSLineBreakByTruncatingTail;label.maximumNumberOfLines=2;return label;
}
- (void)tableViewSelectionDidChange:(NSNotification*)notification{(void)notification;self.insertButton.enabled=self.table.selectedRow>=0;}
- (void)controlTextDidChange:(NSNotification*)notification{(void)notification;[self refresh];}
- (void)refresh{
    NSString* selected=[self selectedBookmark];
    self.visible=bridge_probe::reference_picker::filtered(self.values,self.search.stringValue);
    [self.table reloadData];
    NSInteger index=-1;
    for(NSUInteger i=0;i<self.visible.count;i++)if([self.visible[i][@"bookmark"] isEqual:selected]){index=static_cast<NSInteger>(i);break;}
    if(index<0&&self.visible.count)index=0;
    if(index>=0)[self.table selectRowIndexes:[NSIndexSet indexSetWithIndex:static_cast<NSUInteger>(index)] byExtendingSelection:NO];else [self.table deselectAll:nil];
    self.insertButton.enabled=index>=0;
    self.countLabel.stringValue=[NSString stringWithFormat:@"%lu of %lu numbered equations",static_cast<unsigned long>(self.visible.count),static_cast<unsigned long>(self.values.count)];
}
- (NSString*)selectedBookmark{
    NSInteger row=self.table.selectedRow;
    return row>=0&&static_cast<NSUInteger>(row)<self.visible.count?self.visible[row][@"bookmark"]:nil;
}
@end

namespace bridge_probe::reference_picker {
inline std::int32_t show(NSArray<NSDictionary*>* values){
    clear();if(!values.count || busy || !NSThread.isMainThread)return -2;
    busy=true;
    @try{
        NSAlert* alert=[[NSAlert alloc] init];alert.messageText=@"Insert equation reference";
        alert.informativeText=@"Search the equation number or nearby text, then choose a target. The reference will be inserted at the retained Word cursor.";
        [alert addButtonWithTitle:@"Insert Reference"];[alert addButtonWithTitle:@"Cancel"];
        for(NSButton* button in alert.buttons)button.font=[NSFont systemFontOfSize:NSFont.systemFontSize];
        ELReferencePickerController* controller=[[ELReferencePickerController alloc] init];controller.values=values;controller.visible=values;
        NSView* content=[[NSView alloc] initWithFrame:NSMakeRect(0,0,520,330)];
        controller.search=[[NSSearchField alloc] initWithFrame:NSMakeRect(0,298,520,28)];controller.search.placeholderString=@"Search number or nearby text";controller.search.identifier=@"EquationLabReferenceSearch";controller.search.delegate=controller;controller.search.sendsSearchStringImmediately=YES;[content addSubview:controller.search];
        NSScrollView* scroll=[[NSScrollView alloc] initWithFrame:NSMakeRect(0,28,520,260)];scroll.hasVerticalScroller=YES;scroll.borderType=NSBezelBorder;
        controller.table=[[NSTableView alloc] initWithFrame:scroll.bounds];controller.table.headerView=nil;controller.table.rowHeight=42;controller.table.allowsMultipleSelection=NO;controller.table.allowsEmptySelection=YES;controller.table.identifier=@"EquationLabReferenceTargets";
        NSTableColumn* column=[[NSTableColumn alloc] initWithIdentifier:@"reference"];column.width=500;[controller.table addTableColumn:column];controller.table.dataSource=controller;controller.table.delegate=controller;scroll.documentView=controller.table;[content addSubview:scroll];
        controller.countLabel=[NSTextField labelWithString:@""];controller.countLabel.frame=NSMakeRect(0,0,520,22);controller.countLabel.font=[NSFont systemFontOfSize:11];controller.countLabel.textColor=NSColor.secondaryLabelColor;[content addSubview:controller.countLabel];
        controller.insertButton=alert.buttons.firstObject;[controller refresh];alert.accessoryView=content;alert.window.identifier=@"EquationLabReferencePicker";alert.window.initialFirstResponder=controller.search;
        if([alert runModal]!=NSAlertFirstButtonReturn)return 1;
        NSString* choice=[controller selectedBookmark];if(!choice.length)return -3;
        result=[choice copy];cursor=0;return 0;
    }@finally{busy=false;}
}
}
