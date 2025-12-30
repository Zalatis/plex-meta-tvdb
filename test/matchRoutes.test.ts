/**
 * Integration tests for Match routes
 * Note: These tests require TVDB_API_KEY to be set in environment
 */

import request from 'supertest';
import { createApp } from '../src/app';

// Skip tests if TVDB_API_KEY is not set
const SKIP_TESTS = !process.env.TVDB_API_KEY;

describe('Match Routes', () => {
  const app = createApp();

  if (SKIP_TESTS) {
    it.skip('skipping tests - TVDB_API_KEY not set', () => {});
    return;
  }

  describe('POST /tv/library/metadata/matches', () => {
    it('should return 200 for valid show match request', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2, // show
          title: 'Adventure Time',
          year: 2010,
        });

      expect(response.status).toBe(200);
    });

    it('should return MediaContainer structure', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Adventure Time',
        });

      expect(response.body).toHaveProperty('MediaContainer');
      expect(response.body.MediaContainer).toHaveProperty('offset');
      expect(response.body.MediaContainer).toHaveProperty('totalSize');
      expect(response.body.MediaContainer).toHaveProperty('identifier');
      expect(response.body.MediaContainer).toHaveProperty('size');
      expect(response.body.MediaContainer).toHaveProperty('Metadata');
    });

    it('should return show metadata for Adventure Time', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Adventure Time',
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('show');
      expect(metadata.title).toContain('Adventure');
      expect(metadata.ratingKey).toBeDefined();
      expect(metadata.guid).toContain('tv.plex.agents.custom.example.thetvdb.tv://show/');
    });

    it('should include external IDs (IMDB, TMDB, TVDB)', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Breaking Bad',
        });

      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.Guid).toBeDefined();
      expect(metadata.Guid.length).toBeGreaterThan(0);

      const hasTvdb = metadata.Guid.some((g: any) => g.id.startsWith('tvdb://'));
      expect(hasTvdb).toBe(true);
    });

    it('should match show by external TVDB ID', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          guid: 'tvdb://152831', // Adventure Time TVDB ID
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.title).toContain('Adventure');
    });

    it('should return multiple matches when manual=1', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Star',
          manual: 1,
        });

      expect(response.body.MediaContainer.size).toBeGreaterThanOrEqual(1);
      // Should return up to 5 results for manual search
      expect(response.body.MediaContainer.size).toBeLessThanOrEqual(5);
    });

    it('should match season by parent title and index', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 3, // season
          parentTitle: 'Adventure Time',
          index: 1,
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('season');
      expect(metadata.index).toBe(1);
      expect(metadata.parentTitle).toContain('Adventure');
      expect(metadata.ratingKey).toBeDefined();
      expect(metadata.guid).toContain('tv.plex.agents.custom.example.thetvdb.tv://season/');
    });

    it('should match episode by grandparent title and indices', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 4, // episode
          grandparentTitle: 'Adventure Time',
          parentIndex: 1,
          index: 1,
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('episode');
      expect(metadata.index).toBe(1);
      expect(metadata.parentIndex).toBe(1);
      expect(metadata.grandparentTitle).toContain('Adventure');
      expect(metadata.ratingKey).toBeDefined();
      expect(metadata.guid).toContain('tv.plex.agents.custom.example.thetvdb.tv://episode/');
    });

    it('should respect X-Plex-Language header', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .set('X-Plex-Language', 'en-US')
        .send({
          type: 2,
          title: 'Adventure Time',
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
    });

    it('should respect X-Plex-Country header for content ratings', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .set('X-Plex-Country', 'US')
        .send({
          type: 2,
          title: 'Adventure Time',
        });

      expect(response.status).toBe(200);
      const metadata = response.body.MediaContainer.Metadata[0];
      // Content rating might be present depending on TVDB data
      if (metadata.contentRating) {
        expect(typeof metadata.contentRating).toBe('string');
      }
    });

    it('should return empty results for non-existent show', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'NonExistentShowWithVeryUniqueName12345',
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBe(0);
      expect(response.body.MediaContainer.Metadata).toHaveLength(0);
    });

    it('should return 500 for invalid type', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 1, // movie type - not supported by TV provider
          title: 'Some Movie',
        });

      expect(response.status).toBe(500);
    });

    it('should include proper parent relationships for seasons', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 3,
          parentTitle: 'Breaking Bad',
          index: 1,
        });

      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.parentRatingKey).toBeDefined();
      expect(metadata.parentGuid).toBeDefined();
      expect(metadata.parentType).toBe('show');
      expect(metadata.parentTitle).toBeDefined();
    });

    it('should include proper parent and grandparent relationships for episodes', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 4,
          grandparentTitle: 'Breaking Bad',
          parentIndex: 1,
          index: 1,
        });

      const metadata = response.body.MediaContainer.Metadata[0];

      // Parent (season)
      expect(metadata.parentRatingKey).toBeDefined();
      expect(metadata.parentGuid).toBeDefined();
      expect(metadata.parentType).toBe('season');

      // Grandparent (show)
      expect(metadata.grandparentRatingKey).toBeDefined();
      expect(metadata.grandparentGuid).toBeDefined();
      expect(metadata.grandparentType).toBe('show');
    });

    it('should return English title for Cowboy Bebop (TVDB ID 76885)', async () => {
      // This test ensures that anime/foreign shows return English titles
      // Cowboy Bebop is a Japanese anime with TVDB ID 76885
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          guid: 'tvdb://76885', // Cowboy Bebop TVDB ID
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);

      const metadata = response.body.MediaContainer.Metadata[0];

      // Title should be "Cowboy Bebop" in English characters, not Japanese
      expect(metadata.title).toBe('Cowboy Bebop');
      // Should not contain Japanese characters
      expect(metadata.title).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
    });

    it('should return English overview for foreign shows', async () => {
      // Test that overviews are also in English
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          guid: 'tvdb://76885', // Cowboy Bebop
        });

      expect(response.status).toBe(200);
      const metadata = response.body.MediaContainer.Metadata[0];

      // If overview exists, it should be in English (not contain primarily Japanese characters)
      if (metadata.summary) {
        expect(metadata.summary).not.toMatch(/^[\u3040-\u30ff\u4e00-\u9fff]+$/);
      }
    });

    it('should return English title for Cowboy Bebop S01E01 (Session #2: Stray Dog Strut)', async () => {
      // This test ensures that episode titles are returned in English
      // Cowboy Bebop (1998) Season 1, Episode 1 should be "Session #2: Stray Dog Strut"
      // Using year in title to ensure we match the 1998 series, not the 2021 remake
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 4, // episode
          grandparentTitle: 'Cowboy Bebop (1998)', // Year ensures we get the 1998 animated series
          parentIndex: 1, // Season 1
          index: 1, // Episode 1
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);

      const metadata = response.body.MediaContainer.Metadata[0];

      // Title should contain "Stray Dog Strut" in English
      expect(metadata.title).toContain('Stray Dog Strut');
      // Should not contain Japanese characters
      expect(metadata.title).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
    });

    it('should return English overview for Cowboy Bebop episodes', async () => {
      // Test that episode overviews are also in English
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 4,
          grandparentTitle: 'Cowboy Bebop (1998)',
          parentIndex: 1,
          index: 1,
        });

      expect(response.status).toBe(200);
      const metadata = response.body.MediaContainer.Metadata[0];

      // If overview exists, it should be in English
      if (metadata.summary) {
        expect(metadata.summary).not.toMatch(/^[\u3040-\u30ff\u4e00-\u9fff]+$/);
        // Should contain recognizable English words
        expect(metadata.summary.length).toBeGreaterThan(10);
      }
    });

    it('should extract year from title and match correct series - "Cowboy Bebop (1998)"', async () => {
      // Cowboy Bebop has two versions:
      // - 1998 animated series (TVDB ID: 76885)
      // - 2021 live-action series (different TVDB ID)
      // This test ensures that "Cowboy Bebop (1998)" matches the 1998 version
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Cowboy Bebop (1998)', // Year in parentheses should be extracted
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);

      const metadata = response.body.MediaContainer.Metadata[0];

      // Should match the 1998 version
      expect(metadata.title).toBe('Cowboy Bebop');
      expect(metadata.year).toBe(1998);
      // The GUID should reference the original 1998 series (TVDB ID 76885)
      expect(metadata.ratingKey).toBe('tvdb-show-76885');
    });

    it('should extract year from title with brackets - "Cowboy Bebop [1998]"', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Cowboy Bebop [1998]', // Year in brackets should also work
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);

      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.title).toBe('Cowboy Bebop');
      expect(metadata.year).toBe(1998);
    });

    it('should extract year from title with dash - "Cowboy Bebop - 1998"', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Cowboy Bebop - 1998', // Year after dash should also work
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);

      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.title).toBe('Cowboy Bebop');
      expect(metadata.year).toBe(1998);
    });

    it('should prefer explicitly provided year over extracted year', async () => {
      // If both year and title-with-year are provided, explicit year wins
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Cowboy Bebop (2021)', // Title says 2021
          year: 1998, // But explicit year says 1998
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);

      const metadata = response.body.MediaContainer.Metadata[0];

      // Should match 1998 version because explicit year takes precedence
      expect(metadata.year).toBe(1998);
    });

    it('should extract year from parentTitle for season matching', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 3,
          parentTitle: 'Cowboy Bebop (1998)',
          index: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);

      const metadata = response.body.MediaContainer.Metadata[0];

      // Should match the 1998 series
      expect(metadata.parentTitle).toBe('Cowboy Bebop');
      expect(metadata.parentRatingKey).toBe('tvdb-show-76885');
    });

    it('should extract year from grandparentTitle for episode matching', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 4,
          grandparentTitle: 'Cowboy Bebop (1998)',
          parentIndex: 1,
          index: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);

      const metadata = response.body.MediaContainer.Metadata[0];

      // Should match the 1998 series
      expect(metadata.grandparentTitle).toBe('Cowboy Bebop');
      expect(metadata.grandparentRatingKey).toBe('tvdb-show-76885');
    });
  });
});
