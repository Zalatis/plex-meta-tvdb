/**
 * Maps TVDB API responses to Plex Metadata models
 */

import {
  ShowMetadata,
  SeasonMetadata,
  EpisodeMetadata,
  Image,
  Genre,
  Guid,
  Person,
  Rating,
  Network,
  Country,
  Studio,
  SeasonType,
} from '../models/Metadata';
import {
  TVDBSeries,
  TVDBSeriesExtended,
  TVDBSeason,
  TVDBSeasonExtended,
  TVDBEpisode,
  TVDBEpisodeExtended,
  TVDBCharacter,
  TVDBSeasonType,
  TVDBArtwork,
  TVDBArtworkType,
  TVDBRemoteIdType,
} from '../types/tvdb';
import { TV_PROVIDER_IDENTIFIER } from '../providers/TVProvider';
import { constructGuid, constructMetadataKey, constructMetadataKeyWithChildren, createExternalGuid } from '../utils/guid';

/**
 * Configuration for the mapper
 */
export interface MapperConfig {
  // TVDB provides full image URLs, so no base URL needed
}

export class TVDBMapper {
  constructor(_config?: MapperConfig) {
    // TVDB provides full image URLs, no configuration needed
  }

  /**
   * Localize season-related titles before returning them to Plex.
   * Currently: replace English "Season" with French "Saison" when TVDB_LANGUAGE is French.
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
   * Map TVDB artworks to Plex Image array
   * Only includes one image of each type
   */
  private mapImages(artworks: TVDBArtwork[] | null | undefined, title: string): Image[] | undefined {
    if (!artworks || artworks.length === 0) return undefined;

    const images: Image[] = [];

    // Poster (coverPoster) - only one
    const poster = artworks.find(a => a.type === TVDBArtworkType.POSTER);
    if (poster) {
      images.push({
        type: 'coverPoster',
        url: poster.image,
        alt: title,
      });
    }

    // Backdrop (background) - only one
    const background = artworks.find(a => a.type === TVDBArtworkType.BACKGROUND);
    if (background) {
      images.push({
        type: 'background',
        url: background.image,
        alt: title,
      });
    }

    // Clear logo - only one
    const clearLogo = artworks.find(a => a.type === TVDBArtworkType.CLEARLOGO);
    if (clearLogo) {
      images.push({
        type: 'clearLogo',
        url: clearLogo.image,
        alt: title,
      });
    }

    // Banner - use as background if no background available
    if (!background) {
      const banner = artworks.find(a => a.type === TVDBArtworkType.BANNER);
      if (banner) {
        images.push({
          type: 'background',
          url: banner.image,
          alt: title,
        });
      }
    }

    return images.length > 0 ? images : undefined;
  }

  /**
   * Map TVDB genres to Plex Genre array
   */
  private mapGenres(series: TVDBSeriesExtended): Genre[] | undefined {
    if (!series.genres || series.genres.length === 0) return undefined;

    return series.genres.map(genre => ({
      tag: genre.name,
    }));
  }

  /**
   * Map external IDs to Plex Guid array
   */
  private mapExternalGuids(series: TVDBSeriesExtended): Guid[] | undefined {
    const guids: Guid[] = [];

    // Always include TVDB ID
    guids.push({ id: createExternalGuid('tvdb', series.id) });

    // Add IMDB and TMDB IDs from remoteIds
    if (series.remoteIds) {
      const imdbRemote = series.remoteIds.find(r => r.type === TVDBRemoteIdType.IMDB);
      if (imdbRemote) {
        guids.push({ id: createExternalGuid('imdb', imdbRemote.id) });
      }

      const tmdbRemote = series.remoteIds.find(r => r.type === TVDBRemoteIdType.TMDB);
      if (tmdbRemote) {
        guids.push({ id: createExternalGuid('tmdb', tmdbRemote.id) });
      }
    }

    return guids.length > 0 ? guids : undefined;
  }

  /**
   * Map TVDB characters to Plex Role array
   * Limits to 1000 to avoid excessively large responses
   */
  private mapCast(characters: TVDBCharacter[] | null | undefined): Person[] | undefined {
    if (!characters || characters.length === 0) return undefined;

    // Filter to actor types and sort by sort order
    const actors = characters
      .filter(c => c.type === 3) // Type 3 = Actor
      .sort((a, b) => a.sort - b.sort);

    return actors.slice(0, 1000).map((member, index) => ({
      tag: member.personName,
      role: member.name, // Character name
      order: index + 1, // Plex uses 1-based ordering
      thumb: member.personImgURL || undefined,
    }));
  }

