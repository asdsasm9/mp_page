/** Instagram planner constants (WP-14). The caption and hashtag limits equal the SQL checks in 20261116100000_ig_planner.sql. */
export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAGS_MAX = 2200;
export const IG_PHOTOS_MAX = 10;
export const IG_STATUSES = ['draft', 'planned', 'posted'] as const;
export type IgStatus = (typeof IG_STATUSES)[number];
