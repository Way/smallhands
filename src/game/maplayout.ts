// Hand-authored geometry for the world-map level select, in viewBox units.
// Pure data + pure helpers, no DOM — headless tests can bundle this alone.
// Adding a campaign = one more TerritoryLayout entry (outline drawn by hand,
// node slots with headroom beyond the campaign's current level count).

export const VIEW_W = 1600;
export const VIEW_H = 900;

export interface Pt {
  x: number;
  y: number;
}

export interface TerritoryLayout {
  campaign: number; // matches LevelDef.campaign (1-based)
  nameKey: string; // i18n key of the territory label
  outline: string; // closed SVG path in viewBox coords
  label: Pt; // territory name anchor
  badge: Pt; // lock badge / completion flag anchor
  nodes: Pt[]; // level slots in play order
}

export const MAP_LAYOUT: TerritoryLayout[] = [
  {
    campaign: 1,
    nameKey: 'map.terr1',
    outline:
      'M 250 560 C 260 480 340 440 430 450 C 530 460 590 500 585 570 C 580 650 500 690 400 685 C 310 680 240 640 250 560 Z',
    label: { x: 420, y: 404 },
    badge: { x: 420, y: 570 },
    nodes: [
      { x: 305, y: 615 },
      { x: 390, y: 555 },
      { x: 470, y: 610 },
      { x: 540, y: 530 },
      { x: 505, y: 470 },
      { x: 425, y: 500 },
    ],
  },
  {
    campaign: 2,
    nameKey: 'map.terr2',
    outline:
      'M 640 340 C 660 250 760 210 870 220 C 980 230 1050 290 1035 370 C 1020 450 920 490 810 480 C 700 470 620 430 640 340 Z',
    label: { x: 840, y: 174 },
    badge: { x: 840, y: 350 },
    nodes: [
      { x: 690, y: 400 },
      { x: 760, y: 330 },
      { x: 850, y: 390 },
      { x: 930, y: 300 },
      { x: 990, y: 370 },
      { x: 930, y: 430 },
      { x: 850, y: 280 },
    ],
  },
  {
    campaign: 3,
    nameKey: 'map.terr3',
    outline:
      'M 1120 560 C 1150 470 1270 440 1370 452 C 1470 462 1550 515 1540 605 C 1530 700 1430 752 1315 745 C 1200 738 1095 660 1120 560 Z',
    label: { x: 1300, y: 404 },
    badge: { x: 1300, y: 600 },
    nodes: [
      { x: 1160, y: 620 },
      { x: 1260, y: 550 },
      { x: 1350, y: 620 },
      { x: 1440, y: 560 },
      { x: 1470, y: 660 },
      { x: 1380, y: 720 },
    ],
  },
  {
    campaign: 4,
    nameKey: 'map.terr4',
    // a lower island, apart from the others — the underground frontier
    outline:
      'M 700 760 C 715 680 815 645 915 657 C 1015 669 1075 715 1060 792 C 1045 866 945 892 850 882 C 755 872 685 838 700 760 Z',
    label: { x: 880, y: 618 },
    badge: { x: 880, y: 762 },
    // Play order threads a right-opening arc: level 13 sits at the top-right,
    // the corner nearest campaign 3 (whose journey ends up-right at ~1380,720),
    // so the incoming trail lands on the near shore instead of cutting once
    // straight across the island. From 13 the path sweeps left along the top
    // (14), down the left side (15), along the bottom (16) and back right (17)
    // — a simple C that never crosses itself. The 6th slot is unused headroom.
    nodes: [
      { x: 985, y: 715 },
      { x: 880, y: 700 },
      { x: 772, y: 745 },
      { x: 800, y: 828 },
      { x: 915, y: 838 },
      { x: 985, y: 808 },
    ],
  },
];

// The daily-challenge lighthouse island: a fixed landmark, not a campaign.
export const DAILY_ISLE =
  'M 145 175 C 150 130 195 110 235 122 C 272 133 285 170 265 200 C 245 230 190 235 160 215 C 145 205 142 192 145 175 Z';
export const DAILY_SPOT: Pt = { x: 205, y: 172 };

// Slot lookup with a dev safety net: a campaign may gain more levels than
// authored slots; extras extend along the last authored segment (and warn)
// instead of crashing the select screen.
export function nodePositions(campaign: number, count: number): Pt[] {
  const terr = MAP_LAYOUT.find((tr) => tr.campaign === campaign);
  if (!terr) throw new Error(`map layout: no territory for campaign ${campaign}`);
  const pts = terr.nodes.slice(0, count);
  if (count > terr.nodes.length) {
    console.warn(
      `map layout: campaign ${campaign} has ${count} levels but only ${terr.nodes.length} slots`
    );
    const n = terr.nodes;
    const b = n[n.length - 1];
    const a = n[n.length - 2] ?? { x: b.x - 60, y: b.y };
    for (let i = n.length; i < count; i++) {
      const k = i - n.length + 1;
      pts.push({ x: b.x + (b.x - a.x) * k, y: b.y + (b.y - a.y) * k });
    }
  }
  return pts;
}

// The dotted journey line threads every level slot in campaign order.
export function journeyPoints(countByCampaign: Map<number, number>): Pt[] {
  const out: Pt[] = [];
  for (const terr of MAP_LAYOUT) {
    out.push(...nodePositions(terr.campaign, countByCampaign.get(terr.campaign) ?? 0));
  }
  return out;
}
