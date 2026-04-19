/**
 * Shared Product Catalog schema.
 *
 * This file mirrors the shape consumed by ideaplaces.com. Keep this in sync
 * with `ideaplaces-website/src/lib/catalog-schema.ts`. Any IdeaPlaces product
 * that publishes a catalog at `/api/catalog` must conform to this shape.
 */

export type ProductStatus = 'live' | 'beta' | 'coming-soon' | 'archived'
export type ProductCurrency = 'USD' | 'EUR' | 'CAD'
export type PricingPeriod = 'month' | 'year' | 'one-time' | null

export interface Feature {
  title: string
  body: string
  icon?: string
}

export interface Cta {
  label: string
  href: string
}

export interface PricingTier {
  name: string
  price: number
  period?: PricingPeriod
  features: string[]
  cta?: Cta
  highlighted?: boolean
}

export interface Pricing {
  currency: ProductCurrency
  tiers: PricingTier[]
}

export interface Theme {
  primary?: string
  accent?: string
  background?: string
}

export interface ProductLinks {
  docs?: string
  github?: string
  api?: string
  changelog?: string
}

export interface ProductCatalog {
  $schema: 1
  name: string
  slug: string
  status: ProductStatus
  url: string
  tagline: string
  description: string
  category?: string
  features: Feature[]
  pricing?: Pricing
  theme?: Theme
  screenshot?: string
  ogImage?: string
  cta?: Cta
  links?: ProductLinks
}
