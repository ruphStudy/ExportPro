import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState, type EmptyStateProps } from "./empty-state";
import { ErrorState, type ErrorStateProps } from "./error-state";
import { TableSkeleton } from "./skeleton";

export interface Column<TRow> {
  key: string;
  header: string;
  render: (row: TRow) => React.ReactNode;
  /** Hidden below `md` breakpoint — keeps mobile tables from overflowing (see DataTable's card fallback for full mobile replacement). */
  hideOnMobile?: boolean;
  align?: "left" | "right" | "center";
}

export interface DataTableProps<TRow> {
  columns: Column<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  isLoading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyState?: Partial<EmptyStateProps>;
  errorState?: Partial<ErrorStateProps>;
  onRowClick?: (row: TRow) => void;
  className?: string;
}

/**
 * Foundation table for future list screens (buyers, suppliers, CRM
 * leads, shipments, payments, trade data, documents, ...). Responsive
 * strategy: horizontal scroll on narrow viewports rather than a
 * separate mobile card layout, so one column set always matches one
 * render path — see ARCHITECTURE.md "Responsive Strategy" for why.
 */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  emptyState,
  errorState,
  onRowClick,
  className,
}: DataTableProps<TRow>) {
  if (isLoading) return <TableSkeleton columns={columns.length} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} {...errorState} />;
  if (rows.length === 0) return <EmptyState title="Nothing here yet" {...emptyState} />;

  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border bg-surface", className)}>
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-muted-foreground",
                  column.hideOnMobile && "hidden sm:table-cell",
                  column.align === "right" && "text-right",
                  column.align === "center" && "text-center",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-border last:border-0",
                onRowClick && "cursor-pointer hover:bg-muted/40",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "whitespace-nowrap px-4 py-2.5 text-foreground",
                    column.hideOnMobile && "hidden sm:table-cell",
                    column.align === "right" && "text-right",
                    column.align === "center" && "text-center",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
