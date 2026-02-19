-- @operation: export
-- @entity: batch
-- @name: Regroup and Reorder Quality Rankings for All Profiles for Testing
-- @exportedAt: 2026-02-10T18:42:19.036Z
-- @opIds: 1564, 1565, 1566, 1567, 1568, 1569, 1570, 1571, 1572, 1573, 1574, 1575, 1576, 1577, 1578, 1579, 1580, 1581, 1582, 1583, 1584, 1585, 1586, 1587, 1588, 1589, 1590, 1591, 1592, 1593, 1594, 1595, 1596, 1597, 1598, 1599, 1600, 1601, 1602, 1603, 1604, 1605, 1606, 1607, 1608, 1609, 1610, 1611, 1612, 1613, 1614, 1615, 1616, 1617, 1618, 1619, 1620, 1621, 1622, 1623, 1624, 1625, 1626, 1627, 1628, 1629, 1630, 1631, 1632, 1633, 1634, 1635, 1636, 1637, 1638, 1639, 1640, 1641, 1642, 1643, 1644, 1645, 1646, 1647, 1648, 1649, 1650, 1651, 1652, 1653, 1654, 1655, 1656, 1657, 1658, 1659, 1660, 1661, 1662, 1663, 1664, 1665, 1666, 1667, 1668, 1669, 1670, 1671, 1672, 1673, 1674, 1675, 1676, 1677, 1678, 1679, 1680, 1681, 1682, 1683, 1684, 1685, 1686, 1687, 1688, 1689, 1690, 1691, 1692, 1693, 1694, 1695, 1696, 1697, 1698, 1699, 1700, 1701, 1702, 1703, 1704, 1705, 1706, 1707, 1708, 1709, 1710, 1711, 1712, 1713, 1714, 1715, 1716, 1717, 1718, 1719, 1720, 1721, 1722, 1723, 1724, 1725, 1726, 1727, 1728, 1729, 1730, 1731, 1732, 1733, 1734, 1735, 1736, 1737, 1738, 1739, 1740, 1741, 1742, 1743, 1744, 1745, 1746, 1747, 1748, 1749, 1750, 1751, 1752, 1753, 1754, 1755, 1756, 1757, 1758, 1759, 1760, 1761, 1762, 1763, 1764, 1765, 1766, 1767, 1768, 1769, 1770, 1771, 1772, 1773, 1774, 1775, 1776, 1777, 1778, 1779, 1780, 1781, 1782, 1783, 1784, 1785, 1786, 1787, 1788, 1789, 1790, 1791, 1792, 1793, 1794, 1795, 1796, 1797, 1798, 1799, 1800, 1801, 1802, 1803, 1804, 1805, 1806, 1807, 1808, 1809, 1810, 1811, 1812

-- --- BEGIN op 1564 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '1080p Balanced'
  AND quality_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 1;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '1080p Balanced'
  AND quality_name = 'Bluray-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '1080p Balanced'
  AND quality_name = 'WEBDL-1080p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Balanced'
  AND name = '1080p Balanced';
-- --- END op 1564

-- --- BEGIN op 1565 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 4
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Balanced'
  AND name = '720p Quality';
-- --- END op 1565

-- --- BEGIN op 1566 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 5
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Balanced'
  AND name = '480p Quality';
-- --- END op 1566

-- --- BEGIN op 1567 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'Bluray-1080p', NULL, 0, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'Bluray-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 1567

-- --- BEGIN op 1568 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'WEBDL-1080p', NULL, 1, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'WEBDL-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 1568

-- --- BEGIN op 1569 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'Bluray-720p', NULL, 2, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'Bluray-720p'
    AND quality_group_name IS NULL
);
-- --- END op 1569

-- --- BEGIN op 1570 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'WEBDL-720p', NULL, 3, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'WEBDL-720p'
    AND quality_group_name IS NULL
);
-- --- END op 1570

-- --- BEGIN op 1571 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'WEBRip-720p', NULL, 4, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'WEBRip-720p'
    AND quality_group_name IS NULL
);
-- --- END op 1571

-- --- BEGIN op 1572 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'Bluray-576p', NULL, 7, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'Bluray-576p'
    AND quality_group_name IS NULL
);
-- --- END op 1572

-- --- BEGIN op 1573 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'Bluray-480p', NULL, 8, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'Bluray-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1573

