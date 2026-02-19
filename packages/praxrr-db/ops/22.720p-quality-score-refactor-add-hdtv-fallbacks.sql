-- @operation: export
-- @entity: batch
-- @name: 720p Quality Score Refactor / Add HDTV Fallbacks
-- @exportedAt: 2026-02-08T21:08:39.926Z
-- @opIds: 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 544, 545, 546, 547, 548, 549, 550, 551, 552, 553, 554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573, 574, 575, 576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589, 590, 591, 592, 593, 594, 595, 596, 597, 598, 599, 600, 601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 612, 613, 614, 615, 616, 617, 618, 619, 620, 621, 622, 623, 624, 625, 626, 627, 628, 629, 630, 631, 632, 633, 634, 635, 636, 637, 638, 639, 640

-- --- BEGIN op 470 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Bluray', 'radarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 470

-- --- BEGIN op 471 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Bluray', 'sonarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 471

-- --- BEGIN op 472 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p WEB-DL', 'radarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p WEB-DL'
    AND arr_type = 'radarr'
);
-- --- END op 472

-- --- BEGIN op 473 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p WEB-DL', 'sonarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p WEB-DL'
    AND arr_type = 'sonarr'
);
-- --- END op 473

-- --- BEGIN op 474 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Bluray', 'radarr', 160000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 474

-- --- BEGIN op 475 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Bluray', 'sonarr', 160000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 475

-- --- BEGIN op 476 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Bluray', 'radarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 476

-- --- BEGIN op 477 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Bluray', 'sonarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 477

-- --- BEGIN op 478 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p WEB-DL', 'radarr', 580000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p WEB-DL'
    AND arr_type = 'radarr'
);
-- --- END op 478

-- --- BEGIN op 479 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p WEB-DL', 'sonarr', 580000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p WEB-DL'
    AND arr_type = 'sonarr'
);
-- --- END op 479

-- --- BEGIN op 480 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p WEBRip', 'radarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'radarr'
);
-- --- END op 480

-- --- BEGIN op 481 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p WEBRip', 'sonarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'sonarr'
);
-- --- END op 481

-- --- BEGIN op 482 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'DVD', 'radarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'DVD'
    AND arr_type = 'radarr'
);
-- --- END op 482

-- --- BEGIN op 483 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'DVD', 'sonarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'DVD'
    AND arr_type = 'sonarr'
);
-- --- END op 483

-- --- BEGIN op 484 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'SDTV', 'radarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'SDTV'
    AND arr_type = 'radarr'
);
-- --- END op 484

-- --- BEGIN op 485 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'SDTV', 'sonarr', 200000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'SDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 485

-- --- BEGIN op 486 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Quality Tier 1', 'radarr', 43000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 486

-- --- BEGIN op 487 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Quality Tier 1', 'sonarr', 43000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 487

-- --- BEGIN op 488 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Quality Tier 2', 'radarr', 42000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 488

-- --- BEGIN op 489 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Quality Tier 2', 'sonarr', 42000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 489

-- --- BEGIN op 490 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Quality Tier 3', 'radarr', 41000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 490

-- --- BEGIN op 491 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Quality Tier 3', 'sonarr', 41000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 491

-- --- BEGIN op 492 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Quality Tier 4', 'radarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 492

-- --- BEGIN op 493 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '480p Quality Tier 4', 'sonarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '480p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 493

-- --- BEGIN op 494 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Quality Tier 1', 'radarr', 63000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 494

-- --- BEGIN op 495 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Quality Tier 1', 'sonarr', 63000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 495

-- --- BEGIN op 496 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Quality Tier 2', 'radarr', 62000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 496

-- --- BEGIN op 497 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Quality Tier 2', 'sonarr', 62000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 497

-- --- BEGIN op 498 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Quality Tier 3', 'radarr', 61000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 498

-- --- BEGIN op 499 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Quality Tier 3', 'sonarr', 61000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 499

-- --- BEGIN op 500 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Quality Tier 4', 'radarr', 60000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 500

-- --- BEGIN op 501 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '576p Quality Tier 4', 'sonarr', 60000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '576p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 501

-- --- BEGIN op 502 ( update quality_profile "720p Quality" )
UPDATE quality_profile_custom_formats
SET score = 120000
WHERE quality_profile_name = '720p Quality'
  AND custom_format_name = '720p Balanced Tier 1'
  AND arr_type = 'radarr'
  AND score = 60000;
