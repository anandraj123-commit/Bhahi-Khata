import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { probeBackendReachability } from "./api";

export type ConnectivityStatus =
  | "checking"
  | "offline"
  | "server_unavailable"
  | "online";
export type ConnectivityDetails = {
  networkType: string;
  networkConnected: boolean | null;
  internetReachable: boolean | null;
  backendReachable: boolean | null;
};

const listeners = new Set<(status: ConnectivityStatus) => void>();
let status: ConnectivityStatus = "checking";
let details: ConnectivityDetails = {
  networkType: "unknown",
  networkConnected: null,
  internetReachable: null,
  backendReachable: null,
};
let generation = 0;
let lastCheckAt = 0;
let inFlight: Promise<ConnectivityStatus> | null = null;
let networkTimer: ReturnType<typeof setTimeout> | null = null;
let stopNetInfo: (() => void) | null = null;
let stopAppState: { remove: () => void } | null = null;

function publish(next: ConnectivityStatus) {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(next);
}

export function currentConnectivity(): ConnectivityStatus {
  return status;
}

export function currentConnectivityDetails(): ConnectivityDetails {
  return details;
}

export async function checkConnectivity(force = false): Promise<ConnectivityStatus> {
  if (inFlight) return inFlight;
  if (!force && lastCheckAt && Date.now() - lastCheckAt < 5000) return status;
  const run = ++generation;
  publish("checking");
  const check = (async () => {
    const network = await NetInfo.fetch();
    if (run !== generation) return status;
    details = {
      networkType: network.type,
      networkConnected: network.isConnected,
      internetReachable: network.isInternetReachable,
      backendReachable: null,
    };
    // isInternetReachable is deliberately ignored: a local Mac API can work
    // over Wi-Fi without the Wi-Fi network having public internet access.
    if (network.isConnected === false || network.type === "none") {
      lastCheckAt = Date.now();
      publish("offline");
      return status;
    }
    const reachable = await probeBackendReachability();
    if (run !== generation) return status;
    details = { ...details, backendReachable: reachable };
    lastCheckAt = Date.now();
    publish(reachable ? "online" : "server_unavailable");
    return status;
  })();
  inFlight = check;
  try {
    return await check;
  } catch {
    if (run === generation) {
      lastCheckAt = Date.now();
      publish("server_unavailable");
    }
    return status;
  } finally {
    if (inFlight === check) inFlight = null;
  }
}

function networkChanged() {
  generation += 1; // invalidate a probe started against the previous network
  inFlight = null;
  publish("checking");
  if (networkTimer) clearTimeout(networkTimer);
  networkTimer = setTimeout(() => {
    networkTimer = null;
    void checkConnectivity(true);
  }, 350);
}

export function observeConnectivity(
  listener: (status: ConnectivityStatus) => void,
) {
  listeners.add(listener);
  listener(status);
  if (!stopNetInfo) stopNetInfo = NetInfo.addEventListener(networkChanged);
  if (!stopAppState)
    stopAppState = AppState.addEventListener("change", (next) => {
      if (next === "active") networkChanged();
    });
  void checkConnectivity();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopNetInfo?.();
      stopNetInfo = null;
      stopAppState?.remove();
      stopAppState = null;
      if (networkTimer) clearTimeout(networkTimer);
      networkTimer = null;
    }
  };
}
