import { useRef, type ReactNode, type MouseEvent } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

interface MagneticButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
  strength?: number;
}

export function MagneticButton({
  children,
  className = '',
  onClick,
  href,
  strength = 0.35,
}: MagneticButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.4 });

  const onMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };

  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  const inner = (
    <motion.div
      ref={ref}
      style={{ x: sx, y: sy }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onClick}
      className={className}
      data-cursor="hover"
    >
      {children}
    </motion.div>
  );

  if (href) {
    return (
      <a href={href} className="inline-block">
        {inner}
      </a>
    );
  }
  return inner;
}
