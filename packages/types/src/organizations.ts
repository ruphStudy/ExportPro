import type { BusinessType, MembershipRole, MembershipStatus, TradeDirection } from "./enums";

export interface CreateOrganizationRequest {
  name: string;
  businessType: BusinessType;
  industry?: string;
  tradeDirections?: TradeDirection[];
}

export interface UpdateOrganizationRequest {
  name?: string;
  legalName?: string;
  businessType?: BusinessType;
  industry?: string;
  website?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  timezone?: string;
  defaultCurrency?: string;
  tradeDirections?: TradeDirection[];
}

export interface SwitchOrganizationRequest {
  organizationId: string;
}

export interface MemberSummary {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  role: MembershipRole;
  status: MembershipStatus;
  joinedAt: string;
}

export interface InviteMemberRequest {
  email: string;
  role: MembershipRole;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: MembershipRole;
  expiresAt: string;
  createdAt: string;
}

export interface UpdateMemberRoleRequest {
  role: MembershipRole;
}
