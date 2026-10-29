#include "reference_picker.hpp"
#include <cassert>
#include <iostream>

int main(){@autoreleasepool{
    using namespace bridge_probe::reference_picker;
    NSString* valid=@"ELREF1\n3\n1\tEL_first\t(1.1)\tConservation of energy\n2\tEL_second\t(1.2)\tStress and strain\n3\tEL_third\t(2.1)\t扩散方程\n";
    auto rows=request(valid);assert(rows.count==3);
    assert([rows[1][@"bookmark"] isEqual:@"EL_second"]);
    assert(filtered(rows,@"stress").count==1);
    assert([filtered(rows,@"(1.2)").firstObject[@"bookmark"] isEqual:@"EL_second"]);
    assert(filtered(rows,@"扩散").count==1);
    assert(filtered(rows,@"CONSERVATION").count==1);
    assert(filtered(rows,@"missing").count==0);
    assert(filtered(rows,@"  ").count==3);
    assert(!request(nil));assert(!request(@""));assert(!request(@"ELREF1\n0\n"));
    assert(!request(@"ELREF1\n1\n1\tEL_ok\t(1)\ttext"));
    assert(!request(@"ELREF1\n01\n1\tEL_ok\t(1)\ttext\n"));
    assert(!request(@"ELREF1\n1\n2\tEL_ok\t(1)\ttext\n"));
    assert(!request(@"ELREF1\n1\n1\tunsafe-name\t(1)\ttext\n"));
    assert(!request(@"ELREF1\n1\n1\tEL_unsafe name\t(1)\ttext\n"));
    assert(!request(@"ELREF1\n2\n1\tEL_same\t(1)\ttext\n2\tEL_SAME\t(2)\ttext\n"));
    assert(!request(@"ELREF1\n1\n1\tEL_ok\t\ttext\n"));
    assert(!request(@"ELREF1\n1\n1\tEL_ok\t(1)\ttext\textra\n"));
    assert(!request(@"ELREF1\n1\n1\tEL_ok\t(1)\tcontrol\rcharacter\n"));
    NSString* longNumber=[@"n" stringByPaddingToLength:129 withString:@"n" startingAtIndex:0];
    assert(!request([NSString stringWithFormat:@"ELREF1\n1\n1\tEL_ok\t%@\ttext\n",longNumber]));
    NSString* longContext=[@"x" stringByPaddingToLength:257 withString:@"x" startingAtIndex:0];
    assert(!request([NSString stringWithFormat:@"ELREF1\n1\n1\tEL_ok\t(1)\t%@\n",longContext]));
    assert(filtered(rows,longContext).count==0);
    result=@"EL_second";cursor=0;NSMutableString* selected=[NSMutableString string];
    for(std::int32_t unit=nextCharacter();unit;unit=nextCharacter())[selected appendFormat:@"%C",static_cast<unichar>(unit)];
    assert([selected isEqual:@"EL_second"]);assert(nextCharacter()==0);assert(result==nil);
    result=@"stale";cursor=0;assert(show(nil)==-2);assert(nextCharacter()==0);
    std::cout<<"Reference picker protocol/filter tests passed; UI not opened.\n";
}}
