'use client';

/**
 * Small stat tile used inside the dark hero panels at the top of admin pages.
 *
 * Renders as a translucent card-on-card with a colored accent dot, an
 * uppercased label, and a large tabular-nums number. Designed to sit on a
 * `bg-brand-black` hero strip and read well against the diagonal-line
 * background pattern shared across catalog management pages.
 *
 * Usage:
 *   <HeroStat label="Top-level" value={topLevelCount} accent="blue" />
 *   <HeroStat label="Total"     value={totalCount}    accent="amber" />
 */

export type HeroStatAccent = 'blue' | 'amber' | 'emerald' | 'indigo' | 'rose';

export default function HeroStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: HeroStatAccent;
}) {
  const dot: Record<HeroStatAccent, string> = {
    blue: 'bg-blue-400',
    amber: 'bg-amber-400',
    emerald: 'bg-emerald-400',
    indigo: 'bg-indigo-400',
    rose: 'bg-rose-400',
  };

  return (
    <div className="flex flex-col justify-between min-w-[110px] px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot[accent]}`} />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-white/60">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums mt-1">{value}</div>
    </div>
  );
}