-- --- END op 502

-- --- BEGIN op 503 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Balanced Tier 1', 'sonarr', 120000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Balanced Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 503

-- --- BEGIN op 504 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 1', 'radarr', 145000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 504

-- --- BEGIN op 505 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 1', 'sonarr', 145000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 505

-- --- BEGIN op 506 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 2', 'radarr', 144000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 506

-- --- BEGIN op 507 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 2', 'sonarr', 144000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 507

-- --- BEGIN op 508 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 3', 'radarr', 143000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 508

-- --- BEGIN op 509 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 3', 'sonarr', 143000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 509

-- --- BEGIN op 510 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 4', 'radarr', 142000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 510

-- --- BEGIN op 511 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 4', 'sonarr', 142000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 511

-- --- BEGIN op 512 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 5', 'radarr', 141000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 5'
    AND arr_type = 'radarr'
);
-- --- END op 512

-- --- BEGIN op 513 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 5', 'sonarr', 141000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 5'
    AND arr_type = 'sonarr'
);
-- --- END op 513

-- --- BEGIN op 514 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 6', 'radarr', 140000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 6'
    AND arr_type = 'radarr'
);
-- --- END op 514

-- --- BEGIN op 515 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p Quality Tier 6', 'sonarr', 140000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p Quality Tier 6'
    AND arr_type = 'sonarr'
);
-- --- END op 515

-- --- BEGIN op 516 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'SD Quality Tier 1', 'radarr', 21000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'SD Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 516

-- --- BEGIN op 517 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'SD Quality Tier 1', 'sonarr', 21000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'SD Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 517

-- --- BEGIN op 518 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'SD Quality Tier 2', 'radarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'SD Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 518

-- --- BEGIN op 519 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'SD Quality Tier 2', 'sonarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'SD Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 519

-- --- BEGIN op 520 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'SDTV Tier 1', 'radarr', 10000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'SDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 520

-- --- BEGIN op 521 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'SDTV Tier 1', 'sonarr', 10000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'SDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 521

-- --- BEGIN op 522 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '1080p HDTV', 'radarr', 340000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '1080p HDTV'
    AND arr_type = 'radarr'
);
-- --- END op 522

-- --- BEGIN op 523 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '1080p HDTV', 'sonarr', 340000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '1080p HDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 523

-- --- BEGIN op 524 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p HDTV', 'radarr', 240000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p HDTV'
    AND arr_type = 'radarr'
);
-- --- END op 524

-- --- BEGIN op 525 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p HDTV', 'sonarr', 240000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p HDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 525

-- --- BEGIN op 526 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '1080p HDTV Tier 1', 'radarr', 102000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '1080p HDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 526

-- --- BEGIN op 527 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '1080p HDTV Tier 1', 'sonarr', 102000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '1080p HDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 527

-- --- BEGIN op 528 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '1080p HDTV Tier 2', 'radarr', 101000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '1080p HDTV Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 528

-- --- BEGIN op 529 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '1080p HDTV Tier 2', 'sonarr', 101000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '1080p HDTV Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 529

-- --- BEGIN op 530 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '1080p HDTV Tier 3', 'radarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '1080p HDTV Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 530

-- --- BEGIN op 531 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '1080p HDTV Tier 3', 'sonarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '1080p HDTV Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 531

-- --- BEGIN op 532 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p HDTV Tier 1', 'radarr', 82000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p HDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 532

-- --- BEGIN op 533 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p HDTV Tier 1', 'sonarr', 82000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p HDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 533

-- --- BEGIN op 534 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p HDTV Tier 2', 'radarr', 81000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p HDTV Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 534

-- --- BEGIN op 535 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p HDTV Tier 2', 'sonarr', 81000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p HDTV Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 535

-- --- BEGIN op 536 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p HDTV Tier 3', 'radarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p HDTV Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 536

-- --- BEGIN op 537 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', '720p HDTV Tier 3', 'sonarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = '720p HDTV Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 537

-- --- BEGIN op 538 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 0
  AND enabled = 1
  AND upgrade_until = 1;

DELETE FROM quality_group_members
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '720p Quality'
  AND name = '720p Quality';
-- --- END op 538

-- --- BEGIN op 539 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '720p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '720p Quality'
  AND name = '480p Quality';
