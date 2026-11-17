'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Chip, Button, Spinner, Image, Tabs, Tab, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@heroui/react';
import AdminInput from '@/components/AdminInput';
import Link from 'next/link';
import AdminShell from '@/components/AdminShell';
import SearchInput from '@/components/SearchInput';
import { api, imageUrl, unwrap } from '@/lib/api';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';

type Product = {
  _id: string;
  name: string;
  brand?: string | { _id: string; name: string } | null;
  category?: string | { _id: string; name: string };
  price: number;
  stock: number;
  status: 'draft' | 'active' | 'rejected' | 'out_of_stock';
  isFeatured: boolean;
  images: string[];
  seller?: { _id: string; name: string; storeName?: string; email: string };
  cities?: string[];
  states?: string[];
  country?: string;
  createdAt: string;
};

function categoryName(c: Product['category']): string {
  if (!c) return '—';
  return typeof c === 'string' ? c : c.name;
}

function brandName(b: Product['brand']): string {
  if (!b) return '';
  return typeof b === 'string' ? b : b.name;
}

const statusColor: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  active: 'success',
  draft: 'default',
  rejected: 'danger',
  out_of_stock: 'warning',
};

/* Admin Products page.
 *
 * Two scopes:
 *   - "mine" (default) — only products the super admin themselves created.
 *   - "all"            — every product across every seller. Used for
 *                        platform-wide moderation + the location-tagging
 *                        workflow that powers /<cat>/<page> dynamic pages.
 */
