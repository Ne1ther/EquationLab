#include "word_snapshot_zip.hpp"
#include <iostream>
#include <stdexcept>
int main(int argc,char** argv){@autoreleasepool{try{
 if(argc!=4)throw std::runtime_error("source, compact output and rejected fixture required");
 bridge_probe::WordSnapshotStats stats;NSData* data=bridge_probe::compactSavedWordDocument([NSString stringWithUTF8String:argv[1]],&stats);
 if(!data||stats.entries<3||stats.sourceBytes<20*1024*1024||stats.readBytes>1024*1024)throw std::runtime_error("compact read inflated or read manuscript images");
 if(![data writeToFile:[NSString stringWithUTF8String:argv[2]] atomically:YES])throw std::runtime_error("cannot write compact fixture");
 if(bridge_probe::compactSavedWordDocument([NSString stringWithUTF8String:argv[3]]))throw std::runtime_error("invalid archive accepted");
 if(bridge_probe::compactSavedWordDocument([[NSString stringWithUTF8String:argv[1]] stringByAppendingString:@".link"]))throw std::runtime_error("symlink accepted");
 std::cout<<"{\"sourceBytes\":"<<stats.sourceBytes<<",\"readBytes\":"<<stats.readBytes<<",\"snapshotBytes\":"<<data.length<<",\"entries\":"<<stats.entries<<"}\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}}}
