import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isReviewableState, isTerminalState } from "../../src/core/state.js";

describe("transaction state machine", () => {
  it("allows the normal transaction lifecycle", () => {
    expect(canTransition("CREATED", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "REVIEW")).toBe(true);
    expect(canTransition("REVIEW", "COMMITTED")).toBe(true);
  });

  it("rejects impossible transitions", () => {
    expect(() => assertTransition("ROLLED_BACK", "COMMITTED")).toThrow(/Invalid transaction state transition/);
    expect(() => assertTransition("CREATED", "COMMITTED")).toThrow();
  });

  it("classifies terminal and reviewable states", () => {
    expect(isTerminalState("COMMITTED")).toBe(true);
    expect(isTerminalState("REVIEW")).toBe(false);
    expect(isReviewableState("FAILED")).toBe(true);
  });
});
