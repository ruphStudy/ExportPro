"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, LogOut, Smartphone } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authApi, sessionsApi } from "@/lib/api/auth";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PasswordInput } from "@/components/ui/password-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain at least one letter and one number."),
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match.",
    path: ["confirmNewPassword"],
  });
type PasswordValues = z.infer<typeof passwordSchema>;

function deviceIcon(userAgent: string | null) {
  if (userAgent && /mobile|android|iphone/i.test(userAgent)) return Smartphone;
  return Laptop;
}

export default function SecurityPage() {
  const queryClient = useQueryClient();
  const [revokeTarget, setRevokeTarget] = React.useState<string | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const changePassword = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      toast.success("Password changed", "You've been signed out of other devices.");
      reset();
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => toast.error("Could not change password", toFriendlyErrorMessage(error)),
  });

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: sessionsApi.list });

  const revokeSession = useMutation({
    mutationFn: sessionsApi.revoke,
    onSuccess: () => {
      toast.success("Session revoked");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setRevokeTarget(null);
    },
    onError: (error) => {
      toast.error("Could not revoke session", toFriendlyErrorMessage(error));
      setRevokeTarget(null);
    },
  });

  const revokeOthers = useMutation({
    mutationFn: authApi.logoutOthers,
    onSuccess: () => {
      toast.success("Signed out of other devices");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setRevokeOthersOpen(false);
    },
    onError: (error) => {
      toast.error("Could not sign out other devices", toFriendlyErrorMessage(error));
      setRevokeOthersOpen(false);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>Security</PageTitle>
        <HelperText className="mt-1">Password and active sessions for your account.</HelperText>
      </div>

      <Card className="p-4">
        <SectionTitle>Change password</SectionTitle>
        <CardContent className="px-0">
          <form
            onSubmit={handleSubmit((values) => changePassword.mutate(values))}
            className="flex flex-col gap-4 sm:max-w-sm"
            noValidate
          >
            <PasswordInput
              label="Current password"
              autoComplete="current-password"
              required
              error={errors.currentPassword?.message}
              {...register("currentPassword")}
            />
            <PasswordInput
              label="New password"
              autoComplete="new-password"
              required
              description="At least 8 characters, with a letter and a number."
              error={errors.newPassword?.message}
              {...register("newPassword")}
            />
            <PasswordInput
              label="Confirm new password"
              autoComplete="new-password"
              required
              error={errors.confirmNewPassword?.message}
              {...register("confirmNewPassword")}
            />
            <Button type="submit" loading={isSubmitting || changePassword.isPending} className="self-start">
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <SectionTitle>Active sessions</SectionTitle>
          {sessions.data && sessions.data.length > 1 && (
            <Button variant="outline" size="sm" onClick={() => setRevokeOthersOpen(true)}>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out other devices
            </Button>
          )}
        </div>
        <CardContent className="flex flex-col gap-3 px-0">
          {sessions.isLoading ? (
            <TableSkeleton rows={2} columns={1} />
          ) : sessions.isError ? (
            <ErrorState message={toFriendlyErrorMessage(sessions.error)} onRetry={() => sessions.refetch()} />
          ) : (sessions.data ?? []).length === 0 ? (
            <EmptyState title="No active sessions" />
          ) : (
            (sessions.data ?? []).map((s) => {
              const Icon = deviceIcon(s.userAgent);
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="flex items-center gap-3">
                    <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {s.userAgent ?? "Unknown device"}
                        {s.isCurrent && <Badge variant="success">This device</Badge>}
                      </div>
                      <Caption>
                        Last active {new Date(s.lastUsedAt).toLocaleString()} · {s.rememberMe ? "Remembered" : "Standard"} session
                      </Caption>
                    </div>
                  </div>
                  {!s.isCurrent && (
                    <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(s.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke session"
        description="This device will be signed out immediately."
        confirmLabel="Revoke"
        destructive
        loading={revokeSession.isPending}
        onConfirm={() => revokeTarget && revokeSession.mutate(revokeTarget)}
      />

      <ConfirmDialog
        open={revokeOthersOpen}
        onOpenChange={setRevokeOthersOpen}
        title="Sign out other devices"
        description="Every other session will be signed out immediately. This device stays signed in."
        confirmLabel="Sign out others"
        destructive
        loading={revokeOthers.isPending}
        onConfirm={() => revokeOthers.mutate()}
      />
    </div>
  );
}
