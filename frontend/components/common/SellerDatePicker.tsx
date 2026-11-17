'use client';

import { DatePicker } from '@heroui/react';
import { parseDate, parseDateTime, today, now, toCalendarDateTime, getLocalTimeZone } from '@internationalized/date';
import styles from './SellerDatePicker.module.css';

type Props = {
  id?: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  includeTime?: boolean;
};

function date(value?: string, includeTime = false) {
  if (!value) return undefined;
  try { return includeTime ? parseDateTime(value) : parseDate(value); } catch { return undefined; }
}

/** Keep date and optional local time values without conversion through UTC. */
export default function SellerDatePicker({ id, ariaLabel, value, onChange, min, max, disabled, includeTime = false }: Props) {
  // This HeroUI version overrides onOpenChange internally. Let the picker
  // own its open state so the trigger and keyboard controls can toggle it.
  const current = includeTime ? toCalendarDateTime(now(getLocalTimeZone())).set({ second:0, millisecond:0 }) : today(getLocalTimeZone());
  const minimum = date(min, includeTime);
  const maximum = date(max, includeTime);
  const todayAllowed = (!minimum || current.compare(minimum) >= 0) && (!maximum || current.compare(maximum) <= 0);
  return <DatePicker
    id={id}
    aria-label={ariaLabel}
    value={date(value, includeTime) ?? null}
    onChange={next => onChange(next?.toString() ?? '')}
    minValue={minimum}
    maxValue={maximum}
    isDisabled={disabled}
    granularity={includeTime ? 'minute' : 'day'}
    variant="bordered"
    color="default"
    showMonthAndYearPickers
    disableAnimation
    classNames={{ base: styles.root, inputWrapper: styles.inputWrapper, segment: styles.segment, selectorButton: styles.selector, popoverContent: styles.popover }}
    popoverProps={{ placement:'bottom-start', offset:8, shouldBlockScroll:false }}
    timeInputProps={{ variant:'bordered', classNames:{ inputWrapper:styles.timeWrapper, segment:styles.segment } }}
    calendarProps={{
      classNames:{ base:styles.calendar, headerWrapper:styles.calendarHeader, cellButton:styles.day, prevButton:styles.navigation, nextButton:styles.navigation, pickerItem:styles.pickerItem, pickerHighlight:styles.pickerHighlight, pickerMonthList:styles.pickerList, pickerYearList:styles.pickerList },
      buttonPickerProps:{ className:styles.monthYearButton },
    }}
    CalendarBottomContent={<div className={styles.footer}>
      <button type="button" onClick={() => onChange('')}>Clear</button>
      <button type="button" disabled={!todayAllowed} onClick={() => onChange(current.toString())}>{includeTime ? 'Now' : 'Today'}</button>
    </div>}
  />;
}

