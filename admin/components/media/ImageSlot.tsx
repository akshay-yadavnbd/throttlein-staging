'use client';

/**
 * ImageSlot — the standard admin image field.
 *
 * The tile IS the trigger: clicking it opens the MediaPicker (library +
 * upload) first, so every image field in the admin behaves the same way.
 * No separate "Upload" button and no hidden <input type="file">.
 *
 * Same look as the slot in HeroBannersEditor / PromoBlockForm, made
 * reusable with a few extra knobs:
 *   - uploadEndpoint / uploadField — where the picker's Upload tab posts
 *     (each module has its own endpoint and multipart field name)
 *   - fit      — 'contain' for logos/icons so they aren't cropped
 *   - className — width constraint for small tiles (e.g. 'max-w-[160px]')
 */

import { useState, type ReactNode } from 'react';
import { imageUrl } from '@/lib/api';
import MediaPicker from '@/components/media/MediaPicker';

export default function ImageSlot({
  label,
  aspect = 'aspect-video',
  value,
  onChange,
  required,
  hint,
  description,
  uploadEndpoint,
  uploadField,
  acceptedTypes,
  fit = 'cover',
  className = '',
  proxyUrl = false,
  previewSrc,
}: {
  label: string;
  /** Tailwind aspect class for the tile, e.g. 'aspect-video', 'aspect-square'. */
  aspect?: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  /** Text inside the empty tile. */
  hint?: string;
  /** Helper text under the tile. */
  description?: ReactNode;
  /** POST endpoint the picker's Upload tab uses. */
  uploadEndpoint: string;
  /** Multipart field name that endpoint expects (default 'image'). */
  uploadField?: string;
  acceptedTypes?: string;
  fit?: 'cover' | 'contain';
  className?: string;
  /** Store picked library keys as `/api/files/<key>` — the shape the
   *  blog upload endpoint returns, so blog images stay consistent. */
  proxyUrl?: boolean;
  /** Override how the stored value maps to a preview URL. */
  previewSrc?: (value: string) => string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const fitClass = fit === 'contain' ? 'object-contain p-1.5' : 'object-cover';
  return (
    <div className={`flex flex-col gap-2 min-w-0 ${className}`}>
      {label && (
        <label className="text-sm text-default-700 font-medium">
          {label} {required && <span className="text-rose-600">*</span>}
        </label>
      )}
      {/* The tile IS the trigger — clicking it opens the MediaPicker
          (library + upload). No separate "Choose image" button. */}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-label={value ? `Replace ${label || 'image'}` : `Choose ${label || 'image'}`}
        className="w-full text-left group cursor-pointer outline-none focus:outline-none"
      >
        {value ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc ? previewSrc(value) : imageUrl(value)}
              alt={`${label || 'Image'} preview`}
              className={`w-full ${aspect} rounded-lg ${fitClass} bg-default-50 border border-default-200 transition group-hover:opacity-85`}
            />
            {/* Hover veil so it's obvious the image itself is clickable */}
            <span className="absolute inset-0 rounded-lg grid place-items-center bg-black/0 group-hover:bg-black/35 transition-colors">
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-semibold px-3 py-1.5 rounded-full bg-black/60">
                Click to replace
              </span>
            </span>
          </div>
        ) : (
          <div
            className={`w-full ${aspect} rounded-lg bg-default-50 border-2 border-dashed border-default-200 grid place-items-center text-default-400 text-xs px-3 text-center transition group-hover:border-default-400 group-hover:bg-default-100`}
          >
            <span className="flex flex-col items-center gap-2">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>{hint || 'No image'}</span>
              <span className="font-semibold text-default-500">Click to upload</span>
            </span>
          </div>
        )}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="self-start text-xs text-rose-600 hover:underline"
        >
          Remove
        </button>
      )}
      {description && <div className="text-xs text-default-500">{description}</div>}
      <MediaPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        uploadEndpoint={uploadEndpoint}
        uploadField={uploadField}
        acceptedTypes={acceptedTypes}
        onSelect={(key) =>
          onChange(proxyUrl && !/^(https?:|\/)/i.test(key) ? `/api/files/${key}` : key)
        }
      />
    </div>
  );
}
