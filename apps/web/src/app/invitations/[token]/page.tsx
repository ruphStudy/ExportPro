"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ship } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { invitationsApi } from "@/lib/api/members";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { SESSION_QUERY_KEY, useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle } from "@/components/ui/typography";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <Ship className="size-6 text-primary" aria-hidden="true" />
        <span className="text-lg font-semibold text-foreground">ExportPro</span>
      </div>
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-8">{children}</div>
    </div>
  );
}

export default function InvitationPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isLoading: sessionLoading } = useSession();

  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => invitationsApi.preview(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => invitationsApi.accept(token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      router.push("/dashboard");
    },
  });

  if (preview.isLoading || sessionLoading) {
    return (
      <Shell>
        <PageSkeleton />
      </Shell>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <Shell>
        <ErrorState title="Invitation not found" message={toFriendlyErrorMessage(preview.error)} />
      </Shell>
    );
  }

  const invitation = preview.data;
  const isLoggedInAsInvitee = session && session.user.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <Shell>
      <div className="flex flex-col gap-4 text-center">
        <PageTitle>You&apos;re invited</PageTitle>
        <HelperText>
          <strong className="text-foreground">{invitation.email}</strong> has been invited to join{" "}
          <strong className="text-foreground">{invitation.organizationName}</strong> as{" "}
          <strong className="text-foreground">{invitation.role.replace("_", " ").toLowerCase()}</strong>.
        </HelperText>

        {accept.isError && (
          <p role="alert" className="text-sm text-danger">
            {toFriendlyErrorMessage(accept.error)}
          </p>
        )}

        {!session ? (
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link href={`/login?returnTo=/invitations/${token}`}>Sign in to accept</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/signup?email=${encodeURIComponent(invitation.email)}`}>Create an account</Link>
            </Button>
          </div>
        ) : isLoggedInAsInvitee ? (
          <Button onClick={() => accept.mutate()} loading={accept.isPending}>
            Accept invitation
          </Button>
        ) : (
          <HelperText className="text-danger">
            You&apos;re signed in as {session.user.email}. Sign in with {invitation.email} to accept this invitation.
          </HelperText>
        )}
      </div>
    </Shell>
  );
}
