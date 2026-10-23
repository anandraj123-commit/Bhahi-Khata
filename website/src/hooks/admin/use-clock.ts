"use client";
import { useSyncExternalStore } from "react";

let snapshot = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    snapshot = Date.now();
    timer = setInterval(() => {
      const nextSnapshot = Date.now();
      if (nextSnapshot === snapshot) return;
      snapshot = nextSnapshot;
      for (const notify of listeners) notify();
    }, 1000);
    listener();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return 0;
}

export function useClock() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