  /**
   * Map TVDB characters to crew arrays (Director, Producer, Writer)
   * Note: TVDB uses character types for crew roles
   */
  private mapCrew(characters: TVDBCharacter[] | null | undefined): {
    Director?: Person[];
    Producer?: Person[];
    Writer?: Person[];
  } {
    if (!characters || characters.length === 0) {
      return {};
    }

    const directors: Person[] = [];
    const producers: Person[] = [];
    const writers: Person[] = [];

    // TVDB character types:
    // 1 = Director
    // 2 = Writer  
    // 4 = Producer
    // 3 = Actor (handled separately)

    characters.forEach(member => {
      const person: Person = {
        tag: member.personName,
        thumb: member.personImgURL || undefined,
      };

      switch (member.type) {
        case 1: // Director
          directors.push(person);
          break;
        case 4: // Producer
          producers.push(person);
          break;
        case 2: // Writer
          writers.push(person);
          break;
      }
    });

    return {
      Director: directors.length > 0 ? directors : undefined,
      Producer: producers.length > 0 ? producers : undefined,
      Writer: writers.length > 0 ? writers : undefined,
    };
  }

  /**
   * Map TVDB ratings to Plex Rating array
   */
  private mapRatings(series: TVDBSeriesExtended): Rating[] | undefined {
    const ratings: Rating[] = [];

    if (series.score && series.score > 0) {
      ratings.push({
        image: 'thetvdb://image.rating',
        type: 'audience',
        value: series.score,
      });
    }

    return ratings.length > 0 ? ratings : undefined;
  }

  /**
   * Map TVDB networks to Plex Network array
   */
  private mapNetworks(series: TVDBSeriesExtended): Network[] | undefined {
    const networks: Network[] = [];

    if (series.originalNetwork) {
      networks.push({ tag: series.originalNetwork.name });
    }

    if (series.latestNetwork && series.latestNetwork.id !== series.originalNetwork?.id) {
      networks.push({ tag: series.latestNetwork.name });
    }

    return networks.length > 0 ? networks : undefined;
  }

  /**
   * Map TVDB production country to Plex Country array
   */
  private mapCountries(series: TVDBSeriesExtended): Country[] | undefined {
    if (!series.originalCountry) {
      return undefined;
    }

    // TVDB uses ISO country codes
    return [{ tag: series.originalCountry }];
  }

  /**
   * Map TVDB companies to Plex Studio array
   */
  private mapStudios(series: TVDBSeriesExtended): Studio[] | undefined {
    if (!series.companies || series.companies.length === 0) {
      return undefined;
    }

    return series.companies.map(company => ({
      tag: company.name,
    }));
  }

  /**
   * Get content rating for a specific country (defaults to US)
   */
  private getContentRating(series: TVDBSeriesExtended, country: string = 'US'): string | undefined {
    if (!series.contentRatings) return undefined;

    // Normalize country input - handle both 'US' and 'USA' variants
    const normalizedCountry = country.toUpperCase();
    const isUS = normalizedCountry === 'US' || normalizedCountry === 'USA';

    const rating = series.contentRatings.find(
      r => r.country?.toUpperCase() === normalizedCountry || 
           (isUS && r.country?.toUpperCase() === 'USA') ||
           (isUS && r.country?.toUpperCase() === 'US')
    );

    if (rating) {
      // For US content ratings, just return the rating name without country prefix
      return isUS ? rating.name : `${rating.country?.toLowerCase() || country.toLowerCase()}/${rating.name}`;
    }

    return undefined;
  }

  /**
   * Map TVDB Season Types to Plex SeasonType array
   */
  private mapSeasonTypes(seasonTypes: TVDBSeasonType[] | null | undefined): SeasonType[] | undefined {
    if (!seasonTypes || seasonTypes.length === 0) return undefined;

    return seasonTypes.map(st => ({
      id: st.id.toString(),
      source: 'tvdb',
      tag: st.name,
      title: st.alternateName || st.name,
    }));
  }

