/**
 * AppDisabledScreen
 *
 * Shown for every route while the kill switch is engaged. It reveals nothing
 * and offers no data — just a notice. The hidden 8-click gesture
 * (KillSwitchPanel) is mounted here too, so the owner can re-enable the app
 * from this screen without a Microsoft sign-in.
 */
import KillSwitchPanel from "@/app/_components/KillSwitchPanel";

export default function AppDisabledScreen() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "linear-gradient(160deg,#0d2138 0%,#081525 100%)",
        color: "#e2ebf5",
        textAlign: "center",
      }}
    >
      <KillSwitchPanel />
      <div style={{ maxWidth: 420 }}>
        <div
          aria-hidden="true"
          style={{
            width: 64,
            height: 64,
            margin: "0 auto 20px",
            borderRadius: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 30,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          ⏸
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>
          Temporarily unavailable
        </h1>
        <p style={{ fontSize: 15, color: "rgba(226,235,245,0.72)", margin: 0 }}>
          The Outlet Rotation App is offline for maintenance. Please check back
          shortly.
        </p>
      </div>
    </main>
  );
}
