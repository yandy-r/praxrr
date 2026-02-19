-- @operation: export
-- @entity: batch
-- @name: Add Remaining CF Descriptions
-- @exportedAt: 2026-02-04T19:32:19.128Z
-- @opIds: 291, 292, 293, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325

-- --- BEGIN op 291 ( update custom_format "HONE Bluray" )
update "custom_formats" set "description" = 'Matches 1080p x265 Hone Blurays' where "name" = 'HONE Bluray' and "description" = '';
-- --- END op 291

-- --- BEGIN op 292 ( update custom_format "HONE WEB" )
update "custom_formats" set "description" = 'Matches 1080p x265 HONE WEB-DLs via Release Title Parsing' where "name" = 'HONE WEB' and "description" = '';
-- --- END op 292

-- --- BEGIN op 293 ( update custom_format "HONE Bluray" )
update "custom_formats" set "description" = 'Matches 1080p x265 Hone Blurays via Release Title Parsing' where "name" = 'HONE Bluray' and "description" = 'Matches 1080p x265 Hone Blurays';
-- --- END op 293

-- --- BEGIN op 307 ( update custom_format "QxR Bluray" )
update "custom_formats" set "description" = 'Matches 1080p QxR Blurays via Release Title Parsing' where "name" = 'QxR Bluray' and "description" = '';
-- --- END op 307

-- --- BEGIN op 308 ( update custom_format "QxR Blurays" )
update "custom_formats" set "description" = 'Matches 2160p QxR Blurays via Release Title Parsing' where "name" = 'QxR Blurays' and "description" = '';
-- --- END op 308

-- --- BEGIN op 309 ( update custom_format "QxR WEBs" )
update "custom_formats" set "description" = 'Matches 2160p QxR WEBs via Releases Title Parsing' where "name" = 'QxR WEBs' and "description" = '';
-- --- END op 309

-- --- BEGIN op 310 ( update custom_format "TAoE Bluray" )
update "custom_formats" set "description" = 'Matches 1080p TAoE Blurays via Release Title Parsing' where "name" = 'TAoE Bluray' and "description" = '';
-- --- END op 310

-- --- BEGIN op 311 ( update custom_format "TAoE Blurays" )
update "custom_formats" set "description" = 'Matches 2160p TAoE Blurays via Release Title Parsing' where "name" = 'TAoE Blurays' and "description" = '';
-- --- END op 311

-- --- BEGIN op 312 ( update custom_format "TAoE WEB" )
update "custom_formats" set "description" = 'Matches 1080p TAoE WEBs via Release Title Parsing' where "name" = 'TAoE WEB' and "description" = '';
-- --- END op 312

-- --- BEGIN op 313 ( update custom_format "TAoE WEBs" )
update "custom_formats" set "description" = 'Matches 2160p TAoE WEBs via Release Title Parsing' where "name" = 'TAoE WEBs' and "description" = '';
-- --- END op 313

-- --- BEGIN op 314 ( update custom_format "Vialle Bluray" )
update "custom_formats" set "description" = 'Matches 1080p Vialle Blurays via Release Title Parsing' where "name" = 'Vialle Bluray' and "description" = '';
-- --- END op 314

-- --- BEGIN op 315 ( update custom_format "Vialle WEB" )
update "custom_formats" set "description" = 'Matches 1080p Vialle WEBs via Release Title Parsing' where "name" = 'Vialle WEB' and "description" = '';
-- --- END op 315

-- --- BEGIN op 316 ( update custom_format "Weasley WEB" )
update "custom_formats" set "description" = 'Matches 1080p Weasley HONE WEBs via Release Title Parsing' where "name" = 'Weasley WEB' and "description" = '';
-- --- END op 316

-- --- BEGIN op 317 ( update custom_format "h265" )
update "custom_formats" set "description" = 'Matches H265 Releases that are not 2160p' where "name" = 'h265' and "description" = 'Matches ''h265'' regex pattern.';
-- --- END op 317

-- --- BEGIN op 318 ( update custom_format "h265" )
update "custom_formats" set "description" = 'Matches h265 Releases that are not 2160p' where "name" = 'h265' and "description" = 'Matches H265 Releases that are not 2160p';
-- --- END op 318

-- --- BEGIN op 319 ( update custom_format "h265 (Efficient)" )
update "custom_formats" set "description" = 'Matches h265 Releases that are not 2160p or 1080p' where "name" = 'h265 (Efficient)' and "description" = 'Matches ''h265'' regex pattern.';
-- --- END op 319

-- --- BEGIN op 320 ( update custom_format "x264 (2160p)" )
update "custom_formats" set "description" = 'Matches x264 releases for 2160p' where "name" = 'x264 (2160p)' and "description" = 'Matches ''x264'' regex pattern only when 2160p is also found. ';
-- --- END op 320

-- --- BEGIN op 321 ( update custom_format "x265" )
update "custom_formats" set "description" = 'Matches x265 Releases when not 2160p' where "name" = 'x265' and "description" = 'Matches ''x265'' regex pattern.';
-- --- END op 321

-- --- BEGIN op 322 ( update custom_format "x265 (Bluray)" )
update "custom_formats" set "description" = 'Matches x265 Bluray Releases when not 2160p' where "name" = 'x265 (Bluray)' and "description" = 'Matches ''x265'' regex pattern.';
-- --- END op 322

-- --- BEGIN op 323 ( update custom_format "x265 (Efficient)" )
update "custom_formats" set "description" = 'Matches x/h265 Releases when not 2160p or 1080p' where "name" = 'x265 (Efficient)' and "description" = 'Matches ''x265'' regex pattern.';
-- --- END op 323

-- --- BEGIN op 324 ( update custom_format "x265 (Remux)" )
update "custom_formats" set "description" = 'Matches x265 Remux Releases when not 2160p' where "name" = 'x265 (Remux)' and "description" = 'Matches ''x265'' regex pattern.';
-- --- END op 324

-- --- BEGIN op 325 ( update custom_format "x265 (WEB)" )
update "custom_formats" set "description" = 'Matches x265 Releases when not 2160p or Blurays' where "name" = 'x265 (WEB)' and "description" = 'Matches ''x265'' regex pattern.';
-- --- END op 325