-- --- BEGIN op 1574 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'WEBDL-480p', NULL, 9, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'WEBDL-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1574

-- --- BEGIN op 1575 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', 'DVD', NULL, 10, 1, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name = 'DVD'
    AND quality_group_name IS NULL
);
-- --- END op 1575

-- --- BEGIN op 1576 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 5
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'HDTV-1080p'
  AND quality_group_name IS NULL
  AND position = 10
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1576

-- --- BEGIN op 1577 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 6
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'HDTV-720p'
  AND quality_group_name IS NULL
  AND position = 13
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1577

-- --- BEGIN op 1578 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 11
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'SDTV'
  AND quality_group_name IS NULL
  AND position = 17
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1578

-- --- BEGIN op 1579 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 12
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Remux-2160p'
  AND quality_group_name IS NULL
  AND position = 0
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1579

-- --- BEGIN op 1580 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 13
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Bluray-2160p'
  AND quality_group_name IS NULL
  AND position = 1
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1580

-- --- BEGIN op 1581 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 14
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBDL-2160p'
  AND quality_group_name IS NULL
  AND position = 2
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1581

-- --- BEGIN op 1582 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 15
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBRip-2160p'
  AND quality_group_name IS NULL
  AND position = 22
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1582

-- --- BEGIN op 1583 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 16
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'HDTV-2160p'
  AND quality_group_name IS NULL
  AND position = 11
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1583

-- --- BEGIN op 1584 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 17
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Remux-1080p'
  AND quality_group_name IS NULL
  AND position = 16
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1584

-- --- BEGIN op 1585 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 18
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBRip-1080p'
  AND quality_group_name IS NULL
  AND position = 21
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1585

-- --- BEGIN op 1586 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 19
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBRip-480p'
  AND quality_group_name IS NULL
  AND position = 23
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1586

-- --- BEGIN op 1587 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 20
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'HDTV-480p'
  AND quality_group_name IS NULL
  AND position = 12
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1587

-- --- BEGIN op 1588 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 21
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'BR-DISK'
  AND quality_group_name IS NULL
  AND position = 6
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1588

-- --- BEGIN op 1589 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 22
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'CAM'
  AND quality_group_name IS NULL
  AND position = 7
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1589

-- --- BEGIN op 1590 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 23
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'DVD-R'
  AND quality_group_name IS NULL
  AND position = 8
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1590

-- --- BEGIN op 1591 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 24
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'DVDSCR'
  AND quality_group_name IS NULL
  AND position = 9
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1591

-- --- BEGIN op 1592 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 25
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Raw-HD'
  AND quality_group_name IS NULL
  AND position = 15
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1592

-- --- BEGIN op 1593 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 26
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'REGIONAL'
  AND quality_group_name IS NULL
  AND position = 14
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1593

-- --- BEGIN op 1594 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 27
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'TELECINE'
  AND quality_group_name IS NULL
  AND position = 18
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1594

-- --- BEGIN op 1595 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 28
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'TELESYNC'
  AND quality_group_name IS NULL
  AND position = 19
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1595

-- --- BEGIN op 1596 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 29
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Unknown'
  AND quality_group_name IS NULL
  AND position = 20
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1596

-- --- BEGIN op 1597 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 30
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WORKPRINT'
  AND quality_group_name IS NULL
  AND position = 24
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1597

-- --- BEGIN op 1598 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Bluray-1080p'
  AND quality_group_name IS NULL
  AND position = 0
  AND enabled = 1
  AND upgrade_until = 1;
-- --- END op 1598

-- --- BEGIN op 1599 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBDL-1080p'
  AND quality_group_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1599

-- --- BEGIN op 1600 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Bluray-720p'
  AND quality_group_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1600

-- --- BEGIN op 1601 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBDL-720p'
  AND quality_group_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1601

-- --- BEGIN op 1602 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBRip-720p'
  AND quality_group_name IS NULL
  AND position = 4
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1602

-- --- BEGIN op 1603 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'HDTV-1080p'
  AND quality_group_name IS NULL
  AND position = 5
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1603

-- --- BEGIN op 1604 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'HDTV-720p'
  AND quality_group_name IS NULL
  AND position = 6
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1604

-- --- BEGIN op 1605 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Bluray-576p'
  AND quality_group_name IS NULL
  AND position = 7
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1605

