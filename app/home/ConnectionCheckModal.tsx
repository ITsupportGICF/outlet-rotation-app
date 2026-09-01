"use client";

/**
 * "Check Internet Connection" - a small trigger + popup on the dashboard.
 *
 * navigator.onLine only reflects whether the device THINKS it has a network
 * interface up - it can report "online" even with no real path to the
 * internet (e.g. connected to a router with no WAN). So alongside that, we
 * actually ping the app's own /api/health endpoint and time the round trip,
 * which is a real signal of whether this device can currently reach the
 * server. The Network Information API (effective type / downlink / rtt) is
 * shown when the browser exposes it (Chrome/Edge do; Firefox/Safari don't -
 * we say so rather than showing blank fields).
 */
import { useEffect, useState } from "react";

type ConnectionInfo = {
  effectiveType?: string;
  downlinkMbps?: number;
  rttMs?: number;
  saveData?: boolean;
};

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; latencyMs: number }
  | { status: "fail" };

function readConnectionInfo(): ConnectionInfo | null {
  if (typeof navigator === "undefined") return null;
  // Not in the standard TS lib - Network Information API is Chromium-only.
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
  };
  const conn = nav.connection;
  if (!conn) return null;

  return {
    effectiveType: conn.effectiveType,
    downlinkMbps: conn.downlink,
    rttMs: conn.rtt,
    saveData: conn.saveData,
  };
}

export default function ConnectionCheckModal() {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [browserOnline, setBrowserOnline] = useState<boolean | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);

  async function runCheck() {
    setCheck({ status: "checking" });
    setBrowserOnline(typeof navigator !== "undefined" ? navigator.onLine : null);
    setConnectionInfo(readConnectionInfo());

    const start = performance.now();
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      const latencyMs = Math.round(performance.now() - start);
      setCheck({ status: "ok", latencyMs });
    } catch {
      setCheck({ status: "fail" });
    }
  }

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void runCheck();
        }}
        className="text-xs font-medium underline-offset-2 hover:underline"
        style={{ color: "rgba(226,235,245,0.50)" }}
      >
        Check Internet Connection
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Internet connection status"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(11,25,40,0.35)", backdropFilter: "blur(3px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="glass glass-gold w-full max-w-sm rounded-2xl p-7 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: "#ffffff" }}>
                Connection Status
              </h2>
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full text-base"
                style={{
                  background:
                    check.status === "ok"
                      ? "#dff3e6"
                      : check.status === "fail"
                        ? "#fdecec"
                        : "#e8f0fa",
                }}
                aria-hidden="true"
              >
                {check.status === "ok" ? "✓" : check.status === "fail" ? "✕" : "…"}
              </span>
            </div>

            <div className="mb-6 space-y-3 text-sm">
              <Row
                label="Server reachable"
                value={
                  check.status === "checking"
                    ? "Checking…"
                    : check.status === "ok"
                      ? `Yes — ${check.latencyMs}ms`
                      : check.status === "fail"
                        ? "No response from server"
                        : "—"
                }
                good={check.status === "ok"}
                bad={check.status === "fail"}
              />
              <Row
                label="Device network status"
                value={
                  browserOnline === null
                    ? "—"
                    : browserOnline
                      ? "Online"
                      : "Offline"
                }
                good={browserOnline === true}
                bad={browserOnline === false}
              />
              <Row
                label="Connection type"
                value={connectionInfo?.effectiveType?.toUpperCase() ?? "Not available in this browser"}
              />
              <Row
                label="Estimated speed"
                value={
                  connectionInfo?.downlinkMbps !== undefined
                    ? `${connectionInfo.downlinkMbps} Mbps`
                    : "Not available in this browser"
                }
              />
              <Row
                label="Network latency"
                value={
                  connectionInfo?.rttMs !== undefined
                    ? `${connectionInfo.rttMs}ms`
                    : "Not available in this browser"
                }
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void runCheck()}
                className="btn btn-outline btn-md flex-1"
              >
                Recheck
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                autoFocus
                className="btn btn-primary btn-md flex-1"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "rgba(226,235,245,0.72)" }}>{label}</span>
      <span
        className="font-semibold"
        style={{ color: good ? "#1c7a44" : bad ? "#c23b3b" : "#ffffff" }}
      >
        {value}
      </span>
    </div>
  );
}
