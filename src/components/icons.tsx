// Small stroke icons (24×24, currentColor).
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type P = { className?: string };

export const IconBack = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
export const IconPlus = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconFolder = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const IconFolderOpen = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" />
    <path d="M3 7v10a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L21.8 12H7.4a2 2 0 0 0-1.9 1.4L3 19" />
  </svg>
);
export const IconPencil = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
export const IconTrash = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
);
export const IconFile = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
export const IconUpload = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);
export const IconCheckAll = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 12l3 3 5-6" />
  </svg>
);
export const IconSquare = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
  </svg>
);
export const IconMinusSquare = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 12h8" />
  </svg>
);
export const IconScissors = ({ className = "h-5 w-5" }: P) => (
  <svg {...base} className={className}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
  </svg>
);
