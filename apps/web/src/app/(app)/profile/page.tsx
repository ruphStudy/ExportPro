"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, UserRound } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { profileApi } from "@/lib/api/profile";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { SESSION_QUERY_KEY, useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const schema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  phone: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function ProfilePage() {
  const { data: session, isLoading } = useSession();
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [removeAvatarOpen, setRemoveAvatarOpen] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  React.useEffect(() => {
    if (session) {
      reset({ firstName: session.user.firstName, lastName: session.user.lastName, phone: session.user.phone ?? "" });
    }
  }, [session, reset]);

  const updateProfile = useMutation({
    mutationFn: profileApi.update,
    onSuccess: (user) => {
      toast.success("Profile updated");
      queryClient.setQueryData(SESSION_QUERY_KEY, (prev: typeof session) => (prev ? { ...prev, user } : prev));
    },
    onError: (error) => toast.error("Could not update profile", toFriendlyErrorMessage(error)),
  });

  const uploadAvatar = useMutation({
    mutationFn: profileApi.uploadAvatar,
    onSuccess: (user) => {
      toast.success("Profile picture updated");
      queryClient.setQueryData(SESSION_QUERY_KEY, (prev: typeof session) => (prev ? { ...prev, user } : prev));
    },
    onError: (error) => toast.error("Could not upload picture", toFriendlyErrorMessage(error)),
  });

  const removeAvatar = useMutation({
    mutationFn: profileApi.removeAvatar,
    onSuccess: (user) => {
      toast.success("Profile picture removed");
      queryClient.setQueryData(SESSION_QUERY_KEY, (prev: typeof session) => (prev ? { ...prev, user } : prev));
      setRemoveAvatarOpen(false);
    },
    onError: (error) => toast.error("Could not remove picture", toFriendlyErrorMessage(error)),
  });

  if (isLoading || !session) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>Profile</PageTitle>
        <HelperText className="mt-1">Your personal account details.</HelperText>
      </div>

      <Card className="p-4">
        <SectionTitle>Profile picture</SectionTitle>
        <CardContent className="flex items-center gap-4 px-0">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
            {session.user.avatarUrl ? (
              <Image src={session.user.avatarUrl} alt="Profile picture" width={64} height={64} className="size-full object-cover" />
            ) : (
              <UserRound className="size-6 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadAvatar.mutate(file);
              event.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" loading={uploadAvatar.isPending} onClick={() => fileInputRef.current?.click()}>
            {session.user.avatarUrl ? "Replace" : "Upload"}
          </Button>
          {session.user.avatarUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveAvatarOpen(true)}>
              <Trash2 className="size-4 text-danger" aria-hidden="true" />
              Remove
            </Button>
          )}
        </CardContent>
        <HelperText>PNG, JPEG, or WEBP. Max 2MB.</HelperText>
      </Card>

      <Card className="p-4">
        <SectionTitle>Personal details</SectionTitle>
        <CardContent className="px-0">
          <form onSubmit={handleSubmit((values) => updateProfile.mutate(values))} className="flex flex-col gap-4" noValidate>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="First name" required error={errors.firstName?.message} {...register("firstName")} />
              <Input label="Last name" required error={errors.lastName?.message} {...register("lastName")} />
            </div>
            <Input label="Email" value={session.user.email} disabled description="Email changes aren't supported yet." />
            <Input label="Phone" error={errors.phone?.message} {...register("phone")} />

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => reset()} disabled={!isDirty}>
                Cancel
              </Button>
              <Button type="submit" loading={updateProfile.isPending} disabled={!isDirty}>
                Save changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={removeAvatarOpen}
        onOpenChange={setRemoveAvatarOpen}
        title="Remove profile picture"
        confirmLabel="Remove"
        destructive
        loading={removeAvatar.isPending}
        onConfirm={() => removeAvatar.mutate()}
      />
    </div>
  );
}
