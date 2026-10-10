'use client';
// Number that counts up to its value when it scrolls into view (after Magic UI's Number Ticker, MIT).
import { useInView, useMotionValue, useSpring } from 'motion/react';
import { useEffect, useRef } from 'react';

export function Ticker({ value, decimals = 0, prefix = '' }: { value: number; decimals?: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { damping: 60, stiffness: 120 });
  const inView = useInView(ref, { once: true, margin: '0px' });
  useEffect(() => {
    if (inView) motionValue.set(value);
  }, [inView, value, motionValue]);
  useEffect(
    () =>
      spring.on('change', (v) => {
        if (ref.current)
          ref.current.textContent =
            prefix + Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
      }),
    [spring, decimals, prefix],
  );
  return (
    <span ref={ref} className="tabular">
      {prefix}0
    </span>
  );
}
