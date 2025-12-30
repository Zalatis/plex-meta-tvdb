/**
 * Match Service - Handles matching requests for TV shows, seasons, and episodes
 * See: docs/API Endpoints.md - Match Feature
 */

import { TVDBClient } from './TVDBClient';
import { TVDBMapper } from '../mappers/TVDBMapper';
import { MetadataResponse, ShowMetadata, SeasonMetadata, EpisodeMetadata } from '../models/Metadata';
import { TV_PROVIDER_IDENTIFIER } from '../providers/TVProvider';

/**
 * Match request body parameters
 */
export interface MatchRequest {
  type: number; // 2=show, 3=season, 4=episode
  title?: string;
  parentTitle?: string; // For seasons
  grandparentTitle?: string; // For episodes
  year?: number;
  guid?: string; // External ID (e.g., "tvdb://12345", "imdb://tt1234567")
  index?: number; // Season number or episode number
  parentIndex?: number; // Season number for episodes
  date?: string; // Air date for episode matching (YYYY-MM-DD format)
  filename?: string;
  manual?: number; // 0 or 1
  includeAdult?: number; // 0 or 1
  includeChildren?: number; // 0 or 1
  episodeOrder?: string; // Season type for alternative ordering
}

/**
 * Match service options
 */
export interface MatchServiceOptions {
  language?: string;
  country?: string;
}

export class MatchService {
  private tvdbClient: TVDBClient;
  private mapper: TVDBMapper;

  constructor(apiKey: string) {
    this.tvdbClient = new TVDBClient(apiKey);
    this.mapper = new TVDBMapper();
  }

  /**
   * Parse external GUID to extract provider and ID
   */
  private parseExternalGuid(guid: string): { provider: string; id: string } | null {
    const match = guid.match(/^([^:]+):\/\/(.+)$/);
    if (!match) return null;

    return {
      provider: match[1],
      id: match[2],
    };
  }

  /**
   * Extract year from title if present
   * Matches patterns like "Title (1998)", "Title [1998]", "Title - 1998"
   * Returns the cleaned title and extracted year
   */
  private parseYearFromTitle(title: string): { cleanTitle: string; year: number | undefined } {
    // Match year in parentheses: "Cowboy Bebop (1998)"
    const parenMatch = title.match(/^(.+?)\s*\((\d{4})\)\s*$/);
    if (parenMatch) {
      const year = parseInt(parenMatch[2], 10);
      // Only accept reasonable years (1900-2100)
      if (year >= 1900 && year <= 2100) {
        return { cleanTitle: parenMatch[1].trim(), year };
      }
    }

    // Match year in brackets: "Cowboy Bebop [1998]"
    const bracketMatch = title.match(/^(.+?)\s*\[(\d{4})\]\s*$/);
    if (bracketMatch) {
      const year = parseInt(bracketMatch[2], 10);
      if (year >= 1900 && year <= 2100) {
        return { cleanTitle: bracketMatch[1].trim(), year };
      }
    }

    // Match year after dash: "Cowboy Bebop - 1998"
    const dashMatch = title.match(/^(.+?)\s*-\s*(\d{4})\s*$/);
    if (dashMatch) {
      const year = parseInt(dashMatch[2], 10);
      if (year >= 1900 && year <= 2100) {
        return { cleanTitle: dashMatch[1].trim(), year };
      }
    }

    // No year found
    return { cleanTitle: title, year: undefined };
  }

