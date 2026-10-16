// Values must be readable as soon as data arrives, including offscreen and with reduced motion.
export function Ticker({ value, decimals = 0, prefix = '' }: { value: number; decimals?: number; prefix?: string }) {
  return <span className="tabular">{prefix}{Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value)}</span>;
}
