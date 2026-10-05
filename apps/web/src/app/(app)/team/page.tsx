"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { MembershipRole } from "@exportpro/types";
import { membersApi } from "@/lib/api/members";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequirePermission } from "@/components/layout/require-permission";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { Column } from "@/components/ui/table";
import { DataTable } from "@/components/ui/table";
import { HelperText, PageTitle } from "@/components/ui/typography";

const ROLE_OPTIONS = Object.values(MembershipRole)
  .filter((role) => role !== "OWNER")
  .map((role) => ({ label: role.replace("_", " "), value: role }));

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  role: z.enum(MembershipRole, { message: "Select a role." }),
});
type InviteValues = z.infer<typeof inviteSchema>;

const roleBadgeVariant = (role: MembershipRole) => (role === "OWNER" ? "info" : role === "ADMIN" ? "success" : "neutral");

export default function TeamPage() {
  return (
    <RequirePermission permission="team.view">
      <TeamPageContent />
    </RequirePermission>
  );
}

function TeamPageContent() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<{ id: string; name: string } | null>(null);

  const canInvite = hasPermission(session, "team.invite");
  const canUpdateRole = hasPermission(session, "team.update");
  const canRemove = hasPermission(session, "team.remove");

  const members = useQuery({ queryKey: ["members"], queryFn: membersApi.list });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { role: "VIEWER" } });

  const invite = useMutation({
    mutationFn: (values: InviteValues) => membersApi.invite(values as { email: string; role: Exclude<MembershipRole, "OWNER"> }),
    onSuccess: (invitation) => {
      toast.success("Invitation sent", `${invitation.email} has been invited.`);
      setInviteOpen(false);
      reset();
    },
    onError: (error) => toast.error("Could not send invitation", toFriendlyErrorMessage(error)),
  });

  const updateRole = useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: string; role: Exclude<MembershipRole, "OWNER"> }) =>
      membersApi.updateRole(membershipId, { role }),
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (error) => toast.error("Could not update role", toFriendlyErrorMessage(error)),
  });

  const removeMember = useMutation({
    mutationFn: (membershipId: string) => membersApi.remove(membershipId),
    onSuccess: () => {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["members"] });
      setRemoveTarget(null);
    },
    onError: (error) => {
      toast.error("Could not remove member", toFriendlyErrorMessage(error));
      setRemoveTarget(null);
    },
  });

  const columns: Column<NonNullable<typeof members.data>[number]>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div>
          <div className="font-medium text-foreground">
            {row.firstName} {row.lastName}
          </div>
          <div className="text-xs text-muted-foreground">{row.email}</div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) =>
        canUpdateRole && row.role !== "OWNER" ? (
          <Select
            value={row.role}
            onChange={(event) =>
              updateRole.mutate({ membershipId: row.membershipId, role: event.target.value as Exclude<MembershipRole, "OWNER"> })
            }
            options={ROLE_OPTIONS}
            className="h-8 text-xs"
          />
        ) : (
          <Badge variant={roleBadgeVariant(row.role)}>{row.role.replace("_", " ")}</Badge>
        ),
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge variant={row.status === "ACTIVE" ? "success" : "neutral"}>{row.status}</Badge>,
    },
    {
      key: "joined",
      header: "Joined",
      render: (row) => new Date(row.joinedAt).toLocaleDateString(),
      hideOnMobile: true,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        canRemove && row.role !== "OWNER" && row.userId !== session?.user.id ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${row.firstName}`}
            onClick={() => setRemoveTarget({ id: row.membershipId, name: `${row.firstName} ${row.lastName}` })}
          >
            <Trash2 className="size-4 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>Team</PageTitle>
          <HelperText className="mt-1">Manage who has access to your organization.</HelperText>
        </div>
        {canInvite && (
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Invite member
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={members.data ?? []}
        rowKey={(row) => row.membershipId}
        isLoading={members.isLoading}
        error={members.isError ? toFriendlyErrorMessage(members.error) : undefined}
        onRetry={() => members.refetch()}
        emptyState={{ title: "No team members yet" }}
      />

      <Modal open={inviteOpen} onOpenChange={setInviteOpen} title="Invite member" description="Send an invitation by email.">
        <form onSubmit={handleSubmit((values) => invite.mutate(values))} className="flex flex-col gap-4" noValidate>
          <Input label="Email" type="email" required error={errors.email?.message} {...register("email")} />
          <Select label="Role" required options={ROLE_OPTIONS} error={errors.role?.message} {...register("role")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || invite.isPending}>
              Send invitation
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove member"
        description={removeTarget ? `${removeTarget.name} will lose access to this organization.` : undefined}
        confirmLabel="Remove"
        destructive
        loading={removeMember.isPending}
        onConfirm={() => removeTarget && removeMember.mutate(removeTarget.id)}
      />
    </div>
  );
}
