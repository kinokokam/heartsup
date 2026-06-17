import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTilt } from "./useTilt";

function fireBeta(beta: number) {
  const e = new Event("deviceorientation") as Event & { beta?: number };
  e.beta = beta;
  window.dispatchEvent(e);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useTilt", () => {
  it("calls onUp once when tilted up, then re-arms after returning to neutral", () => {
    const onUp = vi.fn();
    const onDown = vi.fn();
    renderHook(() => useTilt({ enabled: true, onUp, onDown }));
    act(() => {
      fireBeta(-60);
    });
    expect(onUp).toHaveBeenCalledTimes(1);
    act(() => {
      fireBeta(-60);
    }); // still tilted: must not fire again
    expect(onUp).toHaveBeenCalledTimes(1);
    act(() => {
      fireBeta(0);
    }); // back to neutral re-arms
    act(() => {
      fireBeta(-60);
    });
    expect(onUp).toHaveBeenCalledTimes(2);
    expect(onDown).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onUp = vi.fn();
    renderHook(() => useTilt({ enabled: false, onUp, onDown: vi.fn() }));
    act(() => {
      fireBeta(-60);
    });
    expect(onUp).not.toHaveBeenCalled();
  });
});