-- --- END op 539

-- --- BEGIN op 540 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Bluray-720p', NULL, 0, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Bluray-720p'
    AND quality_group_name IS NULL
);
-- --- END op 540

-- --- BEGIN op 541 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WEBDL-720p', NULL, 1, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WEBDL-720p'
    AND quality_group_name IS NULL
);
-- --- END op 541

-- --- BEGIN op 542 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WEBRip-720p', NULL, 2, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WEBRip-720p'
    AND quality_group_name IS NULL
);
-- --- END op 542

-- --- BEGIN op 543 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'HDTV-720p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'HDTV-720p'
    AND quality_group_name IS NULL
);
-- --- END op 543

-- --- BEGIN op 544 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'HDTV-1080p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'HDTV-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 544

-- --- BEGIN op 545 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Bluray-576p', NULL, 5, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Bluray-576p'
    AND quality_group_name IS NULL
);
-- --- END op 545

-- --- BEGIN op 546 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Bluray-480p', NULL, 6, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Bluray-480p'
    AND quality_group_name IS NULL
);
-- --- END op 546

-- --- BEGIN op 547 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WEBDL-480p', NULL, 7, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WEBDL-480p'
    AND quality_group_name IS NULL
);
-- --- END op 547

-- --- BEGIN op 548 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'DVD', NULL, 8, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'DVD'
    AND quality_group_name IS NULL
);
-- --- END op 548

-- --- BEGIN op 549 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'BR-DISK', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 549

-- --- BEGIN op 550 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Bluray-1080p', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Bluray-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 550

-- --- BEGIN op 551 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Bluray-2160p', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Bluray-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 551

-- --- BEGIN op 552 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'CAM', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 552

-- --- BEGIN op 553 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'DVD-R', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 553

-- --- BEGIN op 554 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'DVDSCR', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 554

-- --- BEGIN op 555 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'HDTV-2160p', NULL, 15, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 555

-- --- BEGIN op 556 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'HDTV-480p', NULL, 16, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 556

-- --- BEGIN op 557 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'REGIONAL', NULL, 17, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 557

-- --- BEGIN op 558 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Raw-HD', NULL, 18, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 558

-- --- BEGIN op 559 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Remux-1080p', NULL, 19, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Remux-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 559

-- --- BEGIN op 560 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Remux-2160p', NULL, 20, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Remux-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 560

-- --- BEGIN op 561 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'SDTV', NULL, 21, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'SDTV'
    AND quality_group_name IS NULL
);
-- --- END op 561

-- --- BEGIN op 562 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'TELECINE', NULL, 22, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 562

-- --- BEGIN op 563 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'TELESYNC', NULL, 23, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 563

-- --- BEGIN op 564 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'Unknown', NULL, 24, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 564

-- --- BEGIN op 565 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WEBDL-1080p', NULL, 25, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WEBDL-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 565

-- --- BEGIN op 566 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WEBDL-2160p', NULL, 26, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WEBDL-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 566

-- --- BEGIN op 567 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WEBRip-1080p', NULL, 27, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WEBRip-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 567

-- --- BEGIN op 568 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WEBRip-2160p', NULL, 28, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WEBRip-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 568

-- --- BEGIN op 569 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WEBRip-480p', NULL, 29, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 569

-- --- BEGIN op 570 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', 'WORKPRINT', NULL, 30, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 570

-- --- BEGIN op 571 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET enabled = 1
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-720p'
  AND quality_group_name IS NULL
  AND position = 3
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 571

-- --- BEGIN op 572 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET enabled = 1
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-1080p'
  AND quality_group_name IS NULL
  AND position = 4
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 572

-- --- BEGIN op 573 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 9, enabled = 1
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'SDTV'
  AND quality_group_name IS NULL
  AND position = 21
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 573

-- --- BEGIN op 574 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 10
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'BR-DISK'
  AND quality_group_name IS NULL
  AND position = 9
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 574

-- --- BEGIN op 575 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 11
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-1080p'
  AND quality_group_name IS NULL
  AND position = 10
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 575

-- --- BEGIN op 576 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 12
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-2160p'
  AND quality_group_name IS NULL
  AND position = 11
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 576

-- --- BEGIN op 577 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 13
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'CAM'
  AND quality_group_name IS NULL
  AND position = 12
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 577

