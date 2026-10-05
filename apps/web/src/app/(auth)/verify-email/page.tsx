"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authApi } from "@/lib/api/auth";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle } from "@/components/ui/typography";

const verifySchema = z.object({
  email: z.string().email("Enter a valid email address."),
  code: z.string().length(6, "Enter the 6-digit code."),
});
type VerifyValues = z.infer<typeof verifySchema>;

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VerifyEmailForm />
    </Suspense>
  );
}

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cooldown, setCooldown] = useState(0);

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { email: searchParams.get("email") ?? "", code: "" },
  });

  const verify = useMutation({
    mutationFn: authApi.verifyEmail,
    onSuccess: () => {
      toast.success("Email verified", "You can now sign in.");
      router.push(`/login?email=${encodeURIComponent(getValues("email"))}`);
    },
    onError: (error) => setError("root", { message: toFriendlyErrorMessage(error) }),
  });

  const resend = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => {
      toast.success("Verification code sent", "Check your inbox for the new code.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      const interval = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(interval);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    },
    onError: (error) => toast.error("Could not resend code", toFriendlyErrorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center text-center">
        <div className="mb-2 rounded-full bg-primary/10 p-3">
          <MailCheck className="size-6 text-primary" aria-hidden="true" />
        </div>
        <PageTitle>Verify your email</PageTitle>
        <HelperText className="mt-1">Enter the 6-digit code we sent to your email address.</HelperText>
      </div>

      <form onSubmit={handleSubmit((values) => verify.mutate(values))} className="flex flex-col gap-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register("email")}
        />
        <Input
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          error={errors.code?.message}
          {...register("code")}
        />

        {errors.root?.message && (
          <p role="alert" className="text-sm text-danger">
            {errors.root.message}
          </p>
        )}

        <Button type="submit" loading={isSubmitting || verify.isPending} className="mt-2">
          Verify email
        </Button>
      </form>

      <HelperText className="text-center">
        Didn&apos;t get a code?{" "}
        <button
          type="button"
          disabled={cooldown > 0 || resend.isPending}
          onClick={() => resend.mutate({ email: getValues("email") })}
          className="font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      </HelperText>

      <HelperText className="text-center">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </HelperText>
    </div>
  );
}
