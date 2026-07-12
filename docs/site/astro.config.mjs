// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import starlight from '@astrojs/starlight';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import mermaid from 'astro-mermaid';
import { defineConfig } from 'astro/config';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

// Resolve the documentation version being built from DOCS_VERSION (set per build by
// scripts/build-versions.mjs). See src/content/docs/app/docs-versioning.md.
const versions = JSON.parse(readFileSync(fileURLToPath(new URL('./versions.json', import.meta.url)), 'utf8'));
const activeVersion =
  versions.find((v) => v.id === process.env.DOCS_VERSION) ?? versions.find((v) => v.default);
if (!activeVersion) {
  throw new Error(`Unknown DOCS_VERSION "${process.env.DOCS_VERSION}" and no default in versions.json`);
}
// Astro's `base` expects no trailing slash ('/' or '/next'); versions.json stores '/next/'.
const astroBase = activeVersion.base === '/' ? '/' : activeVersion.base.replace(/\/+$/, '');

export default defineConfig({
  site: 'https://docs.praxrr.dev',
  base: astroBase,
  outDir: `./dist/.versions/${activeVersion.id}`,
  integrations: [
    mermaid(),
    svelte(),
    starlight({
      title: 'Praxrr',
      description: 'Documentation for the Praxrr app, PCD schema, and curated configuration database.',
      customCss: ['./src/styles/global.css'],
      // In-development versions render the same content as the stable root, so keep them
      // out of search indexes to avoid duplicate-content competition with the canonical docs.
      head: activeVersion.development
        ? [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex' } }]
        : [],
      components: {
        Sidebar: './src/components/VersionedSidebar.astro',
        Banner: './src/components/VersionBanner.astro',
      },
      editLink: {
        baseUrl: `https://github.com/yandy-r/praxrr/edit/${activeVersion.ref}/docs/site/`,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/yandy-r/praxrr',
        },
      ],
      plugins: [
        starlightOpenAPI([
          {
            base: 'api',
            schema: '../api/v1/openapi.yaml',
            sidebar: {
              label: 'API Reference',
              collapsed: false,
              operations: {
                badges: true,
                labels: 'summary',
                sort: 'document',
              },
              tags: {
                sort: 'document',
              },
            },
          },
        ]),
      ],
      sidebar: [
        {
          label: 'Start Here',
          items: [{ label: 'Overview', link: '/' }],
        },
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', link: '/getting-started/' },
            { label: 'Installation', link: '/getting-started/installation/' },
            { label: 'Quick Start', link: '/getting-started/quick-start/' },
            { label: 'Docker', link: '/getting-started/docker/' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', link: '/guides/configuration/' },
            {
              label: 'Connecting Arr Instances',
              link: '/guides/connecting-arr-instances/',
            },
            { label: 'Syncing Profiles', link: '/guides/syncing-profiles/' },
            { label: 'Custom Formats', link: '/guides/custom-formats/' },
            { label: 'Quality Profiles', link: '/guides/quality-profiles/' },
            { label: 'MCP Server', link: '/guides/mcp-server/' },
            { label: 'Upgrading', link: '/guides/upgrading/' },
            { label: 'Troubleshooting', link: '/guides/troubleshooting/' },
          ],
        },
        {
          label: 'Application',
          items: [
            { label: 'Architecture', link: '/app/architecture/' },
            { label: 'Startup Sequence', link: '/app/startup/' },
            { label: 'Development Setup', link: '/app/development/' },
            { label: 'PCD System', link: '/app/pcd-system/' },
            { label: 'Job System', link: '/app/jobs/' },
            { label: 'Sync Pipeline', link: '/app/sync-pipeline/' },
            { label: 'Notifications', link: '/app/notifications/' },
            { label: 'Testing', link: '/app/testing/' },
            { label: 'Docs Versioning', link: '/app/docs-versioning/' },
            {
              label: 'Component Library',
              collapsed: true,
              items: [
                { label: 'Overview', link: '/app/components/' },
                { label: 'Buttons & Actions', link: '/app/components/buttons/' },
                { label: 'Form Inputs', link: '/app/components/forms/' },
                { label: 'Tables & Lists', link: '/app/components/tables/' },
                { label: 'Modals & Dialogs', link: '/app/components/modals/' },
                { label: 'Dropdowns & Tabs', link: '/app/components/navigation/' },
                { label: 'Navigation Shell', link: '/app/components/shell/' },
                { label: 'Badges & Labels', link: '/app/components/badges/' },
                { label: 'Cards', link: '/app/components/cards/' },
                { label: 'Feedback & States', link: '/app/components/feedback/' },
                { label: 'Display & Formatting', link: '/app/components/display/' },
                { label: 'Complexity Tiers', link: '/app/components/complexity/' },
                { label: 'Store Patterns', link: '/app/components/patterns/' },
              ],
            },
          ],
        },
        {
          label: 'Plugin SDK',
          items: [
            { label: 'Overview', link: '/plugins/' },
            { label: 'Build & Install the Example', link: '/plugins/example-observer/' },
            { label: 'Manifest Reference', link: '/plugins/manifest/' },
            { label: 'Capabilities & Least Privilege', link: '/plugins/capabilities/' },
            { label: 'Extension Points', link: '/plugins/extension-points/' },
            { label: 'Observe Snapshots', link: '/plugins/observe-snapshot/' },
            { label: 'Lifecycle & Registry', link: '/plugins/lifecycle/' },
            { label: 'API Versioning & Stability', link: '/plugins/versioning/' },
          ],
        },
        {
          label: 'PCD Schema',
          items: [
            { label: 'Overview', link: '/schema/' },
            { label: 'Structure', link: '/schema/structure/' },
            { label: 'Manifest', link: '/schema/manifest/' },
            { label: 'Condition Types', link: '/schema/condition-types/' },
            { label: 'Migration Paths', link: '/schema/migrations/' },
            {
              label: 'Tables',
              collapsed: true,
              items: [
                { label: 'Index', link: '/schema/tables/' },
                {
                  label: 'Core Entities',
                  collapsed: true,
                  items: [
                    { label: 'tags', link: '/schema/tables/tags/' },
                    { label: 'languages', link: '/schema/tables/languages/' },
                    { label: 'regular_expressions', link: '/schema/tables/regular_expressions/' },
                    { label: 'qualities', link: '/schema/tables/qualities/' },
                    { label: 'quality_api_mappings', link: '/schema/tables/quality_api_mappings/' },
                    { label: 'custom_formats', link: '/schema/tables/custom_formats/' },
                  ],
                },
                {
                  label: 'Profiles & Junctions',
                  collapsed: true,
                  items: [
                    { label: 'quality_profiles', link: '/schema/tables/quality_profiles/' },
                    { label: 'quality_groups', link: '/schema/tables/quality_groups/' },
                    {
                      label: 'custom_format_conditions',
                      link: '/schema/tables/custom_format_conditions/',
                    },
                    {
                      label: 'regular_expression_tags',
                      link: '/schema/tables/regular_expression_tags/',
                    },
                    { label: 'custom_format_tags', link: '/schema/tables/custom_format_tags/' },
                    { label: 'quality_profile_tags', link: '/schema/tables/quality_profile_tags/' },
                    {
                      label: 'quality_profile_languages',
                      link: '/schema/tables/quality_profile_languages/',
                    },
                    { label: 'quality_group_members', link: '/schema/tables/quality_group_members/' },
                    {
                      label: 'quality_profile_qualities',
                      link: '/schema/tables/quality_profile_qualities/',
                    },
                    {
                      label: 'quality_profile_custom_formats',
                      link: '/schema/tables/quality_profile_custom_formats/',
                    },
                  ],
                },
                {
                  label: 'Condition Types',
                  collapsed: true,
                  items: [
                    { label: 'condition_patterns', link: '/schema/tables/condition_patterns/' },
                    { label: 'condition_languages', link: '/schema/tables/condition_languages/' },
                    {
                      label: 'condition_indexer_flags',
                      link: '/schema/tables/condition_indexer_flags/',
                    },
                    { label: 'condition_sources', link: '/schema/tables/condition_sources/' },
                    { label: 'condition_resolutions', link: '/schema/tables/condition_resolutions/' },
                    {
                      label: 'condition_quality_modifiers',
                      link: '/schema/tables/condition_quality_modifiers/',
                    },
                    { label: 'condition_sizes', link: '/schema/tables/condition_sizes/' },
                    {
                      label: 'condition_release_types',
                      link: '/schema/tables/condition_release_types/',
                    },
                    { label: 'condition_years', link: '/schema/tables/condition_years/' },
                  ],
                },
                {
                  label: 'Media Management',
                  collapsed: true,
                  items: [
                    {
                      label: 'radarr_quality_definitions',
                      link: '/schema/tables/radarr_quality_definitions/',
                    },
                    {
                      label: 'sonarr_quality_definitions',
                      link: '/schema/tables/sonarr_quality_definitions/',
                    },
                    {
                      label: 'lidarr_quality_definitions',
                      link: '/schema/tables/lidarr_quality_definitions/',
                    },
                    { label: 'radarr_naming', link: '/schema/tables/radarr_naming/' },
                    { label: 'sonarr_naming', link: '/schema/tables/sonarr_naming/' },
                    { label: 'lidarr_naming', link: '/schema/tables/lidarr_naming/' },
                    { label: 'radarr_media_settings', link: '/schema/tables/radarr_media_settings/' },
                    { label: 'sonarr_media_settings', link: '/schema/tables/sonarr_media_settings/' },
                    { label: 'lidarr_media_settings', link: '/schema/tables/lidarr_media_settings/' },
                  ],
                },
                {
                  label: 'Metadata, Delay & Testing',
                  collapsed: true,
                  items: [
                    {
                      label: 'lidarr_metadata_profiles',
                      link: '/schema/tables/lidarr_metadata_profiles/',
                    },
                    {
                      label: 'lidarr_metadata_profile_primary_types',
                      link: '/schema/tables/lidarr_metadata_profile_primary_types/',
                    },
                    {
                      label: 'lidarr_metadata_profile_secondary_types',
                      link: '/schema/tables/lidarr_metadata_profile_secondary_types/',
                    },
                    {
                      label: 'lidarr_metadata_profile_release_statuses',
                      link: '/schema/tables/lidarr_metadata_profile_release_statuses/',
                    },
                    { label: 'delay_profiles', link: '/schema/tables/delay_profiles/' },
                    { label: 'custom_format_tests', link: '/schema/tables/custom_format_tests/' },
                    { label: 'test_entities', link: '/schema/tables/test_entities/' },
                    { label: 'test_releases', link: '/schema/tables/test_releases/' },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: 'PCD Database',
          items: [
            { label: 'Overview', link: '/database/' },
            { label: 'Mirror README', link: '/database/readme/' },
            {
              label: 'Custom Formats',
              items: [
                { label: 'Catalog Overview', link: '/database/custom-formats/' },
                { label: 'Resolution & Source', link: '/database/custom-formats/resolution-source/' },
                { label: 'Audio', link: '/database/custom-formats/audio/' },
                { label: 'Codecs & HDR', link: '/database/custom-formats/codecs-hdr/' },
                { label: 'Release Groups', link: '/database/custom-formats/release-groups/' },
                { label: 'Streaming Services', link: '/database/custom-formats/streaming-services/' },
                { label: 'Editions & Flags', link: '/database/custom-formats/editions-flags/' },
                { label: 'Language & Anime', link: '/database/custom-formats/language-anime/' },
                { label: 'Unwanted & Banned', link: '/database/custom-formats/unwanted/' },
              ],
            },
            {
              label: 'Quality Profiles',
              items: [
                { label: 'Overview', link: '/database/quality-profiles/' },
                { label: 'Video Presets', link: '/database/quality-profiles/presets/' },
              ],
            },
            { label: 'Release & Delay Profiles', link: '/database/release-delay-profiles/' },
            { label: 'Lidarr Support', link: '/database/lidarr/' },
            { label: 'Changelog', link: '/database/changelog/' },
          ],
        },
        ...openAPISidebarGroups,
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