-- --- BEGIN op 1606 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Bluray-480p'
  AND quality_group_name IS NULL
  AND position = 8
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1606

-- --- BEGIN op 1607 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBDL-480p'
  AND quality_group_name IS NULL
  AND position = 9
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1607

-- --- BEGIN op 1608 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'DVD'
  AND quality_group_name IS NULL
  AND position = 10
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1608

-- --- BEGIN op 1609 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'SDTV'
  AND quality_group_name IS NULL
  AND position = 11
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1609

-- --- BEGIN op 1610 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_groups (quality_profile_name, name)
SELECT '1080p Balanced', '1080p Balanced'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_groups
  WHERE quality_profile_name = '1080p Balanced'
    AND name = '1080p Balanced'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'Bluray-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'Bluray-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'WEBDL-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'WEBDL-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Balanced', '1080p Balanced', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_group_name = '1080p Balanced'
    AND quality_name = 'WEBRip-720p'
);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Balanced', NULL, '1080p Balanced', 0, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Balanced'
    AND quality_name IS NULL
    AND quality_group_name = '1080p Balanced'
);
-- --- END op 1610

-- --- BEGIN op 1611 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 1
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Remux-2160p'
  AND quality_group_name IS NULL
  AND position = 12
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1611

-- --- BEGIN op 1612 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 2
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Bluray-2160p'
  AND quality_group_name IS NULL
  AND position = 13
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1612

-- --- BEGIN op 1613 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 3
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBDL-2160p'
  AND quality_group_name IS NULL
  AND position = 14
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1613

-- --- BEGIN op 1614 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 4
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBRip-2160p'
  AND quality_group_name IS NULL
  AND position = 15
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1614

-- --- BEGIN op 1615 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 5
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'HDTV-2160p'
  AND quality_group_name IS NULL
  AND position = 16
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1615

-- --- BEGIN op 1616 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 6
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Remux-1080p'
  AND quality_group_name IS NULL
  AND position = 17
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1616

-- --- BEGIN op 1617 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 7
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBRip-1080p'
  AND quality_group_name IS NULL
  AND position = 18
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1617

-- --- BEGIN op 1618 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 8
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WEBRip-480p'
  AND quality_group_name IS NULL
  AND position = 19
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1618

-- --- BEGIN op 1619 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 9
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'HDTV-480p'
  AND quality_group_name IS NULL
  AND position = 20
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1619

-- --- BEGIN op 1620 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 10
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'BR-DISK'
  AND quality_group_name IS NULL
  AND position = 21
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1620

-- --- BEGIN op 1621 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 11
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'CAM'
  AND quality_group_name IS NULL
  AND position = 22
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1621

-- --- BEGIN op 1622 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 12
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'DVD-R'
  AND quality_group_name IS NULL
  AND position = 23
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1622

-- --- BEGIN op 1623 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 13
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'DVDSCR'
  AND quality_group_name IS NULL
  AND position = 24
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1623

-- --- BEGIN op 1624 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 14
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Raw-HD'
  AND quality_group_name IS NULL
  AND position = 25
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1624

-- --- BEGIN op 1625 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 15
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'REGIONAL'
  AND quality_group_name IS NULL
  AND position = 26
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1625

-- --- BEGIN op 1626 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 16
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'TELECINE'
  AND quality_group_name IS NULL
  AND position = 27
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1626

-- --- BEGIN op 1627 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 17
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'TELESYNC'
  AND quality_group_name IS NULL
  AND position = 28
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1627

-- --- BEGIN op 1628 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 18
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'WORKPRINT'
  AND quality_group_name IS NULL
  AND position = 30
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1628

-- --- BEGIN op 1629 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_qualities
SET position = 19
WHERE quality_profile_name = '1080p Balanced'
  AND quality_name = 'Unknown'
  AND quality_group_name IS NULL
  AND position = 29
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1629

-- --- BEGIN op 1630 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Compact'
  AND name = '720p Quality';
-- --- END op 1630

-- --- BEGIN op 1631 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Compact'
  AND quality_name = 'HDTV-1080p'
  AND quality_group_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1631

-- --- BEGIN op 1632 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Compact'
  AND quality_name = 'HDTV-720p'
  AND quality_group_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1632

-- --- BEGIN op 1633 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 4
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Compact'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Compact'
  AND name = '480p Quality';
