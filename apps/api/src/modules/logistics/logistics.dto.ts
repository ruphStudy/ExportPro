import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  BUYER_UPDATE_TRIGGERS,
  CLAIM_STATUSES,
  FREIGHT_CHARGE_CATEGORIES,
  MILESTONE_STATUSES,
  RFQ_INCOTERMS,
  SHIPMENT_EXCEPTION_TYPES,
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSPORT_MODES,
  SHIPMENT_TYPES,
  TRACKING_EVENT_TYPES,
} from '@exportpro/types';

const nullable = () => ValidateIf((_, v) => v !== null);
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const WEIGHT = /^\d{1,10}(\.\d{1,3})?$/;
const CUR = /^[A-Z]{3}$/;
const ISO2 = /^[A-Z]{2}$/;

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class ProviderDto {
  @IsString() @MinLength(2) @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsOptional() @IsString() @MaxLength(120) contactPerson?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class FreightRequestDto {
  @IsOptional() @IsString() @MaxLength(40) purchaseOrderId?: string;
  @IsIn(SHIPMENT_TRANSPORT_MODES) transportMode: string;
  @IsOptional() @IsIn(SHIPMENT_TYPES) shipmentType?: string;
  @IsOptional() @IsString() @MaxLength(120) origin?: string;
  @IsOptional() @IsString() @MaxLength(120) destination?: string;
  @IsOptional() @IsString() @MaxLength(80) portOfLoading?: string;
  @IsOptional() @IsString() @MaxLength(80) portOfDischarge?: string;
  @IsOptional() @IsIn([...RFQ_INCOTERMS]) incoterm?: string;
  @IsOptional() @IsString() @MaxLength(1000) cargoDescription?: string;
  @IsOptional() @IsInt() @Min(0) packageCount?: number;
  @IsOptional() @Matches(WEIGHT) grossWeightKg?: string;
  @IsOptional() @Matches(WEIGHT) netWeightKg?: string;
  @IsOptional() @Matches(WEIGHT) volumeCbm?: string;
  @IsOptional() @IsDateString() readyDate?: string;
  @IsOptional() @IsDateString() preferredDeparture?: string;
  @IsOptional() @IsString() @MaxLength(1000) specialHandling?: string;
  /** Forwarders the request is addressed to (creates REQUESTED placeholders — nothing is sent). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  providerIds?: string[];
}

export class ChargeDto {
  @IsIn(FREIGHT_CHARGE_CATEGORIES) category: string;
  @IsOptional() @nullable() @IsString() @MaxLength(80) label?: string | null;
  @Matches(MONEY, { message: 'Charge amount must be a non-negative amount.' })
  amount: string;
}

export class FreightQuoteDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(40) requestId?: string;
  @IsOptional() @IsString() @MaxLength(40) purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) providerId?: string;
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  forwarderName?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(120) shippingLine?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) carrier?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) serviceName?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) quoteReference?:
    string | null;
  @IsOptional() @IsIn(SHIPMENT_TRANSPORT_MODES) transportMode?: string;
  @IsOptional() @nullable() @IsIn(SHIPMENT_TYPES) shipmentType?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) containerSummary?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) origin?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) destination?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) portOfLoading?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) portOfDischarge?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) routeSummary?:
    string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  transshipmentPorts?: string[];
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ChargeDto)
  charges?: ChargeDto[];
  @IsOptional() @nullable() @IsInt() @Min(0) @Max(365) transitDays?:
    number | null;
  @IsOptional() @nullable() @IsInt() @Min(0) @Max(365) freeDays?: number | null;
  @IsOptional() @nullable() @IsDateString() validityFrom?: string | null;
  @IsOptional() @nullable() @IsDateString() validityUntil?: string | null;
  @IsOptional() @nullable() @IsDateString() departureDate?: string | null;
  @IsOptional() @nullable() @IsDateString() arrivalDate?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) inclusions?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) exclusions?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(3000) terms?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) riskNotes?:
    string | null;
  @IsOptional()
  @IsIn(['MANUAL', 'EMAIL', 'FORWARDER_PORTAL', 'OTHER'])
  source?: string;
}

export class SelectQuoteDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** Manager override to select an expired quote (audited). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overrideReason?: string;
}

export class ReasonDto extends VersionDto {
  @IsString()
  @MinLength(3, { message: 'A reason is required.' })
  @MaxLength(1000)
  reason: string;
}

export class CompareQuotesDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  quoteIds: string[];
  @IsOptional() @Matches(CUR) targetCurrency?: string;
}

export class ShipmentDto extends VersionDto {
  @IsOptional() @IsIn(SHIPMENT_TRANSPORT_MODES) mode?: string;
  @IsOptional() @nullable() @IsIn(SHIPMENT_TYPES) shipmentType?: string | null;
  @IsOptional() @nullable() @IsIn([...RFQ_INCOTERMS]) incoterm?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) incotermPlace?:
    string | null;
  @IsOptional() @nullable() @Matches(ISO2) originCountry?: string | null;
  @IsOptional() @nullable() @Matches(ISO2) destinationCountry?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) portOfLoading?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) portOfDischarge?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) placeOfReceipt?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) placeOfDelivery?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) carrier?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) shippingLine?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) vesselName?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) voyageNumber?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) flightNumber?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) vehicleReference?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) bookingReference?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) blNumber?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) awbNumber?:
    string | null;
  @IsOptional() @nullable() @IsDateString() etd?: string | null;
  @IsOptional() @nullable() @IsDateString() eta?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) cargoDescription?:
    string | null;
  @IsOptional() @nullable() @IsInt() @Min(0) packageCount?: number | null;
  @IsOptional() @nullable() @Matches(WEIGHT) grossWeightKg?: string | null;
  @IsOptional() @nullable() @Matches(WEIGHT) netWeightKg?: string | null;
  @IsOptional() @nullable() @Matches(WEIGHT) volumeCbm?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) shippingBillNumber?:
    string | null;
  @IsOptional() @nullable() @IsDateString() shippingBillDate?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(160) customsBroker?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) ownerUserId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(3000) notes?: string | null;
  /** ETA/ETD change reason (recorded in the tracking history). */
  @IsOptional() @IsString() @MaxLength(500) changeReason?: string;
}

export class CreateShipmentDto extends ShipmentDto {
  @IsString() @MaxLength(40) purchaseOrderId: string;
  @IsOptional() @IsString() @MaxLength(40) freightQuoteId?: string;
  @IsOptional() @IsBoolean() acknowledgeComplianceWarnings?: boolean;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  complianceOverrideReason?: string;
  /** Booking is confirmed by the user with their forwarder/carrier (ExportPro does not book). */
  @IsOptional() @IsBoolean() bookingConfirmed?: boolean;
}

export class StatusDto extends VersionDto {
  @IsIn(SHIPMENT_STATUSES) status: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class MilestoneDto {
  @IsOptional() @IsIn(MILESTONE_STATUSES) status?: string;
  @IsOptional() @nullable() @IsDateString() plannedAt?: string | null;
  @IsOptional() @nullable() @IsDateString() estimatedAt?: string | null;
  @IsOptional() @nullable() @IsDateString() actualAt?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) location?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?: string;
  /** Manager override to complete documentation despite the document gate. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  overrideReason?: string;
}

export class ContainerDto {
  @IsOptional() @IsString() @MaxLength(15) containerNumber?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(20) containerType?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) sealNumber?:
    string | null;
  @IsOptional() @nullable() @IsInt() @Min(0) packageCount?: number | null;
  @IsOptional() @nullable() @Matches(WEIGHT) grossWeightKg?: string | null;
  @IsOptional() @nullable() @Matches(WEIGHT) netWeightKg?: string | null;
  /** Keep a number whose ISO 6346 check digit does not compute (e.g. typed from a carrier document). */
  @IsOptional() @IsBoolean() acceptCheckDigitMismatch?: boolean;
}

export class LegDto {
  @IsOptional() @IsIn(SHIPMENT_TRANSPORT_MODES) mode?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(120) origin?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) destination?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) carrier?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) vesselName?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) voyageNumber?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) flightNumber?:
    string | null;
  @IsOptional() @nullable() @IsDateString() plannedDeparture?: string | null;
  @IsOptional() @nullable() @IsDateString() plannedArrival?: string | null;
}

