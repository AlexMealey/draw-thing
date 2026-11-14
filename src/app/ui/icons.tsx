import type { SVGProps } from 'react';

/** Simple 24px line icons (currentColor). */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const GalleryIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);

export const ActionsIcon = () => (
  <Icon>
    <path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z" />
  </Icon>
);

export const BrushIcon = () => (
  <Icon>
    <path d="M20 4c-4 2.5-8 6.5-10.5 10" />
    <path d="M9.5 14c-2 0-3.5 1.5-3.5 3.5 0 1.2-.8 2-2 2.5 3 1 7 .5 7.5-3.5" />
  </Icon>
);

export const EraserIcon = () => (
  <Icon>
    <path d="M8 20h12" />
    <path d="M5.5 15.5 14 7l5 5-7.5 7.5H9z" />
    <path d="M9.5 11.5l5 5" />
  </Icon>
);

export const LayersIcon = () => (
  <Icon>
    <path d="M12 4 3 9l9 5 9-5z" />
    <path d="m3 13.5 9 5 9-5" />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export const EyedropperIcon = () => (
  <Icon>
    <path d="m14 6 4 4" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L17 9l-2-2z" />
    <path d="M15 8 6 17l-1 3 3-1 9-9" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="m15 5-7 7 7 7" />
  </Icon>
);

/** Points down when expanded; CSS rotates it for collapsed. */
export const ChevronIcon = () => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

/** Adjustments: a magic wand with sparkles. */
export const AdjustIcon = () => (
  <Icon>
    <path d="m4 20 11-11" />
    <path d="m13 7 2-2 4 4-2 2z" />
    <path d="M7 4v3M5.5 5.5h3M19 14v3M17.5 15.5h3" />
  </Icon>
);

export const HandleIcon = () => (
  <Icon>
    <path d="M5 9h14M5 15h14" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

/** Safari's Share button (a box with an arrow out of the top). */
export const ShareIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M8.5 10H6.5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-2" />
  </Icon>
);

/** Add to Home Screen (a plus in a rounded square). */
export const AddSquareIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Icon>
);

/** A pushpin; filled while pinned. */
export const PinIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M9 4h6l-1 5 3 3H7l3-3z" />
    <path d="M12 12v8" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <rect x="6.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
    <rect x="14" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
  </Icon>
);

/** Stacked, offset frames: onion skin. */
export const OnionIcon = () => (
  <Icon>
    <rect x="3.5" y="7.5" width="10" height="10" rx="2" opacity="0.45" />
    <rect x="10.5" y="6.5" width="10" height="10" rx="2" opacity="0.45" />
    <rect x="7" y="4" width="10" height="10" rx="2" />
  </Icon>
);

/** Animation: a strip of film. */
export const FilmIcon = () => (
  <Icon>
    <rect x="4" y="3.5" width="16" height="17" rx="2" />
    <path d="M8 3.5v17M16 3.5v17M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" />
  </Icon>
);

/** Copy the current frame. */
export const CloneIcon = () => (
  <Icon>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    <path d="M14 11.5v5M11.5 14h5" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4.5 7h15M10 4.5h4M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6" />
  </Icon>
);
