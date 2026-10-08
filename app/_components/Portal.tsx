"use client";

/**
 * Renders its children directly into <body>, outside the component tree.
 *
 * Why this exists: the app's .glass cards use `backdrop-filter`. In CSS, any
 * element with a backdrop-filter becomes the containing block for its
 * `position: fixed` descendants — so a "full-screen" overlay rendered inside a
 * glass card is trapped inside that card and clipped by its overflow. Every
 * overlay (confirmation dialogs, the "Working…" screen) goes through this so
 * it always covers the whole viewport, wherever it's rendered from.
 *
 * Overlays only ever appear after a click, so nothing here renders on the
 * server; the external-store check keeps server and client output identical.
 */
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const noopSubscribe = () => () => {};

export default function Portal({ children }: { children: React.ReactNode }) {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return isClient ? createPortal(children, document.body) : null;
}
