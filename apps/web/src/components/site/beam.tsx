'use client';
// An animated beam of light travelling along a curved path between two elements (after Magic UI's
// Animated Beam, MIT). Positions are measured from the container, so it follows layout changes.
import { motion } from 'motion/react';
import { useEffect, useId, useState, type RefObject } from 'react';

export function Beam({
  container,
  from,
  to,
  color = '#fafafa',
  curvature = 0,
  duration = 3.2,
  delay = 0,
  width = 2,
}: {
  container: RefObject<HTMLElement | null>;
  from: RefObject<HTMLElement | null>;
  to: RefObject<HTMLElement | null>;
  color?: string;
  curvature?: number;
  duration?: number;
  delay?: number;
  width?: number;
}) {
  const id = useId().replace(/:/g, '');
  const [path, setPath] = useState('');
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => {
      const c = container.current?.getBoundingClientRect();
      const a = from.current?.getBoundingClientRect();
      const b = to.current?.getBoundingClientRect();
      if (!c || !a || !b) return;
      const sx = a.right - c.left;
      const sy = a.top - c.top + a.height / 2;
      const ex = b.left - c.left;
      const ey = b.top - c.top + b.height / 2;
      setSize({ w: c.width, h: c.height });
      setPath(`M ${sx},${sy} C ${(sx + ex) / 2},${sy - curvature} ${(sx + ex) / 2},${ey - curvature} ${ex},${ey}`);
    };
    update();
    const ro = new ResizeObserver(update);
    if (container.current) ro.observe(container.current);
    return () => ro.disconnect();
  }, [container, from, to, curvature]);

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      fill="none"
      aria-hidden
    >
      <path d={path} stroke="currentColor" className="text-foreground/10" strokeWidth={width} strokeLinecap="round" />
      <path d={path} stroke={`url(#${id})`} strokeWidth={width} strokeLinecap="round" />
      <defs>
        <motion.linearGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          initial={{ x1: '0%', x2: '0%', y1: '0%', y2: '0%' }}
          animate={{ x1: ['0%', '110%'], x2: ['-10%', '100%'] }}
          transition={{ duration, delay, repeat: Infinity, repeatDelay: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <stop stopColor={color} stopOpacity="0" />
          <stop offset="40%" stopColor={color} />
          <stop offset="60%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </svg>
  );
}