-- --- END op 1633

-- --- BEGIN op 1634 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Compact'
  AND quality_name = 'SDTV'
  AND quality_group_name IS NULL
  AND position = 5
  AND enabled = 1
  AND upgrade_until = 0;
-- --- END op 1634

-- --- BEGIN op 1635 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'Remux-2160p', NULL, 1, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'Remux-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1635

-- --- BEGIN op 1636 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'Bluray-2160p', NULL, 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'Bluray-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1636

-- --- BEGIN op 1637 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'WEBDL-2160p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'WEBDL-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1637

-- --- BEGIN op 1638 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'WEBRip-2160p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'WEBRip-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1638

-- --- BEGIN op 1639 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'HDTV-2160p', NULL, 5, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1639

-- --- BEGIN op 1640 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'Remux-1080p', NULL, 6, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'Remux-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 1640

-- --- BEGIN op 1641 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'WEBRip-480p', NULL, 7, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1641

-- --- BEGIN op 1642 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'HDTV-480p', NULL, 8, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1642

-- --- BEGIN op 1643 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'BR-DISK', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 1643

-- --- BEGIN op 1644 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'CAM', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 1644

-- --- BEGIN op 1645 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'DVD-R', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 1645

-- --- BEGIN op 1646 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'DVDSCR', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 1646

-- --- BEGIN op 1647 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'Raw-HD', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 1647

-- --- BEGIN op 1648 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'REGIONAL', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 1648

-- --- BEGIN op 1649 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'TELECINE', NULL, 15, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 1649

-- --- BEGIN op 1650 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'TELESYNC', NULL, 16, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 1650

-- --- BEGIN op 1651 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'WORKPRINT', NULL, 17, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 1651

-- --- BEGIN op 1652 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Compact', 'Unknown', NULL, 18, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Compact'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 1652

-- --- BEGIN op 1653 ( update quality_profile "1080p Compact" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Compact', '1080p Compact', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Compact'
    AND quality_group_name = '1080p Compact'
    AND quality_name = 'WEBRip-720p'
);
-- --- END op 1653

