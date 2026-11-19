// Types for the OAuth 2.0 (PKCE authorization-code) flow against
// claude.ai / console.anthropic.com. Response types keep the backend's
// snake_case field names; OAuthTokens is the camelCase shape used in-process.

/** Plan derived from the profile's organization type. */
export type SubscriptionType = 'max' | 'pro' | 'enterprise' | 'team'

/** Tiers surfaced by the backend for Max-family seats (5x / 20x). */
export type RateLimitTier = 'default_claude_max_5x' | 'default_claude_max_20x'

/** Payment channel recorded on the organization; drives overage eligibility. */
export type BillingType =
  | 'stripe_subscription'
  | 'stripe_subscription_contracted'
  | 'apple_subscription'
  | 'google_play_subscription'

/** `GET /api/oauth/profile` (also served for API keys via claude_cli_profile). */
export type OAuthProfileResponse = {
  account: {
    uuid: string
    email: string
    display_name?: string | null
    created_at?: string
    // Entitlement flags surfaced by the profile endpoint alongside the
    // organization's `organization_type`; consult them before prompting /login.
    has_claude_max?: boolean
    has_claude_pro?: boolean
  }
  organization: {
    uuid: string
    organization_type?: 'claude_max' | 'claude_pro' | 'claude_enterprise' | 'claude_team'
    rate_limit_tier?: RateLimitTier | null
    has_extra_usage_enabled?: boolean | null
    billing_type?: BillingType | null
    subscription_created_at?: string | null
  }
}

/** Response of the token endpoint for both authorization-code and refresh grants. */
export type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
  account?: {
    uuid: string
    email_address: string
  } | null
  organization?: {
    uuid: string
  } | null
}

/** In-process representation of the stored Claude.ai OAuth credentials. */
export type OAuthTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType: SubscriptionType | null
  rateLimitTier: RateLimitTier | null
  profile?: OAuthProfileResponse
  tokenAccount?: {
    uuid: string
    emailAddress: string
    organizationUuid: string | undefined
  }
}

/** `GET /api/oauth/claude_cli/roles`. */
export type UserRolesResponse = {
  organization_role: string | null
  workspace_role: string | null
  organization_name: string | null
}

/** Guest-pass campaign identifiers accepted by the referral endpoints. */
export type ReferralCampaign = 'claude_code_guest_pass'

/** Reward the referrer earns once a redeemed pass converts to a subscription. */
export type ReferrerRewardInfo = {
  currency: string
  amount_minor_units: number
}

/** `GET .../referral/eligibility`; cached per org with a `timestamp` added. */
export type ReferralEligibilityResponse = {
  eligible: boolean
  remaining_passes?: number
  referrer_reward?: ReferrerRewardInfo | null
  referral_code_details?: {
    referral_link?: string
    campaign?: ReferralCampaign
  }
}

/** `GET .../referral/redemptions`; only presence and the limit are consumed. */
export type ReferralRedemptionsResponse = {
  redemptions?: unknown[]
  limit?: number
}
