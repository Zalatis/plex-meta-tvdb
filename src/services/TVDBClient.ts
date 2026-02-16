/**
 * TheTVDB.com API Client (v4)
 * Documentation: https://github.com/thetvdb/v4-api
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import {
  TVDBSeries,
  TVDBSeriesExtended,
  TVDBSeason,
  TVDBSeasonExtended,
  TVDBEpisode,
  TVDBEpisodeExtended,
  TVDBSearchResult,
  TVDBSearchResponse,
  TVDBResponse,
  TVDBLoginResponse,
  TVDBArtwork,
} from '../types/tvdb';

export class TVDBClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseURL = 'https://api4.thetvdb.com/v4';
  private token: string | null = null;
  private tokenExpiry: Date | null = null;
  private defaultLanguage = (process.env.TVDB_LANGUAGE || 'eng').toLowerCase(); // ISO 639-2 code for English

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: this.baseURL,
    });

    // Add request interceptor for logging, token, and language
    this.client.interceptors.request.use(
      async (config) => {
        // Ensure we have a valid token (except for login endpoint)
        if (!config.url?.includes('/login')) {
          await this.ensureToken();
          config.headers.Authorization = `Bearer ${this.token}`;
        }

        // Set Accept-Language header to prefer English content
        config.headers['Accept-Language'] = this.defaultLanguage;

        const url = `${config.baseURL}${config.url}`;
        logger.info(`TVDB API Request: ${config.method?.toUpperCase()} ${url}`);
        return config;
      },
      (error) => {
        logger.error('TVDB API Request Error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.info(`TVDB API Response: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error(`TVDB API Error: ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
        } else {
          logger.error(`TVDB API Network Error: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Authenticate with TVDB API and get a token
   */
  private async login(): Promise<void> {
    const response = await this.client.post<TVDBLoginResponse>('/login', {
      apikey: this.apiKey,
    });

    this.token = response.data.data.token;
    // Token is valid for approximately 1 month, but we'll refresh after 24 hours to be safe
    this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    logger.info('TVDB API: Successfully authenticated');
  }

  /**
   * Ensure we have a valid token
   */
  private async ensureToken(): Promise<void> {
    if (!this.token || !this.tokenExpiry || new Date() >= this.tokenExpiry) {
      await this.login();
    }
  }

  /**
   * Search for TV series
   * Filters results to prefer entries with English translations
   */
  async searchSeries(query: string, options?: {
    year?: number;
    type?: string;
  }): Promise<TVDBSearchResult[]> {
    const params: Record<string, string> = {
      query,
      type: options?.type || 'series',
    };

    if (options?.year) {
      params.year = options.year.toString();
    }

    const response = await this.client.get<TVDBSearchResponse>('/search', { params });
    const results = response.data.data || [];

    // Filter to prioritize results that have English translations
    // Sort results: English-named entries first, then by default order
    const sortedResults = results.sort((a, b) => {
      const aHasEnglish = a.primary_language === lang ||
                          (a.translations && a.translations[lang]) ||
                          (a.overviews && a.overviews[lang]);
      const bHasEnglish = b.primary_language === lang ||
                          (b.translations && b.translations[lang]) ||
                          (b.overviews && b.overviews[lang]);

      if (aHasEnglish && !bHasEnglish) return -1;
      if (!aHasEnglish && bHasEnglish) return 1;
      return 0;
    });

    return sortedResults;
  }

  /**
   * Get series details with English translations applied
   * @param seriesId - TVDB series ID
   */
  async getSeriesDetails(seriesId: number, options?: {
    meta?: string; // 'translations', 'episodes', etc.
    language?: string; // Language code (default: 'eng')
  }): Promise<TVDBSeriesExtended> {
    const params: Record<string, string> = {};
    if (options?.meta) {
      params.meta = options.meta;
    }

    const response = await this.client.get<TVDBResponse<TVDBSeriesExtended>>(
      `/series/${seriesId}/extended`,
      { params }
    );

    const series = response.data.data;
    const language = options?.language || this.defaultLanguage;

    // Apply English translation to ensure English name and overview
    const translation = await this.getSeriesTranslation(seriesId, language);
    if (translation.name) {
      series.name = translation.name;
    }
    if (translation.overview) {
      series.overview = translation.overview;
    }

    return series;
  }

  /**
   * Get series with translations for a specific language
   */
  async getSeriesTranslation(seriesId: number, language: string): Promise<{ name: string; overview: string; language: string }> {
    try {
      const response = await this.client.get<TVDBResponse<{ name: string; overview: string; language: string }>>(
        `/series/${seriesId}/translations/${language}`
      );
      return response.data.data;
    } catch (error) {
      // Return empty translation if not found
      return { name: '', overview: '', language };
    }
  }

  /**
   * Get all artworks for a series
   */
  async getSeriesArtworks(seriesId: number, options?: {
    type?: number; // Artwork type filter
    lang?: string;
  }): Promise<TVDBArtwork[]> {
    const params: Record<string, string> = {};
    if (options?.type) {
      params.type = options.type.toString();
    }
    if (options?.lang) {
      params.lang = options.lang;
    }

    const response = await this.client.get<TVDBResponse<{ artworks: TVDBArtwork[] }>>(
      `/series/${seriesId}/artworks`,
      { params }
    );
    return response.data.data?.artworks || [];
  }

  /**
   * Get season details with English translations applied to episodes
   * @param seasonId - TVDB season ID
   */
  async getSeasonDetails(seasonId: number): Promise<TVDBSeasonExtended> {
    const response = await this.client.get<TVDBResponse<TVDBSeasonExtended>>(
      `/seasons/${seasonId}/extended`
    );

    const season = response.data.data;

    // Apply English translations to episodes
    if (season.episodes && season.episodes.length > 0) {
      const translationPromises = season.episodes.map(async (episode) => {
        const translation = await this.getEpisodeTranslation(episode.id, this.defaultLanguage);
        if (translation.name) {
          episode.name = translation.name;
        }
        if (translation.overview) {
          episode.overview = translation.overview;
        }
        return episode;
      });

      season.episodes = await Promise.all(translationPromises);
    }

    return season;
  }

  /**
   * Get all episodes for a series with English translations applied
   * @param seriesId - TVDB series ID
   * @param seasonType - Season type (default, dvd, absolute, etc.)
   */
  async getSeriesEpisodes(seriesId: number, options?: {
    seasonType?: string;
    season?: number;
    page?: number;
    applyTranslations?: boolean;
  }): Promise<{ episodes: TVDBEpisode[]; series: TVDBSeries }> {
    const seasonType = options?.seasonType || 'default';
    const params: Record<string, string> = {};

    if (options?.season !== undefined) {
      params.season = options.season.toString();
    }
    if (options?.page) {
      params.page = options.page.toString();
    }

    const response = await this.client.get<TVDBResponse<{ episodes: TVDBEpisode[]; series: TVDBSeries }>>(
      `/series/${seriesId}/episodes/${seasonType}`,
      { params }
    );

    const result = response.data.data;

    // Apply English translations to episodes if requested (default: true)
    if (options?.applyTranslations !== false && result.episodes && result.episodes.length > 0) {
      // Fetch English translations for all episodes in parallel
      const translationPromises = result.episodes.map(async (episode) => {
        const translation = await this.getEpisodeTranslation(episode.id, this.defaultLanguage);
        if (translation.name) {
          episode.name = translation.name;
        }
        if (translation.overview) {
          episode.overview = translation.overview;
        }
        return episode;
      });

      result.episodes = await Promise.all(translationPromises);
    }

    return result;
  }

  /**
   * Get episode details with English translations applied
   * @param episodeId - TVDB episode ID
   */
  async getEpisodeDetails(episodeId: number): Promise<TVDBEpisodeExtended> {
    const response = await this.client.get<TVDBResponse<TVDBEpisodeExtended>>(
      `/episodes/${episodeId}/extended`
    );

    const episode = response.data.data;

    // Apply English translation to ensure English name and overview
    const translation = await this.getEpisodeTranslation(episodeId, this.defaultLanguage);
    if (translation.name) {
      episode.name = translation.name;
    }
    if (translation.overview) {
      episode.overview = translation.overview;
    }

    return episode;
  }

  /**
   * Get episode translation
   */
  async getEpisodeTranslation(episodeId: number, language: string): Promise<{ name: string; overview: string; language: string }> {
    try {
      const response = await this.client.get<TVDBResponse<{ name: string; overview: string; language: string }>>(
        `/episodes/${episodeId}/translations/${language}`
      );
      return response.data.data;
    } catch (error) {
      return { name: '', overview: '', language };
    }
  }

  /**
   * Get series by remote ID (IMDB, TMDB)
   * Note: TVDB API v4 uses search with remote ID
   */
  async findSeriesByRemoteId(remoteId: string, source: 'imdb' | 'tmdb'): Promise<TVDBSearchResult[]> {
    // For IMDB IDs, search directly
    const response = await this.client.get<TVDBSearchResponse>('/search', {
      params: {
        query: remoteId,
        type: 'series',
      },
    });

    // Filter results to find matching remote ID
    const results = response.data.data || [];
    if (source === 'imdb') {
      return results.filter(r =>
        r.remote_ids?.some(rid => rid.id === remoteId && rid.sourceName === 'IMDB')
      );
    }
    return results;
  }

  /**
   * Get season by series ID and season number
   */
  async getSeasonByNumber(seriesId: number, seasonNumber: number, seasonType: string = 'default'): Promise<TVDBSeason | null> {
    const seriesDetails = await this.getSeriesDetails(seriesId);

    // First try to find by exact type match
    let season = seriesDetails.seasons?.find(
      s => s.number === seasonNumber && s.type.type === seasonType
    );

    // If not found and using 'default', try 'official' (TVDB's standard type)
    if (!season && seasonType === 'default') {
      season = seriesDetails.seasons?.find(
        s => s.number === seasonNumber && s.type.type === 'official'
      );
    }

    // Last resort: find any season with matching number
    if (!season) {
      season = seriesDetails.seasons?.find(s => s.number === seasonNumber);
    }

    return season || null;
  }

  /**
   * Get episode by series ID, season number, and episode number
   */
  async getEpisodeByNumber(
    seriesId: number,
    seasonNumber: number,
    episodeNumber: number,
    seasonType: string = 'default'
  ): Promise<TVDBEpisode | null> {
    const response = await this.getSeriesEpisodes(seriesId, {
      seasonType,
      season: seasonNumber,
    });

    return response.episodes?.find(ep => ep.number === episodeNumber) || null;
  }

  /**
   * Get episode by air date
   */
  async getEpisodeByAirDate(seriesId: number, airDate: string): Promise<TVDBEpisode | null> {
    // Fetch all episodes and find by air date
    let page = 0;
    const maxPages = 20; // Prevent infinite loops

    while (page < maxPages) {
      const response = await this.getSeriesEpisodes(seriesId, { page });
      const episodes = response.episodes || [];

      if (episodes.length === 0) break;

      const matchingEpisode = episodes.find(ep => ep.aired === airDate);
      if (matchingEpisode) {
        return matchingEpisode;
      }

      page++;
    }

    return null;
  }

  /**
   * Get season artworks
   */
  async getSeasonArtworks(seasonId: number): Promise<TVDBArtwork[]> {
    const seasonDetails = await this.getSeasonDetails(seasonId);
    return seasonDetails.artwork || [];
  }
}
