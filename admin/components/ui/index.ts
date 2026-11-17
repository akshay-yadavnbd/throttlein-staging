/**
 * Shared admin UI primitives — HeroUI v3 + the nude theme.
 *
 * Import from here, not from the individual files:
 *   import { PageHeader, DataTable, StatusChip } from '@/components/ui';
 *
 * ── RULES FOR THIS FOLDER ───────────────────────────────────────────
 * 1. These components import from `@heroui-v3/react`. NEVER mix v2
 *    (`@heroui/react`) and v3 in the same file — TypeScript will conflict.
 *    A page being migrated should switch wholesale.
 * 2. No colour literals. Use the theme tokens (`bg-surface`,
 *    `text-muted`, `border-border`, `bg-danger-soft`, …) so a palette
 *    change stays a change to themes/nude.css. The audit found ~90 raw
 *    hexes in admin TSX; none of them should reappear here.
 * 3. Prefer a HeroUI v3 component over a hand-rolled one. This folder
 *    exists to compose them into app-shaped pieces (a page header, a list
 *    table), not to re-implement primitives.
 * 4. Accessible names are props, not options: `DataTable.ariaLabel` and
 *    `IconButton.label` are required, because the audit found 8 of 14
 *    icon-only buttons and 67 of 69 raw buttons without one.
 *
 * Kept in step with frontend/components/ui/* for the seller dashboard.
 */

export { default as AppShell } from './AppShell';
export type { AppShellProps } from './AppShell';

export { default as PageHeader } from './PageHeader';
export type { PageHeaderProps, Crumb } from './PageHeader';

export { default as FormField } from './FormField';
export type { FormFieldProps, FormTextAreaProps } from './FormField';

export { default as FilterTabs } from './FilterTabs';
export type { FilterTabsProps, FilterTab } from './FilterTabs';

export { default as IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';

export { default as DataTable } from './DataTable';
export type { DataTableProps, DataTableColumn } from './DataTable';

export { default as TablePagination } from './TablePagination';
export type { TablePaginationProps } from './TablePagination';

export { default as StatusChip, statusTone } from './StatusChip';
export type { StatusChipProps } from './StatusChip';

export { default as RowActions } from './RowActions';
export type { RowActionsProps, RowAction } from './RowActions';

export { default as SectionTabs } from './SectionTabs';
export type { SectionTabsProps, SectionTab } from './SectionTabs';

export { default as StatCard } from './StatCard';
export type { StatCardProps } from './StatCard';

export {
  EmptyState,
  ErrorState,
  LoadingRow,
  TableSkeleton,
  CardGridSkeleton,
  DetailSkeleton,
  DashboardSkeleton,
} from './States';
export type { EmptyStateProps, ErrorStateProps, TableSkeletonProps } from './States';
