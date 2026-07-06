// @ts-check
import starlight from '@astrojs/starlight';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

export default defineConfig({
  site: 'https://docs.praxrr.dev',
  integrations: [
    svelte(),
    starlight({
      title: 'Praxrr',
      description: 'Documentation for the Praxrr app, PCD schema, and curated configuration database.',
      customCss: ['./src/styles/global.css'],
      editLink: {
        baseUrl: 'https://github.com/yandy-r/praxrr/edit/main/docs/site/',
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
            { label: 'Upgrading', link: '/guides/upgrading/' },
            { label: 'Troubleshooting', link: '/guides/troubleshooting/' },
          ],
        },
        {
          label: 'Application',
          items: [{ label: 'Architecture', link: '/app/architecture/' }],
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
