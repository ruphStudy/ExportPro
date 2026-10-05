"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authApi } from "@/lib/api/auth";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { SESSION_QUERY_KEY } from "@/lib/session";
import { useRedirectIfAuthenticated } from "@/lib/use-redirect-if-authenticated";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle } from "@/components/ui/typography";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  rememberMe: z.boolean().optional(),
});
type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { checking } = useRedirectIfAuthenticated();

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { rememberMe: false } });

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      const returnTo = searchParams.get("returnTo");
      if (returnTo && session.activeOrganizationId) {
        router.push(returnTo);
      } else {
        router.push(session.activeOrganizationId ? "/dashboard" : "/create-organization");
      }
    },
    onError: (error) => {
      setError("root", { message: toFriendlyErrorMessage(error) });
    },
  });

  const needsVerification = Boolean(errors.root?.message?.toLowerCase().includes("verify"));

  if (checking) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>Sign in</PageTitle>
        <HelperText className="mt-1">Welcome back to ExportPro.</HelperText>
      </div>

      <form onSubmit={handleSubmit((values) => login.mutate(values))} className="flex flex-col gap-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register("email")}
        />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          required
          error={errors.password?.message}
          {...register("password")}
        />

        <div className="flex items-center justify-between">
          <Checkbox label="Remember me" {...register("rememberMe")} />
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>

        {errors.root?.message && (
          <div role="alert" className="text-sm text-danger">
            {errors.root.message}
            {needsVerification && (
              <>
                {" "}
                <Link
                  href={`/verify-email?email=${encodeURIComponent(getValues("email"))}`}
                  className="font-medium underline"
                >
                  Verify now
                </Link>
              </>
            )}
          </div>
        )}

        <Button type="submit" loading={isSubmitting || login.isPending} className="mt-2">
          Sign in
        </Button>
      </form>

      <HelperText className="text-center">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </HelperText>
    </div>
  );
}
