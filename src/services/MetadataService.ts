/**
 * Metadata Service - Handles metadata requests by ratingKey
 * See: docs/API Endpoints.md - Metadata Feature
 */

import { TVDBClient } from './TVDBClient';
import { TVDBMapper } from '../mappers/TVDBMapper';
import { MetadataResponse, ShowMetadata, SeasonMetadata, EpisodeMetadata, Image } from '../models/Metadata';
import { TV_PROVIDER_IDENTIFIER } from '../providers/TVProvider';
import { constructGuid, constructMetadataKey, constructMetadataKeyWithChildren } from '../utils/guid';

/**
 * Images response
 */
export interface ImagesResponse {
  MediaContainer: {
    offset: number;
    totalSize: number;
    identifier: string;
    size: number;
    Image: Image[];
  };
}

/**
 * Metadata service options
 */
export interface MetadataServiceOptions {
  language?: string;
  country?: string;
  includeChildren?: boolean;
  episodeOrder?: string; // Season type for alternative ordering
}

/**
 * Paging options
 */
export interface PagingOptions {
  containerSize?: number;
  containerStart?: number;
}

/**
 * Parsed ratingKey components
 */
interface ParsedRatingKey {
  type: 'show' | 'season' | 'episode';
  seriesId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  seasonType?: string;
}

export class MetadataService {
  private tvdbClient: TVDBClient;
  private mapper: TVDBMapper;

  constructor(apiKey: string) {
    this.tvdbClient = new TVDBClient(apiKey);
    this.mapper = new TVDBMapper();
  }

  /**
   * Localize season display titles before returning them to Plex.
   * Mirrors the behavior in TVDBMapper (e.g., "Season" -> "Saison" for French).
   */
  private localizeSeasonTitle(title: string): string {
    const lang = (process.env.TVDB_LANGUAGE || 'eng').toLowerCase();
    const isFrench =
      lang === 'fra';

    if (!isFrench) {
      return title;
    }

    return title.replace(/\bSeason\b/gi, 'Saison');
  }

  /**
   * Parse ratingKey to extract metadata type and IDs
   * Format examples:
   * - tvdb-show-15260
   * - tvdb-season-15260-1
   * - tvdb-season-15260-1-dvd (with season type)
   * - tvdb-episode-15260-1-5
   * - tvdb-episode-15260-1-5-dvd (with season type)
   */
  private parseRatingKey(ratingKey: string): ParsedRatingKey | null {
    // Show: tvdb-show-{id}
    const showMatch = ratingKey.match(/^tvdb-show-(\d+)$/);
    if (showMatch) {
      return {
        type: 'show',
        seriesId: parseInt(showMatch[1], 10),
      };
    }

    // Season with season type: tvdb-season-{seriesId}-{seasonNumber}-{seasonType}
    const seasonTypeMatch = ratingKey.match(/^tvdb-season-(\d+)-(\d+)-([a-z]+)$/);
    if (seasonTypeMatch) {
      return {
        type: 'season',
        seriesId: parseInt(seasonTypeMatch[1], 10),
        seasonNumber: parseInt(seasonTypeMatch[2], 10),
        seasonType: seasonTypeMatch[3],
      };
    }

    // Season: tvdb-season-{seriesId}-{seasonNumber}
    const seasonMatch = ratingKey.match(/^tvdb-season-(\d+)-(\d+)$/);
    if (seasonMatch) {
      return {
        type: 'season',
        seriesId: parseInt(seasonMatch[1], 10),
        seasonNumber: parseInt(seasonMatch[2], 10),
      };
    }

    // Episode with season type: tvdb-episode-{seriesId}-{seasonNumber}-{episodeNumber}-{seasonType}
    const episodeTypeMatch = ratingKey.match(/^tvdb-episode-(\d+)-(\d+)-(\d+)-([a-z]+)$/);
    if (episodeTypeMatch) {
      return {
        type: 'episode',
        seriesId: parseInt(episodeTypeMatch[1], 10),
        seasonNumber: parseInt(episodeTypeMatch[2], 10),
        episodeNumber: parseInt(episodeTypeMatch[3], 10),
        seasonType: episodeTypeMatch[4],
      };
    }

    // Episode: tvdb-episode-{seriesId}-{seasonNumber}-{episodeNumber}
    const episodeMatch = ratingKey.match(/^tvdb-episode-(\d+)-(\d+)-(\d+)$/);
    if (episodeMatch) {
      return {
        type: 'episode',
        seriesId: parseInt(episodeMatch[1], 10),
        seasonNumber: parseInt(episodeMatch[2], 10),
        episodeNumber: parseInt(episodeMatch[3], 10),
      };
    }

    return null;
  }

