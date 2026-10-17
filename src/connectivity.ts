import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";
import {
  API_BASE_URL,
  HEALTH_CHECK_URL,
  probeBackendReachability,
  setApiResponseObserver,
} from "./api";

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
  healthHttpStatus: number | null;
  healthErrorCategory: string | null;
  healthErrorDetail: string | null;
  healthDurationMs: number | null;
  lastApiResponseStatus: number | null;
  lastApiResponseAt: string | null;
  apiBaseUrl: string | null;
  healthUrl: string | null;
  lastSuccessfulConnectionAt: string | null;
};

export type ConnectivityBuildInfo = {
  appMode: string;
  buildProfile: string;
  cleartextHttpPermitted: boolean | null;
};

export function connectivityBuildInfo(): ConnectivityBuildInfo {
  const extra = Constants.expoConfig?.extra as
    | { appMode?: string; buildProfile?: string; cleartextHttpPermitted?: boolean }
    | undefined;
  return {
    appMode: extra?.appMode || "unknown",
    buildProfile: extra?.buildProfile || "unknown",
    cleartextHttpPermitted:
      typeof extra?.cleartextHttpPermitted === "boolean"
        ? extra.cleartextHttpPermitted
        : null,
  };
}

const listeners = new Set<(status: ConnectivityStatus) => void>();
let status: ConnectivityStatus = "checking";
let details: ConnectivityDetails = {
  networkType: "unknown",
  networkConnected: null,
  internetReachable: null,
  backendReachable: null,
  healthHttpStatus: null,
  healthErrorCategory: null,
  healthErrorDetail: null,
  healthDurationMs: null,
  lastApiResponseStatus: null,
  lastApiResponseAt: null,
  apiBaseUrl: API_BASE_URL,
  healthUrl: HEALTH_CHECK_URL,
  lastSuccessfulConnectionAt: null,
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

function noteBackendResponse(httpStatus: number) {
  // Invalidate any older probe so a late timeout cannot overwrite newer API
  // evidence. Any HTTP status proves transport/API reachability; it does not
  // assert that the requested business operation succeeded.
  generation += 1;
  inFlight = null;
  lastCheckAt = Date.now();
  details = {
    ...details,
    backendReachable: true,
    lastApiResponseStatus: httpStatus,
    lastApiResponseAt: new Date().toISOString(),
    lastSuccessfulConnectionAt: new Date().toISOString(),
  };
  publish("online");
}

setApiResponseObserver(noteBackendResponse);

export async function checkConnectivity(force = false): Promise<ConnectivityStatus> {
  if (inFlight && !force) return inFlight;
  // A user-requested retry must start a fresh probe rather than joining a
  // potentially stale request. Its generation cannot publish after this one.
  if (inFlight && force) {
    generation += 1;
    inFlight = null;
  }
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
      healthHttpStatus: null,
      healthErrorCategory: null,
      healthErrorDetail: null,
      healthDurationMs: null,
      lastApiResponseStatus: details.lastApiResponseStatus,
      lastApiResponseAt: details.lastApiResponseAt,
      apiBaseUrl: API_BASE_URL,
      healthUrl: HEALTH_CHECK_URL,
      lastSuccessfulConnectionAt: details.lastSuccessfulConnectionAt,
    };
    // isInternetReachable is deliberately ignored: a local Mac API can work
    // over Wi-Fi without the Wi-Fi network having public internet access.
    if (network.isConnected === false || network.type === "none") {
      lastCheckAt = Date.now();
      publish("offline");
      return status;
    }
    const probe = await probeBackendReachability();
    if (run !== generation) return status;
    details = {
      ...details,
      backendReachable: probe.transportReachable,
      healthHttpStatus: probe.httpStatus,
      healthErrorCategory: probe.errorCategory,
      healthErrorDetail: probe.errorDetail,
      healthDurationMs: probe.durationMs,
      apiBaseUrl: probe.apiBaseUrl,
      healthUrl: probe.healthUrl,
      lastSuccessfulConnectionAt: probe.healthy
        ? new Date().toISOString()
        : details.lastSuccessfulConnectionAt,
    };
    if (
      Constants.expoConfig?.extra?.connectivityDiagnosticsEnabled === true &&
      process.env.EXPO_PUBLIC_CONNECTIVITY_DIAGNOSTICS === "true"
    )
      console.info("[Connectivity]", JSON.stringify({
        apiBaseUrl: probe.apiBaseUrl,
        healthUrl: probe.healthUrl,
        httpStatus: probe.httpStatus,
        category: probe.errorCategory,
        detail: probe.errorDetail,
        durationMs: probe.durationMs,
        networkType: details.networkType,
        networkConnected: details.networkConnected,
        internetReachable: details.internetReachable,
      }));
    lastCheckAt = Date.now();
    publish(probe.healthy ? "online" : "server_unavailable");
    return status;
  })();
  inFlight = check;
  try {
    return await check;
  } catch {
    if (run === generation) {
      details = {
        ...details,
        backendReachable: false,
        healthErrorCategory: "network_state",
        healthErrorDetail: "Unable to read the current network state.",
        apiBaseUrl: API_BASE_URL,
        healthUrl: HEALTH_CHECK_URL,
      };
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
