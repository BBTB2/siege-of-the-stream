import { expect, it } from "vitest";
// @ts-expect-error Browser ESM module.
import { nameplateColor } from "../public/overlay-layout.js";

it("keeps black and white Twitch names legible without changing their colour", () => {
  expect(nameplateColor("#000000")).toBe("#fff3d8");
  expect(nameplateColor("#FFFFFF")).toBe("#151d2d");
  expect(nameplateColor("#123456")).toBe("#fff3d8");
  expect(nameplateColor("#FFD073")).toBe("#151d2d");
});
