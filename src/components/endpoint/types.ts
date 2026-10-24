// Shared types for the Endpoint & Key page.

export interface KeyAccess {
  restricted: boolean;
  allow: string[];
}

// Normalized view model for an API key row.
// `key` is the masked value returned by GET /api/keys; full keys are
// fetched lazily via GET /api/keys?reveal=<id>.
export interface EndpointKey {
  id: string;
  name: string;
  key: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt?: number;
  access?: KeyAccess;
}
