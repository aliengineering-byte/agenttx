import type { TransactionState } from "./types.js";

const ALLOWED_TRANSITIONS: Readonly<Record<TransactionState, readonly TransactionState[]>> = {
  CREATED: ["RUNNING", "FAILED", "ABORTED", "ROLLED_BACK"],
  RUNNING: ["REVIEW", "FAILED", "ABORTED"],
  REVIEW: ["COMMITTED", "ROLLED_BACK", "FAILED"],
  COMMITTED: [],
  ROLLED_BACK: [],
  FAILED: ["REVIEW", "ROLLED_BACK"],
  ABORTED: ["REVIEW", "ROLLED_BACK"]
};

export function canTransition(from: TransactionState, to: TransactionState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TransactionState, to: TransactionState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transaction state transition: ${from} -> ${to}`);
  }
}

export function isTerminalState(state: TransactionState): boolean {
  return state === "COMMITTED" || state === "ROLLED_BACK";
}

export function isReviewableState(state: TransactionState): boolean {
  return state === "REVIEW" || state === "FAILED" || state === "ABORTED";
}
