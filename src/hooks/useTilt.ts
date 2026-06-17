import { useEffect, useRef, useState, useCallback } from "react";
import { tiltDirection } from "../lib/tilt";

interface TiltOpts {
  enabled: boolean;
  onUp: () => void;
  onDown: () => void;
}

type PermissionState = "unknown" | "granted" | "denied" | "unsupported";

// iOS 13+ exposes DeviceOrientationEvent.requestPermission(); other browsers don't.
function needsPermission(): boolean {
  const E = (typeof window !== "undefined" ? (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent : undefined) as
    | { requestPermission?: () => Promise<"granted" | "denied"> }
    | undefined;
  return typeof E?.requestPermission === "function";
}

export function useTilt({ enabled, onUp, onDown }: TiltOpts) {
  const armed = useRef(true);
  const [permission, setPermission] = useState<PermissionState>(
    typeof window !== "undefined" && "DeviceOrientationEvent" in window ? "unknown" : "unsupported",
  );

  const requestPermission = useCallback(async () => {
    const E = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<"granted" | "denied"> } }).DeviceOrientationEvent;
    if (E?.requestPermission) {
      try {
        setPermission((await E.requestPermission()) === "granted" ? "granted" : "denied");
      } catch {
        setPermission("denied");
      }
    } else {
      setPermission("granted");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (needsPermission() && permission !== "granted") return; // wait for the gesture-driven grant
    const handler = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const dir = tiltDirection(beta);
      if (dir === null) {
        armed.current = true;
        return;
      }
      if (!armed.current) return;
      armed.current = false;
      if (dir === "up") onUp();
      else onDown();
    };
    window.addEventListener("deviceorientation", handler);
    return () => window.removeEventListener("deviceorientation", handler);
  }, [enabled, permission, onUp, onDown]);

  return { permission, requestPermission, supported: permission !== "unsupported" };
}