  /**
   * Get TV Show metadata by ratingKey
   */
  private async getShow(
    seriesId: number,
    options: MetadataServiceOptions
  ): Promise<MetadataResponse> {
    const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

    // Plex typically reads season posters from the show children listing.
    // TVDB's series details only include a single `season.image`, so when `includeChildren=1`
    // we enrich each season with `/seasons/{id}/extended` to get the full `artwork` list.
    let seriesForMapping = seriesDetails;
    if (options.includeChildren && seriesDetails.seasons && seriesDetails.seasons.length > 0) {
      const extendedSeasons = await Promise.all(
        seriesDetails.seasons.map(async (s) => {
          try {
            return await this.tvdbClient.getSeasonDetails(s.id);
          } catch {
            // Fall back to basic season object if extended fetch fails
            return s;
          }
        })
      );

      seriesForMapping = {
        ...seriesDetails,
        seasons: extendedSeasons as any,
      };
    }

    const showMetadata = this.mapper.mapSeries(seriesForMapping, {
      includeChildren: options.includeChildren,
      country: options.country,
    });

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [showMetadata],
      },
    };
  }

  /**
   * Get Season metadata by ratingKey
   */
  private async getSeason(
    seriesId: number,
    seasonNumber: number,
    options: MetadataServiceOptions,
    seasonType?: string
  ): Promise<MetadataResponse> {
    // Get series details first
    const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

    // Find the season
    const season = await this.tvdbClient.getSeasonByNumber(seriesId, seasonNumber, seasonType || 'default');

    if (!season) {
      throw new Error(`Season ${seasonNumber} not found for series ${seriesId}`);
    }

    // Always get extended season details so we have artwork for all posters/artworks
    const seasonDetails = await this.tvdbClient.getSeasonDetails(season.id);

    const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tvdb-show-${seriesId}`;

    const seasonMetadata = this.mapper.mapSeason(
      seasonDetails,
      seriesId,
      seriesDetails.name,
      showGuid,
      seriesDetails.image || undefined,
      { includeChildren: options.includeChildren }
    );

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [seasonMetadata],
      },
    };
  }

  /**
   * Get Episode metadata by ratingKey
   */
  private async getEpisode(
    seriesId: number,
    seasonNumber: number,
    episodeNumber: number,
    options: MetadataServiceOptions,
    seasonType?: string
  ): Promise<MetadataResponse> {
    // Get series details
    const seriesDetails = await this.tvdbClient.getSeriesDetails(seriesId);

    // Get episode
    const episode = await this.tvdbClient.getEpisodeByNumber(
      seriesId,
      seasonNumber,
      episodeNumber,
      seasonType || 'default'
    );

    if (!episode) {
      throw new Error(`Episode S${seasonNumber}E${episodeNumber} not found for series ${seriesId}`);
    }

    // Get extended episode details
    const episodeDetails = await this.tvdbClient.getEpisodeDetails(episode.id);

    const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tvdb-show-${seriesId}`;
    const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tvdb-season-${seriesId}-${seasonNumber}`;

    const rawSeasonTitle =
      (await this.tvdbClient.getSeasonByNumber(seriesId, seasonNumber, seasonType || 'default'))?.name ||
      `Season ${seasonNumber}`;
    const seasonTitle = this.localizeSeasonTitle(rawSeasonTitle);

    const episodeMetadata = this.mapper.mapEpisode(
      episodeDetails,
      seriesId,
      seriesDetails.name,
      showGuid,
      seasonTitle,
      seasonGuid,
      seriesDetails.image || undefined,
      undefined
    );

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [episodeMetadata],
      },
    };
  }

  /**
   * Get metadata by ratingKey
   * @param ratingKey - The ratingKey to fetch (e.g., "tvdb-show-15260")
   * @param options - Language, country, and includeChildren options
   */
  async getMetadata(
    ratingKey: string,
    options: MetadataServiceOptions = {}
  ): Promise<MetadataResponse> {
    const parsed = this.parseRatingKey(ratingKey);

    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    switch (parsed.type) {
      case 'show':
        return this.getShow(parsed.seriesId, options);
      case 'season':
        if (parsed.seasonNumber === undefined) {
          throw new Error(`Invalid season ratingKey: ${ratingKey}`);
        }
        return this.getSeason(parsed.seriesId, parsed.seasonNumber, options, parsed.seasonType);
      case 'episode':
        if (parsed.seasonNumber === undefined || parsed.episodeNumber === undefined) {
          throw new Error(`Invalid episode ratingKey: ${ratingKey}`);
        }
        return this.getEpisode(parsed.seriesId, parsed.seasonNumber, parsed.episodeNumber, options, parsed.seasonType);
      default:
        throw new Error(`Unsupported metadata type: ${parsed.type}`);
    }
  }

  /**
   * Get all images for an item by ratingKey
   * @param ratingKey - The ratingKey to fetch images for
   * @param options - Language options
   */
  async getImages(
    ratingKey: string,
    options: MetadataServiceOptions = {}
  ): Promise<ImagesResponse> {
    const parsed = this.parseRatingKey(ratingKey);

    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    const images: Image[] = [];

    switch (parsed.type) {
      case 'show': {
        const seriesDetails = await this.tvdbClient.getSeriesDetails(parsed.seriesId);
        const artworks = await this.tvdbClient.getSeriesArtworks(parsed.seriesId);

        images.push(...this.mapper.mapAllImages(artworks, seriesDetails.name));
        break;
      }

      case 'season': {
        if (parsed.seasonNumber === undefined) {
          throw new Error(`Invalid season ratingKey: ${ratingKey}`);
        }

        const seriesDetails = await this.tvdbClient.getSeriesDetails(parsed.seriesId);
        const season = await this.tvdbClient.getSeasonByNumber(
          parsed.seriesId,
          parsed.seasonNumber,
          parsed.seasonType || 'default'
        );

        if (season) {
          const seasonArtworks = await this.tvdbClient.getSeasonArtworks(season.id);
          const rawSeasonTitle = season.name || `Season ${parsed.seasonNumber}`;
          const seasonTitle = this.localizeSeasonTitle(rawSeasonTitle);
          images.push(...this.mapper.mapAllImages(seasonArtworks, `${seriesDetails.name} - ${seasonTitle}`));
        }
        break;
      }

      case 'episode': {
        if (parsed.seasonNumber === undefined || parsed.episodeNumber === undefined) {
          throw new Error(`Invalid episode ratingKey: ${ratingKey}`);
        }

        const seriesDetails = await this.tvdbClient.getSeriesDetails(parsed.seriesId);
        const episode = await this.tvdbClient.getEpisodeByNumber(
          parsed.seriesId,
          parsed.seasonNumber,
          parsed.episodeNumber,
          parsed.seasonType || 'default'
        );

        if (episode?.image) {
          images.push({
            type: 'snapshot',
            url: episode.image,
            alt: `${seriesDetails.name} - S${parsed.seasonNumber}E${parsed.episodeNumber}`,
          });
        }
        break;
      }

      default:
        throw new Error(`Unsupported metadata type for images: ${parsed.type}`);
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: images.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: images.length,
        Image: images,
      },
    };
  }

  /**
   * Get children of an item (Seasons for Shows, Episodes for Seasons)
   * @param ratingKey - The ratingKey to fetch children for
   * @param options - Language, country options
   * @param paging - Paging options (containerSize, containerStart)
   */
  async getChildren(
    ratingKey: string,
    options: MetadataServiceOptions = {},
    paging: PagingOptions = {}
  ): Promise<MetadataResponse> {
    const parsed = this.parseRatingKey(ratingKey);

    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    const containerSize = paging.containerSize ?? 20;
    const containerStart = paging.containerStart ?? 1;

    switch (parsed.type) {
      case 'show': {
        // Get show details with seasons
        const seriesDetails = await this.tvdbClient.getSeriesDetails(parsed.seriesId);

        const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tvdb-show-${parsed.seriesId}`;

        // Map all seasons (filter to default/official type)
        const allSeasons = seriesDetails.seasons
          ?.filter((s) => s.type.type === 'default' || s.type.type === 'official')
          .filter((s) => s.number >= 0)
          .map((season) =>
            this.mapper.mapSeason(
              season,
              parsed.seriesId,
              seriesDetails.name,
              showGuid,
              seriesDetails.image || undefined
            )
          ) || [];

        // Apply paging (containerStart is 1-based)
        const startIndex = containerStart - 1;
        const endIndex = startIndex + containerSize;
        const pagedSeasons = allSeasons.slice(startIndex, endIndex);

        return {
          MediaContainer: {
            offset: startIndex,
            totalSize: allSeasons.length,
            identifier: TV_PROVIDER_IDENTIFIER,
            size: pagedSeasons.length,
            Metadata: pagedSeasons,
          },
        };
      }

      case 'season': {
        if (parsed.seasonNumber === undefined) {
          throw new Error(`Invalid season ratingKey: ${ratingKey}`);
        }

        // Get series details and season details with episodes
        const seriesDetails = await this.tvdbClient.getSeriesDetails(parsed.seriesId);
        const season = await this.tvdbClient.getSeasonByNumber(
          parsed.seriesId,
          parsed.seasonNumber,
          parsed.seasonType || 'default'
        );

        if (!season) {
          throw new Error(`Season ${parsed.seasonNumber} not found`);
        }

        // Get extended season with episodes
        const seasonDetails = await this.tvdbClient.getSeasonDetails(season.id);

        const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tvdb-show-${parsed.seriesId}`;
        const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tvdb-season-${parsed.seriesId}-${parsed.seasonNumber}`;

        // Map all episodes
        const allEpisodes = seasonDetails.episodes?.map((episode) =>
          this.mapper.mapEpisode(
            episode,
            parsed.seriesId,
            seriesDetails.name,
            showGuid,
            season.name || `Season ${parsed.seasonNumber}`,
            seasonGuid,
            seriesDetails.image || undefined,
            season.image || undefined
          )
        ) || [];

        // Apply paging (containerStart is 1-based)
        const startIndex = containerStart - 1;
        const endIndex = startIndex + containerSize;
        const pagedEpisodes = allEpisodes.slice(startIndex, endIndex);

        return {
          MediaContainer: {
            offset: startIndex,
            totalSize: allEpisodes.length,
            identifier: TV_PROVIDER_IDENTIFIER,
            size: pagedEpisodes.length,
            Metadata: pagedEpisodes,
          },
        };
      }

      default:
        throw new Error(`Cannot get children for type: ${parsed.type}`);
    }
  }

  /**
   * Get grandchildren of an item (Episodes for Shows)
   * @param ratingKey - The ratingKey to fetch grandchildren for
   * @param options - Language, country options
   * @param paging - Paging options (containerSize, containerStart)
   */
  async getGrandchildren(
    ratingKey: string,
    options: MetadataServiceOptions = {},
    paging: PagingOptions = {}
  ): Promise<MetadataResponse> {
    const parsed = this.parseRatingKey(ratingKey);

    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    if (parsed.type !== 'show') {
      throw new Error(`Cannot get grandchildren for type: ${parsed.type}`);
    }

    const containerSize = paging.containerSize ?? 20;
    const containerStart = paging.containerStart ?? 1;

    // Get show details
    const seriesDetails = await this.tvdbClient.getSeriesDetails(parsed.seriesId);

    const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tvdb-show-${parsed.seriesId}`;

    // Fetch all episodes from all seasons
    const allEpisodes: EpisodeMetadata[] = [];

    // Get all regular seasons (number >= 1)
    const regularSeasons = seriesDetails.seasons?.filter(
      (s) => s.number >= 1 && (s.type.type === 'default' || s.type.type === 'official')
    ) || [];

    for (const season of regularSeasons) {
      const seasonDetails = await this.tvdbClient.getSeasonDetails(season.id);
        const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tvdb-season-${parsed.seriesId}-${season.number}`;

        const rawSeasonTitle = season.name || `Season ${season.number}`;
        const seasonTitle = this.localizeSeasonTitle(rawSeasonTitle);

        const episodes = seasonDetails.episodes?.map((episode) =>
          this.mapper.mapEpisode(
            episode,
            parsed.seriesId,
            seriesDetails.name,
            showGuid,
            seasonTitle,
            seasonGuid,
            seriesDetails.image || undefined,
            season.image || undefined
          )
        ) || [];

      allEpisodes.push(...episodes);
    }

    // Apply paging (containerStart is 1-based)
    const startIndex = containerStart - 1;
    const endIndex = startIndex + containerSize;
    const pagedEpisodes = allEpisodes.slice(startIndex, endIndex);

    return {
      MediaContainer: {
        offset: startIndex,
        totalSize: allEpisodes.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: pagedEpisodes.length,
        Metadata: pagedEpisodes,
      },
    };
  }
}
