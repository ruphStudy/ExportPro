import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  type CampaignStatus,
  CAMPAIGN_STATUSES,
  type ContentSource,
  GENERATION_TYPES,
  type GenerationType,
  MESSAGE_STATUSES,
  type OutreachMessageStatus,
  type OutreachTemplateType,
  type OutreachTone,
  OUTREACH_HARD_LIMITS,
  RECIPIENT_STATUSES,
  type RecipientStatus,
  TEMPLATE_TYPES,
  TONES,
} from '@exportpro/types';

const ID = /^[a-z0-9_]{6,40}$/i;
const COUNTRY = /^[A-Z]{2}$/;
const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CampaignListQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(CAMPAIGN_STATUSES) status?: CampaignStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class CreateCampaignDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @Matches(ID) productId?: string;
  @IsOptional() @Matches(COUNTRY) countryCode?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(OUTREACH_HARD_LIMITS.maxRecipientsPerCampaign)
  @Matches(ID, { each: true })
  buyerIds?: string[];
  @IsOptional() @Matches(ID) leadId?: string;
}

export class FollowUpDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OUTREACH_HARD_LIMITS.maxFollowUpDelayDays)
  delayDays: number;
  @IsString() @MaxLength(200) subject: string;
  @IsString() @MaxLength(5000) body: string;
}

export class UpdateCampaignDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(ID) productId?:
    string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(COUNTRY)
  countryCode?: string | null;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @Matches(LANG) language?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(ID) templateId?:
    string | null;
  @IsOptional()
  @IsIn(['TEMPLATE', 'AI', 'AI_EDITED', 'MANUAL'])
  contentSource?: ContentSource;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  generationProvider?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() generatedAt?:
    string | null;
  @IsOptional() @IsIn(['NOW', 'SCHEDULED']) sendMode?: 'NOW' | 'SCHEDULED';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() scheduledAt?:
    string | null;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(OUTREACH_HARD_LIMITS.maxFollowUps)
  @ValidateNested({ each: true })
  @Type(() => FollowUpDto)
  followUps?: FollowUpDto[];
}

export class SetRecipientsDto {
  @IsArray()
  @ArrayMaxSize(OUTREACH_HARD_LIMITS.maxRecipientsPerCampaign * 2)
  @Matches(ID, { each: true })
  buyerIds: string[];
}

export class RecipientQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(RECIPIENT_STATUSES) status?: RecipientStatus;
}

export class PreviewDto {
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
}

export class ValidateTemplateDto {
  @IsString() @MaxLength(200) subject: string;
  @IsString() @MaxLength(5000) body: string;
}

export class GenerateDto {
  @IsIn(GENERATION_TYPES) type: GenerationType;
  @IsIn(TONES) tone: OutreachTone;
  @Matches(LANG) language: string;
  @IsOptional() @Matches(ID) productId?: string;
  @IsOptional() @Matches(COUNTRY) countryCode?: string;
  @IsOptional() @Matches(ID) buyerId?: string;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
}

export class TemplateDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsIn(TEMPLATE_TYPES) type: OutreachTemplateType;
  @IsString() @MaxLength(200) subject: string;
  @IsString() @MaxLength(5000) body: string;
  @IsOptional() @Matches(LANG) language?: string;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsIn(TEMPLATE_TYPES) type?: OutreachTemplateType;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @Matches(LANG) language?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class TemplateQueryDto {
  @IsOptional() @Transform(toBool) @IsBoolean() includeArchived?: boolean;
}

export class SettingsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  fromName?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail({}, { message: 'Enter a valid sender email.' })
  fromEmail?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail({}, { message: 'Enter a valid reply-to email.' })
  replyTo?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  companyName?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  companyWebsite?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  signature?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OUTREACH_HARD_LIMITS.dailyLimit)
  dailyLimit?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OUTREACH_HARD_LIMITS.maxRecipientsPerCampaign)
  maxRecipientsPerCampaign?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(OUTREACH_HARD_LIMITS.maxFollowUps)
  maxFollowUps?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(OUTREACH_HARD_LIMITS.minContactCooldownDays)
  @Max(180)
  contactCooldownDays?: number;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class LaunchDto {
  /** Explicit human confirmation that content and recipients were reviewed. */
  @IsBoolean() confirm: boolean;
}

export class MessageQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Matches(ID) campaignId?: string;
  @IsOptional() @Matches(ID) buyerId?: string;
  @IsOptional() @Matches(ID) leadId?: string;
  @IsOptional() @IsIn(MESSAGE_STATUSES) status?: OutreachMessageStatus;
  @IsOptional()
  @IsIn(['EMAIL', 'WHATSAPP', 'LINKEDIN_MANUAL', 'OTHER'])
  channel?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

/** Optional pasted reply text when recording a reply manually (becomes the inquiry body). */
export class RepliedDto {
  @IsOptional() @IsString() @MaxLength(100_000) replyText?: string;
}

export class InterestedDto {
  @IsBoolean() interested: boolean;
}

export class SuppressionDto {
  @IsEmail({}, { message: 'Enter a valid email address.' }) address: string;
}