export class TrackingEventDto {
  @IsIn(TRACKING_EVENT_TYPES) eventType: string;
  @IsDateString() eventTime: string;
  @IsOptional() @IsBoolean() estimated?: boolean;
  @IsOptional() @IsString() @MaxLength(120) location?: string;
  @IsOptional() @IsString() @MaxLength(15) containerNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) vesselName?: string;
  @IsOptional() @IsString() @MaxLength(40) voyageNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) flightNumber?: string;
  @IsOptional() @IsDateString() newEta?: string;
  @IsOptional() @IsDateString() newEtd?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  /** MANUAL (you) or FORWARDER (reported to you by the forwarder). Carrier API data only arrives via providers. */
  @IsOptional() @IsIn(['MANUAL', 'FORWARDER', 'USER_UPLOAD']) source?: string;
  @IsOptional() @IsString() @MaxLength(120) sourceReference?: string;
}

export class ExceptionDto {
  @IsIn(SHIPMENT_EXCEPTION_TYPES) type: string;
  @IsIn(['INFO', 'WARNING', 'CRITICAL']) severity: string;
  @IsString() @MinLength(3) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) impact?: string;
  @IsOptional() @IsString() @MaxLength(120) location?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() @MaxLength(40) ownerUserId?: string;
  @IsOptional() @IsDateString() dueAt?: string;
}

