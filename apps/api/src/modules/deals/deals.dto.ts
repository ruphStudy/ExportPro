import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import {
  COURIER_UPDATE_SOURCES,
  FEEDBACK_SOURCES,
  FEEDBACK_VERDICTS,
  NEGOTIATION_LOST_REASONS,
  NEGOTIATION_SIDES,
  NEGOTIATION_SOURCES,
  ROUND_SOURCES,
  SAMPLE_ATTACHMENT_CATEGORIES,
  SAMPLE_COST_CATEGORIES,
  SAMPLE_REJECTION_REASONS,
  SAMPLE_SOURCES,
  SHARE_PERMISSIONS,
} from '@exportpro/types';

const nullable = () => ValidateIf((_, v) => v !== null);
const NUM = /^\d{1,14}(\.\d{1,4})?$/;
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const PCT = /^-?\d{1,3}(\.\d{1,4})?$/;
const CUR = /^[A-Z]{3}$/;
const ID = () => MaxLength(40);

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}
export class ReasonDto extends VersionDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

// ------------------------------------------------------------ samples

export class SampleDto extends VersionDto {
  @IsOptional() @IsIn(SAMPLE_SOURCES) source?: string;
  @IsOptional() @IsString() @ID() buyerCompanyId?: string;
  @IsOptional() @IsString() @ID() inquiryId?: string;
  @IsOptional() @IsString() @ID() crmLeadId?: string;
  @IsOptional() @IsString() @ID() quotationId?: string;
  @IsOptional() @IsString() @ID() buyerPurchaseOrderId?: string;
  @IsOptional() @nullable() @IsString() @ID() productId?: string | null;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) productName?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) specification?: string | null;
  @IsOptional() @nullable() @Matches(NUM) quantity?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) unit?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) packaging?: string | null;
  @IsOptional() @nullable() @IsDateString() requiredBy?: string | null;
  @IsOptional() @nullable() @IsDateString() preparationDueAt?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() @nullable() @IsString() @ID() ownerUserId?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) packagingNotes?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(4000) internalComments?: string | null;
}

export class SampleStatusDto extends VersionDto {
  @IsIn(['PREPARING', 'READY', 'CANCELLED']) status: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CourierDto extends VersionDto {
  /** BOOKED sets the booking; SHIPPED/DELIVERED are manual updates; NOTE adds a tracking note. */
  @IsIn(['BOOKED', 'SHIPPED', 'DELIVERED', 'NOTE']) event: string;
  @IsOptional() @IsIn(COURIER_UPDATE_SOURCES) source?: string;
  @IsOptional() @IsString() @MaxLength(120) provider?: string;
  @IsOptional() @IsString() @MaxLength(120) bookingReference?: string;
  @IsOptional() @IsString() @MaxLength(120) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) trackingUrl?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsDateString() expectedDeliveryAt?: string;
  @IsOptional() @Matches(MONEY) courierCost?: string;
  @IsOptional() @Matches(CUR) courierCurrency?: string;
  @IsOptional() @IsString() @MaxLength(160) recipient?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
}

export class SampleCostDto {
  @IsIn(SAMPLE_COST_CATEGORIES) category: string;
  @Matches(MONEY) amount: string;
  @Matches(CUR) currency: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsDateString() incurredAt?: string;
  @IsOptional() @Matches(/^\d{1,10}(\.\d{1,10})?$/) fxRate?: string;
}

export class FeedbackDto {
  @IsDateString() receivedAt: string;
  @IsIn(FEEDBACK_SOURCES) source: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @IsIn(FEEDBACK_VERDICTS) verdict: string;
  @IsOptional() @IsString() @MaxLength(4000) comments?: string;
  @IsOptional() @IsString() @MaxLength(2000) qualityNotes?: string;
  @IsOptional() @IsString() @MaxLength(2000) packagingNotes?: string;
  @IsOptional() @IsString() @MaxLength(2000) priceFeedback?: string;
  @IsOptional() @IsString() @MaxLength(2000) requestedChanges?: string;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
}

export class DecisionDto extends VersionDto {
  @IsOptional() @IsIn(SAMPLE_REJECTION_REASONS) reasonCode?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class IterationDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(2000) specification?: string;
  @IsOptional() @Matches(NUM) quantity?: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsString() @MaxLength(500) packaging?: string;
  @IsString() @MinLength(3) @MaxLength(2000) changeNote: string;
}

export class AttachmentMetaDto {
  @IsOptional() @IsIn(SAMPLE_ATTACHMENT_CATEGORIES) category?: string;
  @IsOptional() @IsString() @ID() feedbackId?: string;
}

export class ListDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @ID() buyerCompanyId?: string;
  @IsOptional() @IsString() @ID() crmLeadId?: string;
  @IsOptional() @IsString() @ID() inquiryId?: string;
  @IsOptional() @IsString() @ID() quotationId?: string;
  @IsOptional() @IsString() @MaxLength(100) product?: string;
  @IsOptional() @IsString() @ID() ownerUserId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

