"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Briefcase,
  FileWarning,
  Globe2,
  Package,
  Plus,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Column } from "@/components/ui/table";
import { ActionableCard, Card, CompactCard, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartWrapper } from "@/components/ui/chart-wrapper";
import { ConfirmDialog } from "@/components/ui/modal";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardTitle, HelperText, SectionTitle } from "@/components/ui/typography";
import { toast } from "@/lib/toast";

interface FoundationRow {
  id: string;
  name: string;
  country: string;
  direction: "EXPORT" | "IMPORT";
  status: "active" | "pending" | "blocked";
}

const EXAMPLE_ROWS: FoundationRow[] = [
  { id: "1", name: "Organic Turmeric Powder", country: "United Arab Emirates", direction: "EXPORT", status: "active" },
  { id: "2", name: "Cotton Yarn", country: "Bangladesh", direction: "EXPORT", status: "pending" },
  { id: "3", name: "Industrial Machinery Parts", country: "Germany", direction: "IMPORT", status: "active" },
  { id: "4", name: "Handmade Textiles", country: "United States", direction: "EXPORT", status: "blocked" },
];

const statusVariant = {
  active: "success",
  pending: "warning",
  blocked: "danger",
} as const;

const exampleFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  direction: z.enum(["EXPORT", "IMPORT"], { message: "Select a trade direction" }),
});
type ExampleFormValues = z.infer<typeof exampleFormSchema>;

/**
 * This page exists to prove the Sprint 1 design system and app shell
 * work together end to end — NOT as a real analytics dashboard. Every
 * number/row below is clearly example/foundation data, not live trade
 * statistics (there is no business module yet to source real ones from).
 */
export function DashboardFoundationDemo() {
  const [search, setSearch] = React.useState("");
  const [directionFilter, setDirectionFilter] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmLoading, setConfirmLoading] = React.useState(false);
  const [loadingDemo, setLoadingDemo] = React.useState(false);
  const [errorDemo, setErrorDemo] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExampleFormValues>({ resolver: zodResolver(exampleFormSchema) });

  const filteredRows = EXAMPLE_ROWS.filter((row) => {
    const matchesSearch = row.name.toLowerCase().includes(search.toLowerCase());
    const matchesDirection = !directionFilter || row.direction === directionFilter;
    return matchesSearch && matchesDirection;
  });

  const columns: Column<FoundationRow>[] = [
    { key: "name", header: "Product", render: (row) => row.name },
    { key: "country", header: "Country", render: (row) => row.country, hideOnMobile: true },
    {
      key: "direction",
      header: "Direction",
      render: (row) => <Badge variant={row.direction === "EXPORT" ? "info" : "neutral"}>{row.direction}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge variant={statusVariant[row.status]}>{row.status}</Badge>,
      align: "right",
    },
  ];

  const onSubmitExampleForm = (values: ExampleFormValues) => {
    toast.success("Example form submitted", `${values.name} — ${values.direction}`);
    reset();
  };

  const handleConfirmDestroy = () => {
    setConfirmLoading(true);
    setTimeout(() => {
      setConfirmLoading(false);
      setConfirmOpen(false);
      toast.success("Example action confirmed");
    }, 800);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <SectionTitle>Foundation overview</SectionTitle>
            <Badge variant="neutral">Example data</Badge>
          </div>
          <HelperText className="mt-1">
            This page demonstrates the Sprint 1 design system and app shell — the numbers and rows below are
            illustrative, not live trade data.
          </HelperText>
        </div>
        <Button onClick={() => toast.info("Real \"new opportunity\" flow arrives with that module.")}>
          <Plus className="size-4" aria-hidden="true" />
          New opportunity
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active opportunities (example)" value="12" icon={Globe2} trend={{ direction: "up", label: "+3 this week" }} />
        <StatCard label="Products tracked (example)" value="48" icon={Package} />
        <StatCard label="Open inquiries (example)" value="6" icon={Briefcase} trend={{ direction: "down", label: "-2 this week" }} />
        <StatCard label="Compliance flags (example)" value="1" icon={FileWarning} />
      </div>

      <ChartWrapper
        title="Trade direction split (example)"
        subtitle="Placeholder for the future analytics module"
        isEmpty
        emptyMessage="Analytics data arrives with the Analytics module."
        action={
          <Button variant="ghost" size="sm" onClick={() => toast.info("Export module will power this chart.")}>
            <TrendingUp className="size-4" aria-hidden="true" />
            View details
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Example products list</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setErrorDemo((v) => !v)}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {errorDemo ? "Show data" : "Simulate error"}
          </Button>
        </div>

        <FilterBar
          className="mt-4"
          search={{ value: search, onChange: setSearch, placeholder: "Search example products..." }}
          activeFilterCount={directionFilter ? 1 : 0}
          onClearFilters={() => setDirectionFilter("")}
        >
          <Select
            placeholder="All directions"
            value={directionFilter}
            onChange={(event) => setDirectionFilter(event.target.value)}
            options={[
              { label: "Export", value: "EXPORT" },
              { label: "Import", value: "IMPORT" },
            ]}
            containerClassName="w-40"
          />
        </FilterBar>

        <div className="mt-4">
          <DataTable
            columns={columns}
            rows={filteredRows}
            rowKey={(row) => row.id}
            isLoading={loadingDemo}
            error={errorDemo ? "Could not load example products (simulated error)." : undefined}
            onRetry={() => setErrorDemo(false)}
            emptyState={{ title: "No example products match your filters" }}
          />
        </div>

        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => setLoadingDemo((v) => !v)}>
            Toggle loading state
          </Button>
        </div>
      </Card>

      <Tabs defaultValue="form">
        <TabsList>
          <TabsTrigger value="form">Form example</TabsTrigger>
          <TabsTrigger value="confirm">Dialog example</TabsTrigger>
        </TabsList>
        <TabsContent value="form">
          <CompactCard>
            <form onSubmit={handleSubmit(onSubmitExampleForm)} className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <Input
                label="Product name"
                placeholder="e.g. Basmati Rice"
                required
                error={errors.name?.message}
                containerClassName="flex-1"
                {...register("name")}
              />
              <Select
                label="Trade direction"
                placeholder="Select direction"
                required
                error={errors.direction?.message}
                options={[
                  { label: "Export", value: "EXPORT" },
                  { label: "Import", value: "IMPORT" },
                ]}
                containerClassName="w-full sm:w-48"
                {...register("direction")}
              />
              <Button type="submit" loading={isSubmitting}>
                Submit
              </Button>
            </form>
          </CompactCard>
        </TabsContent>
        <TabsContent value="confirm">
          <CompactCard className="flex items-center justify-between">
            <HelperText>Opens the shared ConfirmDialog component.</HelperText>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              Example destructive action
            </Button>
          </CompactCard>
        </TabsContent>
      </Tabs>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ActionableCard
          icon={Globe2}
          title="Explore opportunities"
          description="Preview of the future Opportunities module."
          onClick={() => toast.info("Opportunities module arrives in a later sprint.")}
        />
        <ActionableCard
          icon={Package}
          title="Manage products"
          description="Preview of the future Products module."
          onClick={() => toast.info("Products module arrives in a later sprint.")}
        />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm example action"
        description="This is a foundation example of the shared ConfirmDialog — nothing is actually deleted."
        confirmLabel="Confirm"
        destructive
        loading={confirmLoading}
        onConfirm={handleConfirmDestroy}
      />
    </div>
  );
}
