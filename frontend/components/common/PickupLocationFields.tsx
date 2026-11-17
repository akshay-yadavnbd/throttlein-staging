'use client';

import { useEffect, useRef, useState } from 'react';
import { Input, Spinner } from '@heroui/react';
import SellerSelect from '@/components/common/SellerSelect';
import { getIndianCities, INDIAN_STATES, normalizeIndianState } from '@/lib/indiaLocations';
import { lookupIndianPincode } from '@/lib/pincodeLookup';

type Location = { state: string; city: string; pincode: string };

type Props = Location & {
  onChange: (location: Partial<Location>) => void;
  stateError?: string;
  cityError?: string;
  pincodeError?: string;
  /** Optional styling so the fields match the host form. */
  inputClassNames?: { inputWrapper?: string; input?: string; label?: string };
  labelClassName?: string;
};

export default function PickupLocationFields({ state, city, pincode, onChange, stateError, cityError, pincodeError, inputClassNames, labelClassName = 'text-sm font-medium' }: Props) {
  const [pinLookup, setPinLookup] = useState<'idle' | 'loading' | 'ok' | 'not-found' | 'error'>('idle');
  const lookup = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const autoFilled = useRef<{ pincode: string; city: string; state: string } | null>(null);
  const selectedState = normalizeIndianState(state);
  // Keep legacy saved values visible even if their spelling is absent from the list.
  const states = selectedState && !INDIAN_STATES.includes(selectedState)
    ? [selectedState, ...INDIAN_STATES]
    : INDIAN_STATES;
  const cities = getIndianCities(selectedState);
  // Keep a saved or auto-filled city visible even when it isn't in the list.
  const cityOptions = city && !cities.includes(city) ? [city, ...cities] : cities;

  useEffect(() => () => {
    if (lookup.current) {
      clearTimeout(lookup.current.timer);
      lookup.current.controller.abort();
    }
  }, []);

  function cancelLookup() {
    if (lookup.current) {
      clearTimeout(lookup.current.timer);
      lookup.current.controller.abort();
      lookup.current = null;
    }
  }

  function changeLocation(change: Partial<Location>) {
    // A manual correction takes precedence over an in-flight lookup.
    if (lookup.current) {
      cancelLookup();
      setPinLookup('idle');
    }
    onChange(change);
  }

  function changePincode(value: string) {
    const pin = value.replace(/\D/g, '').slice(0, 6);
    if (pin === pincode) return;
    cancelLookup();
    setPinLookup('idle');

    const change: Partial<Location> = { pincode: pin };
    const previous = autoFilled.current;
    if (previous && pin !== previous.pincode) {
      if (city === previous.city) change.city = '';
      if (selectedState === previous.state) change.state = '';
      autoFilled.current = null;
    }
    onChange(change);
    if (!/^[1-9][0-9]{5}$/.test(pin)) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPinLookup('loading');
      try {
        const location = await lookupIndianPincode(pin, controller.signal);
        if (controller.signal.aborted || lookup.current?.controller !== controller) return;
        lookup.current = null;
        if (!location) {
          setPinLookup('not-found');
          return;
        }
        autoFilled.current = { pincode: pin, ...location };
        onChange(location);
        setPinLookup('ok');
      } catch {
        if (controller.signal.aborted || lookup.current?.controller !== controller) return;
        lookup.current = null;
        setPinLookup('error');
      }
    }, 350);
    lookup.current = { controller, timer };
  }

  const pinDescription = {
    idle: 'Enter 6 digits to fill city and state.',
    loading: 'Looking up city and state…',
    ok: 'City and state auto-filled — edit if needed.',
    'not-found': 'Pincode not found. Select city and state manually.',
    error: 'Couldn’t look up pincode. Select city and state manually.',
  }[pinLookup];

  return (
    <>
      <Input
        label="Pincode"
        labelPlacement="outside"
        placeholder="6 digits"
        variant="bordered"
        classNames={inputClassNames}
        isRequired
        inputMode="numeric"
        maxLength={6}
        value={pincode}
        onChange={(event) => changePincode(event.target.value)}
        isInvalid={!!pincodeError}
        errorMessage={pincodeError}
        description={<span role="status">{pinDescription}</span>}
        endContent={pinLookup === 'loading' ? <Spinner size="sm" aria-label="Looking up pincode" /> : null}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="pickup-state" className={labelClassName}>State <span className="text-danger">*</span></label>
        <SellerSelect fullWidth id="pickup-state" ariaLabel="State" value={selectedState}
          onChange={(nextState) => { if (nextState !== selectedState) changeLocation({ state: nextState, city: '' }); }}
          options={[{ value: '', label: 'Select a state', disabled: true }, ...states.map(name => ({ value: name, label: name }))]} />
        {stateError && <p className="text-xs text-danger">{stateError}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="pickup-city" className={labelClassName}>City <span className="text-danger">*</span></label>
        <SellerSelect fullWidth id="pickup-city" ariaLabel="City" value={city} disabled={!selectedState}
          onChange={(nextCity) => { if (nextCity !== city) changeLocation({ city: nextCity }); }}
          options={[{ value: '', label: selectedState ? 'Select a city' : 'Select a state first', disabled: true }, ...cityOptions.map(name => ({ value: name, label: name }))]} />
        {cityError && <p className="text-xs text-danger">{cityError}</p>}
      </div>
    </>
  );
}
