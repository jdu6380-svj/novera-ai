import type { SVGProps } from "react";

// Local inline SVG primitives authored for this project. This file does not
// import an icon package or copy path data from a third-party icon source.
export type Phase5IconName =
  | "activity"
  | "arrow-up-right"
  | "book"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "circle-check"
  | "clock"
  | "close"
  | "document"
  | "download"
  | "eye"
  | "eye-off"
  | "file-text"
  | "filter"
  | "insight"
  | "layers"
  | "logout"
  | "menu"
  | "more"
  | "plus"
  | "search"
  | "settings"
  | "spark"
  | "target"
  | "trash"
  | "upload"
  | "warning"
  | "x";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: Phase5IconName;
}

export function Phase5Icon({ name, strokeWidth = 1.8, ...props }: IconProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
  };

  switch (name) {
    case "activity":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M3 12h4l2-6 3 12 2-6h7" /></svg>;
    case "arrow-up-right":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M6 18 18 6M8 6h10v10" /></svg>;
    case "book":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5zM4 5.5v16" /><path {...common} d="M8 7h8M8 11h8" /></svg>;
    case "check":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="m5 12 4 4L19 6" /></svg>;
    case "chevron-down":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="m6 9 6 6 6-6" /></svg>;
    case "chevron-right":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="m9 6 6 6-6 6" /></svg>;
    case "circle-check":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><circle {...common} cx="12" cy="12" r="9" /><path {...common} d="m8 12 3 3 5-6" /></svg>;
    case "clock":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><circle {...common} cx="12" cy="12" r="9" /><path {...common} d="M12 7v5l3 2" /></svg>;
    case "close":
    case "x":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="m7 7 10 10M17 7 7 17" /></svg>;
    case "document":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M6 3h8l4 4v14H6zM14 3v5h5" /><path {...common} d="M9 13h6M9 17h6" /></svg>;
    case "download":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" /></svg>;
    case "eye":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle {...common} cx="12" cy="12" r="2.5" /></svg>;
    case "eye-off":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="m3 3 18 18M10.5 6.2A10.5 10.5 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.8M6.2 6.8C3.8 8.3 2.5 12 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.2-1" /><path {...common} d="M10 10a3 3 0 0 0 4 4" /></svg>;
    case "file-text":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M6 3h8l4 4v14H6zM14 3v5h5" /><path {...common} d="M9 12h6M9 16h4" /></svg>;
    case "filter":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M4 6h16M7 12h10m-6 6h2" /></svg>;
    case "insight":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-1 .8-1.5 1.6-1.5 2.5h-5c0-.9-.5-1.7-1.5-2.5Z" /><path {...common} d="M12 5v2M5.6 7.6 7 9M18.4 7.6 17 9" /></svg>;
    case "layers":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="m12 4 8 4-8 4-8-4 8-4Z" /><path {...common} d="m4 12 8 4 8-4M4 16l8 4 8-4" /></svg>;
    case "logout":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></svg>;
    case "menu":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case "more":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>;
    case "plus":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M12 5v14M5 12h14" /></svg>;
    case "search":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><circle {...common} cx="10.8" cy="10.8" r="6.8" /><path {...common} d="m16 16 5 5" /></svg>;
    case "settings":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><circle {...common} cx="12" cy="12" r="3" /><path {...common} d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>;
    case "spark":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></svg>;
    case "target":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><circle {...common} cx="12" cy="12" r="8" /><circle {...common} cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>;
    case "trash":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
    case "upload":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="M12 16V5m0 0L8 9m4-4 4 4M5 15v4h14v-4" /></svg>;
    case "warning":
      return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path {...common} d="m12 4 9 16H3L12 4Z" /><path {...common} d="M12 9v5m0 3h.01" /></svg>;
    default:
      return null;
  }
}