-- --- BEGIN op 1654 ( update quality_profile "1080p Efficient" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Efficient'
  AND name = '720p Quality';
-- --- END op 1654

-- --- BEGIN op 1655 ( update quality_profile "1080p Efficient" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Efficient'
  AND name = '480p Quality';
-- --- END op 1655

-- --- BEGIN op 1656 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'Remux-2160p', NULL, 1, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'Remux-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1656

-- --- BEGIN op 1657 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'Bluray-2160p', NULL, 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'Bluray-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1657

-- --- BEGIN op 1658 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'WEBDL-2160p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'WEBDL-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1658

-- --- BEGIN op 1659 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'WEBRip-2160p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'WEBRip-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1659

-- --- BEGIN op 1660 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'HDTV-2160p', NULL, 5, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1660

-- --- BEGIN op 1661 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'Remux-1080p', NULL, 6, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'Remux-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 1661

-- --- BEGIN op 1662 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'WEBRip-480p', NULL, 7, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1662

-- --- BEGIN op 1663 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'HDTV-480p', NULL, 8, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1663

-- --- BEGIN op 1664 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'BR-DISK', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 1664

-- --- BEGIN op 1665 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'CAM', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 1665

-- --- BEGIN op 1666 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'DVD-R', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 1666

-- --- BEGIN op 1667 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'DVDSCR', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 1667

-- --- BEGIN op 1668 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'Raw-HD', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 1668

-- --- BEGIN op 1669 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'REGIONAL', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 1669

-- --- BEGIN op 1670 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'TELECINE', NULL, 15, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 1670

-- --- BEGIN op 1671 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'TELESYNC', NULL, 16, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 1671

-- --- BEGIN op 1672 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'WORKPRINT', NULL, 17, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 1672

-- --- BEGIN op 1673 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Efficient', 'Unknown', NULL, 18, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 1673

-- --- BEGIN op 1674 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Efficient', '1080p Efficient', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Efficient'
    AND quality_group_name = '1080p Efficient'
    AND quality_name = 'WEBRip-720p'
);
-- --- END op 1674

-- --- BEGIN op 1675 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Quality'
  AND name = '720p Quality';
-- --- END op 1675

-- --- BEGIN op 1676 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Quality'
  AND name = '480p Quality';
-- --- END op 1676

-- --- BEGIN op 1677 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'Remux-2160p', NULL, 1, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'Remux-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1677

-- --- BEGIN op 1678 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'Bluray-2160p', NULL, 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'Bluray-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1678

-- --- BEGIN op 1679 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'WEBDL-2160p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'WEBDL-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1679

-- --- BEGIN op 1680 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'WEBRip-2160p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'WEBRip-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1680

-- --- BEGIN op 1681 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'HDTV-2160p', NULL, 5, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1681

-- --- BEGIN op 1682 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'Remux-1080p', NULL, 6, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'Remux-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 1682

-- --- BEGIN op 1683 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'WEBRip-480p', NULL, 7, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1683

-- --- BEGIN op 1684 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'HDTV-480p', NULL, 8, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1684

-- --- BEGIN op 1685 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'BR-DISK', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 1685

-- --- BEGIN op 1686 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'CAM', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 1686

-- --- BEGIN op 1687 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'DVD-R', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 1687

-- --- BEGIN op 1688 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'DVDSCR', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 1688

-- --- BEGIN op 1689 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'Raw-HD', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 1689

-- --- BEGIN op 1690 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'REGIONAL', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 1690

-- --- BEGIN op 1691 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'TELECINE', NULL, 15, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 1691

-- --- BEGIN op 1692 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'TELESYNC', NULL, 16, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 1692

-- --- BEGIN op 1693 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'WORKPRINT', NULL, 17, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 1693

-- --- BEGIN op 1694 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Quality', 'Unknown', NULL, 18, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Quality'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 1694

-- --- BEGIN op 1695 ( update quality_profile "1080p Quality" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality', '1080p Quality', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality'
    AND quality_group_name = '1080p Quality'
    AND quality_name = 'WEBRip-720p'
);
-- --- END op 1695

-- --- BEGIN op 1696 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'HDTV-1080p'
  AND quality_group_name IS NULL
  AND position = 6
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1696

-- --- BEGIN op 1697 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'HDTV-720p'
  AND quality_group_name IS NULL
  AND position = 9
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1697

-- --- BEGIN op 1698 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'SDTV'
  AND quality_group_name IS NULL
  AND position = 14
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1698

-- --- BEGIN op 1699 ( update quality_profile "1080p Quality HDR" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality HDR', '1080p Quality HDR', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality HDR'
    AND quality_group_name = '1080p Quality HDR'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality HDR', '1080p Quality HDR', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality HDR'
    AND quality_group_name = '1080p Quality HDR'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Quality HDR', '1080p Quality HDR', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Quality HDR'
    AND quality_group_name = '1080p Quality HDR'
    AND quality_name = 'SDTV'
);
-- --- END op 1699

-- --- BEGIN op 1700 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 1
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Remux-2160p'
  AND quality_group_name IS NULL
  AND position = 13
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1700

-- --- BEGIN op 1701 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 3
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'WEBDL-2160p'
  AND quality_group_name IS NULL
  AND position = 18
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1701

-- --- BEGIN op 1702 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 4
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-2160p'
  AND quality_group_name IS NULL
  AND position = 19
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1702

-- --- BEGIN op 1703 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 5
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'HDTV-2160p'
  AND quality_group_name IS NULL
  AND position = 7
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1703

-- --- BEGIN op 1704 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 6
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Remux-1080p'
  AND quality_group_name IS NULL
  AND position = 12
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1704

-- --- BEGIN op 1705 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 7
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-480p'
  AND quality_group_name IS NULL
  AND position = 20
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1705

-- --- BEGIN op 1706 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 9
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'BR-DISK'
  AND quality_group_name IS NULL
  AND position = 1
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1706

-- --- BEGIN op 1707 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 10
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'CAM'
  AND quality_group_name IS NULL
  AND position = 3
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1707

-- --- BEGIN op 1708 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 11
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'DVD-R'
  AND quality_group_name IS NULL
  AND position = 4
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1708

-- --- BEGIN op 1709 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 12
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'DVDSCR'
  AND quality_group_name IS NULL
  AND position = 5
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1709

-- --- BEGIN op 1710 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 13
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Raw-HD'
  AND quality_group_name IS NULL
  AND position = 11
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1710

-- --- BEGIN op 1711 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 14
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'REGIONAL'
  AND quality_group_name IS NULL
  AND position = 10
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1711

-- --- BEGIN op 1712 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 17
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'WORKPRINT'
  AND quality_group_name IS NULL
  AND position = 21
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1712

-- --- BEGIN op 1713 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_qualities
SET position = 18
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Unknown'
  AND quality_group_name IS NULL
  AND position = 17
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1713

-- --- BEGIN op 1714 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Remux'
  AND name = '720p Quality';
-- --- END op 1714

-- --- BEGIN op 1715 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Remux'
  AND name = '480p Quality';
-- --- END op 1715

-- --- BEGIN op 1716 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'Remux-2160p', NULL, 1, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'Remux-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1716

-- --- BEGIN op 1717 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'Bluray-2160p', NULL, 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'Bluray-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1717

-- --- BEGIN op 1718 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'WEBDL-2160p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'WEBDL-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1718

-- --- BEGIN op 1719 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'WEBRip-2160p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'WEBRip-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1719

-- --- BEGIN op 1720 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'HDTV-2160p', NULL, 5, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1720

-- --- BEGIN op 1721 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'WEBRip-480p', NULL, 6, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1721

-- --- BEGIN op 1722 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'HDTV-480p', NULL, 7, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1722

-- --- BEGIN op 1723 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'BR-DISK', NULL, 8, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 1723

-- --- BEGIN op 1724 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'CAM', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 1724

-- --- BEGIN op 1725 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'DVD-R', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 1725

-- --- BEGIN op 1726 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'DVDSCR', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 1726

-- --- BEGIN op 1727 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'Raw-HD', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 1727

-- --- BEGIN op 1728 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'REGIONAL', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 1728

-- --- BEGIN op 1729 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'TELECINE', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 1729

-- --- BEGIN op 1730 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'TELESYNC', NULL, 15, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 1730

-- --- BEGIN op 1731 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'WORKPRINT', NULL, 16, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 1731

-- --- BEGIN op 1732 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '1080p Remux', 'Unknown', NULL, 17, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '1080p Remux'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 1732

-- --- BEGIN op 1733 ( update quality_profile "1080p Remux" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '1080p Remux', '1080p Remux', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '1080p Remux'
    AND quality_group_name = '1080p Remux'
    AND quality_name = 'WEBRip-720p'
);
-- --- END op 1733

-- --- BEGIN op 1734 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'Bluray-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBDL-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-1080p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Balanced'
  AND name = '1080p Quality HDR';
-- --- END op 1734

-- --- BEGIN op 1735 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Balanced'
  AND name = '720p Quality';
-- --- END op 1735

-- --- BEGIN op 1736 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Balanced'
  AND name = '480p Quality';
-- --- END op 1736

-- --- BEGIN op 1737 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'Remux-2160p', NULL, 1, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'Remux-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1737

-- --- BEGIN op 1738 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'WEBRip-2160p', NULL, 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'WEBRip-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1738

-- --- BEGIN op 1739 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'HDTV-2160p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1739

-- --- BEGIN op 1740 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'Remux-1080p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'Remux-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 1740

-- --- BEGIN op 1741 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'WEBRip-480p', NULL, 5, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1741

-- --- BEGIN op 1742 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'HDTV-480p', NULL, 6, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1742

-- --- BEGIN op 1743 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'BR-DISK', NULL, 7, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 1743

-- --- BEGIN op 1744 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'CAM', NULL, 8, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 1744

-- --- BEGIN op 1745 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'DVD-R', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 1745

-- --- BEGIN op 1746 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'DVDSCR', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 1746

-- --- BEGIN op 1747 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'Raw-HD', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 1747

-- --- BEGIN op 1748 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'REGIONAL', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 1748

-- --- BEGIN op 1749 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'TELECINE', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 1749

-- --- BEGIN op 1750 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'TELESYNC', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 1750

-- --- BEGIN op 1751 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'WORKPRINT', NULL, 15, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 1751

-- --- BEGIN op 1752 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Balanced', 'Unknown', NULL, 16, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 1752

-- --- BEGIN op 1753 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'Bluray-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'Bluray-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'WEBDL-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'WEBDL-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'WEBRip-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'WEBRip-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Balanced', '2160p Balanced', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Balanced'
    AND quality_group_name = '2160p Balanced'
    AND quality_name = 'WEBRip-720p'
);
-- --- END op 1753