-- --- BEGIN op 578 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 14
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'DVD-R'
  AND quality_group_name IS NULL
  AND position = 13
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 578

-- --- BEGIN op 579 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 15
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'DVDSCR'
  AND quality_group_name IS NULL
  AND position = 14
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 579

-- --- BEGIN op 580 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 16
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-2160p'
  AND quality_group_name IS NULL
  AND position = 15
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 580

-- --- BEGIN op 581 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 17
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-480p'
  AND quality_group_name IS NULL
  AND position = 16
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 581

-- --- BEGIN op 582 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 18
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'REGIONAL'
  AND quality_group_name IS NULL
  AND position = 17
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 582

-- --- BEGIN op 583 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 19
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Raw-HD'
  AND quality_group_name IS NULL
  AND position = 18
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 583

-- --- BEGIN op 584 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 20
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Remux-1080p'
  AND quality_group_name IS NULL
  AND position = 19
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 584

-- --- BEGIN op 585 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 21
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Remux-2160p'
  AND quality_group_name IS NULL
  AND position = 20
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 585

-- --- BEGIN op 586 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 10
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Remux-2160p'
  AND quality_group_name IS NULL
  AND position = 21
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 586

-- --- BEGIN op 587 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 11
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-2160p'
  AND quality_group_name IS NULL
  AND position = 12
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 587

-- --- BEGIN op 588 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 12
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBDL-2160p'
  AND quality_group_name IS NULL
  AND position = 26
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 588

-- --- BEGIN op 589 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 13
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBRip-2160p'
  AND quality_group_name IS NULL
  AND position = 28
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 589

-- --- BEGIN op 590 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 14
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-2160p'
  AND quality_group_name IS NULL
  AND position = 16
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 590

-- --- BEGIN op 591 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 15
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Remux-1080p'
  AND quality_group_name IS NULL
  AND position = 20
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 591

-- --- BEGIN op 592 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 16
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-1080p'
  AND quality_group_name IS NULL
  AND position = 11
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 592

-- --- BEGIN op 593 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 17
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBDL-1080p'
  AND quality_group_name IS NULL
  AND position = 25
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 593

-- --- BEGIN op 594 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 18
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBRip-1080p'
  AND quality_group_name IS NULL
  AND position = 27
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 594

-- --- BEGIN op 595 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 19
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBRip-480p'
  AND quality_group_name IS NULL
  AND position = 29
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 595

-- --- BEGIN op 596 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 20
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-480p'
  AND quality_group_name IS NULL
  AND position = 17
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 596

-- --- BEGIN op 597 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 21
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'BR-DISK'
  AND quality_group_name IS NULL
  AND position = 10
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 597

-- --- BEGIN op 598 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 22
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'CAM'
  AND quality_group_name IS NULL
  AND position = 13
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 598

-- --- BEGIN op 599 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 23
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'DVD-R'
  AND quality_group_name IS NULL
  AND position = 14
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 599

-- --- BEGIN op 600 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 24
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'DVDSCR'
  AND quality_group_name IS NULL
  AND position = 15
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 600

-- --- BEGIN op 601 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 25
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'REGIONAL'
  AND quality_group_name IS NULL
  AND position = 18
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 601

-- --- BEGIN op 602 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 26
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Raw-HD'
  AND quality_group_name IS NULL
  AND position = 19
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 602

-- --- BEGIN op 603 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 27
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'TELECINE'
  AND quality_group_name IS NULL
  AND position = 22
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 603

-- --- BEGIN op 604 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 28
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'TELESYNC'
  AND quality_group_name IS NULL
  AND position = 23
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 604

-- --- BEGIN op 605 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 29
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WORKPRINT'
  AND quality_group_name IS NULL
  AND position = 30
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 605

-- --- BEGIN op 606 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 30
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Unknown'
  AND quality_group_name IS NULL
  AND position = 24
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 606

-- --- BEGIN op 607 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 3
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-1080p'
  AND quality_group_name IS NULL
  AND position = 4
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 607

-- --- BEGIN op 608 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 4
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-720p'
  AND quality_group_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 608

-- --- BEGIN op 609 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-720p'
  AND quality_group_name IS NULL
  AND position = 0
  AND enabled = 1
  AND upgrade_until = 1;
-- --- END op 609

-- --- BEGIN op 610 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBDL-720p'
  AND quality_group_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 610