  /**
   * Map TVDB Season Type to short tag for ratingKey
   */
  private getSeasonTypeShortTag(seasonType: TVDBSeasonType | null | undefined): string {
    if (!seasonType) return 'default';

    const typeMap: { [key: string]: string } = {
      'default': 'default',
      'official': 'default',
      'dvd': 'dvd',
      'absolute': 'absolute',
      'alternate': 'alternate',
      'regional': 'regional',
    };

    return typeMap[seasonType.type.toLowerCase()] || seasonType.type.toLowerCase();
  }

  /**
   * Map TVDB Series to Plex ShowMetadata
   */
  mapSeries(series: TVDBSeriesExtended, options?: {
    includeChildren?: boolean;
    country?: string;
  }): ShowMetadata {
    const ratingKey = `tvdb-show-${series.id}`;

    const crew = this.mapCrew(series.characters);

    const metadata: ShowMetadata = {
      type: 'show',
      ratingKey,
      key: constructMetadataKeyWithChildren(ratingKey),
      guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'show', ratingKey),
      title: series.name,
      originallyAvailableAt: series.firstAired || '',
      year: series.firstAired ? new Date(series.firstAired).getFullYear() : undefined,
      summary: series.overview || undefined,
      thumb: series.image || undefined,
      art: series.artworks?.find(a => a.type === TVDBArtworkType.BACKGROUND)?.image,
      contentRating: this.getContentRating(series, options?.country),
      duration: series.averageRuntime ? series.averageRuntime * 60 * 1000 : undefined, // Convert minutes to milliseconds
      studio: series.originalNetwork?.name,
      Image: this.mapImages(series.artworks, series.name),
      Genre: this.mapGenres(series),
      Guid: this.mapExternalGuids(series),
      Country: this.mapCountries(series),
      Role: this.mapCast(series.characters),
      Director: crew.Director,
      Producer: crew.Producer,
      Writer: crew.Writer,
      Studio: this.mapStudios(series),
      Rating: this.mapRatings(series),
      Network: this.mapNetworks(series),
      SeasonType: this.mapSeasonTypes(series.seasonTypes),
    };

    // Add Children (seasons) if requested
    if (options?.includeChildren && series.seasons && series.seasons.length > 0) {
      const showGuid = metadata.guid;
      const showThumb = series.image || undefined;

      const seasonMetadata = series.seasons
        .filter(season => season.type.type === 'default' || season.type.type === 'official')
        .map(season => this.mapSeason(
          season,
          series.id,
          series.name,
          showGuid,
          showThumb
        ));

      metadata.Children = {
        size: seasonMetadata.length,
        Metadata: seasonMetadata,
      };
    }

