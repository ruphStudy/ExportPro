"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authApi } from "@/lib/api/auth";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { HelperText, PageTitle } from "@/components/ui/typography";

const schema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain at least one letter and one number."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const resetPassword = useMutation({
    mutationFn: (values: Values) => authApi.resetPassword({ token: token ?? "", ...values }),
  });

  if (!token) {
    return (
      <EmptyState
        title="Invalid reset link"
        description="This password reset link is missing its token. Request a new one."
        action={
          <Button asChild>
            <Link href="/forgot-password">Request new link</Link>
          </Button>
        }
      />
    );
  }

  if (resetPassword.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-full bg-success/10 p-3">
          <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
        </div>
        <PageTitle>Password reset</PageTitle>
        <HelperText>You can now sign in with your new password.</HelperText>
        <Button asChild className="mt-2">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>Set a new password</PageTitle>
        <HelperText className="mt-1">Choose a new password for your account.</HelperText>
      </div>

      <form
        onSubmit={handleSubmit((values) => resetPassword.mutate(values))}
        className="flex flex-col gap-4"
        noValidate
      >
        <PasswordInput
          label="New password"
          autoComplete="new-password"
          required
          description="At least 8 characters, with a letter and a number."
          error={errors.password?.message}
          {...register("password")}
        />
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />

        {resetPassword.isError && (
          <p role="alert" className="text-sm text-danger">
            {toFriendlyErrorMessage(resetPassword.error)}
          </p>
        )}

        <Button type="submit" loading={resetPassword.isPending} className="mt-2">
          Reset password
        </Button>
      </form>
    </div>
  );
}
