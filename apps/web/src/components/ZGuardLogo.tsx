import React from 'react';

interface ZGuardLogoProps {
  className?: string;
  size?: number;
  animated?: boolean;
  draw?: boolean;
  strokeColor?: string;
}

export const ZGuardLogo: React.FC<ZGuardLogoProps> = ({
  className = '',
  size = 44,
  animated = false,
  draw = false,
  strokeColor = '#FFFFFF',
}) => {
  const cx = 100;
  const cy = 100;
  const deg = (d: number) => (d * Math.PI) / 180;

  const polar = (r: number, angleDeg: number) => ({
    x: +(cx + r * Math.cos(deg(angleDeg))).toFixed(3),
    y: +(cy + r * Math.sin(deg(angleDeg))).toFixed(3),
  });

  const arcPath = (r: number, startDeg: number, endDeg: number) => {
    const s = polar(r, startDeg);
    const e = polar(r, endDeg);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
  };

  // Radii matching the concentric sonic-shield logo
  const R1 = 48;
  const R2 = 59.5;
  const R3 = 71;
  const R4 = 82.5;

  // Exact Euclidean intersections for the 3-track diagonal Z at -50 deg
  // d = 8.4 -> asin(8.4 / 48) = 10.0787 deg
  const theta = -50;
  const deltaDeg = (Math.asin(8.4 / R1) * 180) / Math.PI; // ~10.08 deg

  // R1_top sweeps from -134 deg clockwise to (theta + deltaDeg) = -39.92 deg,
  // then corners down-left to R1_bottom at (theta + 180 - deltaDeg) = +119.92 deg
  const topStart = polar(R1, -134);
  const topRightCorner = polar(R1, theta + deltaDeg);
  const rightDiagEndOnBottom = polar(R1, theta + 180 - deltaDeg);

  // R1_bottom sweeps from +46 deg clockwise to (theta + 180 + deltaDeg) = +140.08 deg,
  // then corners up-right to R1_top at (theta - deltaDeg) = -60.08 deg
  const botStart = polar(R1, 46);
  const botLeftCorner = polar(R1, theta + 180 + deltaDeg);
  const leftDiagEndOnTop = polar(R1, theta - deltaDeg);

  // Center diagonal stroke from R1_top(theta) to R1_bottom(theta + 180)
  const centerTop = polar(R1, theta);
  const centerBot = polar(R1, theta + 180);

  const upperZPath = `M ${topStart.x} ${topStart.y} A ${R1} ${R1} 0 0 1 ${topRightCorner.x} ${topRightCorner.y} L ${rightDiagEndOnBottom.x} ${rightDiagEndOnBottom.y}`;
  const lowerZPath = `M ${botStart.x} ${botStart.y} A ${R1} ${R1} 0 0 1 ${botLeftCorner.x} ${botLeftCorner.y} L ${leftDiagEndOnTop.x} ${leftDiagEndOnTop.y}`;
  const centerZPath = `M ${centerTop.x} ${centerTop.y} L ${centerBot.x} ${centerBot.y}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} ${draw ? 'logo-draw' : ''}`}
      aria-label="ZGuard Logo"
    >
      {/* Outer Top Radar Arcs */}
      <path
        d={arcPath(R4, -136, -44)}
        stroke={strokeColor}
        strokeWidth="3.1"
        strokeLinecap="butt"
        className={animated ? ' transition-opacity duration-500 animate-pulse' : ''}
        style={animated ? { animationDelay: '360ms' } : undefined}
      />
      <path
        d={arcPath(R3, -135, -45)}
        stroke={strokeColor}
        strokeWidth="3.1"
        strokeLinecap="butt"
        className={animated ? 'transition-opacity duration-500 animate-pulse' : ''}
        style={animated ? { animationDelay: '220ms' } : undefined}
      />
      <path
        d={arcPath(R2, -134.5, -45.5)}
        stroke={strokeColor}
        strokeWidth="3.1"
        strokeLinecap="butt"
        className={animated ? 'transition-opacity duration-500 animate-pulse' : ''}
        style={animated ? { animationDelay: '100ms' } : undefined}
      />

      {/* Core Z Geometry (C2 Rotational Symmetry) */}
      <path
        d={upperZPath}
        stroke={strokeColor}
        strokeWidth="3.2"
        strokeLinejoin="miter"
        strokeMiterlimit="8"
      />
      <path
        d={lowerZPath}
        stroke={strokeColor}
        strokeWidth="3.2"
        strokeLinejoin="miter"
        strokeMiterlimit="8"
      />
      <path
        d={centerZPath}
        stroke={strokeColor}
        strokeWidth="3.1"
      />

      {/* Outer Bottom Radar Arcs */}
      <path
        d={arcPath(R2, 45.5, 134.5)}
        stroke={strokeColor}
        strokeWidth="3.1"
        strokeLinecap="butt"
        className={animated ? 'transition-opacity duration-500 animate-pulse' : ''}
        style={animated ? { animationDelay: '100ms' } : undefined}
      />
      <path
        d={arcPath(R3, 45, 135)}
        stroke={strokeColor}
        strokeWidth="3.1"
        strokeLinecap="butt"
        className={animated ? 'transition-opacity duration-500 animate-pulse' : ''}
        style={animated ? { animationDelay: '220ms' } : undefined}
      />
      <path
        d={arcPath(R4, 44, 136)}
        stroke={strokeColor}
        strokeWidth="3.1"
        strokeLinecap="butt"
        className={animated ? 'transition-opacity duration-500 animate-pulse' : ''}
        style={animated ? { animationDelay: '360ms' } : undefined}
      />
    </svg>
  );
};
