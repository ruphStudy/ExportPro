import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ACTION_TRIGGERS, AUTOMATION_ACTIONS } from '@exportpro/types';

const nullable = () => ValidateIf((_, v) => v !== null);

export class MessageDto {
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  /** A predefined quick command (always handled by the deterministic interpreter). */
  @IsOptional() @IsString() @MaxLength(300) command?: string;
  @IsOptional() @IsString() @MaxLength(40) conversationId?: string;
}

export class HistoryQueryDto {
  @IsOptional() @IsString() @MaxLength(40) conversationId?: string;
}

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class ActionQueryDto {
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(60) priority?: string;
  @IsOptional() @IsString() @MaxLength(30) module?: string;
  @IsOptional() @IsString() @MaxLength(40) assignee?: string;
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsIn(['today', 'overdue', 'upcoming', 'critical']) due?:
    'today' | 'overdue' | 'upcoming' | 'critical';
  @IsOptional() @IsIn(['true', 'false']) refresh?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class UpdateActionDto extends VersionDto {
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS']) state?: 'OPEN' | 'IN_PROGRESS';
  @IsOptional() @nullable() @IsString() @MaxLength(40) assignedToUserId?:
    string | null;
}

export class CloseActionDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class SnoozeDto extends VersionDto {
  @IsIn(['tomorrow', '3d', '1w', 'custom']) preset: string;
  @IsOptional() @IsDateString() until?: string;
}

export class ConditionsDto {
  @IsOptional() @IsNumber() @Min(0) minDaysOverdue?: number;
  @IsOptional() @IsNumber() @Min(0) minAmount?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(365) noReplyDays?: number;
  @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL']) minSeverity?:
    'INFO' | 'WARNING' | 'CRITICAL';
  @IsOptional() @IsNumber() @Min(0) @Max(365) daysBeforeExpiry?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(365) minEtaDelayDays?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) minScore?: number;
  @IsOptional()
  @IsArray()
  @IsIn(['APPROACHING', 'IN_WINDOW', 'PAST_WINDOW'], { each: true })
  windowStates?: ('APPROACHING' | 'IN_WINDOW' | 'PAST_WINDOW')[];
}

export class ActionConfigDto {
  @IsOptional() @IsIn(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) priority?:
    'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  @IsOptional() @nullable() @IsString() @MaxLength(40) assigneeUserId?:
    string | null;
  @IsOptional() @IsInt() @Min(0) @Max(60) taskDueDays?: number;
}

export class RuleDto extends VersionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(ACTION_TRIGGERS) triggerType?: string;
  @IsOptional() @IsIn(AUTOMATION_ACTIONS) actionType?: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConditionsDto)
  conditions?: ConditionsDto;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ActionConfigDto)
  actionConfig?: ActionConfigDto;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(60) template?: string;
}

export class RunsQueryDto {
  @IsOptional() @IsString() @MaxLength(40) ruleId?: string;
  @IsOptional()
  @IsIn(['EXECUTED', 'SKIPPED', 'FAILED', 'PENDING_APPROVAL'])
  status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class EvaluateDto {
  @IsOptional() @IsBoolean() force?: boolean;
}

export class RangeQueryDto {
  @IsOptional()
  @IsIn(['today', '7d', '30d', 'month', 'quarter', 'year', 'custom'])
  range?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
