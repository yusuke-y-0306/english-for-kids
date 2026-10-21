/**
 * FeatureIcon — メニューカード用のアイコン（絵文字に依存せず SVG で描画）
 */
export type FeatureIconName = "cards" | "puzzle" | "mic" | "game" | "chart";

export default function FeatureIcon({
  name,
  className = "",
}: {
  name: FeatureIconName;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 48 48",
    className,
    "aria-hidden": true as const,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2.6,
  };

  switch (name) {
    case "cards":
      return (
        <svg {...common}>
          <rect x="8" y="12" width="24" height="30" rx="4" fill="#fff8ec" stroke="#e0761f" transform="rotate(-8 20 27)" />
          <rect x="16" y="8" width="24" height="30" rx="4" fill="#fff" stroke="#ff6b6b" />
          <path d="M22 18h12M22 25h9" stroke="#ff6b6b" />
          <text x="28" y="34" textAnchor="middle" fontSize="10" fontWeight="700" fill="#ff6b6b" fontFamily="var(--font-fredoka), sans-serif">
            ABC
          </text>
        </svg>
      );
    case "puzzle":
      return (
        <svg {...common}>
          <path d="M9 30h9a4 4 0 1 1 8 0h9" stroke="#a17bf0" fill="#fff8ec" />
          <rect x="9" y="12" width="12" height="10" rx="3" fill="#4dc9f6" stroke="#2e9ec4" />
          <rect x="23" y="12" width="12" height="10" rx="3" fill="#ffd93d" stroke="#e0b21c" />
          <rect x="9" y="30" width="12" height="10" rx="3" fill="#6cc24a" stroke="#4a9b2f" />
          <rect x="23" y="30" width="12" height="10" rx="3" fill="#ff9f43" stroke="#d9701f" />
        </svg>
      );
    case "mic":
      return (
        <svg {...common}>
          <rect x="18" y="6" width="12" height="22" rx="6" fill="#ff8fb0" stroke="#e0638b" />
          <path d="M11 22a13 13 0 0 0 26 0" stroke="#e0638b" />
          <path d="M24 35v7M17 42h14" stroke="#a17bf0" />
        </svg>
      );
    case "game":
      return (
        <svg {...common}>
          <rect x="6" y="16" width="36" height="18" rx="9" fill="#4dc9f6" stroke="#2e9ec4" />
          <path d="M15 25h6M18 22v6" stroke="#fff" strokeWidth="3" />
          <circle cx="32" cy="23" r="2.6" fill="#ff6b6b" stroke="none" />
          <circle cx="36" cy="28" r="2.6" fill="#ffd93d" stroke="none" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M8 38h32" stroke="#8a5a3b" />
          <rect x="12" y="24" width="7" height="14" rx="3" fill="#ffd93d" stroke="#e0b21c" />
          <rect x="22" y="16" width="7" height="22" rx="3" fill="#6cc24a" stroke="#4a9b2f" />
          <rect x="32" y="10" width="7" height="28" rx="3" fill="#ff8fb0" stroke="#e0638b" />
          <path d="M10 16l7-5 6 4 8-8" stroke="#a17bf0" strokeDasharray="3 3" />
        </svg>
      );
  }
}
