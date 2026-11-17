'use client';

/**
 * MultiPick — an Autocomplete that appends each selection to a list of
 * removable chips. Used for the multi-category / multi-brand filters on
 * products-list dynamic pages (/pages/new and /pages/dynamic/[id]).
 *
 * The Autocomplete remounts after each pick (key trick) so the input
 * clears, ready for the next search. Already-selected items are
 * excluded from the dropdown.
 */
import { Autocomplete, AutocompleteItem } from '@heroui/react';
import { IconClose } from '@/components/EditorShell';
import form from '@/components/AdminForm.module.css';
import menu from '@/components/AdminSelect.module.css';

export default function MultiPick<T extends { _id: string; name: string }>({
  label,
  placeholder,
  description,
  items,
  selected,
  onChange,
  labelItems,
}: {
  label: string;
  placeholder?: string;
  description?: string;
  /** Full option list — selected ones are hidden from the dropdown. */
  items: T[];
  /** Selected ids, in pick order. */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Optional wider list used ONLY to resolve chip labels — lets a
   *  selection made before an item went inactive still show its name
   *  (and stay removable) even though it's gone from the dropdown. */
  labelItems?: T[];
}) {
  const remaining = items.filter((i) => !selected.includes(i._id));
  const labelFor = (id: string) =>
    items.find((x) => x._id === id)?.name ||
    (labelItems || []).find((x) => x._id === id)?.name ||
    id;
  return (
    <div className="flex flex-col gap-2">
      <Autocomplete
        key={selected.join('|')}
        label={label}
        aria-label={label}
        labelPlacement="outside"
        variant="bordered"
        selectedKey={null}
        onSelectionChange={(key) => {
          if (key) onChange([...selected, String(key)]);
        }}
        placeholder={placeholder}
        description={description}
        allowsCustomValue={false}
        defaultItems={remaining}
        classNames={{ base: 'max-w-none', selectorButton: 'text-[#7a8690]' }}
        /* Same menu look as AdminSelect: white panel, 1px border, compact
           rows, grey hover — not HeroUI's default beige highlight. */
        popoverProps={{ offset: 6, classNames: { content: menu.popover } }}
        listboxProps={{ classNames: { base: menu.listbox }, emptyContent: 'Nothing matches' }}
        scrollShadowProps={{ className: menu.listboxWrapper }}
        inputProps={{
          classNames: {
            label: 'text-[12px] font-medium text-[#39434c]',
            inputWrapper: 'h-10 min-h-10 border border-[#e2e7eb] data-[hover=true]:border-[#c9d1d8] group-data-[focus=true]:!border-[#59656f] shadow-none rounded-lg bg-white',
            input: 'text-[13px] text-[#252c32] placeholder:text-[#929ba3]',
            description: 'text-[11px] text-[#74808a]',
          },
        }}
      >
        {(i) => <AutocompleteItem key={i._id} classNames={{ base: menu.option, title: menu.optionText, selectedIcon: menu.check }}>{i.name}</AutocompleteItem>}
      </Autocomplete>
      {selected.length > 0 && (
        <div className={form.chips}>
          {selected.map((id) => (
            <span key={id} className={form.chip}>
              {labelFor(id)}
              <button type="button" className={form.chipRemove} onClick={() => onChange(selected.filter((s) => s !== id))} aria-label={`Remove ${labelFor(id)}`}><IconClose /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
