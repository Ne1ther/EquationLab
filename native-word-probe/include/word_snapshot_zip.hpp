#pragma once
#import <Foundation/Foundation.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <limits>
#include <set>
#include <string>
#include <vector>

// Private editor snapshots need document XML and OLE streams, not manuscript
// photographs. Copy compressed ZIP entries verbatim: no image decompression,
// document save, shell process or archive extraction occurs in Word.
namespace bridge_probe {
struct WordSnapshotStats {std::uint64_t sourceBytes=0,readBytes=0;std::uint32_t entries=0;};
namespace snapshot_zip {
inline std::uint16_t u16(const unsigned char* p){return p[0]|std::uint16_t(p[1])<<8;}
inline std::uint32_t u32(const unsigned char* p){return u16(p)|std::uint32_t(u16(p+2))<<16;}
inline void put16(NSMutableData* d,std::uint16_t n){unsigned char b[]={static_cast<unsigned char>(n),static_cast<unsigned char>(n>>8)};[d appendBytes:b length:2];}
inline void put32(NSMutableData* d,std::uint32_t n){put16(d,n&65535);put16(d,n>>16);}
inline bool readAt(int fd,std::uint64_t offset,void* buffer,std::size_t length,WordSnapshotStats& stats){
 auto* bytes=static_cast<unsigned char*>(buffer);std::size_t done=0;
 while(done<length){auto n=pread(fd,bytes+done,length-done,static_cast<off_t>(offset+done));if(n<0&&errno==EINTR)continue;if(n<=0)return false;done+=n;stats.readBytes+=n;}return true;
}
struct Entry {std::string name;std::uint16_t method,flags;std::uint32_t crc,packed,size,offset;};
inline bool sameFile(const struct stat& a,const struct stat& b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
inline NSData* compact(int fd,const struct stat& before,WordSnapshotStats& stats){
 constexpr std::uint64_t MaxPacked=34000000,MaxExpanded=128*1024*1024;
 if(before.st_size<22||std::uint64_t(before.st_size)>UINT32_MAX)return nil;
 stats.sourceBytes=before.st_size;const auto tailSize=std::min<std::uint64_t>(stats.sourceBytes,65557);
 std::vector<unsigned char> tail(tailSize);if(!readAt(fd,stats.sourceBytes-tailSize,tail.data(),tail.size(),stats))return nil;
 std::int64_t end=tail.size()-22;for(;end>=0;--end)if(u32(tail.data()+end)==0x06054b50&&std::uint64_t(end+22+u16(tail.data()+end+20))==tail.size())break;
 if(end<0)return nil;const auto* footer=tail.data()+end;
 const auto count=u16(footer+10);const std::uint64_t dirSize=u32(footer+12),dirOffset=u32(footer+16);
 if(u16(footer+4)||u16(footer+6)||u16(footer+8)!=count||count==65535||dirSize>16*1024*1024||dirOffset+dirSize!=stats.sourceBytes-tailSize+end)return nil;
 std::vector<unsigned char> directory(dirSize);if(!readAt(fd,dirOffset,directory.data(),directory.size(),stats))return nil;
 std::set<std::string> names;std::vector<Entry> retained;std::size_t position=0;std::uint64_t expanded=0,packed=0;bool root=false,types=false;
 for(std::uint32_t i=0;i<count;i++){
  if(position+46>directory.size())return nil;const auto* p=directory.data()+position;if(u32(p)!=0x02014b50)return nil;
  const std::size_t length=u16(p+28),extra=u16(p+30),comment=u16(p+32);if(!length||position+46+length+extra+comment>directory.size()||u16(p+34))return nil;
  std::string name(reinterpret_cast<const char*>(p+46),length);NSString* text=[[NSString alloc] initWithBytes:name.data() length:name.size() encoding:NSUTF8StringEncoding];
  if(!text||name.front()=='/'||name.find('\0')!=std::string::npos||name.find('\\')!=std::string::npos||name.find(':')!=std::string::npos||name.find("../")!=std::string::npos||!names.insert(name).second)return nil;
  const auto flags=u16(p+8),method=u16(p+10);const auto size=u32(p+24),compressed=u32(p+20),offset=u32(p+42);
  if(flags&~0x080e||size==UINT32_MAX||compressed==UINT32_MAX||offset==UINT32_MAX)return nil;
  const bool xml=[text.lowercaseString hasSuffix:@".xml"]||[text.lowercaseString hasSuffix:@".rels"];
  const bool ole=[text.lowercaseString hasSuffix:@".bin"]&&size<=16*1024*1024;
  if(xml||ole){
   if(method!=0&&method!=8)return nil;expanded+=size;packed+=compressed+length+76;
   if(expanded>MaxExpanded||packed>MaxPacked||std::uint64_t(offset)+30+length+compressed>dirOffset)return nil;
   retained.push_back({name,method,std::uint16_t(flags&~8),u32(p+16),compressed,size,offset});
   root|=name=="_rels/.rels";types|=name=="[Content_Types].xml";
  }
  position+=46+length+extra+comment;
 }
 if(position!=directory.size()||!root||!types||retained.empty())return nil;
 NSMutableData* output=[NSMutableData data],*central=[NSMutableData data];
 for(const auto& e:retained){
  unsigned char local[30];if(!readAt(fd,e.offset,local,sizeof(local),stats)||u32(local)!=0x04034b50||u16(local+8)!=e.method||u16(local+26)!=e.name.size()||(u16(local+6)&~8)!=(e.flags&~8))return nil;
  const std::uint64_t dataOffset=std::uint64_t(e.offset)+30+u16(local+26)+u16(local+28);if(dataOffset+e.packed>dirOffset)return nil;
  std::vector<unsigned char> localName(e.name.size());if(!readAt(fd,e.offset+30,localName.data(),localName.size(),stats)||std::memcmp(localName.data(),e.name.data(),e.name.size()))return nil;
  const auto start=static_cast<std::uint32_t>(output.length);
  put32(output,0x04034b50);put16(output,20);put16(output,e.flags);put16(output,e.method);put32(output,0);put32(output,e.crc);put32(output,e.packed);put32(output,e.size);put16(output,e.name.size());put16(output,0);[output appendBytes:e.name.data() length:e.name.size()];
  const auto at=output.length;[output increaseLengthBy:e.packed];if(!readAt(fd,dataOffset,static_cast<unsigned char*>(output.mutableBytes)+at,e.packed,stats))return nil;
  put32(central,0x02014b50);put16(central,20);put16(central,20);put16(central,e.flags);put16(central,e.method);put32(central,0);put32(central,e.crc);put32(central,e.packed);put32(central,e.size);put16(central,e.name.size());put16(central,0);put16(central,0);put16(central,0);put16(central,0);put32(central,0);put32(central,start);[central appendBytes:e.name.data() length:e.name.size()];
 }
 const auto centralOffset=output.length;[output appendData:central];put32(output,0x06054b50);put16(output,0);put16(output,0);put16(output,retained.size());put16(output,retained.size());put32(output,central.length);put32(output,centralOffset);put16(output,0);
 struct stat after{};if(fstat(fd,&after)||!sameFile(before,after)||output.length>MaxPacked)return nil;stats.entries=retained.size();return output;
}
}
inline NSData* compactSavedWordDocument(NSString* path,WordSnapshotStats* measured=nullptr){
 if(![path hasPrefix:@"/"]||[path rangeOfString:@"\n"].location!=NSNotFound)return nil;
 int fd=open(path.fileSystemRepresentation,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(fd<0)return nil;
 struct stat before{};WordSnapshotStats stats;NSData* result=nil;
 if(!fstat(fd,&before)&&S_ISREG(before.st_mode)&&before.st_uid==geteuid())result=snapshot_zip::compact(fd,before,stats);
 close(fd);if(measured)*measured=stats;return result;
}
}
