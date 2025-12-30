/**
 * TV Provider Routes
 */

import { Router, Request, Response } from 'express';
import { getTVProviderResponse } from '../providers/TVProvider';
import { MatchService, MatchRequest } from '../services/MatchService';
import { MetadataService } from '../services/MetadataService';
import { config } from '../config/env';
import { API_PATHS } from '../constants';

const router = Router();

// Initialize services (will be reused across requests)
let matchService: MatchService | null = null;
let metadataService: MetadataService | null = null;

function getMatchService(): MatchService {
  if (!matchService) {
    matchService = new MatchService(config.tvdb.apiKey);
  }
  return matchService;
}

function getMetadataService(): MetadataService {
  if (!metadataService) {
    metadataService = new MetadataService(config.tvdb.apiKey);
  }
  return metadataService;
}

/**
 * @openapi
 * /tv:
 *   get:
 *     tags:
 *       - Provider
 *     summary: Get MediaProvider definition
 *     description: Returns the MediaProvider definition for TV shows including supported types and features
 *     responses:
 *       200:
 *         description: MediaProvider definition
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 MediaProvider:
 *                   type: object
 *                   properties:
 *                     identifier:
 *                       type: string
 *                       example: tv.plex.agents.custom.example.thetvdb.tv
 *                     title:
 *                       type: string
 *                       example: TheTVDB Example TV Provider
 *                     version:
 *                       type: string
 *                       example: 1.0.0
 *                     Types:
 *                       type: array
 *                       items:
 *                         type: object
 *                     Feature:
 *                       type: array
 *                       items:
 *                         type: object
 */
router.get('/', (_req: Request, res: Response) => {
  const providerResponse = getTVProviderResponse();
  res.json(providerResponse);
});

/**
 * @openapi
 * /tv/library/metadata/{ratingKey}/images:
 *   get:
 *     tags:
 *       - Metadata
 *     summary: Get all images for an item
 *     description: Returns all available image assets for a specific item (show, season, or episode)
 *     parameters:
 *       - in: path
 *         name: ratingKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The ratingKey of the item
 *         examples:
 *           show:
 *             value: tvdb-show-15260
 *             summary: TV Show
 *           season:
 *             value: tvdb-season-15260-1
 *             summary: Season
 *           episode:
 *             value: tvdb-episode-15260-1-5
 *             summary: Episode
 *       - in: header
 *         name: X-Plex-Language
 *         schema:
 *           type: string
 *           example: en-US
 *         description: Language for metadata
 *     responses:
 *       200:
 *         description: Images response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 MediaContainer:
 *                   type: object
 *                   properties:
 *                     offset:
 *                       type: number
 *                     totalSize:
 *                       type: number
 *                     identifier:
 *                       type: string
 *                     size:
 *                       type: number
 *                     Image:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                           url:
 *                             type: string
 *                           alt:
 *                             type: string
 *       500:
 *         description: Internal server error
 */
