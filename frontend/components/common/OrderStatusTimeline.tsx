'use client';

/**
 * Continuous order-lifecycle timeline.
 *
 * Forward leg (always shown):
 *   Placed → Confirmed → Shipped → Delivered
 *
 * If `returnState` is provided (i.e. a return / exchange is in flight), the
 * timeline extends past Delivered with the appropriate reverse-leg steps:
 *
 *   ...Delivered → Approved → Picked up → In transit back → Received →
 *      (Return) Refunded  |  (Exchange) Replacement shipped
 *
 * Each completed step renders a compact timestamp under its label so the
 * seller / customer can see when each transition happened. Pass a `dates`
 * object keyed by step name. Missing keys → no timestamp shown for that step.
 */

type ReturnState = {
  kind: 'return' | 'exchange';
  /** 0-based index into the 5 reverse-leg steps (0..4). */
  stepIdx: number;
};

export type TimelineDates = {
  placed?: Date | string | null;
  confirmed?: Date | string | null;
  shipped?: Date | string | null;
  delivered?: Date | string | null;
  // reverse leg — return path
  approved?: Date | string | null;
  pickedUp?: Date | string | null;
  inTransit?: Date | string | null;
  received?: Date | string | null;
  refunded?: Date | string | null;
  // reverse leg — exchange path (simplified to 3 customer-facing milestones)
  exchangeOnTheWay?: Date | string | null;
  exchangeCompleted?: Date | string | null;
};

const FORWARD = [
  { key: 'placed',    label: 'Placed',    dateKey: 'placed'    as const },
  { key: 'confirmed', label: 'Confirmed', dateKey: 'confirmed' as const },
  { key: 'shipped',   label: 'Shipped',   dateKey: 'shipped'   as const },
  { key: 'delivered', label: 'Delivered', dateKey: 'delivered' as const },
];

function fmt(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OrderStatusTimeline({
  status,
  returnState,
  dates,
}: {
  status: string;
  returnState?: ReturnState | null;
  dates?: TimelineDates;
}) {
  if (status === 'cancelled') {
    return (
      <div className="rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm font-semibold px-4 py-2">
        This order was cancelled.
        {dates?.placed && (
          <span className="font-normal opacity-80"> · cancelled {fmt(dates.placed)}</span>
        )}
      </div>
    );
  }

  const forwardIdx = FORWARD.findIndex((s) => s.key === status);

  // Exchange flow is collapsed to 3 customer-facing milestones (matches the
  // vertical tracker). The detailed sub-steps (old item picked up, in
  // transit back, received, verified) all roll up into "Exchange completed"
  // — the seller's "Next steps" panel already exposes the operational
  // checklist, so the horizontal bar doesn't need to repeat them.
  const reverseSteps: { label: string; dateKey: keyof TimelineDates }[] = returnState
    ? returnState.kind === 'exchange'
      ? [
          { label: 'Exchange accepted', dateKey: 'approved' },
          { label: 'Exchange on the way', dateKey: 'exchangeOnTheWay' },
          { label: 'Exchange completed', dateKey: 'exchangeCompleted' },
        ]
      : [
          { label: 'Return accepted',  dateKey: 'approved' },
          { label: 'Picked up',        dateKey: 'pickedUp' },
          { label: 'In transit back',  dateKey: 'inTransit' },
          { label: 'Received',         dateKey: 'received' },
          { label: 'Refunded',         dateKey: 'refunded' },
        ]
    : [];

  type Step = {
    label: string;
    date: string;
    phase: 'forward' | 'reverse';
    done: boolean;
    isCurrent: boolean;
  };

  const steps: Step[] = FORWARD.map((s, i) => ({
    label: s.label,
    date: fmt(dates?.[s.dateKey]),
    phase: 'forward',
    done: i <= forwardIdx,
    isCurrent: i === forwardIdx && (!returnState || forwardIdx < FORWARD.length - 1),
  }));

  reverseSteps.forEach((s, i) => {
    const reverseIdx = returnState ? returnState.stepIdx : -1;
    steps.push({
      label: s.label,
      date: fmt(dates?.[s.dateKey]),
      phase: 'reverse',
      done: reverseIdx >= i,
      isCurrent: reverseIdx === i,
    });
  });

  return (
    <div className="flex items-start gap-1.5 w-full overflow-x-auto pb-2">
      {steps.map((step, i) => {
        const nextDone = i + 1 < steps.length ? steps[i + 1].done : false;
        return (
          <div
            key={`${step.phase}-${i}-${step.label}`}
            className="flex items-start flex-1 last:flex-none min-w-[80px]"
          >
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className={`w-8 h-8 rounded-full grid place-items-center text-xs font-bold border-2 transition ${
                  step.done
                    ? step.phase === 'reverse'
                      ? 'bg-purple-600 border-purple-600 text-white'
                      : 'bg-brand-black border-brand-black text-white'
                    : 'bg-white border-default-300 text-default-400'
                } ${
                  step.isCurrent
                    ? step.phase === 'reverse'
                      ? 'ring-4 ring-purple-600/10'
                      : 'ring-4 ring-brand-black/10'
                    : ''
                }`}
              >
                {step.done && !step.isCurrent ? '✓' : i + 1}
              </div>
              <div
                className={`text-[10px] font-semibold uppercase tracking-wider text-center whitespace-nowrap ${
                  step.done
                    ? step.phase === 'reverse'
                      ? 'text-purple-700'
                      : 'text-brand-black'
                    : 'text-default-400'
                }`}
              >
                {step.label}
              </div>
              {/* Timestamp — only on completed steps with a known date. */}
              <div
                className={`text-[10px] font-normal text-center whitespace-nowrap leading-tight ${
                  step.done ? 'text-default-500' : 'text-default-300'
                }`}
              >
                {step.done && step.date ? step.date : ' ' /* nbsp keeps row height stable */}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 mt-[14px] ${
                  step.done && nextDone
                    ? step.phase === 'reverse' || steps[i + 1].phase === 'reverse'
                      ? 'bg-purple-600'
                      : 'bg-brand-black'
                    : 'bg-default-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