// ------------------------------------------------------------ negotiation

export class SnapshotDto {
  @IsOptional() @nullable() @Matches(NUM) quantity?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) unit?: string | null;
  @IsOptional() @nullable() @Matches(NUM) unitPrice?: string | null;
  @IsOptional() @nullable() @Matches(CUR) currency?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(10) incoterm?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) namedPlace?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) paymentTerms?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) packaging?: string | null;
  @IsOptional() @nullable() @IsDateString() deliveryDate?: string | null;
  @IsOptional() @nullable() @Type(() => Number) @IsInt() @Min(0) @Max(720) leadTimeDays?: number | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) specification?: string | null;
  @IsOptional() @nullable() @IsDateString() validUntil?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) otherTerms?: string | null;
}

export class NegotiationDto {
  @IsOptional() @IsIn(NEGOTIATION_SOURCES) source?: string;
  @IsOptional() @IsString() @ID() buyerCompanyId?: string;
  @IsOptional() @IsString() @ID() inquiryId?: string;
  @IsOptional() @IsString() @ID() quotationId?: string;
  @IsOptional() @IsString() @ID() sampleId?: string;
  @IsOptional() @IsString() @ID() crmLeadId?: string;
  @IsOptional() @IsString() @ID() buyerPurchaseOrderId?: string;
  @IsOptional() @IsString() @ID() costingId?: string;
  @IsOptional() @IsString() @ID() costingScenarioId?: string;
  @IsOptional() @IsString() @MaxLength(200) productName?: string;
  @IsOptional() @IsString() @ID() productId?: string;
  @IsOptional() @Matches(PCT) targetMarginPercent?: string;
  @IsOptional() @ValidateNested() @Type(() => SnapshotDto) initial?: SnapshotDto;
  @IsOptional() @IsIn(NEGOTIATION_SIDES) initialSide?: string;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
}

export class UpdateNegotiationDto extends VersionDto {
  @IsOptional() @nullable() @Matches(PCT) targetMarginPercent?: string | null;
  @IsOptional() @nullable() @IsString() @ID() costingId?: string | null;
  @IsOptional() @nullable() @IsString() @ID() costingScenarioId?: string | null;
  @IsOptional() @IsString() @ID() ownerUserId?: string;
}

export class RoundDto extends VersionDto {
  @IsIn(NEGOTIATION_SIDES) side: string;
  @IsIn(ROUND_SOURCES) source: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @ValidateNested() @Type(() => SnapshotDto) snapshot: SnapshotDto;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
}

export class AgreeDto extends VersionDto {
  @IsOptional() @IsString() @ID() roundId?: string;
  @IsBoolean() confirm: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class LoseDto extends VersionDto {
  @IsIn(NEGOTIATION_LOST_REASONS) reason: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class HoldDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() resume?: boolean;
}

export class HandoffDto extends VersionDto {
  /** Without confirm a preview is returned and nothing changes. */
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export class CommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) body: string;
}

// ------------------------------------------------------------ deal room

export class DealRoomDto extends VersionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @ID() buyerCompanyId?: string;
  @IsOptional() @IsString() @ID() inquiryId?: string;
  @IsOptional() @IsString() @ID() quotationId?: string;
  @IsOptional() @IsString() @ID() proformaInvoiceId?: string;
  @IsOptional() @IsString() @ID() buyerPurchaseOrderId?: string;
  @IsOptional() @IsString() @ID() shipmentId?: string;
  @IsOptional() @IsString() @ID() negotiationId?: string;
  @IsOptional() @IsIn(['1', '7', '30', 'CUSTOM']) expiry?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @nullable() @IsEmail() allowedEmail?: string | null;
  @IsOptional() @nullable() @IsString() @MinLength(6) @MaxLength(32) accessCode?: string | null;
  @IsOptional() @IsBoolean() allowComments?: boolean;
}

export class ShareDto extends VersionDto {
  /** Free string on purpose: blocked internal types get an explicit refusal. */
  @IsString() @MaxLength(40) docType: string;
  @IsString() @ID() sourceId: string;
  @IsOptional() @IsIn(SHARE_PERMISSIONS) permission?: string;
  @IsOptional() @IsString() @MaxLength(160) title?: string;
}

export class ReplaceShareDto extends VersionDto {
  @IsString() @ID() sourceId: string;
}

export class GuestAccessDto {
  @IsOptional() @IsString() @MaxLength(32) accessCode?: string;
  @IsOptional() @IsEmail() email?: string;
}

export class GuestCommentDto {
  @IsString() @MinLength(1) @MaxLength(120) guestName: string;
  @IsOptional() @IsEmail() guestEmail?: string;
  @IsString() @MinLength(1) @MaxLength(2000) body: string;
  @IsOptional() @IsString() @ID() shareId?: string;
}