    return metadata;
  }

  /**
   * Map TVDB Season to Plex SeasonMetadata
   */
  mapSeason(
    season: TVDBSeason | TVDBSeasonExtended,
    seriesId: number,
    showTitle: string,
    showGuid: string,
    showThumb?: string,
    options?: {
      includeChildren?: boolean;
    }
  ): SeasonMetadata {
    const seasonTypeShort = this.getSeasonTypeShortTag(season.type);
    const ratingKey = `tvdb-season-${seriesId}-${season.number}`;
    const parentRatingKey = `tvdb-show-${seriesId}`;

    const metadata: SeasonMetadata = {
      type: 'season',
      ratingKey,
      key: constructMetadataKeyWithChildren(ratingKey),
      guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'season', ratingKey),
      title: this.localizeSeasonTitle(season.name || `Season ${season.number}`),
      originallyAvailableAt: '', // TVDB seasons don't have air dates at the season level
      index: season.number,
      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: showGuid,
      parentType: 'show',
      parentTitle: showTitle,
      parentThumb: showThumb,
      thumb: season.image || undefined,
    };

    // Add external IDs
    const guids: Guid[] = [];
    guids.push({ id: createExternalGuid('tvdb', season.id) });
    metadata.Guid = guids;

    // Add images
    if (season.image) {
      metadata.Image = [{
        type: 'coverPoster',
        url: season.image,
        alt: this.localizeSeasonTitle(season.name || `Season ${season.number}`),
      }];
    }

    // Handle extended season with artwork
    const extendedSeason = season as TVDBSeasonExtended;
    if (extendedSeason.artwork && extendedSeason.artwork.length > 0) {
      metadata.Image = this.mapImages(
        extendedSeason.artwork,
        this.localizeSeasonTitle(season.name || `Season ${season.number}`)
      );
    }

    // Add Children (episodes) if requested and available
    if (options?.includeChildren && extendedSeason.episodes && extendedSeason.episodes.length > 0) {
      const seasonGuid = metadata.guid;
      const seasonThumb = season.image || undefined;

      const episodeMetadata = extendedSeason.episodes.map(episode => 
        this.mapEpisode(
          episode,
          seriesId,
          showTitle,
          showGuid,
          this.localizeSeasonTitle(season.name || `Season ${season.number}`),
          seasonGuid,
          showThumb,
          seasonThumb
        )
      );

      metadata.Children = {
        size: episodeMetadata.length,
        Metadata: episodeMetadata,
      };
    }

    return metadata;
  }

  /**
   * Map TVDB Episode to Plex EpisodeMetadata
   */
  mapEpisode(
    episode: TVDBEpisode | TVDBEpisodeExtended,
    seriesId: number,
    showTitle: string,
    showGuid: string,
    seasonTitle: string,
    seasonGuid: string,
    showThumb?: string,
    seasonThumb?: string
  ): EpisodeMetadata {
    const ratingKey = `tvdb-episode-${seriesId}-${episode.seasonNumber}-${episode.number}`;
    const parentRatingKey = `tvdb-season-${seriesId}-${episode.seasonNumber}`;
    const grandparentRatingKey = `tvdb-show-${seriesId}`;

    const crew = this.mapCrew(episode.characters);

    const metadata: EpisodeMetadata = {
      type: 'episode',
      ratingKey,
      key: constructMetadataKey(ratingKey),
      guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'episode', ratingKey),
      title: episode.name || `Episode ${episode.number}`,
      originallyAvailableAt: episode.aired || '',
      year: episode.aired ? new Date(episode.aired).getFullYear() : undefined,
      summary: episode.overview || undefined,
      thumb: episode.image || undefined,
      duration: episode.runtime ? episode.runtime * 60 * 1000 : undefined, // Convert minutes to milliseconds
      index: episode.number,
      parentIndex: episode.seasonNumber,
      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: seasonGuid,
      parentType: 'season',
      parentTitle: seasonTitle,
      parentThumb: seasonThumb,
      grandparentRatingKey,
      grandparentKey: constructMetadataKey(grandparentRatingKey),
      grandparentGuid: showGuid,
      grandparentType: 'show',
      grandparentTitle: showTitle,
      grandparentThumb: showThumb,
    };

    // Add snapshot image
    if (episode.image) {
      metadata.Image = [{
        type: 'snapshot',
        url: episode.image,
        alt: episode.name || `Episode ${episode.number}`,
      }];
    }

    // Add external IDs
    const guids: Guid[] = [];
    guids.push({ id: createExternalGuid('tvdb', episode.id) });

    // Add IMDB ID if available
    if (episode.remoteIds) {
      const imdbRemote = episode.remoteIds.find(r => r.type === TVDBRemoteIdType.IMDB);
      if (imdbRemote) {
        guids.push({ id: createExternalGuid('imdb', imdbRemote.id) });
      }
    }
    metadata.Guid = guids;

    // Add cast and crew
    metadata.Role = this.mapCast(episode.characters);
    metadata.Director = crew.Director;
    metadata.Producer = crew.Producer;
    metadata.Writer = crew.Writer;

    return metadata;
  }

  /**
   * Map TVDB artworks to all available Plex images
   */
  mapAllImages(artworks: TVDBArtwork[] | null | undefined, title: string): Image[] {
    if (!artworks || artworks.length === 0) return [];

    const images: Image[] = [];

    artworks.forEach(artwork => {
      let imageType: 'coverPoster' | 'background' | 'clearLogo' | 'backgroundSquare' | 'snapshot';
      switch (artwork.type) {
        case TVDBArtworkType.POSTER:
          imageType = 'coverPoster';
          break;
        case TVDBArtworkType.BACKGROUND:
          imageType = 'background';
          break;
        case TVDBArtworkType.CLEARLOGO:
          imageType = 'clearLogo';
          break;
        case TVDBArtworkType.BANNER:
          // Map banner to background since banner type doesn't exist
          imageType = 'background';
          break;
        default:
          return; // Skip unknown types
      }

      images.push({
        type: imageType,
        url: artwork.image,
        alt: title,
      });
    });

    return images;
  }
}