  /**
   * Match TV Show
   */
  private async matchShow(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    let matches: ShowMetadata[] = [];

    // Try to match by external ID first
    if (request.guid) {
      const parsed = this.parseExternalGuid(request.guid);
      if (parsed) {
        try {
          // If it's a TVDB ID, use it directly
          if (parsed.provider === 'tvdb') {
            const seriesId = parseInt(parsed.id, 10);
            const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

            matches.push(this.mapper.mapSeries(seriesDetails, {
              includeChildren: request.includeChildren === 1,
              country: options.country,
            }));
          }
          // For IMDB IDs, search by remote ID
          else if (parsed.provider === 'imdb') {
            const searchResults = await this.tvdbClient.findSeriesByRemoteId(parsed.id, 'imdb');

            if (searchResults.length > 0) {
              const seriesId = parseInt(searchResults[0].tvdb_id, 10);
              const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

              matches.push(this.mapper.mapSeries(seriesDetails, {
                includeChildren: request.includeChildren === 1,
                country: options.country,
              }));
            }
          }
          // For TMDB IDs, search by remote ID
          else if (parsed.provider === 'tmdb') {
            const searchResults = await this.tvdbClient.findSeriesByRemoteId(parsed.id, 'tmdb');

            if (searchResults.length > 0) {
              const seriesId = parseInt(searchResults[0].tvdb_id, 10);
              const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

              matches.push(this.mapper.mapSeries(seriesDetails, {
                includeChildren: request.includeChildren === 1,
                country: options.country,
              }));
            }
          }
        } catch (error) {
          // Fall through to title search
        }
      }
    }

    // If no match by GUID, search by title
    if (matches.length === 0 && request.title) {
      // Extract year from title if present (e.g., "Cowboy Bebop (1998)")
      const { cleanTitle, year: extractedYear } = this.parseYearFromTitle(request.title);
      
      // Use explicitly provided year, or fall back to extracted year from title
      const searchYear = request.year || extractedYear;
      
      const searchResults = await this.tvdbClient.searchSeries(cleanTitle, {
        year: searchYear,
      });

      // Get detailed info for the top result(s)
      const limit = request.manual === 1 ? Math.min(5, searchResults.length) : Math.min(1, searchResults.length);

      for (let i = 0; i < limit; i++) {
        try {
          const seriesId = parseInt(searchResults[i].tvdb_id, 10);
          const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

          matches.push(this.mapper.mapSeries(seriesDetails, {
            includeChildren: request.includeChildren === 1,
            country: options.country,
          }));
        } catch (error) {
          // Skip this result if details can't be fetched
          continue;
        }
      }
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: matches.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: matches.length,
        Metadata: matches,
      },
    };
  }

  /**
   * Match Season
   */
  private async matchSeason(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    let matches: SeasonMetadata[] = [];

    if (!request.parentTitle || request.index === undefined) {
      return {
        MediaContainer: {
          offset: 0,
          totalSize: 0,
          identifier: TV_PROVIDER_IDENTIFIER,
          size: 0,
          Metadata: [],
        },
      };
    }

    // Extract year from parentTitle if present (e.g., "Cowboy Bebop (1998)")
    const { cleanTitle: cleanParentTitle, year: extractedYear } = this.parseYearFromTitle(request.parentTitle);
    
    // Use explicitly provided year, or fall back to extracted year from title
    const searchYear = request.year || extractedYear;
    
    // First, find the TV show
    const searchResults = await this.tvdbClient.searchSeries(cleanParentTitle, {
      year: searchYear,
    });

    if (searchResults.length === 0) {
      return {
        MediaContainer: {
          offset: 0,
          totalSize: 0,
          identifier: TV_PROVIDER_IDENTIFIER,
          size: 0,
          Metadata: [],
        },
      };
    }

    // Get the series details
    const seriesId = parseInt(searchResults[0].tvdb_id, 10);
    const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

    // Get the specific season
    try {
      const season = await this.tvdbClient.getSeasonByNumber(seriesId, request.index);

      if (season) {
        const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tvdb-show-${seriesId}`;

        const seasonMetadata = this.mapper.mapSeason(
          season,
          seriesId,
          seriesDetails.name,
          showGuid,
          seriesDetails.image || undefined,
          { includeChildren: request.includeChildren === 1 }
        );

        matches.push(seasonMetadata);
      }
    } catch (error) {
      // Season not found
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: matches.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: matches.length,
        Metadata: matches,
      },
    };
  }

  /**
   * Match Episode
   */
  private async matchEpisode(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    let matches: EpisodeMetadata[] = [];

    // Validate that we have either (index + parentIndex) or date
    const hasIndexes = request.index !== undefined && request.parentIndex !== undefined;
    const hasDate = request.date !== undefined;

    if (!request.grandparentTitle || (!hasIndexes && !hasDate)) {
      // Bad request - need either indexes or date
      throw new Error('Episode matching requires either (index + parentIndex) or date parameter');
    }

    // Extract year from grandparentTitle if present (e.g., "Cowboy Bebop (1998)")
    const { cleanTitle: cleanGrandparentTitle, year: extractedYear } = this.parseYearFromTitle(request.grandparentTitle);
    
    // Use explicitly provided year, or fall back to extracted year from title
    const searchYear = request.year || extractedYear;
    
    // First, find the TV show
    const searchResults = await this.tvdbClient.searchSeries(cleanGrandparentTitle, {
      year: searchYear,
    });

    if (searchResults.length === 0) {
      return {
        MediaContainer: {
          offset: 0,
          totalSize: 0,
          identifier: TV_PROVIDER_IDENTIFIER,
          size: 0,
          Metadata: [],
        },
      };
    }

    // Get the series details
    const seriesId = parseInt(searchResults[0].tvdb_id, 10);
    const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

    // Match by index (season/episode number)
    if (hasIndexes) {
      try {
        const episode = await this.tvdbClient.getEpisodeByNumber(
          seriesId,
          request.parentIndex!,
          request.index!
        );

        if (episode) {
          const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tvdb-show-${seriesId}`;
          const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tvdb-season-${seriesId}-${request.parentIndex}`;

          const episodeMetadata = this.mapper.mapEpisode(
            episode,
            seriesId,
            seriesDetails.name,
            showGuid,
            `Season ${request.parentIndex}`,
            seasonGuid,
            seriesDetails.image || undefined,
            undefined
          );

          matches.push(episodeMetadata);
        }
      } catch (error) {
        // Episode not found
      }
    }
    // Match by air date
    else if (hasDate) {
      try {
        const episode = await this.tvdbClient.getEpisodeByAirDate(seriesId, request.date!);

        if (episode) {
          const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tvdb-show-${seriesId}`;
          const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tvdb-season-${seriesId}-${episode.seasonNumber}`;

          const episodeMetadata = this.mapper.mapEpisode(
            episode,
            seriesId,
            seriesDetails.name,
            showGuid,
            `Season ${episode.seasonNumber}`,
            seasonGuid,
            seriesDetails.image || undefined,
            undefined
          );

          matches.push(episodeMetadata);
        }
      } catch (error) {
        // Episode not found
      }
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: matches.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: matches.length,
        Metadata: matches,
      },
    };
  }

  /**
   * Main match handler
   */
  async match(
    request: MatchRequest,
    options: MatchServiceOptions = {}
  ): Promise<MetadataResponse> {
    switch (request.type) {
      case 2: // Show
        return this.matchShow(request, options);
      case 3: // Season
        return this.matchSeason(request, options);
      case 4: // Episode
        return this.matchEpisode(request, options);
      default:
        throw new Error(`Unsupported metadata type: ${request.type}`);
    }
  }
}
