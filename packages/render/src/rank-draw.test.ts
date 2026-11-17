import { describe,expect,it } from "vitest";
import { rankDrawAt } from "./RankDrawText";
describe("rank outline-to-fill frames",()=>{
  it("has no initial paint, draws a contour first and fills completely on the final reveal frame",()=>{
    const draw={from:10,durationInFrames:66};
    expect(rankDrawAt(draw,9)).toEqual({stroke:0,fill:0});
    expect(rankDrawAt(draw,10)).toEqual({stroke:0,fill:0});
    expect(rankDrawAt(draw,40).stroke).toBeGreaterThan(0);
    expect(rankDrawAt(draw,40).fill).toBe(0);
    expect(rankDrawAt(draw,75)).toEqual({stroke:1,fill:1});
    expect(rankDrawAt(draw,100)).toEqual({stroke:1,fill:1});
  });
});
