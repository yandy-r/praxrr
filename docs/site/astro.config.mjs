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
