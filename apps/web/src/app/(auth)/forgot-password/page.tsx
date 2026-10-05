"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authApi } from "@/lib/api/auth";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelperText, PageTitle } from "@/components/ui/typography";

const schema = z.object({ email: z.string().email("Enter a valid email address.") });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const forgotPassword = useMutation({ mutationFn: authApi.forgotPassword });

  if (forgotPassword.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-full bg-success/10 p-3">
          <MailCheck className="size-6 text-success" aria-hidden="true" />
        </div>
        <PageTitle>Check your email</PageTitle>
        <HelperText>
          If an account exists for that email, we&apos;ve sent password reset instructions.
        </HelperText>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>Forgot password</PageTitle>
        <HelperText className="mt-1">Enter your email and we&apos;ll send you reset instructions.</HelperText>
      </div>

      <form onSubmit={handleSubmit((values) => forgotPassword.mutate(values))} className="flex flex-col gap-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register("email")}
        />

        {forgotPassword.isError && (
          <p role="alert" className="text-sm text-danger">
            {toFriendlyErrorMessage(forgotPassword.error)}
          </p>
        )}

        <Button type="submit" loading={forgotPassword.isPending} className="mt-2">
          Send reset instructions
        </Button>
      </form>

      <HelperText className="text-center">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </HelperText>
    </div>
  );
}