router.get(`${API_PATHS.LIBRARY_METADATA}/:ratingKey/images`, async (req: Request, res: Response) => {
  try {
    const { ratingKey } = req.params;

    // Get language from headers or query params
    const language = (req.headers['x-plex-language'] as string) ||
                    (req.query['X-Plex-Language'] as string) ||
                    'en-US';

    // Get images
    const service = getMetadataService();
    const result = await service.getImages(ratingKey, { language });

    res.json(result);
  } catch (error) {
    console.error('Images error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @openapi
 * /tv/library/metadata/{ratingKey}:
 *   get:
 *     tags:
 *       - Metadata
 *     summary: Get metadata by ratingKey
 *     description: Returns metadata for a specific item (show, season, or episode) by its ratingKey
 *     parameters:
 *       - in: path
 *         name: ratingKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The ratingKey of the item (e.g., "tvdb-show-15260", "tvdb-season-15260-1", "tvdb-episode-15260-1-5")
 *         examples:
 *           show:
 *             value: tvdb-show-15260
 *             summary: TV Show
 *           season:
 *             value: tvdb-season-15260-1
 *             summary: Season
 *           episode:
 *             value: tvdb-episode-15260-1-5
 *             summary: Episode
 *       - in: query
 *         name: includeChildren
 *         schema:
 *           type: string
 *           enum: ['0', '1']
 *         description: Include child items (seasons for shows, episodes for seasons)
 *       - in: header
 *         name: X-Plex-Language
 *         schema:
 *           type: string
 *           example: en-US
 *         description: Language for metadata
 *       - in: header
 *         name: X-Plex-Country
 *         schema:
 *           type: string
 *           example: US
 *         description: Country for content ratings
 *     responses:
 *       200:
 *         description: Metadata response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 MediaContainer:
 *                   type: object
 *                   properties:
 *                     offset:
 *                       type: number
 *                     totalSize:
 *                       type: number
 *                     identifier:
 *                       type: string
 *                     size:
 *                       type: number
 *                     Metadata:
 *                       type: array
 *                       items:
 *                         type: object
 *       500:
 *         description: Internal server error
 */
router.get(`${API_PATHS.LIBRARY_METADATA}/:ratingKey`, async (req: Request, res: Response) => {
  try {
    const { ratingKey } = req.params;

    // Get language and country from headers or query params
    const language = (req.headers['x-plex-language'] as string) ||
                    (req.query['X-Plex-Language'] as string) ||
                    'en-US';
    const country = (req.headers['x-plex-country'] as string) ||
                   (req.query['X-Plex-Country'] as string) ||
                   'US';
    const includeChildren = req.query.includeChildren === '1';
    const episodeOrder = req.query.episodeOrder as string | undefined;

    // Get metadata
    const service = getMetadataService();
    const result = await service.getMetadata(ratingKey, {
      language,
      country,
      includeChildren,
      episodeOrder,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @openapi
 * /tv/library/metadata/{ratingKey}/children:
 *   get:
 *     tags:
 *       - Metadata
 *     summary: Get children of an item
 *     description: Returns child items with paging support. For shows, returns seasons. For seasons, returns episodes.
 *     parameters:
 *       - in: path
 *         name: ratingKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The ratingKey of the parent item
 *         examples:
 *           show:
 *             value: tvdb-show-15260
 *             summary: TV Show (returns seasons)
 *           season:
 *             value: tvdb-season-15260-1
 *             summary: Season (returns episodes)
 *       - in: header
 *         name: X-Plex-Language
 *         schema:
 *           type: string
 *           example: en-US
 *         description: Language for metadata
 *       - in: header
 *         name: X-Plex-Country
 *         schema:
 *           type: string
 *           example: US
 *         description: Country for content ratings
 *       - in: header
 *         name: X-Plex-Container-Size
 *         schema:
 *           type: number
 *           default: 20
 *         description: Maximum number of items to return
 *       - in: header
 *         name: X-Plex-Container-Start
 *         schema:
 *           type: number
 *           default: 1
 *         description: Starting index (1-based)
 *     responses:
 *       200:
 *         description: Paged children response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 MediaContainer:
 *                   type: object
 *                   properties:
 *                     offset:
 *                       type: number
 *                     totalSize:
 *                       type: number
 *                     identifier:
 *                       type: string
 *                     size:
 *                       type: number
 *                     Metadata:
 *                       type: array
 *                       items:
 *                         type: object
 *       500:
 *         description: Internal server error
 */
router.get(`${API_PATHS.LIBRARY_METADATA}/:ratingKey/children`, async (req: Request, res: Response) => {
  try {
    const { ratingKey } = req.params;

    // Get language and country from headers or query params
    const language = (req.headers['x-plex-language'] as string) ||
                    (req.query['X-Plex-Language'] as string) ||
                    'en-US';
    const country = (req.headers['x-plex-country'] as string) ||
                   (req.query['X-Plex-Country'] as string) ||
                   'US';
    const episodeOrder = req.query.episodeOrder as string | undefined;

    // Get paging parameters (default: size=20, start=1)
    const containerSize = parseInt(
      (req.headers['x-plex-container-size'] as string) ||
      (req.query['X-Plex-Container-Size'] as string) ||
      '20',
      10
    );
    const containerStart = parseInt(
      (req.headers['x-plex-container-start'] as string) ||
      (req.query['X-Plex-Container-Start'] as string) ||
      '1',
      10
    );

    // Get children
    const service = getMetadataService();
    const result = await service.getChildren(
      ratingKey,
      { language, country, episodeOrder },
      { containerSize, containerStart }
    );

    res.json(result);
  } catch (error) {
    console.error('Children error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @openapi
 * /tv/library/metadata/{ratingKey}/grandchildren:
 *   get:
 *     tags:
 *       - Metadata
 *     summary: Get grandchildren of an item
 *     description: Returns grandchild items with paging support. For shows, returns all episodes across all seasons.
 *     parameters:
 *       - in: path
 *         name: ratingKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The ratingKey of the grandparent item
 *         examples:
 *           show:
 *             value: tvdb-show-15260
 *             summary: TV Show (returns all episodes)
 *       - in: header
 *         name: X-Plex-Language
 *         schema:
 *           type: string
 *           example: en-US
 *         description: Language for metadata
 *       - in: header
 *         name: X-Plex-Country
 *         schema:
 *           type: string
 *           example: US
 *         description: Country for content ratings
 *       - in: header
 *         name: X-Plex-Container-Size
 *         schema:
 *           type: number
 *           default: 20
 *         description: Maximum number of items to return
 *       - in: header
 *         name: X-Plex-Container-Start
 *         schema:
 *           type: number
 *           default: 1
 *         description: Starting index (1-based)
 *     responses:
 *       200:
 *         description: Paged grandchildren response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 MediaContainer:
 *                   type: object
 *                   properties:
 *                     offset:
 *                       type: number
 *                     totalSize:
 *                       type: number
 *                     identifier:
 *                       type: string
 *                     size:
 *                       type: number
 *                     Metadata:
 *                       type: array
 *                       items:
 *                         type: object
 *       500:
 *         description: Internal server error
 */
router.get(`${API_PATHS.LIBRARY_METADATA}/:ratingKey/grandchildren`, async (req: Request, res: Response) => {
  try {
    const { ratingKey } = req.params;

    // Get language and country from headers or query params
    const language = (req.headers['x-plex-language'] as string) ||
                    (req.query['X-Plex-Language'] as string) ||
                    'en-US';
    const country = (req.headers['x-plex-country'] as string) ||
                   (req.query['X-Plex-Country'] as string) ||
                   'US';

    // Get paging parameters (default: size=20, start=1)
    const containerSize = parseInt(
      (req.headers['x-plex-container-size'] as string) ||
      (req.query['X-Plex-Container-Size'] as string) ||
      '20',
      10
    );
    const containerStart = parseInt(
      (req.headers['x-plex-container-start'] as string) ||
      (req.query['X-Plex-Container-Start'] as string) ||
      '1',
      10
    );

    // Get grandchildren
    const service = getMetadataService();
    const result = await service.getGrandchildren(
      ratingKey,
      { language, country },
      { containerSize, containerStart }
    );

    res.json(result);
  } catch (error) {
    console.error('Grandchildren error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @openapi
 * /tv/library/metadata/matches:
 *   post:
 *     tags:
 *       - Match
 *     summary: Match content
 *     description: Search for TV shows, seasons, or episodes based on provided hints
 *     parameters:
 *       - in: header
 *         name: X-Plex-Language
 *         schema:
 *           type: string
 *           example: en-US
 *         description: Language for metadata
 *       - in: header
 *         name: X-Plex-Country
 *         schema:
 *           type: string
 *           example: US
 *         description: Country for content ratings
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: number
 *                 description: Metadata type (2=show, 3=season, 4=episode)
 *                 enum: [2, 3, 4]
 *               title:
 *                 type: string
 *                 description: Title of the show (for type 2)
 *               parentTitle:
 *                 type: string
 *                 description: Title of the show (for type 3 - season)
 *               grandparentTitle:
 *                 type: string
 *                 description: Title of the show (for type 4 - episode)
 *               year:
 *                 type: number
 *                 description: Year of first air date
 *               guid:
 *                 type: string
 *                 description: External ID (e.g., "tvdb://12345", "imdb://tt1234567")
 *               index:
 *                 type: number
 *                 description: Season number (for type 3) or episode number (for type 4)
 *               parentIndex:
 *                 type: number
 *                 description: Season number (for type 4 - episode)
 *               manual:
 *                 type: number
 *                 description: Manual search mode (0 or 1) - returns multiple results if 1
 *                 enum: [0, 1]
 *               includeChildren:
 *                 type: number
 *                 description: Include child items (0 or 1)
 *                 enum: [0, 1]
 *               includeAdult:
 *                 type: number
 *                 description: Include adult content (0 or 1)
 *                 enum: [0, 1]
 *           examples:
 *             matchShow:
 *               summary: Match TV Show by title
 *               value:
 *                 type: 2
 *                 title: Adventure Time
 *                 year: 2010
 *             matchByExternalId:
 *               summary: Match by external ID
 *               value:
 *                 type: 2
 *                 guid: tvdb://152831
 *             matchSeason:
 *               summary: Match Season
 *               value:
 *                 type: 3
 *                 parentTitle: Adventure Time
 *                 index: 1
 *             matchEpisode:
 *               summary: Match Episode
 *               value:
 *                 type: 4
 *                 grandparentTitle: Adventure Time
 *                 parentIndex: 1
 *                 index: 5
 *             manualSearch:
 *               summary: Manual search (multiple results)
 *               value:
 *                 type: 2
 *                 title: Star
 *                 manual: 1
 *     responses:
 *       200:
 *         description: Match results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 MediaContainer:
 *                   type: object
 *                   properties:
 *                     offset:
 *                       type: number
 *                     totalSize:
 *                       type: number
 *                     identifier:
 *                       type: string
 *                     size:
 *                       type: number
 *                     Metadata:
 *                       type: array
 *                       items:
 *                         type: object
 *       500:
 *         description: Internal server error
 */
router.post(API_PATHS.LIBRARY_MATCHES, async (req: Request, res: Response) => {
  try {
    const matchRequest: MatchRequest = req.body;

    // Get language and country from headers or query params
    const language = (req.headers['x-plex-language'] as string) ||
                    (req.query['X-Plex-Language'] as string) ||
                    'en-US';
    const country = (req.headers['x-plex-country'] as string) ||
                   (req.query['X-Plex-Country'] as string) ||
                   'US';

    // Perform the match
    const service = getMatchService();
    const result = await service.match(matchRequest, { language, country });

    res.json(result);
  } catch (error) {
    console.error('Match error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;