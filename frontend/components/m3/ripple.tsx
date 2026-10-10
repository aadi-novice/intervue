"use client";

import { useEffect, useRef } from "react";

/**
 * M3 press ripple. Drop inside any `relative overflow-hidden` interactive
 * element; it listens to its parent's pointer events and spawns DOM ripples
 * (no React state, so it never re-renders the host). Disabled under
 * `prefers-reduced-motion` via CSS.
 */
export function Ripple({ disabled = false }: { disabled?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = ref.current?.parentElement;
    const layer = ref.current;
    if (!host || !layer || disabled) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || host.hasAttribute("disabled") || host.getAttribute("aria-disabled") === "true") return;
      const rect = host.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
      const ripple = document.createElement("span");
      ripple.className = "m3-ripple";
      ripple.style.width = ripple.style.height = `${radius * 2}px`;
      ripple.style.left = `${x - radius}px`;
      ripple.style.top = `${y - radius}px`;
      layer.appendChild(ripple);

      const release = () => {
        ripple.setAttribute("data-releasing", "");
        window.setTimeout(() => ripple.remove(), 500);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    };

    host.addEventListener("pointerdown", onDown);
    return () => host.removeEventListener("pointerdown", onDown);
  }, [disabled]);

  return (
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ borderRadius: "inherit" }}
    />
  );
}
