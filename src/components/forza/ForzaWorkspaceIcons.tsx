import React from 'react';

type IconProps = {
  className?: string;
  size?: number;
};

const baseSvgProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: className ?? 'shrink-0',
  'aria-hidden': true as const,
});

/** V-belt and timing belt loop wrapped around driver/driven sheaves */
export const BeltIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <circle cx="7" cy="12" r="4" />
    <circle cx="17.5" cy="12" r="2.75" />
    <path d="M7 8l10.5 1.25" />
    <path d="M7 16l10.5-1.25" />
    <circle cx="7" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

/** Taper-lock industrial pulley with precision keyway bore */
export const PulleyIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="5.2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 3.5v3.3" />
    <path d="M12 17.2v3.3" />
    <path d="M4.6 7.75l2.85 1.65" />
    <path d="M16.55 14.6l2.85 1.65" />
    <path d="M19.4 7.75l-2.85 1.65" />
    <path d="M7.45 14.6L4.6 16.25" />
  </svg>
);

/** Deep-groove ball bearing cross section */
export const BearingIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.6" />
    <circle cx="12" cy="5.7" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.3" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="5.7" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="18.3" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="7.55" cy="7.55" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="16.45" cy="16.45" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="16.45" cy="7.55" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="7.55" cy="16.45" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);

/** Roller chain & sprocket coupling */
export const ChainCouplingIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <rect x="3.5" y="7.5" width="9" height="6" rx="3" />
    <rect x="11.5" y="10.5" width="9" height="6" rx="3" />
    <circle cx="6.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="13.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** Ceramic kiln roller with thermal flux waves */
export const KilnRollerIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <rect x="3.5" y="13.5" width="17" height="5" rx="2.2" />
    <path d="M7.5 13.5v5" />
    <path d="M16.5 13.5v5" />
    <path d="M8 9.8c0-1.4 1.3-1.8 1.3-3.3" />
    <path d="M12 9.8c0-1.4 1.3-1.8 1.3-3.3" />
    <path d="M16 9.8c0-1.4 1.3-1.8 1.3-3.3" />
  </svg>
);

/** Precision machined bushing & mechanical seal profile */
export const MechanicalSealIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <path d="M5 7h14v3.5h-2.5v3H19V17H5v-3.5h2.5v-3H5V7z" />
    <path d="M10 10.5v3" />
    <path d="M14 10.5v3" />
  </svg>
);

/** DIN 2215 pulley center-distance & belt length geometry icon */
export const DinCalculatorIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <circle cx="6.5" cy="10.5" r="3.5" />
    <circle cx="17.5" cy="10.5" r="2.25" />
    <path d="M6.5 7l11 1.25" />
    <path d="M6.5 14l11-1.25" />
    <path d="M6.5 18.5h11" />
    <path d="M6.5 16.75v3.5" />
    <path d="M17.5 16.75v3.5" />
  </svg>
);

/** Optical 4-corner reticle framing an industrial component */
export const VisualScannerIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
    <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
    <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
    <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 7.2v1.3" />
    <path d="M12 15.5v1.3" />
    <path d="M7.2 12h1.3" />
    <path d="M15.5 12h1.3" />
  </svg>
);

/** Live engineering voice call icon with acoustic waves */
export const LiveVoiceIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <path d="M6.5 12.5v-1a5.5 5.5 0 0 1 11 0v1" />
    <rect x="4" y="12" width="3" height="5.2" rx="1.4" />
    <rect x="17" y="12" width="3" height="5.2" rx="1.4" />
    <path d="M18.5 17.2v.6A2.2 2.2 0 0 1 16.3 20H13" />
    <path d="M10.5 11.5v3" />
    <path d="M13.5 10.5v5" />
  </svg>
);

/** Multi-layer blueprint & deep technical specification analysis icon */
export const DeepEngineeringIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <path d="M12 3.5L3.5 8 12 12.5 20.5 8 12 3.5z" />
    <path d="M3.5 12.2L12 16.7l8.5-4.5" />
    <path d="M3.5 16.4L12 20.9l8.5-4.5" />
  </svg>
);

/** Precision catalog SKU finder lens */
export const CatalogFinderIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.4 15.4L20 20" />
    <path d="M8.5 10.5h4" />
    <path d="M10.5 8.5v4" />
  </svg>
);

/** Engineering spec sheet / technical matching icon */
export const SpecSheetIcon: React.FC<IconProps> = ({ className, size = 20 }) => (
  <svg {...baseSvgProps(size, className)}>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M8.5 8h7" />
    <path d="M8.5 12h7" />
    <path d="M8.5 16h4.2" />
  </svg>
);