-- --- BEGIN op 611 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBRip-720p'
  AND quality_group_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 611

-- --- BEGIN op 612 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-1080p'
  AND quality_group_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 612

-- --- BEGIN op 613 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-720p'
  AND quality_group_name IS NULL
  AND position = 4
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 613

-- --- BEGIN op 614 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-576p'
  AND quality_group_name IS NULL
  AND position = 5
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 614

-- --- BEGIN op 615 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-480p'
  AND quality_group_name IS NULL
  AND position = 6
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 615

-- --- BEGIN op 616 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBDL-480p'
  AND quality_group_name IS NULL
  AND position = 7
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 616

-- --- BEGIN op 617 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'DVD'
  AND quality_group_name IS NULL
  AND position = 8
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 617

-- --- BEGIN op 618 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'SDTV'
  AND quality_group_name IS NULL
  AND position = 9
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 618

-- --- BEGIN op 619 ( update quality_profile "720p Quality" )
INSERT INTO quality_groups (quality_profile_name, name)
SELECT '720p Quality', '720p Quality'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_groups
  WHERE quality_profile_name = '720p Quality'
    AND name = '720p Quality'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '720p Quality', '720p Quality', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '720p Quality'
    AND quality_group_name = '720p Quality'
    AND quality_name = 'WEBRip-720p'
);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '720p Quality', NULL, '720p Quality', 0, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '720p Quality'
    AND quality_name IS NULL
    AND quality_group_name = '720p Quality'
);
-- --- END op 619

-- --- BEGIN op 620 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 1
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Remux-2160p'
  AND quality_group_name IS NULL
  AND position = 10
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 620

-- --- BEGIN op 621 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 2
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-2160p'
  AND quality_group_name IS NULL
  AND position = 11
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 621

-- --- BEGIN op 622 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 3
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBDL-2160p'
  AND quality_group_name IS NULL
  AND position = 12
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 622

-- --- BEGIN op 623 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 4
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBRip-2160p'
  AND quality_group_name IS NULL
  AND position = 13
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 623

-- --- BEGIN op 624 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 5
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-2160p'
  AND quality_group_name IS NULL
  AND position = 14
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 624

-- --- BEGIN op 625 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 6
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Remux-1080p'
  AND quality_group_name IS NULL
  AND position = 15
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 625

-- --- BEGIN op 626 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 7
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Bluray-1080p'
  AND quality_group_name IS NULL
  AND position = 16
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 626

-- --- BEGIN op 627 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 8
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBDL-1080p'
  AND quality_group_name IS NULL
  AND position = 17
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 627

-- --- BEGIN op 628 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 9
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBRip-1080p'
  AND quality_group_name IS NULL
  AND position = 18
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 628

-- --- BEGIN op 629 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 10
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WEBRip-480p'
  AND quality_group_name IS NULL
  AND position = 19
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 629

-- --- BEGIN op 630 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 11
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'HDTV-480p'
  AND quality_group_name IS NULL
  AND position = 20
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 630

-- --- BEGIN op 631 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 12
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'BR-DISK'
  AND quality_group_name IS NULL
  AND position = 21
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 631

-- --- BEGIN op 632 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 13
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'CAM'
  AND quality_group_name IS NULL
  AND position = 22
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 632

-- --- BEGIN op 633 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 14
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'DVD-R'
  AND quality_group_name IS NULL
  AND position = 23
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 633

-- --- BEGIN op 634 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 15
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'DVDSCR'
  AND quality_group_name IS NULL
  AND position = 24
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 634

-- --- BEGIN op 635 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 16
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'REGIONAL'
  AND quality_group_name IS NULL
  AND position = 25
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 635

-- --- BEGIN op 636 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 17
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Raw-HD'
  AND quality_group_name IS NULL
  AND position = 26
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 636

-- --- BEGIN op 637 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 18
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'TELECINE'
  AND quality_group_name IS NULL
  AND position = 27
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 637

-- --- BEGIN op 638 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 19
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'TELESYNC'
  AND quality_group_name IS NULL
  AND position = 28
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 638

-- --- BEGIN op 639 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 20
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'WORKPRINT'
  AND quality_group_name IS NULL
  AND position = 29
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 639

-- --- BEGIN op 640 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 21
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Unknown'
  AND quality_group_name IS NULL
  AND position = 30
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 640