-- --- BEGIN op 1754 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '1080p Efficient'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '1080p Efficient'
  AND quality_name = 'Bluray-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '1080p Efficient'
  AND quality_name = 'WEBDL-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '1080p Efficient'
  AND quality_name = 'WEBRip-1080p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Efficient'
  AND name = '1080p Efficient';
-- --- END op 1754

-- --- BEGIN op 1755 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Efficient'
  AND name = '720p Quality';
-- --- END op 1755

-- --- BEGIN op 1756 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Efficient'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Efficient'
  AND name = '480p Quality';
-- --- END op 1756

-- --- BEGIN op 1757 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'Remux-2160p', NULL, 1, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'Remux-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1757

-- --- BEGIN op 1758 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'HDTV-2160p', NULL, 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1758

-- --- BEGIN op 1759 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'Remux-1080p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'Remux-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 1759

-- --- BEGIN op 1760 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'WEBRip-480p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1760

-- --- BEGIN op 1761 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'HDTV-480p', NULL, 5, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1761

-- --- BEGIN op 1762 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'BR-DISK', NULL, 6, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 1762

-- --- BEGIN op 1763 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'CAM', NULL, 7, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 1763

-- --- BEGIN op 1764 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'DVD-R', NULL, 8, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 1764

-- --- BEGIN op 1765 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'DVDSCR', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 1765

