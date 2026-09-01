import Link from "next/link";

import Ambient from "@/app/_components/Ambient";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <Ambient />
      <div className="glass glass-gold gloss relative w-full max-w-md overflow-hidden p-10 text-center">
        <p className="mb-2 text-5xl font-bold" style={{ color: "#f5c451" }}>
          404
        </p>
        <h1 className="mb-2 text-2xl font-semibold" style={{ color: "#ffffff" }}>
          Page not found
        </h1>
        <p className="mx-auto mb-8 max-w-sm text-base" style={{ color: "rgba(226,235,245,0.72)" }}>
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link href="/home" className="btn btn-primary btn-lg">
          Go home
        </Link>
      </div>
    </div>
  );
}
