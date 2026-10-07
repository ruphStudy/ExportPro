"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, MailX } from "lucide-react";
import { useParams } from "next/navigation";
import { outreachApi } from "@/lib/api/outreach";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle } from "@/components/ui/typography";

/**
 * Public, unauthenticated unsubscribe page. The opaque token is the only
 * input; nothing about the sender organization or recipient is shown.
 */
export default function UnsubscribePage() {
  const { token } = useParams<{ token: string }>();
  const status = useQuery({ queryKey: ["unsubscribe", token], queryFn: () => outreachApi.unsubscribeStatus(token), retry: false });
  const m = useMutation({ mutationFn: () => outreachApi.unsubscribe(token) });
  const done = m.isSuccess || status.data?.unsubscribed;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 text-center shadow-sm sm:p-8">
        {status.isLoading ? (
          <Skeleton className="mx-auto h-24 w-full" />
        ) : status.isError ? (
          <>
            <MailX className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <PageTitle className="mt-3 text-xl">Link not valid</PageTitle>
            <HelperText className="mt-2">This unsubscribe link is invalid or has expired.</HelperText>
          </>
        ) : done ? (
          <>
            <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden="true" />
            <PageTitle className="mt-3 text-xl">You have been unsubscribed.</PageTitle>
            <HelperText className="mt-2">You will not receive further outreach emails from this sender.</HelperText>
          </>
        ) : (
          <>
            <MailX className="mx-auto size-8 text-primary" aria-hidden="true" />
            <PageTitle className="mt-3 text-xl">Unsubscribe</PageTitle>
            <HelperText className="mt-2">Stop receiving outreach emails from this sender.</HelperText>
            <Button className="mt-4" onClick={() => m.mutate()} loading={m.isPending}>Unsubscribe</Button>
            {m.isError && <p role="alert" className="mt-2 text-sm text-danger">Something went wrong. Please try again.</p>}
          </>
        )}
      </div>
    </main>
  );
}
