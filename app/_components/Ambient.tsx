/**
 * Ambient background used app-wide: two softly drifting gradient orbs and a
 * faint grid texture, fixed behind all content (z-index -1). Pure
 * presentational, no state — safe in any server component.
 */
export default function Ambient() {
  return (
    <>
      <div
        className="orb drift-orb"
        style={{
          top: "-9rem",
          left: "-9rem",
          height: "34rem",
          width: "34rem",
          background:
            "radial-gradient(circle, rgba(96,123,155,0.18), transparent 70%)",
        }}
        aria-hidden="true"
      />
      <div
        className="orb drift-orb"
        style={{
          bottom: "-11rem",
          right: "-9rem",
          height: "36rem",
          width: "36rem",
          background:
            "radial-gradient(circle, rgba(132,161,196,0.16), transparent 70%)",
          animationDelay: "-8s",
        }}
        aria-hidden="true"
      />
      <div className="grid-texture" aria-hidden="true" />
    </>
  );
}