-- --- BEGIN op 1766 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'Raw-HD', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 1766

-- --- BEGIN op 1767 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'REGIONAL', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 1767

-- --- BEGIN op 1768 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'TELECINE', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 1768

-- --- BEGIN op 1769 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'TELESYNC', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 1769

-- --- BEGIN op 1770 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'WORKPRINT', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 1770

-- --- BEGIN op 1771 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Efficient', 'Unknown', NULL, 15, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 1771

-- --- BEGIN op 1772 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'Bluray-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'Bluray-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'WEBDL-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'WEBDL-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'WEBRip-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'WEBRip-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Efficient', '2160p Efficient', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Efficient'
    AND quality_group_name = '2160p Efficient'
    AND quality_name = 'WEBRip-720p'
);
-- --- END op 1772

-- --- BEGIN op 1773 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'Bluray-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBDL-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-1080p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Quality'
  AND name = '1080p Quality HDR';
-- --- END op 1773

-- --- BEGIN op 1774 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Quality'
  AND name = '720p Quality';
-- --- END op 1774

-- --- BEGIN op 1775 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Quality'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Quality'
  AND name = '480p Quality';
-- --- END op 1775

-- --- BEGIN op 1776 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'Remux-2160p', NULL, 1, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'Remux-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1776

-- --- BEGIN op 1777 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'WEBRip-2160p', NULL, 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'WEBRip-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1777

-- --- BEGIN op 1778 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'HDTV-2160p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1778

-- --- BEGIN op 1779 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'Remux-1080p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'Remux-1080p'
    AND quality_group_name IS NULL
);
-- --- END op 1779

-- --- BEGIN op 1780 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'WEBRip-480p', NULL, 5, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1780

-- --- BEGIN op 1781 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'HDTV-480p', NULL, 6, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1781

-- --- BEGIN op 1782 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'BR-DISK', NULL, 7, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 1782

-- --- BEGIN op 1783 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'CAM', NULL, 8, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 1783

-- --- BEGIN op 1784 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'DVD-R', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 1784

-- --- BEGIN op 1785 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'DVDSCR', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 1785

-- --- BEGIN op 1786 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'Raw-HD', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 1786

-- --- BEGIN op 1787 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'REGIONAL', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 1787

-- --- BEGIN op 1788 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'TELECINE', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 1788

-- --- BEGIN op 1789 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'TELESYNC', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 1789

-- --- BEGIN op 1790 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'WORKPRINT', NULL, 15, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 1790

-- --- BEGIN op 1791 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Quality', 'Unknown', NULL, 16, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Quality'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 1791

-- --- BEGIN op 1792 ( update quality_profile "2160p Quality" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'Bluray-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'Bluray-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'WEBDL-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'WEBDL-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'WEBRip-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'WEBRip-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Quality', '2160p Quality', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Quality'
    AND quality_group_name = '2160p Quality'
    AND quality_name = 'WEBRip-720p'
);
-- --- END op 1792

