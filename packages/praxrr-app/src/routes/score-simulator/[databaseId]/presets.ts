import type { PresetCategory, PresetGroup } from './helpers.ts';

export const PRESET_GROUPS: PresetGroup[] = [
  // Movie presets
  {
    category: 'movie',
    label: '4K Remux vs Web-DL',
    description: 'Compare how profiles score full remux against streaming sources',
    titles: [
      {
        label: '4K Remux DTS-HD MA',
        title: 'The.Dark.Knight.2008.2160p.UHD.BluRay.Remux.HDR.HEVC.DTS-HD.MA.5.1-FGT',
      },
      {
        label: '4K Web-DL Atmos',
        title: 'The.Dark.Knight.2008.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX',
      },
      {
        label: '1080p Remux TrueHD',
        title: 'The.Dark.Knight.2008.1080p.BluRay.Remux.AVC.TrueHD.5.1-FGT',
      },
      {
        label: '1080p Web-DL DD5.1',
        title: 'The.Dark.Knight.2008.1080p.WEB-DL.DD5.1.H.264-FLUX',
      },
      {
        label: '720p BluRay',
        title: 'The.Dark.Knight.2008.720p.BluRay.x264.DTS-FGT',
      },
    ],
  },
  {
    category: 'movie',
    label: 'HDR Formats',
    description: 'Test scoring across Dolby Vision, HDR10+, HDR10, and SDR',
    titles: [
      {
        label: 'DV + HDR10',
        title: 'Dune.Part.Two.2024.2160p.UHD.BluRay.Remux.DV.HDR10.HEVC.TrueHD.7.1.Atmos-FGT',
      },
      {
        label: 'HDR10+ Only',
        title: 'Dune.Part.Two.2024.2160p.UHD.BluRay.Remux.HDR10Plus.HEVC.TrueHD.7.1.Atmos-FGT',
      },
      {
        label: 'HDR10 Only',
        title: 'Dune.Part.Two.2024.2160p.UHD.BluRay.Remux.HDR.HEVC.TrueHD.7.1.Atmos-FGT',
      },
      {
        label: 'SDR 4K',
        title: 'Dune.Part.Two.2024.2160p.BluRay.Remux.HEVC.TrueHD.7.1.Atmos-FGT',
      },
      {
        label: 'DV Web-DL',
        title: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-FLUX',
      },
    ],
  },
  {
    category: 'movie',
    label: 'Audio Codecs',
    description: 'Compare Atmos, TrueHD, DTS-HD MA, DTS-X, AAC, and lossy tracks',
    titles: [
      {
        label: 'TrueHD 7.1 Atmos',
        title: 'Oppenheimer.2023.2160p.UHD.BluRay.Remux.HDR.HEVC.TrueHD.7.1.Atmos-FGT',
      },
      {
        label: 'DTS-X',
        title: 'Oppenheimer.2023.2160p.UHD.BluRay.Remux.HDR.HEVC.DTS-X.7.1-FGT',
      },
      {
        label: 'DTS-HD MA 5.1',
        title: 'Oppenheimer.2023.2160p.UHD.BluRay.Remux.HDR.HEVC.DTS-HD.MA.5.1-FGT',
      },
      {
        label: 'DD+ Atmos (Web)',
        title: 'Oppenheimer.2023.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX',
      },
      {
        label: 'AAC 2.0 (Web)',
        title: 'Oppenheimer.2023.1080p.WEB-DL.AAC2.0.H.264-FLUX',
      },
    ],
  },

  // Series presets
  {
    category: 'series',
    label: 'Web-DL Quality Ladder',
    description: 'See how profiles rank different resolutions and sources',
    titles: [
      {
        label: '2160p Web-DL Atmos',
        title: 'Shogun.S01E01.2160p.DSNP.WEB-DL.DDP5.1.Atmos.DV.H.265-NTb',
      },
      {
        label: '1080p Web-DL',
        title: 'Shogun.S01E01.1080p.DSNP.WEB-DL.DDP5.1.H.264-NTb',
      },
      {
        label: '720p Web-DL',
        title: 'Shogun.S01E01.720p.DSNP.WEB-DL.DDP5.1.H.264-NTb',
      },
      {
        label: '1080p WEBRip x265',
        title: 'Shogun.S01E01.1080p.WEBRip.x265-RARBG',
      },
      {
        label: '480p WEB',
        title: 'Shogun.S01E01.480p.WEB-DL.AAC2.0.H.264-NTb',
      },
    ],
  },
  {
    category: 'series',
    label: 'Season Packs vs Singles',
    description: 'Compare season pack releases against individual episodes',
    titles: [
      {
        label: 'S01 Pack BluRay Remux',
        title: 'Breaking.Bad.S01.1080p.BluRay.Remux.AVC.DTS-HD.MA.5.1-FGT',
      },
      {
        label: 'S01 Pack Web-DL',
        title: 'Breaking.Bad.S01.1080p.NF.WEB-DL.DDP5.1.H.264-NTb',
      },
      {
        label: 'S01E01 BluRay',
        title: 'Breaking.Bad.S01E01.1080p.BluRay.x264.DTS-FGT',
      },
      {
        label: 'S01E01 Web-DL',
        title: 'Breaking.Bad.S01E01.1080p.NF.WEB-DL.DDP5.1.H.264-NTb',
      },
      {
        label: 'S01 Pack 2160p',
        title: 'Breaking.Bad.S01.2160p.UHD.BluRay.Remux.HDR.HEVC.DTS-HD.MA.5.1-FGT',
      },
    ],
  },
  {
    category: 'series',
    label: 'Anime Releases',
    description: 'Typical anime release groups and naming patterns',
    titles: [
      {
        label: 'Dual Audio BluRay',
        title: '[SubsPlease] Frieren - Beyond Journeys End - 01 (1080p) [Dual-Audio][BluRay][FLAC].mkv',
      },
      {
        label: 'Web Source HEVC',
        title: '[SubsPlease] Frieren - Beyond Journeys End - 01 (1080p) [HEVC].mkv',
      },
      {
        label: 'Mini Encode x265',
        title: '[Judas] Frieren - Beyond Journeys End - S01E01.mkv',
      },
      {
        label: 'Batch 1080p FLAC',
        title: '[Erai-raws] Frieren - Beyond Journeys End S01 [1080p][FLAC][Multiple Subtitle].mkv',
      },
      {
        label: '720p SubsPlease',
        title: '[SubsPlease] Frieren - Beyond Journeys End - 01 (720p) [AAC].mkv',
      },
    ],
  },
];

export function getPresetsForCategory(category: PresetCategory): PresetGroup[] {
  return PRESET_GROUPS.filter((group) => group.category === category);
}
