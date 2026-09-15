import type { MetadataRoute } from 'next';

import { deploymentInfo } from '@/lib/env/deployment';

import { robotsRules } from './robots-rules';

/** Served as /robots.txt. The rules, and why, are in ./robots-rules.ts. */
export default function robots(): MetadataRoute.Robots {
  return robotsRules(deploymentInfo().environment);
}
