"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authApi } from "@/lib/api/auth";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { useRedirectIfAuthenticated } from "@/lib/use-redirect-if-authenticated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle } from "@/components/ui/typography";

const signupSchema = z
  .object({
    firstName: z.string().min(1, "First name is required."),
    lastName: z.string().min(1, "Last name is required."),
    email: z.string().email("Enter a valid email address."),
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

type SignupValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const router = useRouter();
  const { checking } = useRedirectIfAuthenticated();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({ resolver: zodResolver(signupSchema) });

  const signup = useMutation({
    mutationFn: authApi.signup,
    onSuccess: (data) => {
      router.push(`/verify-email?email=${encodeURIComponent(data.email)}`);
    },
    onError: (error) => {
      setError("root", { message: toFriendlyErrorMessage(error) });
    },
  });

  if (checking) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>Create your account</PageTitle>
        <HelperText className="mt-1">Start managing your export/import business on ExportPro.</HelperText>
      </div>

      <form
        onSubmit={handleSubmit((values) => signup.mutate(values))}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" required error={errors.firstName?.message} {...register("firstName")} />
          <Input label="Last name" required error={errors.lastName?.message} {...register("lastName")} />
        </div>
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
          autoComplete="new-password"
          required
          description="At least 8 characters, with a letter and a number."
          error={errors.password?.message}
          {...register("password")}
        />
        <PasswordInput
          label="Confirm password"
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />

        {errors.root?.message && (
          <p role="alert" className="text-sm text-danger">
            {errors.root.message}
          </p>
        )}

        <Button type="submit" loading={isSubmitting || signup.isPending} className="mt-2">
          Create account
        </Button>
      </form>

      <HelperText className="text-center">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </HelperText>
    </div>
  );
}
