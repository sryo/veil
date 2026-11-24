// Loads veil.js's pure decisions under node:vm. Its JXA glue lives inside
// run(), which osascript calls and node never does.
import { readFileSync } from "node:fs";
import vm from "node:vm";
export const SOURCE = readFileSync(new URL("../../veil.js", import.meta.url), "utf8");
export function core() {
  const ctx = vm.createContext({});
  vm.runInContext(SOURCE, ctx);
  return vm.runInContext("({ holderStep, wardenStep, holderInit, wardenInit, uncovered, u32s, drift, K })", ctx);
}