export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  // Which scope the list was last loaded for — "loading" is derived from
  // the mismatch rather than set inside the effect.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== scope;

  // Locations modal — opened from each row's "Edit locations" button.
  const locationModal = useDisclosure();
  const [editing, setEditing] = useState<Product | null>(null);
  const [editCities, setEditCities] = useState('');
  const [editStates, setEditStates] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback((params: { q: string; scope: 'mine' | 'all' }) => api.get('/admin/products', { params: { ...params, limit: 100 } })
    .then((r) => setItems(unwrap<{ items: Product[] }>(r).items))
    .catch((e: any) => notifyError(e, M.products.couldntLoadProducts))
    .finally(() => setLoadedFor(params.scope)), []);

  // The search text is read through a ref so switching scope doesn't
  // need `q` as a dependency (typing in the search box shouldn't refetch).
  const qRef = useRef(q);
  useEffect(() => { qRef.current = q; });
  useEffect(() => { void load({ q: qRef.current, scope }); }, [scope, load]);

  async function setStatus(id: string, status: Product['status']) {
    try {
      await api.patch(`/admin/products/${id}/status`, { status });
      notifySuccess(M.products.product(status));
      void load({ q, scope });
    } catch (e: any) {
      notifyError(e, M.products.thatDidntWork);
    }
  }

  async function toggleFeatured(p: Product) {
    try {
      await api.patch(`/admin/products/${p._id}/status`, { isFeatured: !p.isFeatured });
      notifySuccess(M.products.featuredToggled(p.isFeatured));
      void load({ q, scope });
    } catch (e: any) {
      notifyError(e, M.products.thatDidntWork);
    }
  }

  function openLocationsEditor(p: Product) {
    setEditing(p);
    // Tags are stored as slug arrays — show them comma-joined so the admin
    // sees a readable list. They'll be re-slugified on save.
    setEditCities((p.cities || []).join(', '));
    setEditStates((p.states || []).join(', '));
    setEditCountry(p.country || '');
    locationModal.onOpen();
  }

  async function saveLocations() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.patch(`/admin/products/${editing._id}/locations`, {
        cities: editCities,
        states: editStates,
        country: editCountry,
      });
      notifySuccess(M.products.locationsUpdated);
      locationModal.onClose();
      setEditing(null);
      void load({ q, scope });
    } catch (e: any) {
      notifyError(e, M.products.couldntUpdateLocations);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell>
      {/* Toolbar only — the shell's header names this screen; the old
          eyebrow ("CATALOG"), 30 px title and developer intro ("per-product
          location tags that drive city/state pages") are gone (UX audit W4/W5/W6). */}
      <div className="flex items-center justify-end gap-4 mb-4">
        <div className="flex items-center gap-2">
          <SearchInput
            size="sm"
            placeholder="Search name or brand…"
            value={q}
            onChange={setQ}
            className="w-72"
          />
          <Button size="sm" color="primary" className="font-semibold" onPress={() => void load({ q, scope })}>Search</Button>
          <Link href="/products/new">
            <Button size="sm" color="primary" className="font-semibold">Add product</Button>
          </Link>
        </div>
      </div>

      {/* Scope tabs — toggles between admin's own products and every product on the platform. */}
      <Tabs
        aria-label="Product scope"
        selectedKey={scope}
        onSelectionChange={(k) => setScope(k as 'mine' | 'all')}
        size="sm"
        variant="underlined"
        className="mb-2"
      >
        <Tab key="mine" title="My products" />
        <Tab key="all" title="All sellers" />
      </Tabs>

      {loading ? (
        <Spinner size="sm" />
      ) : (
        <Table aria-label="Products">
          <TableHeader>
            <TableColumn>Image</TableColumn>
            <TableColumn>Product</TableColumn>
            <TableColumn>Category</TableColumn>
            <TableColumn>Price</TableColumn>
            <TableColumn>Stock</TableColumn>
            <TableColumn>Status</TableColumn>
            <TableColumn>Locations</TableColumn>
            <TableColumn>Actions</TableColumn>
          </TableHeader>
          <TableBody emptyContent={
            scope === 'mine' ? (
              <span>
                You haven&apos;t added any products yet.{' '}
                <Link href="/products/new" className="text-brand-700 font-bold hover:underline">
                  Add your first
                </Link>.
              </span>
            ) : (
              <span>No products found.</span>
            )
          }>
            {items.map((p) => (
              <TableRow key={p._id}>
                <TableCell>
                  {p.images?.[0] ? (
                    <Image src={imageUrl(p.images[0])} alt={p.name} width={48} height={48}
                      className="object-cover rounded" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-default-200" />
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted">
                    {brandName(p.brand)}
                    {scope === 'all' && p.seller?.storeName && (
                      <span className="ml-1">· {p.seller.storeName}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{categoryName(p.category)}</TableCell>
                <TableCell>₹{p.price}</TableCell>
                <TableCell>{p.stock}</TableCell>
                <TableCell>
                  <Chip color={statusColor[p.status]} size="sm" variant="flat">{p.status}</Chip>
                  {p.isFeatured && (
                    <Chip color="primary" size="sm" variant="flat" className="ml-1">★ featured</Chip>
                  )}
                </TableCell>
                <TableCell>
                  {/* Show all location tags as small chips — gives the admin a
                      quick visual of what's set without opening the modal. */}
                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                    {(p.cities || []).map((c) => (
                      <Chip key={`c-${c}`} size="sm" variant="flat" color="default">
                        {c}
                      </Chip>
                    ))}
                    {(p.states || []).map((s) => (
                      <Chip key={`s-${s}`} size="sm" variant="flat" color="secondary">
                        {s}
                      </Chip>
                    ))}
                    {p.country && (
                      <Chip size="sm" variant="flat" color="success">{p.country}</Chip>
                    )}
                    {!(p.cities?.length || p.states?.length || p.country) && (
                      <span className="text-xs text-muted italic">No tags</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="flex gap-2 flex-wrap">
                  {p.status !== 'active' && (
                    <Button size="sm" color="success" variant="flat"
                      onPress={() => setStatus(p._id, 'active')}>Activate</Button>
                  )}
                  {p.status !== 'rejected' && (
                    <Button size="sm" color="danger" variant="flat"
                      onPress={() => setStatus(p._id, 'rejected')}>Reject</Button>
                  )}
                  <Button size="sm" color="primary" variant="flat"
                    onPress={() => toggleFeatured(p)}>
                    {p.isFeatured ? 'Unfeature' : 'Feature'}
                  </Button>
                  <Button size="sm" variant="bordered" onPress={() => openLocationsEditor(p)}>
                    Edit locations
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Locations editor modal — comma-separated input keeps it simple. The
          backend slugifies each entry so "New Delhi" and "new-delhi" become
          the same tag. */}
      <Modal isOpen={locationModal.isOpen} onOpenChange={locationModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <span>Edit locations</span>
                <span className="text-xs font-normal text-muted">
                  {editing?.name}
                </span>
              </ModalHeader>
              <ModalBody className="gap-4">
                <AdminInput
                  label="Cities"
                  variant="bordered"
                  value={editCities}
                  onChange={(e) => setEditCities(e.target.value)}
                  placeholder="noida, mumbai, bengaluru"
                  description="Comma-separated. Saved as slugs (lower-case, hyphenated)."
                />
                <AdminInput
                  label="States"
                  variant="bordered"
                  value={editStates}
                  onChange={(e) => setEditStates(e.target.value)}
                  placeholder="uttar-pradesh, maharashtra"
                  description="Comma-separated."
                />
                <AdminInput
                  label="Country"
                  variant="bordered"
                  value={editCountry}
                  onChange={(e) => setEditCountry(e.target.value)}
                  placeholder="india"
                  description="Single value. Optional."
                />
                <div className="text-xs text-muted bg-default-50 rounded-lg p-3 border border-default-200">
                  <span className="font-semibold">How this works:</span> these tags
                  decide which products appear on location-specific pages like{' '}
                  <code className="bg-default-100 px-1 py-0.5 rounded">/helmets-and-accessories/ls2-helmet-in-noida</code>.
                  A product needs to have <code className="bg-default-100 px-1 py-0.5 rounded">noida</code>
                  {' '}in Cities to show up on that page.
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>Cancel</Button>
                <Button color="primary" isLoading={saving} onPress={saveLocations}>
                  Save locations
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </AdminShell>
  );
}