-- --- BEGIN op 1793 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '1080p Remux'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '1080p Remux'
  AND quality_name = 'Bluray-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '1080p Remux'
  AND quality_name = 'Remux-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '1080p Remux'
  AND quality_name = 'WEBDL-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '1080p Remux'
  AND quality_name = 'WEBRip-1080p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Remux'
  AND name = '1080p Remux';
-- --- END op 1793

-- --- BEGIN op 1794 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Remux'
  AND name = '720p Quality';
-- --- END op 1794

-- --- BEGIN op 1795 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 3
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '2160p Remux'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_groups
WHERE quality_profile_name = '2160p Remux'
  AND name = '480p Quality';
-- --- END op 1795

-- --- BEGIN op 1796 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'WEBRip-2160p', NULL, 1, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'WEBRip-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1796

-- --- BEGIN op 1797 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'HDTV-2160p', NULL, 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'HDTV-2160p'
    AND quality_group_name IS NULL
);
-- --- END op 1797

-- --- BEGIN op 1798 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'WEBRip-480p', NULL, 3, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'WEBRip-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1798

-- --- BEGIN op 1799 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'HDTV-480p', NULL, 4, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'HDTV-480p'
    AND quality_group_name IS NULL
);
-- --- END op 1799

-- --- BEGIN op 1800 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'BR-DISK', NULL, 5, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'BR-DISK'
    AND quality_group_name IS NULL
);
-- --- END op 1800

-- --- BEGIN op 1801 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'CAM', NULL, 6, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'CAM'
    AND quality_group_name IS NULL
);
-- --- END op 1801

-- --- BEGIN op 1802 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'DVD-R', NULL, 7, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'DVD-R'
    AND quality_group_name IS NULL
);
-- --- END op 1802

-- --- BEGIN op 1803 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'DVDSCR', NULL, 8, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'DVDSCR'
    AND quality_group_name IS NULL
);
-- --- END op 1803

-- --- BEGIN op 1804 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'Raw-HD', NULL, 9, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'Raw-HD'
    AND quality_group_name IS NULL
);
-- --- END op 1804

-- --- BEGIN op 1805 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'REGIONAL', NULL, 10, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'REGIONAL'
    AND quality_group_name IS NULL
);
-- --- END op 1805

-- --- BEGIN op 1806 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'TELECINE', NULL, 11, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'TELECINE'
    AND quality_group_name IS NULL
);
-- --- END op 1806

-- --- BEGIN op 1807 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'TELESYNC', NULL, 12, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'TELESYNC'
    AND quality_group_name IS NULL
);
-- --- END op 1807

-- --- BEGIN op 1808 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'WORKPRINT', NULL, 13, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'WORKPRINT'
    AND quality_group_name IS NULL
);
-- --- END op 1808

-- --- BEGIN op 1809 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until)
SELECT '2160p Remux', 'Unknown', NULL, 14, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = '2160p Remux'
    AND quality_name = 'Unknown'
    AND quality_group_name IS NULL
);
-- --- END op 1809

-- --- BEGIN op 1810 ( update quality_profile "2160p Remux" )
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'Bluray-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'Bluray-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'Bluray-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'Bluray-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'Bluray-576p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'Bluray-576p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'Bluray-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'Bluray-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'DVD'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'DVD'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'HDTV-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'HDTV-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'HDTV-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'HDTV-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'Remux-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'Remux-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'SDTV'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'SDTV'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'WEBDL-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'WEBDL-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'WEBDL-480p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'WEBDL-480p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'WEBDL-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'WEBDL-720p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'WEBRip-1080p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'WEBRip-1080p'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT '2160p Remux', '2160p Remux', 'WEBRip-720p'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = '2160p Remux'
    AND quality_group_name = '2160p Remux'
    AND quality_name = 'WEBRip-720p'
);
-- --- END op 1810

-- --- BEGIN op 1811 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 16
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'Raw-HD'
  AND quality_group_name IS NULL
  AND position = 17
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1811

-- --- BEGIN op 1812 ( update quality_profile "720p Quality" )
UPDATE quality_profile_qualities
SET position = 17
WHERE quality_profile_name = '720p Quality'
  AND quality_name = 'REGIONAL'
  AND quality_group_name IS NULL
  AND position = 16
  AND enabled = 0
  AND upgrade_until = 0;
-- --- END op 1812
