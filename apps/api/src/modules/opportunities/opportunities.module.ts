import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SavedSearchesController } from './saved-searches.controller';
import { WatchlistController } from './watchlist.controller';
import { OpportunitiesController } from './opportunities.controller';
import { ScoringService } from './scoring.service';
import { OpportunityMapperService } from './opportunity-mapper.service';
import { OpportunitiesService } from './opportunities.service';
import { WatchlistService } from './watchlist.service';
import { SavedSearchesService } from './saved-searches.service';

@Module({
  imports: [AuditModule],
  // Order matters: literal-path controllers (saved-searches, watchlist)
  // must be registered before OpportunitiesController's ":id" route.
  controllers: [
    SavedSearchesController,
    WatchlistController,
    OpportunitiesController,
  ],
  providers: [
    ScoringService,
    OpportunityMapperService,
    OpportunitiesService,
    WatchlistService,
    SavedSearchesService,
  ],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