export class ResolveExceptionDto {
  @IsString()
  @MinLength(3, { message: 'A resolution is required.' })
  @MaxLength(2000)
  resolution: string;
}

export class ClaimDto {
  @IsOptional() @IsString() @MaxLength(40) exceptionId?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(2000) description?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(120) quantityAffected?:
    string | null;
  @IsOptional() @nullable() @Matches(MONEY) estimatedLoss?: string | null;
  @IsOptional() @nullable() @Matches(CUR) currency?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) claimReference?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) insurerReference?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) carrierReference?:
    string | null;
  @IsOptional() @IsIn(CLAIM_STATUSES) status?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
}

export class GenerateUpdateDto {
  @IsIn(BUYER_UPDATE_TRIGGERS) trigger: string;
}

export class RecordSentDto {
  @IsIn(['EMAIL', 'WHATSAPP', 'PHONE', 'OTHER']) channel: string;
}

export class CostsDto extends VersionDto {
  @IsOptional() @nullable() @Matches(MONEY) actualFreight?: string | null;
  @IsOptional() @nullable() @Matches(MONEY) actualSurcharges?: string | null;
  @IsOptional() @nullable() @Matches(MONEY) actualLocalCharges?: string | null;
  @IsOptional() @nullable() @Matches(CUR) currency?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) notes?: string | null;
}

export class SettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(60) etaDelayWarningDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) etaDelayCriticalDays?: number;
  @IsOptional() @IsBoolean() autoDraftBuyerUpdates?: boolean;
  @IsOptional()
  @IsIn(['DRAFT_ONLY', 'REQUIRE_APPROVAL', 'AUTO_SEND'])
  buyerUpdateMode?: string;
}

export class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional() @IsString() @MaxLength(20) health?: string;
  @IsOptional() @IsString() @MaxLength(20) mode?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(40) purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
  @IsOptional() @Matches(ISO2) country?: string;
  @IsOptional() @IsDateString() etaFrom?: string;
  @IsOptional() @IsDateString() etaTo?: string;
  @IsOptional() @IsString() @MaxLength(40) ownerUserId?: string;
  @IsOptional() @IsIn(['true', 'false']) hasOpenExceptions?: string;
  @IsOptional() @IsString() @MaxLength(20) severity?: string;
  @IsOptional() @IsString() @MaxLength(30) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}
