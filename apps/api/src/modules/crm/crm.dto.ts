import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
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
  CRM_STAGES,
  type CrmLeadSort,
  type CrmStage,
  LEAD_PRIORITIES,
  LEAD_REMINDER_TYPES,
  LEAD_SOURCES,
  LEAD_TASK_STATUSES,
  type LeadPriority,
  type LeadQualification,
  type LeadReminderType,
  type LeadSource,
  type LeadStatusFilter,
  type LeadTaskStatus,
  LOGGABLE_ACTIVITY_TYPES,
  type LoggableActivityType,
  LOST_REASONS,
  type LostReason,
} from '@exportpro/types';

const ID = /^[a-z0-9]{8,40}$/i;
const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class LeadListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['OPEN', 'WON', 'LOST', 'ALL']) status?: LeadStatusFilter;
  @IsOptional() @IsIn(CRM_STAGES) stage?: CrmStage;
  @IsOptional() @IsString() @MaxLength(40) owner?: string;
  @IsOptional() @Matches(ID) productId?: string;
  @IsOptional() @Matches(COUNTRY) country?: string;
  @IsOptional() @IsIn(LEAD_PRIORITIES) priority?: LeadPriority;
  @IsOptional() @Matches(ID) tagId?: string;
  @IsOptional() @IsIn(LEAD_SOURCES) source?: LeadSource;
  @IsOptional()
  @IsIn(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'])
  risk?: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  @IsOptional() @Transform(toBool) @IsBoolean() overdue?: boolean;
  @IsOptional() @Transform(toBool) @IsBoolean() stale?: boolean;
  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;
  @IsOptional() @IsDateString() updatedFrom?: string;
  @IsOptional() @IsDateString() updatedTo?: string;
  @IsOptional()
  @IsIn([
    'updatedAt',
    'createdAt',
    'lastActivityAt',
    'nextActionDueAt',
    'expectedValue',
    'priority',
    'stage',
    'buyer',
  ])
  sortBy?: CrmLeadSort;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class PipelineQueryDto {
  @IsOptional() @IsString() @MaxLength(40) owner?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(LEAD_PRIORITIES) priority?: LeadPriority;
  @IsOptional() @Matches(ID) tagId?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() includeClosed?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) perStage?: number;
}

export class CreateLeadDto {
  @Matches(ID, { message: 'Select a buyer.' }) buyerCompanyId: string;
  @IsOptional() @Matches(ID) productId?: string;
  @IsOptional() @Matches(COUNTRY) countryCode?: string;
  @IsOptional() @Matches(ID) ownerUserId?: string;
  @IsOptional() @IsIn(LEAD_PRIORITIES) priority?: LeadPriority;
  @IsOptional() @IsIn(LEAD_SOURCES) source?: LeadSource;
  @IsOptional() @IsString() @MaxLength(200) nextAction?: string;
  @IsOptional() @IsDateString() nextActionDueAt?: string;
}

export class QualificationDto implements LeadQualification {
  @IsOptional() @IsString() @MaxLength(300) requirement?: string | null;
  @IsOptional() @IsString() @MaxLength(300) volume?: string | null;
  @IsOptional() @IsString() @MaxLength(300) timeline?: string | null;
  @IsOptional() @IsString() @MaxLength(300) paymentTerms?: string | null;
  @IsOptional() @IsString() @MaxLength(300) decisionMaker?: string | null;
}

export class UpdateLeadDto {
  @IsOptional() @IsIn(LEAD_PRIORITIES) priority?: LeadPriority;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(ID) productId?:
    string | null;
  @IsOptional() @Matches(COUNTRY) countryCode?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1e13)
  expectedValue?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(CURRENCY) currency?:
    string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  nextAction?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  nextActionDueAt?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID)
  primaryContactId?: string | null;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => QualificationDto)
  qualification?: QualificationDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(ID, { each: true })
  tagIds?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

export class StageChangeDto {
  @IsIn(CRM_STAGES) stage: CrmStage;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

export class AssignDto {
  @ValidateIf((_, v) => v !== null) @Matches(ID) ownerUserId: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

export class WonDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1e13)
  value?: number;
  @IsOptional() @Matches(CURRENCY) currency?: string;
  @IsOptional() @IsDateString() wonAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

export class LostDto {
  @IsIn(LOST_REASONS, { message: 'Select a lost reason.' }) reason: LostReason;
  @IsOptional() @IsString() @MaxLength(1000) details?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

export class ReopenDto {
  @IsIn(CRM_STAGES) stage: CrmStage;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class LogActivityDto {
  @IsIn(LOGGABLE_ACTIVITY_TYPES) type: LoggableActivityType;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) direction?:
    'INBOUND' | 'OUTBOUND';
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @Matches(ID) contactId?: string;
  @IsOptional() @IsString() @MaxLength(200) outcome?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  durationMinutes?: number;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
}

export class ActivitiesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CommentDto {
  @IsString()
  @MinLength(1, { message: 'Write a comment.' })
  @MaxLength(5000)
  body: string;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(2, { message: 'Enter a task title.' })
  @MaxLength(200)
  title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @Matches(ID) assignedToUserId?: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsIn(LEAD_PRIORITIES) priority?: LeadPriority;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID)
  assignedToUserId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() dueAt?:
    string | null;
  @IsOptional() @IsIn(LEAD_PRIORITIES) priority?: LeadPriority;
  @IsOptional() @IsIn(LEAD_TASK_STATUSES) status?: LeadTaskStatus;
}

export class TasksQueryDto {
  @IsOptional() @IsIn(['mine', 'all']) scope?: 'mine' | 'all';
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'ACTIVE'])
  status?: LeadTaskStatus | 'ACTIVE';
  @IsOptional() @Transform(toBool) @IsBoolean() overdue?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateReminderDto {
  @IsDateString({}, { message: 'Choose when to be reminded.' })
  remindAt: string;
  @IsOptional() @IsIn(LEAD_REMINDER_TYPES) type?: LeadReminderType;
  @IsString()
  @MinLength(2, { message: 'Enter a reminder message.' })
  @MaxLength(300)
  message: string;
  @IsOptional() @Matches(ID) taskId?: string;
  @IsOptional() @Matches(ID) userId?: string;
}

export class UpdateReminderDto {
  @IsOptional() @IsIn(['DISMISSED', 'CANCELLED', 'PENDING']) status?:
    'DISMISSED' | 'CANCELLED' | 'PENDING';
  @IsOptional() @IsDateString() remindAt?: string;
}

export class CreateTagDto {
  @IsString() @MinLength(1) @MaxLength(40) name: string;
  @IsOptional() @Matches(/^#[0-9a-f]{6}$/i) color?: string;
}

export class AttentionQueryDto {
  @IsOptional() @IsIn(['mine', 'all']) scope?: 'mine' | 'all';
}
